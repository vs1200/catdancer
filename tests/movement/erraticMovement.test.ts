import { describe, expect, it } from "vitest";
import { createWorldBounds } from "../../src/core/worldBounds";
import { createCritterState } from "../../src/critters/CritterState";
import { hasExitedWorld } from "../../src/movement/CrossMovement";
import {
  ERRATIC_SPAWN_DEFAULTS,
  ErraticMovement,
  type ErraticPlan,
  erraticEntryVelocity,
  erraticPositionAt,
  erraticTotalSeconds,
  planErraticSpawn,
} from "../../src/movement/ErraticMovement";
import type { MovementContext } from "../../src/movement/Movement";

const viewport = { width: 800, height: 600 };
const world = createWorldBounds(viewport, 300); // minX/minY=-300, maxX=1100, maxY=900
const ctx: MovementContext = { world, pointer: null };
const SIZE = 56;

/** 配列から順に値を返し、尽きたら 0.5 を返す決定論的 rng（可変個の rng 消費に対応）。 */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = i < values.length ? values[i] : 0.5;
    i++;
    return v;
  };
}

/** 直接評価テスト用の具体的な計画（rng に依存しない）。 */
function makePlan(overrides: Partial<ErraticPlan> = {}): ErraticPlan {
  return {
    enter: { x: world.minX, y: 300 },
    waypoints: [
      { x: 200, y: 200 },
      { x: 600, y: 400 },
      { x: 300, y: 500 },
    ],
    exit: { x: world.maxX + SIZE, y: 500 },
    entrySec: 0.35,
    dashSec: 0.3,
    pauseSec: 0.25,
    exitSec: 0.35,
    jitterAmp: 10,
    jitterFreq: 22,
    jitterPhase: 0,
    facing: 1,
    ...overrides,
  };
}

function stateAt(x: number, y: number, vx = 0, vy = 0) {
  return createCritterState({
    typeId: "insect",
    position: { x, y },
    velocity: { x: vx, y: vy },
    size: SIZE,
  });
}

describe("planErraticSpawn", () => {
  it("enter は world 端(inside)・exit は world 外・waypoint は viewport inset 内", () => {
    const plan = planErraticSpawn(world, seqRng([]), ERRATIC_SPAWN_DEFAULTS, SIZE); // すべて 0.5
    // 進入開始は world 内（初フレームで即 despawn しない）。
    expect(hasExitedWorld(plan.enter, world)).toBe(false);
    // 退場先は world 外（寿命後に確実に despawn）。
    expect(hasExitedWorld(plan.exit, world)).toBe(true);
    // waypoint 個数はレンジ内。
    expect(plan.waypoints.length).toBeGreaterThanOrEqual(ERRATIC_SPAWN_DEFAULTS.waypointsMin);
    expect(plan.waypoints.length).toBeLessThanOrEqual(ERRATIC_SPAWN_DEFAULTS.waypointsMax);
    // waypoint は viewport の inset 内（無限遠へ飛ばさない）。
    const inset = ERRATIC_SPAWN_DEFAULTS.insetFrac;
    for (const wp of plan.waypoints) {
      expect(wp.x).toBeGreaterThanOrEqual(viewport.width * inset - 1e-6);
      expect(wp.x).toBeLessThanOrEqual(viewport.width * (1 - inset) + 1e-6);
      expect(wp.y).toBeGreaterThanOrEqual(viewport.height * inset - 1e-6);
      expect(wp.y).toBeLessThanOrEqual(viewport.height * (1 - inset) + 1e-6);
    }
    expect(plan.facing).toBe(1);
  });

  it("enterEdge セレクタで進入辺(world 端)が決まる", () => {
    const enterOf = (sel: number) =>
      planErraticSpawn(world, seqRng([sel]), ERRATIC_SPAWN_DEFAULTS, SIZE).enter;
    expect(enterOf(0.1).x).toBe(world.minX); // left
    expect(enterOf(0.3).x).toBe(world.maxX); // right
    expect(enterOf(0.6).y).toBe(world.minY); // top
    expect(enterOf(0.9).y).toBe(world.maxY); // bottom
  });

  it("waypointCount セレクタで個数が決まる（min..max）", () => {
    // index1=0 → 最小、index1≈1 → 最大。
    const countOf = (sel: number) =>
      planErraticSpawn(world, seqRng([0.1, sel]), ERRATIC_SPAWN_DEFAULTS, SIZE).waypoints.length;
    expect(countOf(0)).toBe(ERRATIC_SPAWN_DEFAULTS.waypointsMin);
    expect(countOf(0.999)).toBe(ERRATIC_SPAWN_DEFAULTS.waypointsMax);
  });
});

describe("erraticTotalSeconds", () => {
  it("entry + n*pause + (n-1)*dash + exit", () => {
    const plan = makePlan();
    const expected = 0.35 + 3 * 0.25 + 2 * 0.3 + 0.35;
    expect(erraticTotalSeconds(plan)).toBeCloseTo(expected, 9);
  });
});

describe("erraticPositionAt", () => {
  it("t<=0 は enter、t>=total は exit（＝寿命後は world 外）", () => {
    const plan = makePlan();
    const total = erraticTotalSeconds(plan);
    expect(erraticPositionAt(plan, 0)).toEqual(plan.enter);
    expect(erraticPositionAt(plan, -1)).toEqual(plan.enter);
    expect(erraticPositionAt(plan, total)).toEqual(plan.exit);
    expect(erraticPositionAt(plan, total + 5)).toEqual(plan.exit);
    expect(hasExitedWorld(erraticPositionAt(plan, total), world)).toBe(true);
  });

  it("進入は enter→wp0 へ前進し、進入完了時はちょうど wp0", () => {
    const plan = makePlan();
    const mid = erraticPositionAt(plan, plan.entrySec / 2);
    expect(mid.x).toBeGreaterThan(plan.enter.x);
    expect(mid.x).toBeLessThan(plan.waypoints[0].x);
    // 進入完了＝pause0 開始（ジッター窓 0）→ ちょうど wp0。
    expect(erraticPositionAt(plan, plan.entrySec)).toEqual(plan.waypoints[0]);
  });

  it("停止中は wp0 の周囲 jitterAmp 内に留まる（ドリフトしない）", () => {
    const plan = makePlan();
    const wp0 = plan.waypoints[0];
    const start = plan.entrySec;
    const end = plan.entrySec + plan.pauseSec;
    for (let t = start; t <= end; t += 0.01) {
      const p = erraticPositionAt(plan, t);
      expect(Math.abs(p.x - wp0.x)).toBeLessThanOrEqual(plan.jitterAmp + 1e-6);
      expect(Math.abs(p.y - wp0.y)).toBeLessThanOrEqual(plan.jitterAmp + 1e-6);
    }
  });

  it("roam 中は viewport 近辺に留まる（無限遠へ飛ばさない）", () => {
    const plan = makePlan();
    const total = erraticTotalSeconds(plan);
    const roamEnd = total - plan.exitSec; // 最終ダッシュ(退場)前まで
    const pad = plan.jitterAmp + 1e-6;
    for (let t = plan.entrySec; t <= roamEnd; t += 0.01) {
      const p = erraticPositionAt(plan, t);
      expect(p.x).toBeGreaterThanOrEqual(-pad);
      expect(p.x).toBeLessThanOrEqual(viewport.width + pad);
      expect(p.y).toBeGreaterThanOrEqual(-pad);
      expect(p.y).toBeLessThanOrEqual(viewport.height + pad);
    }
  });

  it("長時間サンプルで有限（NaN・非有限を出さない）", () => {
    const plan = makePlan();
    for (let t = -1; t < 20; t += 0.013) {
      const p = erraticPositionAt(plan, t);
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});

describe("erraticEntryVelocity", () => {
  it("wp0 方向を向く（進入方向へ heading 初期化できる）", () => {
    const plan = makePlan(); // enter(-300,300) → wp0(200,200): dx>0, dy<0
    const v = erraticEntryVelocity(plan);
    expect(v.x).toBeGreaterThan(0);
    expect(v.y).toBeLessThan(0);
    expect(Number.isFinite(v.x)).toBe(true);
    expect(Number.isFinite(v.y)).toBe(true);
  });
});

describe("ErraticMovement", () => {
  it("enter から視界内へ入り、初期は world 内、総寿命後は world 外へ抜ける（despawn 保証）", () => {
    const plan = makePlan();
    const state = stateAt(plan.enter.x, plan.enter.y);
    const m = new ErraticMovement(plan);
    // 進入後の数フレームで world 内に入り、enter から前進している。
    for (let i = 0; i < 30; i++) {
      m.update(state, 1 / 60, ctx);
    }
    expect(hasExitedWorld(state.position, world)).toBe(false);
    expect(state.position.x).toBeGreaterThan(plan.enter.x);
    // 総寿命を十分に超えたら exit（world 外）に達し despawn 対象。
    const total = erraticTotalSeconds(plan);
    for (let i = 0; i < Math.ceil(total * 60) + 120; i++) {
      m.update(state, 1 / 60, ctx);
    }
    expect(state.position).toEqual(plan.exit);
    expect(hasExitedWorld(state.position, world)).toBe(true);
  });

  it("ダッシュはキビキビ速く、停止で速度が落ちる（速度が大きく変動する）", () => {
    const plan = makePlan();
    const state = stateAt(plan.enter.x, plan.enter.y);
    const m = new ErraticMovement(plan);
    let maxSpeed = 0;
    let minSpeed = Number.POSITIVE_INFINITY;
    const total = erraticTotalSeconds(plan);
    const frames = Math.ceil((total - plan.exitSec) * 60); // roam 終了まで
    for (let i = 0; i < frames; i++) {
      m.update(state, 1 / 60, ctx);
      const s = Math.hypot(state.velocity.x, state.velocity.y);
      maxSpeed = Math.max(maxSpeed, s);
      minSpeed = Math.min(minSpeed, s);
    }
    expect(maxSpeed).toBeGreaterThan(800); // ダッシュは速い
    expect(minSpeed).toBeLessThan(300); // 停止付近で落ちる
  });

  it("dt<=0 では状態を変えない（NaN・暴走ガード）", () => {
    const plan = makePlan();
    const state = stateAt(100, 200, 3, 4);
    const m = new ErraticMovement(plan);
    m.update(state, 0, ctx);
    expect(state.position).toEqual({ x: 100, y: 200 });
    m.update(state, -1, ctx);
    expect(state.position).toEqual({ x: 100, y: 200 });
  });

  it("長時間でも NaN・非有限を出さない", () => {
    const plan = makePlan({ pauseSec: 2, dashSec: 1 });
    const state = stateAt(plan.enter.x, plan.enter.y);
    const m = new ErraticMovement(plan);
    for (let i = 0; i < 5000; i++) {
      m.update(state, 1 / 60, ctx);
    }
    expect(Number.isFinite(state.position.x)).toBe(true);
    expect(Number.isFinite(state.position.y)).toBe(true);
    expect(Number.isFinite(state.velocity.x)).toBe(true);
    expect(Number.isFinite(state.velocity.y)).toBe(true);
  });
});

describe("planErraticSpawn + ErraticMovement 統合", () => {
  it("seeded rng: 初期位置は world 内、roam は viewport 近辺、総寿命後は world 外(despawn)", () => {
    // 変化に富む決定論シーケンス（waypoint が中央に固まらないよう散らす）。
    const seq = [0.05, 0.9, 0.4, 0.6, 0.3, 0.5, 0.5, 0.5, 0.2, 0.7];
    const plan = planErraticSpawn(world, seqRng(seq), ERRATIC_SPAWN_DEFAULTS, SIZE);
    const state = createCritterState({
      typeId: "insect",
      position: { x: plan.enter.x, y: plan.enter.y },
      velocity: erraticEntryVelocity(plan),
      size: SIZE,
    });
    // 初期位置は world 内（即 despawn しない）。
    expect(hasExitedWorld(state.position, world)).toBe(false);

    const m = new ErraticMovement(plan);
    const total = erraticTotalSeconds(plan);
    const roamEndFrame = Math.floor((total - plan.exitSec) * 60);
    const pad = plan.jitterAmp + 1e-3;
    for (let i = 0; i < roamEndFrame; i++) {
      m.update(state, 1 / 60, ctx);
      const elapsed = (i + 1) / 60;
      if (elapsed >= plan.entrySec) {
        // roam 中は viewport 近辺（無限遠へ飛ばない）。
        expect(state.position.x).toBeGreaterThanOrEqual(-pad);
        expect(state.position.x).toBeLessThanOrEqual(viewport.width + pad);
        expect(state.position.y).toBeGreaterThanOrEqual(-pad);
        expect(state.position.y).toBeLessThanOrEqual(viewport.height + pad);
      }
      expect(Number.isFinite(state.velocity.x)).toBe(true);
      expect(Number.isFinite(state.velocity.y)).toBe(true);
    }
    // 総寿命後は world 外へ達する。
    for (let i = 0; i < Math.ceil(total * 60) + 120; i++) {
      m.update(state, 1 / 60, ctx);
    }
    expect(hasExitedWorld(state.position, world)).toBe(true);
  });
});

describe("planErraticSpawn exit は size に依らず全 edge で world 外(despawn 保証)", () => {
  // rng 消費順の先頭 9 個(enterEdge..jitterPhase)を 0.5 に固定し、10 個目(exitEdge)で退場辺を選ぶ。
  // size=0（既定/退化ケース）でも exit が world 境界上に留まらず strictly outside になることを保証する。
  const withExitEdge = (edgeSel: number, size: number) =>
    planErraticSpawn(
      world,
      seqRng([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, edgeSel]),
      ERRATIC_SPAWN_DEFAULTS,
      size,
    );

  const edges: ReadonlyArray<readonly [string, number]> = [
    ["left", 0.1],
    ["right", 0.3],
    ["top", 0.6],
    ["bottom", 0.9],
  ];

  for (const [name, sel] of edges) {
    it(`size=0 でも ${name} 辺の exit は world 外`, () => {
      expect(hasExitedWorld(withExitEdge(sel, 0).exit, world)).toBe(true);
    });
    it(`size=${SIZE} でも ${name} 辺の exit は world 外`, () => {
      expect(hasExitedWorld(withExitEdge(sel, SIZE).exit, world)).toBe(true);
    });
  }
});
