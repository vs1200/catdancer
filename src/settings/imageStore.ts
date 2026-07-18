/**
 * ユーザー画像（Blob）の IndexedDB 永続化。
 *
 * localStorage は容量が小さく画像に不足しうるため、画像バイナリは必ず IndexedDB に置く
 * （キー=imageId）。全 API は非同期で、IndexedDB 非対応/失敗時も安全にガードする:
 * - getImage: 失敗/未存在なら null を返す（例外を投げない）。
 * - putImage: 成否を呼び出し側が判断できるよう、失敗時は reject する
 *   （SettingsStore は reject を捕捉して設定を変更しないでガードする）。
 * - deleteImage: 失敗しても no-op（orphan 掃除は best-effort）。
 *
 * ストアは 2 つに分離する（名前空間を跨がない）:
 * - "images": 背景画像。putImage/getImage/deleteImage/pruneImagesExcept が触る。
 * - "critterImages": ユーザー任意画像クリッター。putCritterImage/... が触る。
 * 背景の prune はクリッター画像を消さず、クリッターの prune は背景を消さない
 * （＝ストア分離が肝。両者の "1 枚だけ保持" 不変条件を独立に成立させる）。
 */

const DB_NAME = "catdancer";
/** v1: "images" のみ。v2: "critterImages" を追加（既存 "images" は保持）。 */
const DB_VERSION = 2;
/** 背景画像ストア。 */
const STORE_NAME = "images";
/** ユーザー任意画像クリッター用ストア（背景と分離）。 */
const CRITTER_STORE_NAME = "critterImages";

/** IndexedDB が利用可能か（プライベートモード等で例外になる環境をガード）。 */
function isIndexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    // セキュリティ制限で indexedDB 参照自体が例外になる環境がある。
    return false;
  }
}

/** DB を開く（初回/バージョン上げ時に object store を作成）。非対応/失敗時は reject。 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new Error("IndexedDB は利用できません"));
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error instanceof Error ? error : new Error("IndexedDB open に失敗しました"));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      // どのストアも「無ければ作る」= idempotent。v1→v2 では "images" を保持しつつ
      // "critterImages" を追加する（既存データは消えない）。
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // out-of-line key（put(value, key) で imageId を指定）。
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(CRITTER_STORE_NAME)) {
        db.createObjectStore(CRITTER_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open に失敗しました"));
    request.onblocked = () => reject(new Error("IndexedDB open がブロックされました"));
  });
}

/** 指定ストアへ画像 Blob を id で保存する。失敗時は reject（呼び出し側がガードできる）。 */
async function putImageIn(storeName: string, id: string, blob: Blob): Promise<void> {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("画像の保存に失敗しました"));
      tx.onabort = () => reject(tx.error ?? new Error("画像の保存が中断されました"));
    });
  } finally {
    db.close();
  }
}

/** 指定ストアから画像 Blob を id で取得する。未存在・失敗・非対応は null。 */
async function getImageIn(storeName: string, id: string): Promise<Blob | null> {
  let db: IDBDatabase;
  try {
    db = await openDB();
  } catch {
    // IndexedDB 非対応/失敗時は画像なし扱い。
    return null;
  }
  try {
    return await new Promise<Blob | null>((resolve) => {
      const tx = db.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).get(id);
      request.onsuccess = () => {
        const value = request.result;
        resolve(value instanceof Blob ? value : null);
      };
      request.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

/** 指定ストアから画像 Blob を id で削除する。失敗しても no-op（best-effort の orphan 掃除）。 */
async function deleteImageIn(storeName: string, id: string): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await openDB();
  } catch {
    // 開けなければ掃除不能だが致命的ではないので黙って諦める。
    return;
  }
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

/**
 * 指定ストアで keepId 以外の全画像を削除する（keepId=null なら全削除）。失敗しても no-op。
 * 常に 1 枚しか保持しない不変条件を保証し、orphan（連続差し替え時の取りこぼし・旧セッションの
 * 残骸）を確実に掃除する。deleteImage(previousId) は同時多重呼び出しで previousId 捕捉が
 * 競合して取りこぼしうるため、こちらを正の掃除経路に使う。
 * 対象ストアのキーだけを走査するので、別ストア（背景⇔クリッター）は決して消さない。
 */
async function pruneImagesExceptIn(storeName: string, keepId: string | null): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await openDB();
  } catch {
    return;
  }
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const request = store.getAllKeys();
      request.onsuccess = () => {
        for (const key of request.result) {
          if (key !== keepId) {
            store.delete(key);
          }
        }
      };
      // getAllKeys 失敗時も掃除は諦めるだけで致命的でない。
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

// --- 背景画像（"images" ストア） ---

/** 背景画像 Blob を id で保存する。失敗時は reject（呼び出し側がガードできる）。 */
export function putImage(id: string, blob: Blob): Promise<void> {
  return putImageIn(STORE_NAME, id, blob);
}

/** 背景画像 Blob を id で取得する。未存在・失敗・非対応は null。 */
export function getImage(id: string): Promise<Blob | null> {
  return getImageIn(STORE_NAME, id);
}

/** 背景画像 Blob を id で削除する。失敗しても no-op。 */
export function deleteImage(id: string): Promise<void> {
  return deleteImageIn(STORE_NAME, id);
}

/** 背景画像ストアで keepId 以外を全削除する（keepId=null なら全削除）。クリッター画像は触らない。 */
export function pruneImagesExcept(keepId: string | null): Promise<void> {
  return pruneImagesExceptIn(STORE_NAME, keepId);
}

// --- ユーザー任意画像クリッター（"critterImages" ストア） ---

/** クリッター画像 Blob を id で保存する。失敗時は reject（呼び出し側がガードできる）。 */
export function putCritterImage(id: string, blob: Blob): Promise<void> {
  return putImageIn(CRITTER_STORE_NAME, id, blob);
}

/** クリッター画像 Blob を id で取得する。未存在・失敗・非対応は null。 */
export function getCritterImage(id: string): Promise<Blob | null> {
  return getImageIn(CRITTER_STORE_NAME, id);
}

/** クリッター画像 Blob を id で削除する。失敗しても no-op。 */
export function deleteCritterImage(id: string): Promise<void> {
  return deleteImageIn(CRITTER_STORE_NAME, id);
}

/** クリッター画像ストアで keepId 以外を全削除する（keepId=null なら全削除）。背景画像は触らない。 */
export function pruneCritterImagesExcept(keepId: string | null): Promise<void> {
  return pruneImagesExceptIn(CRITTER_STORE_NAME, keepId);
}
