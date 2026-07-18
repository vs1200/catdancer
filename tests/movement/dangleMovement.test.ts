import { describe, expect, it } from "vitest";
import { createWorldBounds } from "../../src/core/worldBounds";
import { createCritterState } from "../../src/critters/CritterState";
import { hasExitedWorld } from "../../src/movement/CrossMovement";
import {
  DANGLE_SPAWN_DEFAULTS,
  DangleMovement,
  type DanglePlan,
  dangleAngleAt,
  danglePositionAt,
  dangleTotalSeconds,
  planDangleSpawn,
} from "../../src/movement/DangleMovement";
import type { MovementContext } from "../../src/movement/Movement";

const viewport = { width: 800, height: 600 };
const world = createWorldBounds(viewport, 300); // minX/minY=-300, maxX=1100, maxY=900
const ctx: MovementContext = { world, pointer: null };

/** 配列から順に値を返す決定論的 rng（planDangleSpawn は 12 回消費する）。 */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

/** 直接評価テスト用の具体的な計画（rng に依存しない）。 */
function makePlan(overrides: Partial<DanglePlan> = {}): DanglePlan {
  return {
    edge: "left",
    enter: { x: world.minX, y: 300 },
    hold: { x: 400, y: 300 },
    exit: { x: world.minX - 360, y: 300 },
    entrySec: 1,
    holdSec: 3,
    exitSec: 1,
    swayAmp: 0.6,
    swayFreq: 5,
    swayPhase: 0,
    bobAmp: 40,
    bobFreq: 4,
    bobPhase: 0,
    facing: 1,
    ...overrides,
  };
}

describe("planDangleSpawn", () => {
  it("左端から進入＝ enter は world 左端で hold と同軸、exit は world 外", () => {
    const size = 360;
    const plan = planDangleSpawn(
      world,
      seqRng([0.1, 0.5, 0.5, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0, 0]),
      DANGLE_SPAWN_DEFAULTS,
      size,
    );
    expect(plan.edge).toBe("left");
    expect(plan.hold.x).toBeCloseTo(400, 6); // width/2（inset 中央）
    expect(plan.hold.y).toBeCloseTo(300, 6);
    expect(plan.enter.x).toBe(world.minX);
    expect(plan.enter.y).toBe(plan.hold.y); // 同軸でまっすぐ進入
    expect(plan.exit.x).toBe(world.minX - size);
    expect(hasExitedWorld(plan.exit, world)).toBe(true); // 退場先は world 外
    expect(hasExitedWorld(plan.enter, world)).toBe(false); // 進入開始は world 内（即despawnしない）
    expect(plan.facing).toBe(1);
  });

  it("edge セレクタで上下左右を選ぶ", () => {
    const base = [0, 0.5, 0.5, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0, 0];
    const edgeOf = (sel: number) =>
      planDangleSpawn(world, seqRng([sel, ...base.slice(1)]), DANGLE_SPAWN_DEFAULTS, 100).edge;
    expect(edgeOf(0.1)).toBe("left");
    expect(edgeOf(0.3)).toBe("right");
    expect(edgeOf(0.6)).toBe("top");
    expect(edgeOf(0.9)).toBe("bottom");
  });

  it("hold は viewport 内（inset を守る）", () => {
    const plan = planDangleSpawn(
      world,
      seqRng([0.1, 0, 1, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0, 0]),
      DANGLE_SPAWN_DEFAULTS,
      100,
    );
    const inset = DANGLE_SPAWN_DEFAULTS.holdInsetFrac;
    expect(plan.hold.x).toBeGreaterThanOrEqual(viewport.width * inset - 1e-6);
    expect(plan.hold.x).toBeLessThanOrEqual(viewport.width * (1 - inset) + 1e-6);
    expect(plan.hold.y).toBeGreaterThanOrEqual(viewport.height * inset - 1e-6);
    expect(plan.hold.y).toBeLessThanOrEqual(viewport.height * (1 - inset) + 1e-6);
  });
});

describe("danglePositionAt", () => {
  it("t<=0 は enter、t>=total は exit（＝寿命後は world 外）", () => {
    const plan = makePlan();
    const total = dangleTotalSeconds(plan);
    expect(danglePositionAt(plan, 0)).toEqual(plan.enter);
    expect(danglePositionAt(plan, -1)).toEqual(plan.enter);
    expect(danglePositionAt(plan, total)).toEqual(plan.exit);
    expect(danglePositionAt(plan, total + 5)).toEqual(plan.exit);
    expect(hasExitedWorld(danglePositionAt(plan, total), world)).toBe(true);
  });

  it("進入は enter→hold、退場は hold→exit へ滑らかに向かう", () => {
    const plan = makePlan();
    // 進入中盤は enter と hold の間（x が前進している）。
    const mid = danglePositionAt(plan, plan.entrySec / 2);
    expect(mid.x).toBeGreaterThan(plan.enter.x);
    expect(mid.x).toBeLessThan(plan.hold.x);
    // 進入完了時は hold（bob 窓が 0）。
    expect(danglePositionAt(plan, plan.entrySec)).toEqual(plan.hold);
  });

  it("hold 中は支点（hold）付近に留まる（bobAmp 内で漂う＝ドリフトしない）", () => {
    const plan = makePlan();
    const start = plan.entrySec;
    const end = plan.entrySec + plan.holdSec;
    for (let t = start; t <= end; t += 0.05) {
      const p = danglePositionAt(plan, t);
      expect(Math.abs(p.x - plan.hold.x)).toBeLessThanOrEqual(plan.bobAmp + 1e-6);
      expect(Math.abs(p.y - plan.hold.y)).toBeLessThanOrEqual(plan.bobAmp + 1e-6);
    }
  });

  it("長時間サンプルで NaN・非有限を出さない", () => {
    const plan = makePlan();
    for (let t = 0; t < 20; t += 0.013) {
      const p = danglePositionAt(plan, t);
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});

describe("dangleAngleAt", () => {
  it("端(t=0, t>=total)は角0、|angle| は swayAmp 以内（範囲内）", () => {
    const plan = makePlan();
    const total = dangleTotalSeconds(plan);
    expect(dangleAngleAt(plan, 0)).toBe(0);
    expect(dangleAngleAt(plan, total)).toBe(0);
    for (let t = 0; t <= total; t += 0.01) {
      expect(Math.abs(dangleAngleAt(plan, t))).toBeLessThanOrEqual(plan.swayAmp + 1e-9);
    }
  });

  it("時間で振動する（正負両側に振れる）", () => {
    const plan = makePlan();
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    const holdMid = plan.entrySec + plan.holdSec / 2;
    for (let t = holdMid - 1; t <= holdMid + 1; t += 0.01) {
      const a = dangleAngleAt(plan, t);
      min = Math.min(min, a);
      max = Math.max(max, a);
    }
    expect(min).toBeLessThan(0);
    expect(max).toBeGreaterThan(0);
  });
});

describe("DangleMovement", () => {
  it("enter から hold へ引き込み、rotation を振り、やがて world 外へ抜ける", () => {
    const plan = makePlan();
    const state = createCritterState({
      typeId: "foxtail",
      position: { x: plan.enter.x, y: plan.enter.y },
      size: 360,
    });
    const m = new DangleMovement(plan);
    // 数フレームで視界へ入り world 内。
    for (let i = 0; i < 30; i++) {
      m.update(state, 1 / 60, ctx);
    }
    expect(hasExitedWorld(state.position, world)).toBe(false);
    expect(state.position.x).toBeGreaterThan(plan.enter.x);
    // 総寿命を十分に超えたら exit（world 外）に達し despawn 対象。
    const total = dangleTotalSeconds(plan);
    for (let i = 0; i < Math.ceil(total * 60) + 60; i++) {
      m.update(state, 1 / 60, ctx);
    }
    expect(state.position).toEqual(plan.exit);
    expect(hasExitedWorld(state.position, world)).toBe(true);
    expect(state.facing).toBe(1); // dangle は反転しない
  });

  it("rotation が更新される（振れている）", () => {
    const plan = makePlan();
    const state = createCritterState({
      typeId: "foxtail",
      position: { x: plan.enter.x, y: plan.enter.y },
      size: 360,
    });
    const m = new DangleMovement(plan);
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < 240; i++) {
      m.update(state, 1 / 60, ctx);
      min = Math.min(min, state.rotation);
      max = Math.max(max, state.rotation);
      expect(Number.isFinite(state.rotation)).toBe(true);
    }
    expect(max - min).toBeGreaterThan(0.1); // 振動している
    expect(Math.abs(min)).toBeLessThanOrEqual(plan.swayAmp + 1e-9);
    expect(Math.abs(max)).toBeLessThanOrEqual(plan.swayAmp + 1e-9);
  });

  it("dt<=0 では状態を変えない（NaN・暴走ガード）", () => {
    const plan = makePlan();
    const state = createCritterState({
      typeId: "foxtail",
      position: { x: 100, y: 200 },
      velocity: { x: 3, y: 4 },
      size: 360,
    });
    const m = new DangleMovement(plan);
    m.update(state, 0, ctx);
    expect(state.position).toEqual({ x: 100, y: 200 });
    m.update(state, -1, ctx);
    expect(state.position).toEqual({ x: 100, y: 200 });
    expect(state.rotation).toBe(0);
  });

  it("長時間でも NaN を出さない", () => {
    const plan = makePlan({ holdSec: 30 });
    const state = createCritterState({
      typeId: "toys",
      position: { x: plan.enter.x, y: plan.enter.y },
      size: 340,
    });
    const m = new DangleMovement(plan);
    for (let i = 0; i < 5000; i++) {
      m.update(state, 1 / 60, ctx);
    }
    expect(Number.isFinite(state.position.x)).toBe(true);
    expect(Number.isFinite(state.position.y)).toBe(true);
    expect(Number.isFinite(state.rotation)).toBe(true);
    expect(Number.isFinite(state.velocity.x)).toBe(true);
  });
});
