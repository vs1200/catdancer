import { describe, expect, it } from "vitest";
import {
  applyMovement,
  createCritterState,
  updateFacingFromVelocity,
} from "../../src/critters/CritterState";

describe("CritterState", () => {
  it("createCritterState は既定値を埋め、position/velocity をコピーする", () => {
    const pos = { x: 10, y: 20 };
    const state = createCritterState({ typeId: "mouse", position: pos, size: 160 });
    expect(state.typeId).toBe("mouse");
    expect(state.position).toEqual({ x: 10, y: 20 });
    expect(state.position).not.toBe(pos); // コピーされている
    expect(state.velocity).toEqual({ x: 0, y: 0 });
    expect(state.facing).toBe(1);
    expect(state.size).toBe(160);
  });

  it("createCritterState は指定した velocity / facing を反映する", () => {
    const state = createCritterState({
      typeId: "mouse",
      position: { x: 0, y: 0 },
      velocity: { x: -5, y: 3 },
      facing: -1,
      size: 100,
    });
    expect(state.velocity).toEqual({ x: -5, y: 3 });
    expect(state.facing).toBe(-1);
  });

  it("heading 既定: 初速があればその向き、無ければ facing(右=0/左=π)", () => {
    // 初速なし・右向き → 0
    const right = createCritterState({ typeId: "t", position: { x: 0, y: 0 }, size: 10 });
    expect(right.heading).toBeCloseTo(0);
    // 初速なし・左向き → π
    const left = createCritterState({
      typeId: "t",
      position: { x: 0, y: 0 },
      facing: -1,
      size: 10,
    });
    expect(left.heading).toBeCloseTo(Math.PI);
    // 初速あり → atan2(vy,vx)（facing より優先）
    const moving = createCritterState({
      typeId: "t",
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 100 },
      size: 10,
    });
    expect(moving.heading).toBeCloseTo(Math.PI / 2);
    // 明示指定が最優先
    const explicit = createCritterState({
      typeId: "t",
      position: { x: 0, y: 0 },
      velocity: { x: 100, y: 0 },
      heading: 1.23,
      size: 10,
    });
    expect(explicit.heading).toBeCloseTo(1.23);
  });

  it("applyMovement は速度 * dt で位置を積分する", () => {
    const state = createCritterState({
      typeId: "t",
      position: { x: 0, y: 0 },
      velocity: { x: 100, y: -50 },
      size: 10,
    });
    applyMovement(state, 0.5);
    expect(state.position).toEqual({ x: 50, y: -25 });
  });

  it("applyMovement: ゼロ速度では動かない", () => {
    const state = createCritterState({
      typeId: "t",
      position: { x: 7, y: 9 },
      velocity: { x: 0, y: 0 },
      size: 10,
    });
    applyMovement(state, 1);
    expect(state.position).toEqual({ x: 7, y: 9 });
  });

  it("updateFacingFromVelocity: 正→1 / 負→-1 / ゼロ→維持", () => {
    const right = createCritterState({
      typeId: "t",
      position: { x: 0, y: 0 },
      velocity: { x: 3, y: 0 },
      facing: -1,
      size: 10,
    });
    updateFacingFromVelocity(right);
    expect(right.facing).toBe(1);

    const left = createCritterState({
      typeId: "t",
      position: { x: 0, y: 0 },
      velocity: { x: -3, y: 0 },
      facing: 1,
      size: 10,
    });
    updateFacingFromVelocity(left);
    expect(left.facing).toBe(-1);

    // velocity.x === 0 は現状維持（真上/真下移動でちらつかない）
    const still = createCritterState({
      typeId: "t",
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 5 },
      facing: -1,
      size: 10,
    });
    updateFacingFromVelocity(still);
    expect(still.facing).toBe(-1);
  });
});
