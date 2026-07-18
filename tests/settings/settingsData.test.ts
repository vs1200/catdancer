import { describe, expect, it } from "vitest";
import {
  clampPlayLimitMinutes,
  clampSpawnInterval,
  clampVolume,
  createDefaultSettings,
  DEFAULT_AUTO_PLAY_LIMIT_MINUTES,
  DEFAULT_AUTO_SPAWN_INTERVAL_MS,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_MASTER_VOLUME,
  DEFAULT_MODE,
  MAX_AUTO_PLAY_LIMIT_MINUTES,
  MAX_AUTO_SPAWN_INTERVAL_MS,
  MIN_AUTO_SPAWN_INTERVAL_MS,
  normalizeAutoDisabledTypes,
  normalizeHexColor,
  normalizeMode,
  normalizeSettings,
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

describe("createDefaultSettings", () => {
  it("既定は単色 白 / master 0.5 / imageId null / mode manual / interval 1500 / 遊びすぎ防止 OFF / 無効種別なし", () => {
    const s = createDefaultSettings();
    expect(s).toEqual({
      background: { type: "color", color: DEFAULT_BACKGROUND_COLOR, imageId: null },
      masterVolume: DEFAULT_MASTER_VOLUME,
      mode: DEFAULT_MODE,
      autoSpawnIntervalMs: DEFAULT_AUTO_SPAWN_INTERVAL_MS,
      autoPlayLimitMinutes: DEFAULT_AUTO_PLAY_LIMIT_MINUTES,
      customCritterImageId: null,
      autoDisabledTypes: [],
    });
    expect(DEFAULT_BACKGROUND_COLOR).toBe("#ffffff");
    expect(DEFAULT_MASTER_VOLUME).toBe(0.5);
    expect(DEFAULT_MODE).toBe("manual");
    expect(DEFAULT_AUTO_SPAWN_INTERVAL_MS).toBe(1500);
    expect(DEFAULT_AUTO_PLAY_LIMIT_MINUTES).toBe(0);
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
        mode: "auto",
        autoSpawnIntervalMs: 900,
        autoPlayLimitMinutes: 15,
        customCritterImageId: "critter-1",
        autoDisabledTypes: ["insect", "toys"],
      }),
    ).toEqual({
      background: { type: "image", color: "#112233", imageId: "bg-1" },
      masterVolume: 0.8,
      mode: "auto",
      autoSpawnIntervalMs: 900,
      autoPlayLimitMinutes: 15,
      customCritterImageId: "critter-1",
      autoDisabledTypes: ["insect", "toys"],
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
});

describe("serializeSettings / parseSettings", () => {
  it("往復で保存すべき項目が保たれる", () => {
    const original = {
      background: { type: "image" as const, color: "#abcdef", imageId: "bg-xyz" },
      masterVolume: 0.33,
      mode: "auto" as const,
      autoSpawnIntervalMs: 2400,
      autoPlayLimitMinutes: 10,
      customCritterImageId: "critter-xyz",
      autoDisabledTypes: ["foxtail", "insect"],
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
      "masterVolume",
      "mode",
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
      mode: DEFAULT_MODE,
      autoSpawnIntervalMs: DEFAULT_AUTO_SPAWN_INTERVAL_MS,
      autoPlayLimitMinutes: DEFAULT_AUTO_PLAY_LIMIT_MINUTES,
      customCritterImageId: null,
      autoDisabledTypes: [],
    });
  });
});
