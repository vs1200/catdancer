import { describe, expect, it } from "vitest";
import { FOXTAIL_TYPE_ID } from "../../src/critters/types/foxtail";
import { INSECT_TYPE_ID } from "../../src/critters/types/insect";
import { MOUSE_TYPE_ID } from "../../src/critters/types/mouse";
import { TOYS_TYPE_ID } from "../../src/critters/types/toys";
import {
  MAX_AUTO_SPAWN_INTERVAL_MS,
  MIN_AUTO_SPAWN_INTERVAL_MS,
} from "../../src/settings/settingsData";
import { findSpawnPreset, SPAWN_PRESETS } from "../../src/settings/spawnPresets";

/** 組み込み種別 id の集合（disabledTypes はこの部分集合であること）。 */
const BUILTIN_TYPE_IDS = new Set<string>([
  MOUSE_TYPE_ID,
  FOXTAIL_TYPE_ID,
  TOYS_TYPE_ID,
  INSECT_TYPE_ID,
]);

describe("SPAWN_PRESETS", () => {
  it("各プリセットの intervalMs が [MIN, MAX] の範囲内", () => {
    for (const preset of SPAWN_PRESETS) {
      expect(preset.intervalMs).toBeGreaterThanOrEqual(MIN_AUTO_SPAWN_INTERVAL_MS);
      expect(preset.intervalMs).toBeLessThanOrEqual(MAX_AUTO_SPAWN_INTERVAL_MS);
    }
  });

  it("disabledTypes は既知の組み込み種別 id の部分集合", () => {
    for (const preset of SPAWN_PRESETS) {
      for (const id of preset.disabledTypes) {
        expect(BUILTIN_TYPE_IDS.has(id)).toBe(true);
      }
    }
  });

  it("disabledTypes に重複が無い", () => {
    for (const preset of SPAWN_PRESETS) {
      expect(new Set(preset.disabledTypes).size).toBe(preset.disabledTypes.length);
    }
  });

  it("id が一意", () => {
    const ids = SPAWN_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("賑やか/標準/控えめの 3 プリセットを定義順に含む", () => {
    expect(SPAWN_PRESETS.map((p) => p.id)).toEqual(["lively", "standard", "calm"]);
  });

  it("控えめ(calm)は虫(insect)を無効化し、賑やか/標準は全種有効", () => {
    const calm = findSpawnPreset("calm");
    expect(calm?.disabledTypes).toEqual([INSECT_TYPE_ID]);
    expect(findSpawnPreset("lively")?.disabledTypes).toEqual([]);
    expect(findSpawnPreset("standard")?.disabledTypes).toEqual([]);
  });
});

describe("findSpawnPreset", () => {
  it("一致する id で対応するプリセットを返す", () => {
    for (const preset of SPAWN_PRESETS) {
      expect(findSpawnPreset(preset.id)).toBe(preset);
    }
  });

  it("未知の id では undefined を返す", () => {
    expect(findSpawnPreset("unknown")).toBeUndefined();
    expect(findSpawnPreset("")).toBeUndefined();
  });
});
