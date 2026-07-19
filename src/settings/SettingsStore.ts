import {
  pruneCritterImagesExcept,
  pruneImagesExcept,
  putCritterImage,
  putImage,
} from "./imageStore";
import { normalizeManualTypeId } from "./manualTargets";
import type { AppMode, AppSettings, BackgroundType, InsectManualPattern } from "./settingsData";
import {
  clampPlayLimitMinutes,
  clampSpawnInterval,
  clampVolume,
  DEFAULT_AUTO_SPEED_SCALE,
  DEFAULT_MANUAL_SPEED_SCALE,
  normalizeAutoDisabledTypes,
  normalizeHexColor,
  normalizeHideCursor,
  normalizeInsectManualPattern,
  normalizeMode,
  normalizeMuted,
  normalizeObjectScale,
  normalizeSoundEnabled,
  normalizeSpeedScale,
  parseSettings,
  serializeSettings,
} from "./settingsData";
import type { SpawnPreset } from "./spawnPresets";

/**
 * アプリ設定を保持・購読・永続化するストア。
 *
 * - 設定 JSON（type/color/imageId/masterVolume）は localStorage に保存/復元する。
 *   画像バイナリは容量的に IndexedDB（imageStore）へ。ここには入れない。
 * - 変更は commit()（永続化 + 購読者通知）でまとめて反映し、Scene / AudioManager が
 *   subscribe で追従する（ストアは描画/音声に直接依存しない）。
 * - 敵対的ガード: localStorage/IndexedDB が失敗しても設定操作はクラッシュしない。
 *   setBackgroundImage は IDB 保存に成功したときだけ type=image に切り替える。
 *
 * オプション画面(#10)はこのインスタンスの公開 API を呼ぶ。
 */

const STORAGE_KEY = "catdancer:settings";

export type SettingsListener = (settings: AppSettings) => void;

export class SettingsStore {
  private state: AppSettings;
  private readonly listeners = new Set<SettingsListener>();
  private readonly storageKey: string;
  /** 画像 I/O（IDB put/prune）を直列化するチェーン。 */
  private imageOpChain: Promise<void> = Promise.resolve();

  constructor(storageKey: string = STORAGE_KEY) {
    this.storageKey = storageKey;
    this.state = this.load();
  }

  /** 現在の設定のスナップショット（購読側からの直接改変を防ぐためコピーを返す）。 */
  get settings(): AppSettings {
    return {
      background: { ...this.state.background },
      masterVolume: this.state.masterVolume,
      muted: this.state.muted,
      hideCursor: this.state.hideCursor,
      mode: this.state.mode,
      manualTypeId: this.state.manualTypeId,
      insectManualPattern: this.state.insectManualPattern,
      autoSpawnIntervalMs: this.state.autoSpawnIntervalMs,
      autoPlayLimitMinutes: this.state.autoPlayLimitMinutes,
      customCritterImageId: this.state.customCritterImageId,
      autoDisabledTypes: [...this.state.autoDisabledTypes],
      manualSpeedScale: this.state.manualSpeedScale,
      autoSpeedScale: this.state.autoSpeedScale,
      manualObjectScales: { ...this.state.manualObjectScales },
      autoObjectScales: { ...this.state.autoObjectScales },
      objectSoundEnabled: { ...this.state.objectSoundEnabled },
    };
  }

  /** 変更通知を購読する。返り値を呼ぶと解除。 */
  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 背景を単色に切り替え、色を設定する（hex 不正時は現状色を維持）。 */
  setBackgroundColor(hex: string): void {
    this.state.background.color = normalizeHexColor(hex, this.state.background.color);
    this.state.background.type = "color";
    this.commit();
  }

  /**
   * 背景をユーザー画像に設定する。Blob を IndexedDB へ保存してから type=image・imageId を更新する。
   * IDB 保存に失敗した場合は設定を変更しない（ガード）。
   *
   * 画像 I/O は enqueueImageOp で直列化する。連続呼び出しでも put→commit→掃除 が
   * 割り込まれないため、取りこぼし orphan も、古い掃除が現行画像を誤削除する事故も起きない
   * （常に最後の呼び出しが勝ち、IDB には現行 1 枚だけが残る）。
   */
  setBackgroundImage(blob: Blob): Promise<void> {
    return this.enqueueImageOp(async () => {
      const id = generateImageId("bg");
      try {
        await putImage(id, blob);
      } catch (error) {
        console.warn("背景画像の保存に失敗しました。設定は変更しません。", error);
        return;
      }
      this.state.background.imageId = id;
      this.state.background.type = "image";
      this.commit();
      // 保持するのは常にこの 1 枚のみ。旧画像/残骸をまとめて掃除する。
      await pruneImagesExcept(id);
    });
  }

  /** 背景の種類だけを切り替える（imageId は保持。UI のトグル用）。 */
  setBackgroundType(type: BackgroundType): void {
    this.state.background.type = type;
    this.commit();
  }

  /** ユーザー画像を破棄して単色に戻す（IDB の画像も全削除）。画像 I/O は直列化する。 */
  clearBackgroundImage(): Promise<void> {
    return this.enqueueImageOp(async () => {
      this.state.background.imageId = null;
      this.state.background.type = "color";
      this.commit();
      // 画像は保持しないので IDB を全掃除する。
      await pruneImagesExcept(null);
    });
  }

  /**
   * ユーザー任意画像クリッター（単一スロット）を設定する。Blob を IndexedDB（"critterImages"）へ
   * 保存してから customCritterImageId を更新する。IDB 保存に失敗した場合は設定を変更しない（ガード）。
   *
   * 背景画像 set と同じ流儀: enqueueImageOp で直列化し、put→commit→掃除 が割り込まれないため
   * 取りこぼし orphan も、古い掃除が現行画像を誤削除する事故も起きない（常に最後の呼び出しが勝ち、
   * "critterImages" には現行 1 枚だけが残る）。掃除は critterImages ストア限定＝背景を消さない。
   */
  setCustomCritterImage(blob: Blob): Promise<void> {
    return this.enqueueImageOp(async () => {
      const id = generateImageId("critter");
      try {
        await putCritterImage(id, blob);
      } catch (error) {
        console.warn("クリッター画像の保存に失敗しました。設定は変更しません。", error);
        return;
      }
      this.state.customCritterImageId = id;
      this.commit();
      // 保持するのは常にこの 1 枚のみ。旧画像/残骸をまとめて掃除する（背景は触らない）。
      await pruneCritterImagesExcept(id);
    });
  }

  /** ユーザー任意画像クリッターを破棄する（IDB の critterImages を全掃除）。画像 I/O は直列化する。 */
  clearCustomCritterImage(): Promise<void> {
    return this.enqueueImageOp(async () => {
      this.state.customCritterImageId = null;
      this.commit();
      // 画像は保持しないので critterImages を全掃除する（背景は触らない）。
      await pruneCritterImagesExcept(null);
    });
  }

  /** master 音量を設定する（[0,1] にクランプして永続化＋通知）。 */
  setMasterVolume(value: number): void {
    this.state.masterVolume = clampVolume(value);
    this.commit();
  }

  /**
   * 一括ミュート（映像のみモード）を設定する（永続化＋通知）。
   * masterVolume 値は変えないため、解除で元の音量に戻る。
   */
  setMuted(muted: boolean): void {
    this.state.muted = normalizeMuted(muted);
    this.commit();
  }

  /**
   * マウスカーソル非表示モードを設定する（永続化＋通知）。既定 false（オプトイン）。
   * 実際のカーソル表示制御は main.ts の購読が担う（歯車付近・パネル表示中は通常表示）。
   */
  setHideCursor(hideCursor: boolean): void {
    this.state.hideCursor = normalizeHideCursor(hideCursor);
    this.commit();
  }

  /** 表示モードを設定する（manual/auto。不正値は manual へ正規化）。 */
  setMode(mode: AppMode): void {
    this.state.mode = normalizeMode(mode);
    this.commit();
  }

  /**
   * [UR-4] マウス操作モードの「操作するもの」種別 id を設定する（永続化＋通知）。
   * 選択可能な id（MANUAL_TARGETS）以外は mouse へ正規化する。main の購読が
   * manualMode.setManualType へ実配線し、実行中でも即差し替える（旧 critter/pointer/audio をリークなく破棄）。
   */
  setManualTypeId(typeId: string): void {
    this.state.manualTypeId = normalizeManualTypeId(typeId);
    this.commit();
  }

  /**
   * [UR3-5] 操作対象=虫の動きパターンを設定する（click=クリックで出現 / follow=マウス追従。永続化＋通知）。
   * 許可集合外/異常型は既定 click へ正規化する。main の購読が現在虫を操作中なら虫コントローラを作り直す
   * （InsectManualController↔FollowManualController(insect) を差し替え、既存虫を残さない）。
   */
  setInsectManualPattern(pattern: InsectManualPattern): void {
    this.state.insectManualPattern = normalizeInsectManualPattern(pattern);
    this.commit();
  }

  /** auto モードの出現間隔(ms)を設定する（範囲外はクランプして永続化＋通知）。 */
  setAutoSpawnInterval(ms: number): void {
    this.state.autoSpawnIntervalMs = clampSpawnInterval(ms);
    this.commit();
  }

  /**
   * [UR3-8] マウス操作モードの動きの速さ倍率を設定する（[MIN,MAX] にクランプ／非有限・0以下は
   * 既定 1.0 へ。永続化＋通知）。auto とは独立。main の購読が manualMode.setSpeedScale へ実配線する。
   */
  setManualSpeedScale(value: number): void {
    this.state.manualSpeedScale = normalizeSpeedScale(value, DEFAULT_MANUAL_SPEED_SCALE);
    this.commit();
  }

  /**
   * [UR3-8] 動画モード(auto)の動きの速さ倍率を設定する（[MIN,MAX] にクランプ／非有限・0以下は
   * 既定 1.8 へ。永続化＋通知）。manual とは独立。main の購読が autoMode.setSpeedScale へ実配線する。
   */
  setAutoSpeedScale(value: number): void {
    this.state.autoSpeedScale = normalizeSpeedScale(value, DEFAULT_AUTO_SPEED_SCALE);
    this.commit();
  }

  /**
   * [UR4-2] マウス操作モードの指定種別の表示サイズ倍率を設定する（該当キーのみ更新。永続化＋通知）。
   * 値は {@link normalizeObjectScale}（[MIN,MAX] クランプ／非有限・0以下・型不一致は既定 1.0）で正規化する。
   * auto とは独立。main の購読が現在その種別を操作中なら manualMode.rebuildCurrent() で 1 体へ即反映する。
   */
  setManualObjectScale(typeId: string, value: number): void {
    this.state.manualObjectScales[typeId] = normalizeObjectScale(value);
    this.commit();
  }

  /**
   * [UR4-2] 動画モード(auto)の指定種別の表示サイズ倍率を設定する（該当キーのみ更新。永続化＋通知）。
   * 値は {@link normalizeObjectScale} で正規化する。manual とは独立。main の購読が
   * autoMode.setSizeMultipliers へ実配線し、以後 spawn される該当種別の表示サイズへ反映される。
   */
  setAutoObjectScale(typeId: string, value: number): void {
    this.state.autoObjectScales[typeId] = normalizeObjectScale(value);
    this.commit();
  }

  /**
   * [UR4-3] 指定種別の効果音 ON/OFF を設定する（該当キーのみ更新。永続化＋通知）。
   * enabled は {@link normalizeSoundEnabled}（真偽値のみ採用・異常型は既定 true）で正規化する。
   * manual/auto 共通の単一フラグ。main の購読が autoMode.setSoundEnabled へ live-apply し、manual は
   * 各コントローラが closure でこの値をライブ参照するため respawn せず次フレームの present 判定へ即反映する。
   */
  setObjectSoundEnabled(typeId: string, enabled: boolean): void {
    this.state.objectSoundEnabled[typeId] = normalizeSoundEnabled(enabled);
    this.commit();
  }

  /**
   * auto モードの遊びすぎ防止タイマー上限(分)を設定する（0＝OFF。範囲外はクランプして永続化＋通知）。
   */
  setAutoPlayLimitMinutes(minutes: number): void {
    this.state.autoPlayLimitMinutes = clampPlayLimitMinutes(minutes);
    this.commit();
  }

  /**
   * auto モードで指定種別の出現を有効/無効にする（永続化＋通知）。
   * enabled=false なら autoDisabledTypes に追加（重複なし）、true なら除去する。
   */
  setAutoTypeEnabled(typeId: string, enabled: boolean): void {
    const disabled = this.state.autoDisabledTypes;
    const idx = disabled.indexOf(typeId);
    if (enabled) {
      if (idx >= 0) {
        disabled.splice(idx, 1);
      }
    } else if (idx < 0) {
      disabled.push(typeId);
    }
    this.commit();
  }

  /**
   * 出現プリセット（賑やか/標準/控えめ）を一括適用する（永続化＋通知は commit 1 回のみ）。
   * autoSpawnIntervalMs と autoDisabledTypes をまとめて設定するため購読者への通知は 1 回で済み、
   * main の subscribe が interval と disabledTypes の両差分を 1 パスで反映する。
   * disabledTypes は外部の readonly 配列を共有せず、コピー＆正規化（非文字列/重複を除去）して state に持つ。
   */
  applySpawnPreset(preset: SpawnPreset): void {
    this.state.autoSpawnIntervalMs = clampSpawnInterval(preset.intervalMs);
    this.state.autoDisabledTypes = normalizeAutoDisabledTypes([...preset.disabledTypes]);
    this.commit();
  }

  /**
   * 画像 I/O を前操作の完了後に直列実行する。前操作が失敗してもチェーンは継続する
   * （次の操作を止めない）。返す Promise は当該操作の完了で解決する。
   */
  private enqueueImageOp(op: () => Promise<void>): Promise<void> {
    const run = this.imageOpChain.then(op, op);
    this.imageOpChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private load(): AppSettings {
    return parseSettings(readLocalStorage(this.storageKey));
  }

  private commit(): void {
    this.persist();
    this.notify();
  }

  private persist(): void {
    try {
      writeLocalStorage(this.storageKey, serializeSettings(this.state));
    } catch (error) {
      // 容量超過/プライベートモード等。永続化は諦めるが状態は保つ。
      console.warn("設定の永続化に失敗しました。", error);
    }
  }

  private notify(): void {
    const snapshot = this.settings;
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        // 購読者の例外で他購読者やストアを巻き込まない。
        console.warn("設定購読者の処理でエラーが発生しました。", error);
      }
    }
  }
}

/**
 * 画像 ID を生成する（crypto.randomUUID 優先、非対応環境はフォールバック）。
 * prefix で用途を区別する（背景="bg" / クリッター="critter"）。
 */
function generateImageId(prefix: string): string {
  try {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c && typeof c.randomUUID === "function") {
      return `${prefix}-${c.randomUUID()}`;
    }
  } catch {
    // crypto 参照が例外になる環境ではフォールバックへ。
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readLocalStorage(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") {
      return null;
    }
    return localStorage.getItem(key);
  } catch {
    // アクセス自体が例外になる環境（プライベートモード等）。
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(key, value);
}

export { STORAGE_KEY };
