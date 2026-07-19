import { describe, expect, it } from "vitest";
import { FOXTAIL_TYPE_ID } from "../../src/critters/types/foxtail";
import { INSECT_TYPE_ID } from "../../src/critters/types/insect";
import { MOUSE_TYPE_ID } from "../../src/critters/types/mouse";
import { TOYS_TYPE_ID } from "../../src/critters/types/toys";
import {
  DEFAULT_MANUAL_TYPE_ID,
  isManualTarget,
  MANUAL_TARGETS,
  normalizeManualTypeId,
} from "../../src/settings/manualTargets";

describe("MANUAL_TARGETS", () => {
  it("mouse/foxtail/toys/insect を表示順で持つ", () => {
    expect(MANUAL_TARGETS.map((t) => t.id)).toEqual([
      MOUSE_TYPE_ID,
      FOXTAIL_TYPE_ID,
      TOYS_TYPE_ID,
      INSECT_TYPE_ID,
    ]);
  });

  it("各対象は非空の表示名を持つ", () => {
    for (const target of MANUAL_TARGETS) {
      expect(target.label.length).toBeGreaterThan(0);
    }
  });

  it("id は重複しない", () => {
    const ids = MANUAL_TARGETS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("既定は mouse（ネズミ）", () => {
    expect(DEFAULT_MANUAL_TYPE_ID).toBe(MOUSE_TYPE_ID);
  });
});

describe("isManualTarget", () => {
  it("選択可能な id は true", () => {
    expect(isManualTarget(MOUSE_TYPE_ID)).toBe(true);
    expect(isManualTarget(FOXTAIL_TYPE_ID)).toBe(true);
    expect(isManualTarget(TOYS_TYPE_ID)).toBe(true);
    expect(isManualTarget(INSECT_TYPE_ID)).toBe(true);
  });

  it("未登録/未対象の id は false", () => {
    expect(isManualTarget("custom")).toBe(false);
    expect(isManualTarget("")).toBe(false);
    expect(isManualTarget("unknown")).toBe(false);
  });
});

describe("normalizeManualTypeId", () => {
  it("選択可能な id はそのまま返す", () => {
    expect(normalizeManualTypeId(MOUSE_TYPE_ID)).toBe(MOUSE_TYPE_ID);
    expect(normalizeManualTypeId(FOXTAIL_TYPE_ID)).toBe(FOXTAIL_TYPE_ID);
    expect(normalizeManualTypeId(TOYS_TYPE_ID)).toBe(TOYS_TYPE_ID);
    expect(normalizeManualTypeId(INSECT_TYPE_ID)).toBe(INSECT_TYPE_ID);
  });

  it("範囲外・型不一致・欠損は既定（mouse）へ落とす", () => {
    expect(normalizeManualTypeId("custom")).toBe(DEFAULT_MANUAL_TYPE_ID);
    expect(normalizeManualTypeId("")).toBe(DEFAULT_MANUAL_TYPE_ID);
    expect(normalizeManualTypeId(undefined)).toBe(DEFAULT_MANUAL_TYPE_ID);
    expect(normalizeManualTypeId(null)).toBe(DEFAULT_MANUAL_TYPE_ID);
    expect(normalizeManualTypeId(123)).toBe(DEFAULT_MANUAL_TYPE_ID);
    expect(normalizeManualTypeId({})).toBe(DEFAULT_MANUAL_TYPE_ID);
  });
});
