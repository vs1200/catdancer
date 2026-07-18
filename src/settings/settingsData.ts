/**
 * アプリ設定の型・デフォルト・直列化/正規化（DOM/PixiJS 非依存 = Vitest で単体テスト可能）。
 *
 * localStorage には type/color/imageId/masterVolume の JSON のみを保存する
 * （画像バイナリは容量的に IndexedDB へ。ここには入れない）。
 * 壊れた JSON・未知キー・型不一致に対しては安全にデフォルトへフォールバックする。
 */

/** 背景の種類。単色 or ユーザー画像。 */
export type BackgroundType = "color" | "image";

/** 表示モード。manual=マウス操作（1体を追従）/ auto=猫用動画（自動で出現・横切り）。 */
export type AppMode = "manual" | "auto";

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
  /** 表示モード（manual=マウス操作 / auto=猫用動画）。 */
  mode: AppMode;
  /** auto モードのオブジェクト出現間隔(ms)。 */
  autoSpawnIntervalMs: number;
  /**
   * auto（猫用動画）モードの遊びすぎ防止タイマー上限(分)。既定 0（OFF＝無制限）。
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
}

/** 既定の背景色（単色 白）。 */
export const DEFAULT_BACKGROUND_COLOR = "#ffffff";
/** 既定の master 音量。 */
export const DEFAULT_MASTER_VOLUME = 0.5;
/** 既定の表示モード。 */
export const DEFAULT_MODE: AppMode = "manual";
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

/** 表示モードを正規化する。"auto" のみ auto、その他は既定(manual)。 */
export function normalizeMode(value: unknown): AppMode {
  return value === "auto" ? "auto" : "manual";
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
 * 出現間隔(ms)を [MIN,MAX] にクランプする。数値化できない/非有限は既定へフォールバック。
 */
export function clampSpawnInterval(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return DEFAULT_AUTO_SPAWN_INTERVAL_MS;
  }
  return n < MIN_AUTO_SPAWN_INTERVAL_MS
    ? MIN_AUTO_SPAWN_INTERVAL_MS
    : n > MAX_AUTO_SPAWN_INTERVAL_MS
      ? MAX_AUTO_SPAWN_INTERVAL_MS
      : n;
}

/**
 * 遊びすぎ防止の上限(分)を正規化する。数値化できない/非有限/負は 0（OFF）へ。
 * それ以外は Math.round して [0, MAX] にクランプする（UI はプリセットに制約するが永続値は堅牢に扱う）。
 */
export function clampPlayLimitMinutes(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return DEFAULT_AUTO_PLAY_LIMIT_MINUTES;
  }
  const rounded = Math.round(n);
  return rounded > MAX_AUTO_PLAY_LIMIT_MINUTES ? MAX_AUTO_PLAY_LIMIT_MINUTES : rounded;
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
    mode: DEFAULT_MODE,
    autoSpawnIntervalMs: DEFAULT_AUTO_SPAWN_INTERVAL_MS,
    autoPlayLimitMinutes: DEFAULT_AUTO_PLAY_LIMIT_MINUTES,
    customCritterImageId: null,
    autoDisabledTypes: [],
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
  mode: DEFAULT_MODE,
  autoSpawnIntervalMs: DEFAULT_AUTO_SPAWN_INTERVAL_MS,
  autoPlayLimitMinutes: DEFAULT_AUTO_PLAY_LIMIT_MINUTES,
  customCritterImageId: null,
  autoDisabledTypes: Object.freeze([] as string[]) as string[],
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

  return {
    background: { type, color, imageId },
    masterVolume: clampVolume(obj.masterVolume),
    mode: normalizeMode(obj.mode),
    autoSpawnIntervalMs: clampSpawnInterval(obj.autoSpawnIntervalMs),
    autoPlayLimitMinutes: clampPlayLimitMinutes(obj.autoPlayLimitMinutes),
    customCritterImageId,
    autoDisabledTypes: normalizeAutoDisabledTypes(obj.autoDisabledTypes),
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
    mode: settings.mode,
    autoSpawnIntervalMs: settings.autoSpawnIntervalMs,
    autoPlayLimitMinutes: settings.autoPlayLimitMinutes,
    customCritterImageId: settings.customCritterImageId,
    autoDisabledTypes: [...settings.autoDisabledTypes],
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
