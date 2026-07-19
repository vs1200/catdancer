import { describe, expect, it } from "vitest";
import {
  clampPlayLimitMinutes,
  clampSpawnInterval,
  clampVolume,
  createDefaultSettings,
  DEFAULT_AUTO_PLAY_LIMIT_MINUTES,
  DEFAULT_AUTO_SPAWN_INTERVAL_MS,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_HIDE_CURSOR,
  DEFAULT_MASTER_VOLUME,
  DEFAULT_MODE,
  DEFAULT_MUTED,
  DEFAULT_SPEED_SCALE,
  MAX_AUTO_PLAY_LIMIT_MINUTES,
  MAX_AUTO_SPAWN_INTERVAL_MS,
  MAX_SPEED_SCALE,
  MIN_AUTO_SPAWN_INTERVAL_MS,
  MIN_SPEED_SCALE,
  normalizeAutoDisabledTypes,
  normalizeHexColor,
  normalizeHideCursor,
  normalizeMode,
  normalizeMuted,
  normalizeSettings,
  normalizeSpeedScale,
  parseSettings,
  serializeSettings,
} from "../../src/settings/settingsData";

describe("normalizeHexColor", () => {
  it("6桁 hex を小文字で受理する", () => {
    expect(normalizeHexColor("#AABBCC", "#000000")).toBe("#aabbcc");
    expect(normalizeHexColor("#cc3344", "#000000")).toBe("#cc3344");
  });

  it("3桁 hex は6桁へ展開する", () => {
    expect(normalizeHexColor("#fff", "#000000")).toBe("#ffffff");
    expect(normalizeHexColor("#0F8", "#000000")).toBe("#00ff88");
  });

  it("前後空白は許容する", () => {
    expect(normalizeHexColor("  #abc  ", "#000000")).toBe("#aabbcc");
  });

  it("不正値は fallback を返す", () => {
    expect(normalizeHexColor("red", "#123456")).toBe("#123456");
    expect(normalizeHexColor("#12", "#123456")).toBe("#123456");
    expect(normalizeHexColor("#12345", "#123456")).toBe("#123456");
    expect(normalizeHexColor("aabbcc", "#123456")).toBe("#123456"); // # なし
    expect(normalizeHexColor("#gggggg", "#123456")).toBe("#123456");
    expect(normalizeHexColor(123, "#123456")).toBe("#123456");
    expect(normalizeHexColor(null, "#123456")).toBe("#123456");
    expect(normalizeHexColor(undefined, "#123456")).toBe("#123456");
  });
});

describe("clampVolume", () => {
  it("[0,1] 内はそのまま", () => {
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(0.5)).toBe(0.5);
    expect(clampVolume(1)).toBe(1);
  });

  it("範囲外はクランプ", () => {
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(2)).toBe(1);
  });

  it("数値化できない/非有限は既定音量へ", () => {
    expect(clampVolume(Number.NaN)).toBe(DEFAULT_MASTER_VOLUME);
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(DEFAULT_MASTER_VOLUME);
    expect(clampVolume(undefined)).toBe(DEFAULT_MASTER_VOLUME);
    expect(clampVolume("abc")).toBe(DEFAULT_MASTER_VOLUME);
  });

  it("数値文字列は解釈する", () => {
    expect(clampVolume("0.25")).toBe(0.25);
  });
});

describe("normalizeMode", () => {
  it("'auto' のみ auto、その他/不正値は manual", () => {
    expect(normalizeMode("auto")).toBe("auto");
    expect(normalizeMode("manual")).toBe("manual");
    expect(normalizeMode("weird")).toBe("manual");
    expect(normalizeMode(undefined)).toBe("manual");
    expect(normalizeMode(null)).toBe("manual");
    expect(normalizeMode(1)).toBe("manual");
  });
});

describe("normalizeMuted", () => {
  it("真の boolean true のみ true", () => {
    expect(normalizeMuted(true)).toBe(true);
  });

  it("false/欠損/型不一致は false（後方互換で音あり）", () => {
    expect(normalizeMuted(false)).toBe(false);
    expect(normalizeMuted(undefined)).toBe(false);
    expect(normalizeMuted(null)).toBe(false);
    expect(normalizeMuted(0)).toBe(false);
    expect(normalizeMuted(1)).toBe(false);
    expect(normalizeMuted("true")).toBe(false);
    expect(normalizeMuted({})).toBe(false);
  });
});

describe("normalizeHideCursor", () => {
  it("真の boolean true のみ true", () => {
    expect(normalizeHideCursor(true)).toBe(true);
  });

  it("false/欠損/型不一致は false（後方互換でカーソル表示）", () => {
    expect(normalizeHideCursor(false)).toBe(false);
    expect(normalizeHideCursor(undefined)).toBe(false);
    expect(normalizeHideCursor(null)).toBe(false);
    expect(normalizeHideCursor(0)).toBe(false);
    expect(normalizeHideCursor(1)).toBe(false);
    expect(normalizeHideCursor("true")).toBe(false);
    expect(normalizeHideCursor({})).toBe(false);
  });
});

describe("normalizeAutoDisabledTypes", () => {
  it("文字列要素のみ採用し順序を保つ", () => {
    expect(normalizeAutoDisabledTypes(["mouse", "insect"])).toEqual(["mouse", "insect"]);
  });

  it("重複を除去する", () => {
    expect(normalizeAutoDisabledTypes(["mouse", "mouse", "toys", "mouse"])).toEqual([
      "mouse",
      "toys",
    ]);
  });

  it("非文字列要素は除去する", () => {
    expect(normalizeAutoDisabledTypes(["mouse", 1, null, undefined, {}, "toys", true])).toEqual([
      "mouse",
      "toys",
    ]);
  });

  it("非配列/欠損は [] を返す", () => {
    expect(normalizeAutoDisabledTypes(undefined)).toEqual([]);
    expect(normalizeAutoDisabledTypes(null)).toEqual([]);
    expect(normalizeAutoDisabledTypes("mouse")).toEqual([]);
    expect(normalizeAutoDisabledTypes(42)).toEqual([]);
    expect(normalizeAutoDisabledTypes({ 0: "mouse" })).toEqual([]);
  });

  it("空配列は [] のまま", () => {
    expect(normalizeAutoDisabledTypes([])).toEqual([]);
  });
});

describe("clampSpawnInterval", () => {
  it("範囲内はそのまま", () => {
    expect(clampSpawnInterval(1500)).toBe(1500);
    expect(clampSpawnInterval(MIN_AUTO_SPAWN_INTERVAL_MS)).toBe(MIN_AUTO_SPAWN_INTERVAL_MS);
    expect(clampSpawnInterval(MAX_AUTO_SPAWN_INTERVAL_MS)).toBe(MAX_AUTO_SPAWN_INTERVAL_MS);
  });

  it("範囲外は下限/上限へクランプ（極小/極大対策）", () => {
    expect(clampSpawnInterval(1)).toBe(MIN_AUTO_SPAWN_INTERVAL_MS);
    expect(clampSpawnInterval(0)).toBe(MIN_AUTO_SPAWN_INTERVAL_MS);
    expect(clampSpawnInterval(-100)).toBe(MIN_AUTO_SPAWN_INTERVAL_MS);
    expect(clampSpawnInterval(99999)).toBe(MAX_AUTO_SPAWN_INTERVAL_MS);
  });

  it("数値化できない/非有限は既定へ", () => {
    expect(clampSpawnInterval(Number.NaN)).toBe(DEFAULT_AUTO_SPAWN_INTERVAL_MS);
    expect(clampSpawnInterval(Number.POSITIVE_INFINITY)).toBe(DEFAULT_AUTO_SPAWN_INTERVAL_MS);
    expect(clampSpawnInterval(undefined)).toBe(DEFAULT_AUTO_SPAWN_INTERVAL_MS);
    expect(clampSpawnInterval("abc")).toBe(DEFAULT_AUTO_SPAWN_INTERVAL_MS);
  });

  it("数値文字列は解釈する", () => {
    expect(clampSpawnInterval("800")).toBe(800);
  });
});

describe("clampPlayLimitMinutes", () => {
  it("非負の整数はそのまま（0=OFF 含む）", () => {
    expect(clampPlayLimitMinutes(0)).toBe(0);
    expect(clampPlayLimitMinutes(5)).toBe(5);
    expect(clampPlayLimitMinutes(30)).toBe(30);
  });

  it("小数は四捨五入する", () => {
    expect(clampPlayLimitMinutes(4.4)).toBe(4);
    expect(clampPlayLimitMinutes(4.6)).toBe(5);
  });

  it("上限を超える値は MAX へクランプ", () => {
    expect(clampPlayLimitMinutes(9999)).toBe(MAX_AUTO_PLAY_LIMIT_MINUTES);
    expect(clampPlayLimitMinutes(MAX_AUTO_PLAY_LIMIT_MINUTES)).toBe(MAX_AUTO_PLAY_LIMIT_MINUTES);
  });

  it("負値/非有限/数値化不能は 0（OFF）へ", () => {
    expect(clampPlayLimitMinutes(-5)).toBe(DEFAULT_AUTO_PLAY_LIMIT_MINUTES);
    expect(clampPlayLimitMinutes(Number.NaN)).toBe(DEFAULT_AUTO_PLAY_LIMIT_MINUTES);
    expect(clampPlayLimitMinutes(Number.POSITIVE_INFINITY)).toBe(DEFAULT_AUTO_PLAY_LIMIT_MINUTES);
    expect(clampPlayLimitMinutes(undefined)).toBe(DEFAULT_AUTO_PLAY_LIMIT_MINUTES);
    expect(clampPlayLimitMinutes("abc")).toBe(DEFAULT_AUTO_PLAY_LIMIT_MINUTES);
  });

  it("数値文字列は解釈する", () => {
    expect(clampPlayLimitMinutes("15")).toBe(15);
  });
});

describe("normalizeSpeedScale", () => {
  it("範囲内はそのまま（プリセット値・境界含む）", () => {
    expect(normalizeSpeedScale(0.6)).toBe(0.6);
    expect(normalizeSpeedScale(1.0)).toBe(1.0);
    expect(normalizeSpeedScale(1.4)).toBe(1.4);
    expect(normalizeSpeedScale(1.8)).toBe(1.8);
    expect(normalizeSpeedScale(MIN_SPEED_SCALE)).toBe(MIN_SPEED_SCALE);
    expect(normalizeSpeedScale(MAX_SPEED_SCALE)).toBe(MAX_SPEED_SCALE);
  });

  it("範囲外は下限/上限へクランプ", () => {
    expect(normalizeSpeedScale(0.01)).toBe(MIN_SPEED_SCALE);
    expect(normalizeSpeedScale(MIN_SPEED_SCALE - 0.1)).toBe(MIN_SPEED_SCALE);
    expect(normalizeSpeedScale(99)).toBe(MAX_SPEED_SCALE);
    expect(normalizeSpeedScale(MAX_SPEED_SCALE + 0.1)).toBe(MAX_SPEED_SCALE);
  });

  it("0以下は既定へ（>0 のみ受理）", () => {
    expect(normalizeSpeedScale(0)).toBe(DEFAULT_SPEED_SCALE);
    expect(normalizeSpeedScale(-1)).toBe(DEFAULT_SPEED_SCALE);
  });

  it("数値化できない/非有限/欠損は既定(1.0)へ", () => {
    expect(normalizeSpeedScale(Number.NaN)).toBe(DEFAULT_SPEED_SCALE);
    expect(normalizeSpeedScale(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SPEED_SCALE);
    expect(normalizeSpeedScale(undefined)).toBe(DEFAULT_SPEED_SCALE);
    expect(normalizeSpeedScale(null)).toBe(DEFAULT_SPEED_SCALE);
    expect(normalizeSpeedScale("abc")).toBe(DEFAULT_SPEED_SCALE);
    expect(DEFAULT_SPEED_SCALE).toBe(1.0);
  });

  it("数値文字列は解釈する", () => {
    expect(normalizeSpeedScale("1.4")).toBe(1.4);
  });
});

describe("createDefaultSettings", () => {
  it("既定は単色 白 / master 0.5 / imageId null / mode manual / interval 1500 / 遊びすぎ防止 OFF / 無効種別なし / 速さ 1.0", () => {
    const s = createDefaultSettings();
    expect(s).toEqual({
      background: { type: "color", color: DEFAULT_BACKGROUND_COLOR, imageId: null },
      masterVolume: DEFAULT_MASTER_VOLUME,
      muted: DEFAULT_MUTED,
      hideCursor: DEFAULT_HIDE_CURSOR,
      mode: DEFAULT_MODE,
      autoSpawnIntervalMs: DEFAULT_AUTO_SPAWN_INTERVAL_MS,
      autoPlayLimitMinutes: DEFAULT_AUTO_PLAY_LIMIT_MINUTES,
      customCritterImageId: null,
      autoDisabledTypes: [],
      speedScale: DEFAULT_SPEED_SCALE,
    });
    expect(DEFAULT_BACKGROUND_COLOR).toBe("#ffffff");
    expect(DEFAULT_MUTED).toBe(false);
    expect(DEFAULT_HIDE_CURSOR).toBe(false);
    expect(DEFAULT_MASTER_VOLUME).toBe(0.5);
    expect(DEFAULT_MODE).toBe("manual");
    expect(DEFAULT_AUTO_SPAWN_INTERVAL_MS).toBe(1500);
    expect(DEFAULT_AUTO_PLAY_LIMIT_MINUTES).toBe(0);
    expect(DEFAULT_SPEED_SCALE).toBe(1.0);
  });

  it("呼び出しごとに独立したオブジェクトを返す（共有参照でない）", () => {
    const a = createDefaultSettings();
    const b = createDefaultSettings();
    expect(a).not.toBe(b);
    expect(a.background).not.toBe(b.background);
    expect(a.autoDisabledTypes).not.toBe(b.autoDisabledTypes);
    a.background.color = "#000000";
    a.autoDisabledTypes.push("mouse");
    expect(b.background.color).toBe(DEFAULT_BACKGROUND_COLOR);
    expect(b.autoDisabledTypes).toEqual([]);
  });
});

describe("normalizeSettings", () => {
  it("妥当な設定はそのまま整える", () => {
    expect(
      normalizeSettings({
        background: { type: "image", color: "#123", imageId: "bg-1" },
        masterVolume: 0.8,
        muted: true,
        hideCursor: true,
        mode: "auto",
        autoSpawnIntervalMs: 900,
        autoPlayLimitMinutes: 15,
        customCritterImageId: "critter-1",
        autoDisabledTypes: ["insect", "toys"],
        speedScale: 1.4,
      }),
    ).toEqual({
      background: { type: "image", color: "#112233", imageId: "bg-1" },
      masterVolume: 0.8,
      muted: true,
      hideCursor: true,
      mode: "auto",
      autoSpawnIntervalMs: 900,
      autoPlayLimitMinutes: 15,
      customCritterImageId: "critter-1",
      autoDisabledTypes: ["insect", "toys"],
      speedScale: 1.4,
    });
  });

  it("mode/interval も欠損はデフォルト・不正はクランプ", () => {
    const s = normalizeSettings({ mode: "nope", autoSpawnIntervalMs: 1 });
    expect(s.mode).toBe("manual");
    expect(s.autoSpawnIntervalMs).toBe(MIN_AUTO_SPAWN_INTERVAL_MS);
  });

  it("未知キーは無視し欠損はデフォルト", () => {
    expect(normalizeSettings({ foo: 1, background: { bar: 2 } })).toEqual(createDefaultSettings());
  });

  it("非オブジェクトはデフォルト", () => {
    expect(normalizeSettings(null)).toEqual(createDefaultSettings());
    expect(normalizeSettings(42)).toEqual(createDefaultSettings());
    expect(normalizeSettings("x")).toEqual(createDefaultSettings());
    expect(normalizeSettings([])).toEqual(createDefaultSettings());
  });

  it("type は 'image' のみ image、その他は color", () => {
    expect(normalizeSettings({ background: { type: "image" } }).background.type).toBe("image");
    expect(normalizeSettings({ background: { type: "weird" } }).background.type).toBe("color");
    expect(normalizeSettings({ background: {} }).background.type).toBe("color");
  });

  it("imageId は非空文字列のみ、それ以外は null", () => {
    expect(normalizeSettings({ background: { imageId: "" } }).background.imageId).toBeNull();
    expect(normalizeSettings({ background: { imageId: 5 } }).background.imageId).toBeNull();
    expect(normalizeSettings({ background: { imageId: "k" } }).background.imageId).toBe("k");
  });

  it("customCritterImageId は非空文字列のみ、それ以外は null（欠損/型不一致フォールバック）", () => {
    // 欠損はデフォルト null。
    expect(normalizeSettings({}).customCritterImageId).toBeNull();
    // 非空文字列のみ受理。
    expect(normalizeSettings({ customCritterImageId: "critter-abc" }).customCritterImageId).toBe(
      "critter-abc",
    );
    // 空文字/型不一致は null。
    expect(normalizeSettings({ customCritterImageId: "" }).customCritterImageId).toBeNull();
    expect(normalizeSettings({ customCritterImageId: 7 }).customCritterImageId).toBeNull();
    expect(normalizeSettings({ customCritterImageId: null }).customCritterImageId).toBeNull();
    expect(normalizeSettings({ customCritterImageId: {} }).customCritterImageId).toBeNull();
  });

  it("muted は true のみ true、欠損/非boolは false（後方互換で音あり）", () => {
    // 欠損はデフォルト false（フィールドを持たない旧 localStorage との後方互換）。
    expect(normalizeSettings({}).muted).toBe(false);
    // 真の true のみ受理。
    expect(normalizeSettings({ muted: true }).muted).toBe(true);
    // false/型不一致は false。
    expect(normalizeSettings({ muted: false }).muted).toBe(false);
    expect(normalizeSettings({ muted: "true" }).muted).toBe(false);
    expect(normalizeSettings({ muted: 1 }).muted).toBe(false);
    expect(normalizeSettings({ muted: null }).muted).toBe(false);
  });

  it("hideCursor は true のみ true、欠損/非boolは false（後方互換でカーソル表示）", () => {
    // 欠損はデフォルト false（フィールドを持たない旧 localStorage との後方互換）。
    expect(normalizeSettings({}).hideCursor).toBe(false);
    // 真の true のみ受理。
    expect(normalizeSettings({ hideCursor: true }).hideCursor).toBe(true);
    // false/型不一致は false。
    expect(normalizeSettings({ hideCursor: false }).hideCursor).toBe(false);
    expect(normalizeSettings({ hideCursor: "true" }).hideCursor).toBe(false);
    expect(normalizeSettings({ hideCursor: 1 }).hideCursor).toBe(false);
    expect(normalizeSettings({ hideCursor: null }).hideCursor).toBe(false);
  });

  it("autoDisabledTypes は配列の文字列のみ・重複除去、非配列/欠損は []", () => {
    // 欠損はデフォルト []。
    expect(normalizeSettings({}).autoDisabledTypes).toEqual([]);
    // 文字列のみ採用・重複除去。
    expect(
      normalizeSettings({ autoDisabledTypes: ["mouse", "mouse", 3, null, "insect"] })
        .autoDisabledTypes,
    ).toEqual(["mouse", "insect"]);
    // 非配列は []。
    expect(normalizeSettings({ autoDisabledTypes: "mouse" }).autoDisabledTypes).toEqual([]);
    expect(normalizeSettings({ autoDisabledTypes: 7 }).autoDisabledTypes).toEqual([]);
    expect(normalizeSettings({ autoDisabledTypes: null }).autoDisabledTypes).toEqual([]);
  });

  it("既存キー(background/mode/volume/interval/customCritterImageId)を壊さない", () => {
    const s = normalizeSettings({
      background: { type: "image", color: "#abc", imageId: "bg-9" },
      masterVolume: 0.7,
      mode: "auto",
      autoSpawnIntervalMs: 1200,
      autoPlayLimitMinutes: 30,
      customCritterImageId: "critter-9",
      autoDisabledTypes: ["toys"],
    });
    expect(s.background).toEqual({ type: "image", color: "#aabbcc", imageId: "bg-9" });
    expect(s.masterVolume).toBe(0.7);
    expect(s.mode).toBe("auto");
    expect(s.autoSpawnIntervalMs).toBe(1200);
    expect(s.autoPlayLimitMinutes).toBe(30);
    expect(s.customCritterImageId).toBe("critter-9");
    expect(s.autoDisabledTypes).toEqual(["toys"]);
  });

  it("autoPlayLimitMinutes は欠損で 0、負/非有限で 0、上限超は clamp、小数は round", () => {
    expect(normalizeSettings({}).autoPlayLimitMinutes).toBe(0);
    expect(normalizeSettings({ autoPlayLimitMinutes: -3 }).autoPlayLimitMinutes).toBe(0);
    expect(normalizeSettings({ autoPlayLimitMinutes: Number.NaN }).autoPlayLimitMinutes).toBe(0);
    expect(normalizeSettings({ autoPlayLimitMinutes: 4.6 }).autoPlayLimitMinutes).toBe(5);
    expect(normalizeSettings({ autoPlayLimitMinutes: 9999 }).autoPlayLimitMinutes).toBe(
      MAX_AUTO_PLAY_LIMIT_MINUTES,
    );
  });

  it("不正な色/音量はフォールバック/クランプ", () => {
    const s = normalizeSettings({
      background: { color: "not-a-color" },
      masterVolume: 999,
    });
    expect(s.background.color).toBe(DEFAULT_BACKGROUND_COLOR);
    expect(s.masterVolume).toBe(1);
  });

  it("speedScale は欠損で既定(1.0)、範囲外はクランプ、0以下/非有限は既定（後方互換）", () => {
    // フィールドを持たない旧 localStorage は既定 1.0（後方互換）。
    expect(normalizeSettings({}).speedScale).toBe(DEFAULT_SPEED_SCALE);
    // 範囲内はそのまま。
    expect(normalizeSettings({ speedScale: 1.4 }).speedScale).toBe(1.4);
    // 範囲外はクランプ。
    expect(normalizeSettings({ speedScale: 99 }).speedScale).toBe(MAX_SPEED_SCALE);
    expect(normalizeSettings({ speedScale: 0.01 }).speedScale).toBe(MIN_SPEED_SCALE);
    // 0以下/非有限は既定へ。
    expect(normalizeSettings({ speedScale: 0 }).speedScale).toBe(DEFAULT_SPEED_SCALE);
    expect(normalizeSettings({ speedScale: -2 }).speedScale).toBe(DEFAULT_SPEED_SCALE);
    expect(normalizeSettings({ speedScale: Number.NaN }).speedScale).toBe(DEFAULT_SPEED_SCALE);
  });
});

describe("serializeSettings / parseSettings", () => {
  it("往復で保存すべき項目が保たれる", () => {
    const original = {
      background: { type: "image" as const, color: "#abcdef", imageId: "bg-xyz" },
      masterVolume: 0.33,
      muted: true,
      hideCursor: true,
      mode: "auto" as const,
      autoSpawnIntervalMs: 2400,
      autoPlayLimitMinutes: 10,
      customCritterImageId: "critter-xyz",
      autoDisabledTypes: ["foxtail", "insect"],
      speedScale: 1.8,
    };
    const restored = parseSettings(serializeSettings(original));
    expect(restored).toEqual(original);
  });

  it("直列化に画像バイナリ由来のキーは含まれない（保存項目のみ）", () => {
    const json = serializeSettings(createDefaultSettings());
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      "autoDisabledTypes",
      "autoPlayLimitMinutes",
      "autoSpawnIntervalMs",
      "background",
      "customCritterImageId",
      "hideCursor",
      "masterVolume",
      "mode",
      "muted",
      "speedScale",
    ]);
    expect(Object.keys(parsed.background as object).sort()).toEqual(["color", "imageId", "type"]);
  });

  it("null/空文字/壊れた JSON はデフォルトへフォールバック", () => {
    const def = createDefaultSettings();
    expect(parseSettings(null)).toEqual(def);
    expect(parseSettings(undefined)).toEqual(def);
    expect(parseSettings("")).toEqual(def);
    expect(parseSettings("{not json")).toEqual(def);
    expect(parseSettings("null")).toEqual(def);
    expect(parseSettings("123")).toEqual(def);
  });

  it("部分的な JSON も安全に補完する", () => {
    expect(parseSettings('{"masterVolume":0.2}')).toEqual({
      background: { type: "color", color: DEFAULT_BACKGROUND_COLOR, imageId: null },
      masterVolume: 0.2,
      muted: DEFAULT_MUTED,
      hideCursor: DEFAULT_HIDE_CURSOR,
      mode: DEFAULT_MODE,
      autoSpawnIntervalMs: DEFAULT_AUTO_SPAWN_INTERVAL_MS,
      autoPlayLimitMinutes: DEFAULT_AUTO_PLAY_LIMIT_MINUTES,
      customCritterImageId: null,
      autoDisabledTypes: [],
      speedScale: DEFAULT_SPEED_SCALE,
    });
  });

  it("muted 往復: true/false ともに保持し、フィールド無しの旧 JSON は false（後方互換）", () => {
    // true → serialize → parse で保持。
    const on = createDefaultSettings();
    on.muted = true;
    expect(parseSettings(serializeSettings(on)).muted).toBe(true);
    // false も保持。
    const off = createDefaultSettings();
    off.muted = false;
    expect(parseSettings(serializeSettings(off)).muted).toBe(false);
    // muted フィールドを持たない旧 localStorage JSON は false へフォールバック。
    expect(parseSettings('{"masterVolume":0.4,"mode":"auto"}').muted).toBe(false);
  });

  it("hideCursor 往復: true/false ともに保持し、フィールド無しの旧 JSON は false（後方互換）", () => {
    // true → serialize → parse で保持。
    const on = createDefaultSettings();
    on.hideCursor = true;
    expect(parseSettings(serializeSettings(on)).hideCursor).toBe(true);
    // false も保持。
    const off = createDefaultSettings();
    off.hideCursor = false;
    expect(parseSettings(serializeSettings(off)).hideCursor).toBe(false);
    // hideCursor フィールドを持たない旧 localStorage JSON は false へフォールバック。
    expect(parseSettings('{"masterVolume":0.4,"mode":"auto"}').hideCursor).toBe(false);
  });
});
