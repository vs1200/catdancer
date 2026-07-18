/**
 * ユーザー背景画像（Blob）の IndexedDB 永続化。
 *
 * localStorage は容量が小さく画像に不足しうるため、画像バイナリは必ず IndexedDB に置く
 * （キー=imageId）。全 API は非同期で、IndexedDB 非対応/失敗時も安全にガードする:
 * - getImage: 失敗/未存在なら null を返す（例外を投げない）。
 * - putImage: 成否を呼び出し側が判断できるよう、失敗時は reject する
 *   （SettingsStore は reject を捕捉して設定を変更しないでガードする）。
 * - deleteImage: 失敗しても no-op（orphan 掃除は best-effort）。
 */

const DB_NAME = "catdancer";
const DB_VERSION = 1;
const STORE_NAME = "images";

/** IndexedDB が利用可能か（プライベートモード等で例外になる環境をガード）。 */
function isIndexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    // セキュリティ制限で indexedDB 参照自体が例外になる環境がある。
    return false;
  }
}

/** DB を開く（初回は object store を作成）。非対応/失敗時は reject。 */
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
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // out-of-line key（put(value, key) で imageId を指定）。
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open に失敗しました"));
    request.onblocked = () => reject(new Error("IndexedDB open がブロックされました"));
  });
}

/** 画像 Blob を id で保存する。失敗時は reject（呼び出し側がガードできる）。 */
export async function putImage(id: string, blob: Blob): Promise<void> {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("画像の保存に失敗しました"));
      tx.onabort = () => reject(tx.error ?? new Error("画像の保存が中断されました"));
    });
  } finally {
    db.close();
  }
}

/** 画像 Blob を id で取得する。未存在・失敗・非対応は null。 */
export async function getImage(id: string): Promise<Blob | null> {
  let db: IDBDatabase;
  try {
    db = await openDB();
  } catch {
    // IndexedDB 非対応/失敗時は画像なし扱い（背景は単色フォールバック）。
    return null;
  }
  try {
    return await new Promise<Blob | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(id);
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

/** 画像 Blob を id で削除する。失敗しても no-op（best-effort の orphan 掃除）。 */
export async function deleteImage(id: string): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await openDB();
  } catch {
    // 開けなければ掃除不能だが致命的ではないので黙って諦める。
    return;
  }
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

/**
 * keepId 以外の全画像を削除する（keepId=null なら全削除）。失敗しても no-op。
 * 背景画像は常に 1 枚しか保持しない不変条件を保証し、orphan（連続差し替え時の取りこぼし・
 * 旧セッションの残骸）を確実に掃除する。deleteImage(previousId) は同時多重呼び出しで
 * previousId 捕捉が競合して取りこぼしうるため、こちらを正の掃除経路に使う。
 */
export async function pruneImagesExcept(keepId: string | null): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await openDB();
  } catch {
    return;
  }
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
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
