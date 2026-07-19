/**
 * アプリ設定の型・デフォルト・直列化/正規化（DOM/PixiJS 非依存 = Vitest で単体テスト可能）。
 *
 * localStorage には type/color/imageId/masterVolume の JSON のみを保存する
 * （画像バイナリは容量的に IndexedDB へ。ここには入れない）。
 * 壊れた JSON・未知キー・型不一致に対しては安全にデフォルトへフォールバックする。
 */

import { DEFAULT_MANUAL_TYPE_ID, normalizeManualTypeId } from "./manualTargets";

/** 背景の種類。単色 or ユーザー画像。 */
export type BackgroundType = "color" | "image";

/** 表示モード。manual=マウス操作（1体を追従）/ auto=動画モード（自動で出現・横切り）。 */
export type AppMode = "manual" | "auto";

/**
 * [UR3-5] マウス操作モードで操作対象が「虫」のときの動きパターン。
 * click=クリックした位置へ虫が画面外から飛び込み複数出現（UR3-4 の挙動）/
 * follow=1 匹の虫がネズミのようにカーソルへ追従する。既定は click（従来挙動を保つ）。
 */
export type InsectManualPattern = "click" | "follow";

/** 背景設定。type=image のとき imageId が IndexedDB のキーを指す。 */
export interface BackgroundSettings {
  type: BackgroundType;
  /** 単色背景の色（正規化済み `#rrggbb`、小文字）。 */
  color: string;
  /** ユーザー画像の IndexedDB キー。未設定は null。 */
  imageId: string | null;
}

/** アプリ全体の設定。 */
export interface AppSettings {
  background: BackgroundSettings;
  /** master 音量(0..1)。 */
  masterVolume: number;
  /**
   * 一括ミュート（映像のみモード）。既定 false。true の間は無音化するが masterVolume 値は保持する
   * （解除で元の音量に戻る）。夜間や音に驚く猫向けに映像だけで遊ばせる用途。
   */
  muted: boolean;
  /**
   * マウスカーソル非表示モード。既定 false（オプトイン）。true の間はプレイ領域（#app）で
   * カーソルを隠す（猫が物理マウスカーソルを追う誤作動を防ぐ）。歯車ボタン付近・設定パネル
   * 表示中は人間が操作できるよう通常表示のまま（表示制御は main.ts が担い、位置取得は不変）。
   */
  hideCursor: boolean;
  /** 表示モード（manual=マウス操作 / auto=動画モード）。 */
  mode: AppMode;
  /**
   * [UR-4] マウス操作モードで「操作するもの」の種別 id（既定 mouse＝ネズミ）。
   * 選択可能な値は MANUAL_TARGETS（mouse/foxtail/toys/insect）。範囲外/欠損は mouse へ正規化する。
   * UR-4 時点は全対象がカーソル追従（プレースホルダ）。固有 manual 挙動は UR-5/UR-6 で差し替える。
   */
  manualTypeId: string;
  /**
   * [UR3-5] 操作対象=虫のときの動きパターン（click=クリックで出現 / follow=マウス追従）。既定 click。
   * 操作対象が虫以外のときは無視されるが値は保持し、虫を選び直すと復元される。
   * 許可集合外/異常型の永続値は click へ正規化する（normalizeInsectManualPattern）。
   */
  insectManualPattern: InsectManualPattern;
  /** auto モードのオブジェクト出現間隔(ms)。 */
  autoSpawnIntervalMs: number;
  /**
   * auto（動画モード）の遊びすぎ防止タイマー上限(分)。既定 0（OFF＝無制限）。
   * 到達すると自動停止し、動くオブジェクトを消して無音の穏やかな背景のみにする。
   */
  autoPlayLimitMinutes: number;
  /**
   * ユーザー任意画像クリッター（単一スロット）の IndexedDB キー（"critterImages" ストア）。
   * 未設定は null。画像バイナリは容量的に IndexedDB へ。ここには id のみを持つ。
   */
  customCritterImageId: string | null;
  /**
   * auto モードで出現を無効化する組み込み種別 id の配列（既定 []＝全種別有効）。
   * 「無効化リスト」方式にする理由: 新種別はデフォルトで有効(前方互換)＝好ましい。
   * カスタム画像クリッターは画像の設定/削除が実質のON/OFFなのでこのリストの対象外。
   */
  autoDisabledTypes: string[];
  /**
   * [UR3-8] マウス操作モードの動きの速さの全体倍率（既定 1.0＝従来同一）。
   * Critter.update が dt に乗じて全 movement へ均一適用する（出現頻度＝spawn 間隔とは独立）。
   * auto モードとは独立に設定・永続化する（動画モードは別倍率＝autoSpeedScale）。
   */
  manualSpeedScale: number;
  /**
   * [UR3-8] 動画モード(auto)の動きの速さの全体倍率（既定 1.8＝従来の「とてもはやい」相当へ底上げ）。
   * 動画モードは全体的に速い方が映えるため manual と別倍率にし、既定を底上げする。
   * 旧単一 speedScale からの migration では auto はこの既定(1.8)を採る（旧storageでも底上げ）。
   */
  autoSpeedScale: number;
}

/** 既定の背景色（単色 白）。 */
export const DEFAULT_BACKGROUND_COLOR = "#ffffff";
/** 既定の master 音量。 */
export const DEFAULT_MASTER_VOLUME = 0.5;
/** 既定のミュート状態（映像のみモード）。既定 false（音あり）。 */
export const DEFAULT_MUTED = false;
/** 既定のマウスカーソル非表示状態。既定 false（オプトイン＝初回はカーソル表示）。 */
export const DEFAULT_HIDE_CURSOR = false;
/** 既定の表示モード。 */
export const DEFAULT_MODE: AppMode = "manual";
/** [UR3-5] 操作対象=虫の動きパターンの既定（click=クリックで出現＝従来 UR3-4 挙動）。 */
export const DEFAULT_INSECT_MANUAL_PATTERN: InsectManualPattern = "click";
/** auto モードの既定出現間隔(ms)。 */
export const DEFAULT_AUTO_SPAWN_INTERVAL_MS = 1500;
/** 出現間隔の下限(ms)。極小値による spawn 暴走を UI/設定段で防ぐ。 */
export const MIN_AUTO_SPAWN_INTERVAL_MS = 200;
/** 出現間隔の上限(ms)。 */
export const MAX_AUTO_SPAWN_INTERVAL_MS = 8000;
/** 遊びすぎ防止タイマーの既定上限(分)。0＝OFF（無制限）。 */
export const DEFAULT_AUTO_PLAY_LIMIT_MINUTES = 0;
/** 遊びすぎ防止タイマーの上限(分)の上限値（永続値の暴走ガード）。 */
export const MAX_AUTO_PLAY_LIMIT_MINUTES = 180;
/** UI に並べる遊びすぎ防止の選択肢(分)。0＝なし（OFF）。 */
export const AUTO_PLAY_LIMIT_OPTIONS_MINUTES: readonly number[] = [0, 5, 10, 15, 30];

/** [UR3-8] マウス操作モードの動きの速さ倍率の既定値（1.0＝従来と完全に同一）。 */
export const DEFAULT_MANUAL_SPEED_SCALE = 1.0;
/**
 * [UR3-8] 動画モード(auto)の動きの速さ倍率の既定値（1.8＝従来の「とてもはやい」相当へ底上げ）。
 * 動画モードは全体的に速い方が映えるため既定を底上げする（要望「旧とてもはやい→標準」）。
 */
export const DEFAULT_AUTO_SPEED_SCALE = 1.8;
/** 動きの速さ倍率の下限（永続値の暴走ガード）。manual/auto 共通。 */
export const MIN_SPEED_SCALE = 0.3;
/** 動きの速さ倍率の上限（永続値の暴走ガード）。manual/auto 共通。 */
export const MAX_SPEED_SCALE = 2.5;

/** [UR3-5] 虫の動きパターン UI 選択肢 1 件。value は正規化許可集合、label は UI 表示名。 */
export interface InsectManualPatternOption {
  value: InsectManualPattern;
  label: string;
}

/**
 * [UR3-5] UI（マウスモードタブ）に並べる虫の動きパターン選択肢。
 * click を先頭（既定）に置く。この配列が「セレクタ候補」かつ順序の単一の真実源になる。
 */
export const INSECT_MANUAL_PATTERN_OPTIONS: readonly InsectManualPatternOption[] = [
  { value: "click", label: "クリックで出現" },
  { value: "follow", label: "マウス追従" },
];

/** UI 用の動きの速さ倍率選択肢（ラベルと値）。 */
export interface SpeedScaleOption {
  label: string;
  value: number;
}

/** UI に並べるマウス操作モードの動きの速さの選択肢。value は [MIN,MAX] 内。標準=1.0 が既定。 */
export const SPEED_SCALE_OPTIONS: readonly SpeedScaleOption[] = [
  { label: "ゆっくり", value: 0.6 },
  { label: "標準", value: 1.0 },
  { label: "はやい", value: 1.4 },
  { label: "とてもはやい", value: 1.8 },
];

/**
 * [UR3-8] UI に並べる動画モード(auto)の動きの速さの選択肢。全体を底上げし value は [MIN,MAX] 内。
 * 「標準」＝1.8（＝従来の manual「とてもはやい」相当・既定）。要望「動画モードが全体的に遅い」への対応。
 */
export const AUTO_SPEED_SCALE_OPTIONS: readonly SpeedScaleOption[] = [
  { label: "ゆっくり", value: 1.4 },
  { label: "標準", value: 1.8 },
  { label: "はやい", value: 2.2 },
  { label: "とてもはやい", value: 2.5 },
];

/** `#rgb` / `#rrggbb`（大小文字可）を受理する正規表現。 */
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * hex 色を正規化する。妥当なら小文字 `#rrggbb`（3桁は6桁へ展開）で返し、
 * 妥当でなければ fallback を返す。文字列以外・書式違反は全て fallback。
 */
export function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!HEX_COLOR_RE.test(trimmed)) {
    return fallback;
  }
  let hex = trimmed.slice(1).toLowerCase();
  if (hex.length === 3) {
    hex = `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  }
  return `#${hex}`;
}

/**
 * unknown を有限数へ変換する。number（有限）と数値文字列のみ受理し、
 * それ以外（boolean/null/配列/オブジェクト/空文字/空白のみ/非数値文字列/undefined）は null を返す。
 * clamp/normalize 各関数が型不一致を安全に既定へ落とすための共通変換。
 * （Number() 強制だと Number(true)=1 / Number(null)=0 / Number("")=0 / Number([5])=5 のように
 *  型不一致が数値へ化けて既定に落ちないため、ここで受理範囲を数値・数値文字列に限定する。）
 */
function coerceFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") {
      return null;
    }
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * 音量を [0,1] に収める。有限数・数値文字列のみ受理し、型不一致（boolean/null/配列/
 * オブジェクト/空文字）・非有限・欠損(undefined)は既定音量へフォールバックする。
 */
export function clampVolume(value: unknown): number {
  const n = coerceFiniteNumber(value);
  if (n === null) {
    return DEFAULT_MASTER_VOLUME;
  }
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** 表示モードを正規化する。"auto" のみ auto、その他は既定(manual)。 */
export function normalizeMode(value: unknown): AppMode {
  return value === "auto" ? "auto" : "manual";
}

/**
 * [UR3-5] 虫の動きパターンを正規化する。許可集合 {"click","follow"} の "follow" のみ follow、
 * それ以外（"click"・許可集合外の文字列・boolean/null/数値/配列/オブジェクト/Symbol/BigInt/欠損）は
 * 既定 click へフォールバックする。=== 比較のみで型を問わず例外を投げない
 * （破損/改竄 localStorage 由来の異常入力に対する堅牢化。normalizeMode と同流儀）。
 */
export function normalizeInsectManualPattern(value: unknown): InsectManualPattern {
  return value === "follow" ? "follow" : "click";
}

/**
 * ミュート状態を正規化する。真の boolean true のみ true、それ以外は false。
 * （フィールドを持たない旧 localStorage との後方互換で欠損は false＝音あり。）
 */
export function normalizeMuted(value: unknown): boolean {
  return value === true;
}

/**
 * マウスカーソル非表示設定を正規化する。真の boolean true のみ true、それ以外は false。
 * （フィールドを持たない旧 localStorage との後方互換で欠損は false＝カーソル表示。）
 */
export function normalizeHideCursor(value: unknown): boolean {
  return value === true;
}

/**
 * auto 無効化種別リストを正規化する。配列の文字列要素のみ採用し、重複を除去する。
 * 非配列/欠損は [] を返す（全種別有効）。
 */
export function normalizeAutoDisabledTypes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && !out.includes(item)) {
      out.push(item);
    }
  }
  return out;
}

/**
 * 出現間隔(ms)を [MIN,MAX] にクランプする。有限数・数値文字列のみ受理し、
 * 型不一致（boolean/null/配列/オブジェクト/空文字）・非有限・欠損は既定へフォールバックする。
 */
export function clampSpawnInterval(value: unknown): number {
  const n = coerceFiniteNumber(value);
  if (n === null) {
    return DEFAULT_AUTO_SPAWN_INTERVAL_MS;
  }
  return n < MIN_AUTO_SPAWN_INTERVAL_MS
    ? MIN_AUTO_SPAWN_INTERVAL_MS
    : n > MAX_AUTO_SPAWN_INTERVAL_MS
      ? MAX_AUTO_SPAWN_INTERVAL_MS
      : n;
}

/**
 * 遊びすぎ防止の上限(分)を正規化する。有限数・数値文字列のみ受理する。
 * 型不一致（boolean/null/配列/オブジェクト/空文字）・非有限・欠損・負は 0（OFF）へ。
 * それ以外は Math.round して [0, MAX] にクランプする（UI はプリセットに制約するが永続値は堅牢に扱う）。
 */
export function clampPlayLimitMinutes(value: unknown): number {
  const n = coerceFiniteNumber(value);
  if (n === null || n < 0) {
    return DEFAULT_AUTO_PLAY_LIMIT_MINUTES;
  }
  const rounded = Math.round(n);
  return rounded > MAX_AUTO_PLAY_LIMIT_MINUTES ? MAX_AUTO_PLAY_LIMIT_MINUTES : rounded;
}

/**
 * 動きの速さ倍率を正規化する。有限数・数値文字列のみ受理し、>0 なら [MIN,MAX] にクランプ。
 * 型不一致（boolean/null/配列/オブジェクト/空文字）・非有限・0以下・欠損は fallback へフォールバックする。
 * [UR3-8] fallback は manual/auto で既定が異なる（manual=1.0 / auto=1.8）ため引数で受ける。
 * 既定は manual 相当(1.0)。
 */
export function normalizeSpeedScale(
  value: unknown,
  fallback: number = DEFAULT_MANUAL_SPEED_SCALE,
): number {
  const n = coerceFiniteNumber(value);
  if (n === null || n <= 0) {
    return fallback;
  }
  return n < MIN_SPEED_SCALE ? MIN_SPEED_SCALE : n > MAX_SPEED_SCALE ? MAX_SPEED_SCALE : n;
}

/** デフォルト設定を新規生成する（呼び出しごとに独立したオブジェクト）。 */
export function createDefaultSettings(): AppSettings {
  return {
    background: {
      type: "color",
      color: DEFAULT_BACKGROUND_COLOR,
      imageId: null,
    },
    masterVolume: DEFAULT_MASTER_VOLUME,
    muted: DEFAULT_MUTED,
    hideCursor: DEFAULT_HIDE_CURSOR,
    mode: DEFAULT_MODE,
    manualTypeId: DEFAULT_MANUAL_TYPE_ID,
    insectManualPattern: DEFAULT_INSECT_MANUAL_PATTERN,
    autoSpawnIntervalMs: DEFAULT_AUTO_SPAWN_INTERVAL_MS,
    autoPlayLimitMinutes: DEFAULT_AUTO_PLAY_LIMIT_MINUTES,
    customCritterImageId: null,
    autoDisabledTypes: [],
    manualSpeedScale: DEFAULT_MANUAL_SPEED_SCALE,
    autoSpeedScale: DEFAULT_AUTO_SPEED_SCALE,
  };
}

/** 参照用の凍結済みデフォルト（改変不可）。可変が必要なら createDefaultSettings を使う。 */
export const DEFAULT_SETTINGS: AppSettings = Object.freeze({
  background: Object.freeze({
    type: "color",
    color: DEFAULT_BACKGROUND_COLOR,
    imageId: null,
  }),
  masterVolume: DEFAULT_MASTER_VOLUME,
  muted: DEFAULT_MUTED,
  hideCursor: DEFAULT_HIDE_CURSOR,
  mode: DEFAULT_MODE,
  manualTypeId: DEFAULT_MANUAL_TYPE_ID,
  insectManualPattern: DEFAULT_INSECT_MANUAL_PATTERN,
  autoSpawnIntervalMs: DEFAULT_AUTO_SPAWN_INTERVAL_MS,
  autoPlayLimitMinutes: DEFAULT_AUTO_PLAY_LIMIT_MINUTES,
  customCritterImageId: null,
  autoDisabledTypes: Object.freeze([] as string[]) as string[],
  manualSpeedScale: DEFAULT_MANUAL_SPEED_SCALE,
  autoSpeedScale: DEFAULT_AUTO_SPEED_SCALE,
}) as AppSettings;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * 任意の値（パース済み JSON など）を妥当な AppSettings へ正規化する。
 * 未知キーは無視し、欠損/型不一致はデフォルトへ落とす（フォールバック）。
 */
export function normalizeSettings(raw: unknown): AppSettings {
  const obj = asRecord(raw);
  const bg = asRecord(obj.background);

  const type: BackgroundType = bg.type === "image" ? "image" : "color";
  const color = normalizeHexColor(bg.color, DEFAULT_BACKGROUND_COLOR);
  const imageId = typeof bg.imageId === "string" && bg.imageId.length > 0 ? bg.imageId : null;
  // 非空文字列のみ受理。欠損/型不一致は null フォールバック（背景 imageId と同じ流儀）。
  const customCritterImageId =
    typeof obj.customCritterImageId === "string" && obj.customCritterImageId.length > 0
      ? obj.customCritterImageId
      : null;

  // [UR3-8] 動きの速さの mode 別 migration（reload 退行防止）:
  //  - 新フィールド(manual/autoSpeedScale)があればそれを各既定で正規化。
  //  - manual が無く旧単一 speedScale があれば manual はそれを継承（従来の manual 挙動を保つ）。
  //  - auto は旧 speedScale を継承せず常に既定 1.8 へ底上げ（旧storageでも動画モードを速くする要望）。
  //  - どちらも無ければ各既定（manual=1.0 / auto=1.8）。
  const manualSpeedScale =
    obj.manualSpeedScale !== undefined
      ? normalizeSpeedScale(obj.manualSpeedScale, DEFAULT_MANUAL_SPEED_SCALE)
      : obj.speedScale !== undefined
        ? normalizeSpeedScale(obj.speedScale, DEFAULT_MANUAL_SPEED_SCALE)
        : DEFAULT_MANUAL_SPEED_SCALE;
  const autoSpeedScale =
    obj.autoSpeedScale !== undefined
      ? normalizeSpeedScale(obj.autoSpeedScale, DEFAULT_AUTO_SPEED_SCALE)
      : DEFAULT_AUTO_SPEED_SCALE;

  return {
    background: { type, color, imageId },
    masterVolume: clampVolume(obj.masterVolume),
    muted: normalizeMuted(obj.muted),
    hideCursor: normalizeHideCursor(obj.hideCursor),
    mode: normalizeMode(obj.mode),
    manualTypeId: normalizeManualTypeId(obj.manualTypeId),
    insectManualPattern: normalizeInsectManualPattern(obj.insectManualPattern),
    autoSpawnIntervalMs: clampSpawnInterval(obj.autoSpawnIntervalMs),
    autoPlayLimitMinutes: clampPlayLimitMinutes(obj.autoPlayLimitMinutes),
    customCritterImageId,
    autoDisabledTypes: normalizeAutoDisabledTypes(obj.autoDisabledTypes),
    manualSpeedScale,
    autoSpeedScale,
  };
}

/** 設定を localStorage 保存用の JSON 文字列へ直列化する（画像バイナリは含めない）。 */
export function serializeSettings(settings: AppSettings): string {
  const plain: AppSettings = {
    background: {
      type: settings.background.type,
      color: settings.background.color,
      imageId: settings.background.imageId,
    },
    masterVolume: settings.masterVolume,
    muted: settings.muted,
    hideCursor: settings.hideCursor,
    mode: settings.mode,
    manualTypeId: settings.manualTypeId,
    insectManualPattern: settings.insectManualPattern,
    autoSpawnIntervalMs: settings.autoSpawnIntervalMs,
    autoPlayLimitMinutes: settings.autoPlayLimitMinutes,
    customCritterImageId: settings.customCritterImageId,
    autoDisabledTypes: [...settings.autoDisabledTypes],
    manualSpeedScale: settings.manualSpeedScale,
    autoSpeedScale: settings.autoSpeedScale,
  };
  return JSON.stringify(plain);
}

/**
 * localStorage 由来の JSON 文字列を AppSettings へ復元する。
 * null/空/不正 JSON は全てデフォルトへフォールバックする。
 */
export function parseSettings(json: string | null | undefined): AppSettings {
  if (!json) {
    return createDefaultSettings();
  }
  try {
    return normalizeSettings(JSON.parse(json));
  } catch {
    // 壊れた JSON はデフォルトへ（アプリを落とさない）。
    return createDefaultSettings();
  }
}
