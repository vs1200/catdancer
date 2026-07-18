import { describe, expect, it } from "vitest";
import {
  clampSpawnInterval,
  clampVolume,
  createDefaultSettings,
  DEFAULT_AUTO_SPAWN_INTERVAL_MS,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_MASTER_VOLUME,
  DEFAULT_MODE,
  MAX_AUTO_SPAWN_INTERVAL_MS,
  MIN_AUTO_SPAWN_INTERVAL_MS,
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

describe("createDefaultSettings", () => {
  it("既定は単色 白 / master 0.5 / imageId null / mode manual / interval 1500", () => {
    const s = createDefaultSettings();
    expect(s).toEqual({
      background: { type: "color", color: DEFAULT_BACKGROUND_COLOR, imageId: null },
      masterVolume: DEFAULT_MASTER_VOLUME,
      mode: DEFAULT_MODE,
      autoSpawnIntervalMs: DEFAULT_AUTO_SPAWN_INTERVAL_MS,
    });
    expect(DEFAULT_BACKGROUND_COLOR).toBe("#ffffff");
    expect(DEFAULT_MASTER_VOLUME).toBe(0.5);
    expect(DEFAULT_MODE).toBe("manual");
    expect(DEFAULT_AUTO_SPAWN_INTERVAL_MS).toBe(1500);
  });

  it("呼び出しごとに独立したオブジェクトを返す（共有参照でない）", () => {
    const a = createDefaultSettings();
    const b = createDefaultSettings();
    expect(a).not.toBe(b);
    expect(a.background).not.toBe(b.background);
    a.background.color = "#000000";
    expect(b.background.color).toBe(DEFAULT_BACKGROUND_COLOR);
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
      }),
    ).toEqual({
      background: { type: "image", color: "#112233", imageId: "bg-1" },
      masterVolume: 0.8,
      mode: "auto",
      autoSpawnIntervalMs: 900,
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
    };
    const restored = parseSettings(serializeSettings(original));
    expect(restored).toEqual(original);
  });

  it("直列化に画像バイナリ由来のキーは含まれない（保存項目のみ）", () => {
    const json = serializeSettings(createDefaultSettings());
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      "autoSpawnIntervalMs",
      "background",
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
    });
  });
});
