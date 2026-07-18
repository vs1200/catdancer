import { describe, expect, it } from "vitest";
import type { Vec2 } from "../../src/core/vec2";
import { createWorldBounds } from "../../src/core/worldBounds";
import { createCritterState } from "../../src/critters/CritterState";
import {
  computeEscapeTarget,
  computeFollowTarget,
  MOUSE_FOLLOW_DEFAULTS,
  MouseFollowMovement,
} from "../../src/movement/MouseFollowMovement";
import type { MovementContext } from "../../src/movement/Movement";

const viewport = { width: 800, height: 600 };
const margin = 100; // minX/minY=-100, maxX=900, maxY=700
const world = createWorldBounds(viewport, margin);

function ctxWith(pointer: Vec2 | null): MovementContext {
  return { world, pointer };
}

function stateAt(x: number, y: number, vx = 0, vy = 0) {
  return createCritterState({
    typeId: "mouse",
    position: { x, y },
    velocity: { x: vx, y: vy },
    size: 220,
  });
}

/** dt=1/60 の固定ステップで n フレーム進める。 */
function run(
  m: MouseFollowMovement,
  state: ReturnType<typeof stateAt>,
  ctx: MovementContext,
  n: number,
) {
  const dt = 1 / 60;
  for (let i = 0; i < n; i++) {
    m.update(state, dt, ctx);
  }
}

describe("computeFollowTarget", () => {
  it("画面内のポインタはそのまま目標になる", () => {
    const t = computeFollowTarget({ x: 400, y: 300 }, { x: 0, y: 0 }, { x: 0, y: 0 }, world, 40);
    expect(t).toEqual({ x: 400, y: 300 });
  });

  it("右端に近いポインタは目標 x を world 右端(margin側)へ延長する", () => {
    // width-edgeThreshold = 760。x=770 は端に近い → maxX へ。
    const t = computeFollowTarget({ x: 770, y: 300 }, { x: 0, y: 0 }, { x: 0, y: 0 }, world, 40);
    expect(t.x).toBe(world.maxX);
    expect(t.y).toBe(300);
  });

  it("左端/上端に近いポインタは minX/minY へ延長する", () => {
    const t = computeFollowTarget({ x: 10, y: 20 }, { x: 0, y: 0 }, { x: 0, y: 0 }, world, 40);
    expect(t.x).toBe(world.minX);
    expect(t.y).toBe(world.minY);
  });

  it("pointer=null は escape 目標（進行方向の world 端）になる", () => {
    // 右向きに進行中 → 右の world 端(maxX)へ逃げる。
    const t = computeFollowTarget(null, { x: 400, y: 300 }, { x: 200, y: 0 }, world, 40);
    expect(t.x).toBe(world.maxX);
    expect(t.y).toBe(300);
  });
});

describe("computeEscapeTarget", () => {
  it("速度方向の world 端へ向かう", () => {
    expect(computeEscapeTarget({ x: 400, y: 300 }, { x: -100, y: 0 }, world)).toEqual({
      x: world.minX,
      y: 300,
    });
  });

  it("速度がほぼ0なら画面中心→現在位置の向き（近い辺）へ逃げる", () => {
    // 位置は中心より右 → 右へ逃げる。
    const t = computeEscapeTarget({ x: 700, y: 300 }, { x: 0, y: 0 }, world);
    expect(t.x).toBe(world.maxX);
  });

  it("中心かつ速度0でも既定で右へ逃げ、NaN を出さない", () => {
    const t = computeEscapeTarget({ x: 400, y: 300 }, { x: 0, y: 0 }, world);
    expect(Number.isFinite(t.x)).toBe(true);
    expect(Number.isFinite(t.y)).toBe(true);
    expect(t.x).toBe(world.maxX);
  });
});

describe("MouseFollowMovement", () => {
  it("目標ポインタへ近づく（慣性追従）", () => {
    const state = stateAt(100, 300);
    const m = new MouseFollowMovement();
    const before = Math.hypot(700 - state.position.x, 300 - state.position.y);
    run(m, state, ctxWith({ x: 700, y: 300 }), 30);
    const after = Math.hypot(700 - state.position.x, 300 - state.position.y);
    expect(after).toBeLessThan(before);
    expect(state.velocity.x).toBeGreaterThan(0); // 右へ加速
  });

  it("速度は maxSpeed を超えない", () => {
    const state = stateAt(0, 0);
    const m = new MouseFollowMovement();
    // 遠方の目標へ十分加速させる。
    run(m, state, ctxWith({ x: 5000, y: 5000 }), 200);
    const speed = Math.hypot(state.velocity.x, state.velocity.y);
    expect(speed).toBeLessThanOrEqual(MOUSE_FOLLOW_DEFAULTS.maxSpeed + 1e-6);
  });

  it("静止した目標付近では収束し、無限に振動しない", () => {
    const state = stateAt(420, 315);
    const m = new MouseFollowMovement();
    run(m, state, ctxWith({ x: 400, y: 300 }), 600); // 10 秒
    const speed = Math.hypot(state.velocity.x, state.velocity.y);
    const dist = Math.hypot(400 - state.position.x, 300 - state.position.y);
    expect(speed).toBeLessThan(5);
    expect(dist).toBeLessThan(5);
  });

  it("pointer=null で画面外(viewport外)へ走り去る", () => {
    const state = stateAt(700, 300, 100, 0); // 右向きに動いている
    const m = new MouseFollowMovement();
    run(m, state, ctxWith(null), 300);
    // 画面(viewport)外まで抜けている。
    expect(
      state.position.x < 0 ||
        state.position.x > viewport.width ||
        state.position.y < 0 ||
        state.position.y > viewport.height,
    ).toBe(true);
  });

  it("進行方向で facing が更新される（右→1, 左→-1）", () => {
    const right = stateAt(400, 300);
    new MouseFollowMovement().update(right, 1 / 60, ctxWith({ x: 780, y: 300 }));
    run(new MouseFollowMovement(), right, ctxWith({ x: 780, y: 300 }), 5);
    expect(right.facing).toBe(1);

    const left = stateAt(400, 300);
    left.facing = 1;
    run(new MouseFollowMovement(), left, ctxWith({ x: 20, y: 300 }), 10);
    expect(left.facing).toBe(-1);
  });

  it("位置は world 内にクランプされ、長時間でも NaN・暴走しない", () => {
    const state = stateAt(400, 300);
    const m = new MouseFollowMovement();
    // 交互に遠方・null を与え続けても発散しない。
    for (let i = 0; i < 5000; i++) {
      const p = i % 2 === 0 ? { x: 9999, y: -9999 } : null;
      m.update(state, 1 / 60, ctxWith(p));
    }
    expect(Number.isFinite(state.position.x)).toBe(true);
    expect(Number.isFinite(state.position.y)).toBe(true);
    expect(state.position.x).toBeGreaterThanOrEqual(world.minX);
    expect(state.position.x).toBeLessThanOrEqual(world.maxX);
    expect(state.position.y).toBeGreaterThanOrEqual(world.minY);
    expect(state.position.y).toBeLessThanOrEqual(world.maxY);
  });

  it("dt<=0 では状態を変えない（NaN・暴走ガード）", () => {
    const state = stateAt(400, 300, 10, 20);
    const m = new MouseFollowMovement();
    m.update(state, 0, ctxWith({ x: 700, y: 300 }));
    expect(state.position).toEqual({ x: 400, y: 300 });
    expect(state.velocity).toEqual({ x: 10, y: 20 });
    m.update(state, -1, ctxWith({ x: 700, y: 300 }));
    expect(state.position).toEqual({ x: 400, y: 300 });
  });

  it("ゼロ距離（目標=現在位置）でも 0 除算せず有限", () => {
    const state = stateAt(400, 300);
    new MouseFollowMovement().update(state, 1 / 60, ctxWith({ x: 400, y: 300 }));
    expect(Number.isFinite(state.position.x)).toBe(true);
    expect(Number.isFinite(state.velocity.x)).toBe(true);
  });
});
