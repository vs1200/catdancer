/**
 * アプリ設定の型・デフォルト・直列化/正規化（DOM/PixiJS 非依存 = Vitest で単体テスト可能）。
 *
 * localStorage には type/color/imageId/masterVolume の JSON のみを保存する
 * （画像バイナリは容量的に IndexedDB へ。ここには入れない）。
 * 壊れた JSON・未知キー・型不一致に対しては安全にデフォルトへフォールバックする。
 */

/** 背景の種類。単色 or ユーザー画像。 */
export type BackgroundType = "color" | "image";

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
}

/** 既定の背景色（単色 白）。 */
export const DEFAULT_BACKGROUND_COLOR = "#ffffff";
/** 既定の master 音量。 */
export const DEFAULT_MASTER_VOLUME = 0.5;

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
 * 音量を [0,1] に収める。数値化できない/非有限は既定音量へフォールバック。
 * （未設定 undefined は Number(undefined)=NaN 経由で既定に落ちる。）
 */
export function clampVolume(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return DEFAULT_MASTER_VOLUME;
  }
  return n < 0 ? 0 : n > 1 ? 1 : n;
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

  return {
    background: { type, color, imageId },
    masterVolume: clampVolume(obj.masterVolume),
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
