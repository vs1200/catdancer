import { describe, expect, it } from "vitest";
import type { CritterType } from "../../src/critters/CritterType";
import { mouseType } from "../../src/critters/types/mouse";
import { computeWorldMargin, critterHideRadius } from "../../src/critters/worldMargin";
import { MouseFollowMovement } from "../../src/movement/MouseFollowMovement";

function makeType(overrides: Partial<CritterType> = {}): CritterType {
  return {
    id: "dummy",
    displayName: "dummy",
    textureUrl: "dummy.webp",
    baseSize: 120,
    defaultFacing: 1,
    createMovement: () => new MouseFollowMovement(),
    sounds: {},
    hasTail: false,
    ...overrides,
  };
}

describe("critterHideRadius", () => {
  it("尻尾なしは baseSize/2（本体半径）", () => {
    expect(critterHideRadius(makeType({ baseSize: 120, hasTail: false }))).toBe(60);
  });

  it("尻尾ありは本体半径より大きい（尻尾先端まで隠せる）", () => {
    const r = critterHideRadius(mouseType);
    expect(r).toBeGreaterThan(mouseType.baseSize / 2);
    // reachX=(0.5-0.06+0.95)*220=305.8, reachY=(0.33+0.1+0.11)*220=118.8, hypot≈328。
    expect(r).toBeGreaterThan(320);
    expect(r).toBeLessThan(335);
  });
});

describe("computeWorldMargin", () => {
  it("ネズミ種別からは尻尾込みの margin(≈329)を返し、fallback より大きい", () => {
    const m = computeWorldMargin([mouseType], 220);
    expect(m).toBe(329);
    expect(m).toBeGreaterThan(220);
  });

  it("複数種別では最大の hideRadius を採る", () => {
    const small = makeType({ id: "s", baseSize: 100, hasTail: false }); // 50
    const m = computeWorldMargin([small, mouseType], 220);
    expect(m).toBe(329);
  });

  it("種別が無ければ fallback を返す", () => {
    expect(computeWorldMargin([], 220)).toBe(220);
  });

  it("小さな尻尾なし種別なら margin も小さくなる（過大にしない）", () => {
    expect(computeWorldMargin([makeType({ baseSize: 80, hasTail: false })], 220)).toBe(40);
  });
});
