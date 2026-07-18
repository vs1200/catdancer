import { describe, expect, it } from "vitest";
import { createWorldBounds } from "../../src/core/worldBounds";
import { createCritterState } from "../../src/critters/CritterState";
import { DriftMovement } from "../../src/movement/DriftMovement";
import type { MovementContext } from "../../src/movement/Movement";

const ctx: MovementContext = {
  world: createWorldBounds({ width: 800, height: 600 }, 100),
  pointer: null,
};

function stateAt(x: number, y: number, vx = 0, vy = 0) {
  return createCritterState({
    typeId: "t",
    position: { x, y },
    velocity: { x: vx, y: vy },
    size: 10,
  });
}

describe("DriftMovement", () => {
  it("速度未設定なら初速を与えて動き出す（右向きに）", () => {
    const state = stateAt(400, 300);
    new DriftMovement({ velocity: { x: 50, y: 20 } }).update(state, 1, ctx);
    expect(state.velocity).toEqual({ x: 50, y: 20 });
    expect(state.position).toEqual({ x: 450, y: 320 });
    expect(state.facing).toBe(1);
  });

  it("既定初速でも動き、正の x で facing=1", () => {
    const state = stateAt(400, 300);
    new DriftMovement().update(state, 1, ctx);
    expect(state.position.x).toBeGreaterThan(400);
    expect(state.facing).toBe(1);
  });

  it("world 右端(maxX)で跳ね返り、x速度が負・facing=-1 になる", () => {
    // maxX=900。右向き速度で 1s 進めば 900 を超える → クランプ&反転。
    const state = stateAt(880, 300, 100, 0);
    new DriftMovement().update(state, 1, ctx);
    expect(state.position.x).toBe(900);
    expect(state.velocity.x).toBe(-100);
    expect(state.facing).toBe(-1);
  });

  it("world 左端(minX)で跳ね返り、x速度が正・facing=1 になる", () => {
    // minX=-100。左向き速度で進めば -100 を下回る → クランプ&反転。
    const state = stateAt(-80, 300, -100, 0);
    new DriftMovement().update(state, 1, ctx);
    expect(state.position.x).toBe(-100);
    expect(state.velocity.x).toBe(100);
    expect(state.facing).toBe(1);
  });

  it("world 上端/下端(y)で跳ね返り、y速度が反転。x=0 なら facing は維持", () => {
    // maxY=700。下向き速度で跳ね返り。x 速度 0 なので facing は初期値のまま。
    const state = stateAt(400, 680, 0, 100);
    state.facing = -1;
    new DriftMovement().update(state, 1, ctx);
    expect(state.position.y).toBe(700);
    expect(state.velocity.y).toBe(-100);
    expect(state.facing).toBe(-1); // x=0 のため維持
  });
});
