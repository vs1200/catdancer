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
    // ワールドトレイル: attachDist=hypot((0.06-0.5)*220,(0.83-0.5)*220)=121, +0.9*220=198 → 319。
    expect(r).toBeGreaterThan(315);
    expect(r).toBeLessThan(325);
  });

  it("sway系(回転揺れ)は本体半径より大きい（回した範囲を隠せる）", () => {
    const sway = makeType({ baseSize: 360, hasTail: false, sway: { pivot: { x: 0.14, y: 0.85 } } });
    const r = critterHideRadius(sway);
    // 1.5*baseSize=540（端寄り pivot 周りの回転を安全側に覆う）。
    expect(r).toBe(540);
    expect(r).toBeGreaterThan(sway.baseSize / 2);
  });
});

describe("computeWorldMargin", () => {
  it("ネズミ種別からは尻尾込みの margin(=319)を返し、fallback より大きい", () => {
    const m = computeWorldMargin([mouseType], 220);
    expect(m).toBe(319);
    expect(m).toBeGreaterThan(220);
  });

  it("複数種別では最大の hideRadius を採る", () => {
    const small = makeType({ id: "s", baseSize: 100, hasTail: false }); // 50
    const m = computeWorldMargin([small, mouseType], 220);
    expect(m).toBe(319);
  });

  it("種別が無ければ fallback を返す", () => {
    expect(computeWorldMargin([], 220)).toBe(220);
  });

  it("小さな尻尾なし種別なら margin も小さくなる（過大にしない）", () => {
    expect(computeWorldMargin([makeType({ baseSize: 80, hasTail: false })], 220)).toBe(40);
  });
});
