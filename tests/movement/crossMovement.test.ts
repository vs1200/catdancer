import { describe, expect, it } from "vitest";
import { createWorldBounds } from "../../src/core/worldBounds";
import { createCritterState } from "../../src/critters/CritterState";
import { CrossMovement, hasExitedWorld, planCrossSpawn } from "../../src/movement/CrossMovement";
import type { MovementContext } from "../../src/movement/Movement";

const viewport = { width: 800, height: 600 };
const margin = 200; // minX/minY=-200, maxX=1000, maxY=800
const world = createWorldBounds(viewport, margin);
const ctx: MovementContext = { world, pointer: null };

/** 配列から順に値を返す決定論的 rng（planCrossSpawn は 7 回消費する）。 */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

function stateAt(x: number, y: number, vx = 0, vy = 0) {
  return createCritterState({
    typeId: "mouse",
    position: { x, y },
    velocity: { x: vx, y: vy },
    size: 220,
  });
}

describe("planCrossSpawn", () => {
  it("左端から出現＝ world 左端・右向き・inside world", () => {
    // rng: fromLeft(0<0.5), speed(0→min), vy(0.5→0), y(0.5→中央), amp(0), freq(0), phase(0)
    const plan = planCrossSpawn(world, seqRng([0, 0, 0.5, 0.5, 0, 0, 0]));
    expect(plan.position.x).toBe(world.minX);
    expect(plan.velocity.x).toBeGreaterThan(0); // 右向き
    expect(plan.velocity.y).toBeCloseTo(0, 6); // ドリフト 0
    expect(plan.facing).toBe(1);
    // 出現位置は world 内（初フレームで即 despawn しない）。
    expect(hasExitedWorld(plan.position, world)).toBe(false);
  });

  it("右端から出現＝ world 右端・左向き", () => {
    // rng: fromLeft(0.9>=0.5→right), speed(1→max), ...
    const plan = planCrossSpawn(world, seqRng([0.9, 1, 0.5, 0.5, 0, 0, 0]));
    expect(plan.position.x).toBe(world.maxX);
    expect(plan.velocity.x).toBeLessThan(0); // 左向き
    expect(plan.facing).toBe(-1);
    expect(hasExitedWorld(plan.position, world)).toBe(false);
  });

  it("出現 y は viewport 可視域寄りに収まる", () => {
    const plan = planCrossSpawn(world, seqRng([0, 0.5, 0.5, 0, 0, 0, 0])); // y frac=0 → 下限
    expect(plan.position.y).toBeGreaterThanOrEqual(0);
    expect(plan.position.y).toBeLessThanOrEqual(viewport.height);
  });
});

describe("hasExitedWorld", () => {
  it("world 内は false、world 外は true", () => {
    expect(hasExitedWorld({ x: 400, y: 300 }, world)).toBe(false);
    expect(hasExitedWorld({ x: world.minX, y: 300 }, world)).toBe(false); // 端は内側
    expect(hasExitedWorld({ x: world.maxX + 1, y: 300 }, world)).toBe(true);
    expect(hasExitedWorld({ x: 400, y: world.minY - 1 }, world)).toBe(true);
  });
});

describe("CrossMovement", () => {
  it("左端から右へ横切り、やがて world 外へ抜ける（クランプしない）", () => {
    const state = stateAt(world.minX, 300);
    const m = new CrossMovement({ vx: 300, vy: 0 });
    // 初フレームは world 内。
    m.update(state, 1 / 60, ctx);
    expect(state.position.x).toBeGreaterThan(world.minX);
    expect(hasExitedWorld(state.position, world)).toBe(false);
    // 十分な時間で world 右端の外へ抜ける（クランプされず maxX を超える）。
    for (let i = 0; i < 600; i++) {
      m.update(state, 1 / 60, ctx);
    }
    expect(state.position.x).toBeGreaterThan(world.maxX);
    expect(hasExitedWorld(state.position, world)).toBe(true);
    expect(state.facing).toBe(1);
  });

  it("左向き速度では facing=-1", () => {
    const state = stateAt(world.maxX, 300);
    state.facing = 1;
    const m = new CrossMovement({ vx: -300, vy: 0 });
    m.update(state, 1 / 60, ctx);
    expect(state.facing).toBe(-1);
    expect(state.position.x).toBeLessThan(world.maxX);
  });

  it("揺れは進行に垂直（水平横断で x はほぼ一定速度、y が振動）", () => {
    const state = stateAt(0, 300);
    const m = new CrossMovement({ vx: 200, vy: 0, wobbleAmp: 30, wobbleFreq: 4, phase: 0 });
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < 120; i++) {
      m.update(state, 1 / 60, ctx);
      minY = Math.min(minY, state.position.y);
      maxY = Math.max(maxY, state.position.y);
    }
    // x は常に前進（vx>0）。
    expect(state.velocity.x).toBeGreaterThan(0);
    // y は揺れで振動している。
    expect(maxY - minY).toBeGreaterThan(1);
  });

  it("dt<=0 では状態を変えない（NaN・暴走ガード）", () => {
    const state = stateAt(100, 300, 5, 5);
    const m = new CrossMovement({ vx: 300, vy: 0, wobbleAmp: 30, wobbleFreq: 4 });
    m.update(state, 0, ctx);
    expect(state.position).toEqual({ x: 100, y: 300 });
    m.update(state, -1, ctx);
    expect(state.position).toEqual({ x: 100, y: 300 });
  });

  it("長時間でも NaN・非有限を出さない", () => {
    const state = stateAt(world.minX, 300);
    const m = new CrossMovement({ vx: 250, vy: 40, wobbleAmp: 20, wobbleFreq: 5, phase: 1 });
    for (let i = 0; i < 5000; i++) {
      m.update(state, 1 / 60, ctx);
    }
    expect(Number.isFinite(state.position.x)).toBe(true);
    expect(Number.isFinite(state.position.y)).toBe(true);
    expect(Number.isFinite(state.velocity.x)).toBe(true);
  });
});
