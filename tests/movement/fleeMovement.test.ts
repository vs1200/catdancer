import { describe, expect, it } from "vitest";
import { createWorldBounds } from "../../src/core/worldBounds";
import { createCritterState } from "../../src/critters/CritterState";
import { hasExitedWorld } from "../../src/movement/CrossMovement";
import { FLEE_DEFAULT_SPEED, FleeMovement } from "../../src/movement/FleeMovement";
import type { MovementContext } from "../../src/movement/Movement";

const viewport = { width: 800, height: 600 };
const margin = 200; // minX/minY=-200, maxX=1000, maxY=800
const world = createWorldBounds(viewport, margin);
const ctx: MovementContext = { world, pointer: null };

function stateAt(x: number, y: number, vx = 0, vy = 0) {
  return createCritterState({
    typeId: "mouse",
    position: { x, y },
    velocity: { x: vx, y: vy },
    size: 220,
  });
}

describe("FleeMovement", () => {
  it("指定方向（正規化）へ一定速度で進む", () => {
    const state = stateAt(400, 300);
    // dir=(3,4)（長さ5）→ 単位(0.6,0.8)×speed。
    const speed = 500;
    const m = new FleeMovement({ dirX: 3, dirY: 4, speed });
    m.update(state, 1, ctx);
    expect(state.velocity.x).toBeCloseTo(0.6 * speed, 6);
    expect(state.velocity.y).toBeCloseTo(0.8 * speed, 6);
    // 位置も速度×dt ぶん進む。
    expect(state.position.x).toBeCloseTo(400 + 0.6 * speed, 6);
    expect(state.position.y).toBeCloseTo(300 + 0.8 * speed, 6);
    // facing は速度x符号（右向き）。
    expect(state.facing).toBe(1);
  });

  it("左向き方向では facing=-1", () => {
    const state = stateAt(400, 300);
    state.facing = 1;
    const m = new FleeMovement({ dirX: -1, dirY: 0, speed: 300 });
    m.update(state, 1 / 60, ctx);
    expect(state.velocity.x).toBeLessThan(0);
    expect(state.facing).toBe(-1);
  });

  it("画面中央からのタップ点逆方向へ、数フレームで world 外へ到達する", () => {
    // 画面中央の critter、タップ点は左上寄り → 右下へ逃げる想定（dir = 中心 - from）。
    const cx = 400;
    const cy = 300;
    const fromX = 300;
    const fromY = 200;
    const state = stateAt(cx, cy);
    const m = new FleeMovement({
      dirX: cx - fromX, // +100 → 右へ
      dirY: cy - fromY, // +100 → 下へ
      speed: FLEE_DEFAULT_SPEED,
    });
    // 初フレームは world 内。
    m.update(state, 1 / 60, ctx);
    expect(hasExitedWorld(state.position, world)).toBe(false);
    // 逃走方向はタップ点から離れる向き（右下）。
    expect(state.velocity.x).toBeGreaterThan(0);
    expect(state.velocity.y).toBeGreaterThan(0);
    // 数十フレームで world 外（右下端の外）へ抜ける（クランプしない）。
    let exited = false;
    for (let i = 0; i < 120; i++) {
      m.update(state, 1 / 60, ctx);
      if (hasExitedWorld(state.position, world)) {
        exited = true;
        break;
      }
    }
    expect(exited).toBe(true);
  });

  it("零ベクトル方向（中心とタップ点が一致）は +x へフォールバックする", () => {
    const state = stateAt(400, 300);
    const m = new FleeMovement({ dirX: 0, dirY: 0, speed: 400 });
    m.update(state, 1 / 60, ctx);
    expect(state.velocity.x).toBeCloseTo(400, 6);
    expect(state.velocity.y).toBeCloseTo(0, 6);
    expect(state.facing).toBe(1);
  });

  it("dt<=0 では状態を変えない（NaN・暴走ガード）", () => {
    const state = stateAt(100, 300, 5, 5);
    const m = new FleeMovement({ dirX: 1, dirY: 0, speed: 900 });
    m.update(state, 0, ctx);
    expect(state.position).toEqual({ x: 100, y: 300 });
    expect(state.velocity).toEqual({ x: 5, y: 5 });
    m.update(state, -1, ctx);
    expect(state.position).toEqual({ x: 100, y: 300 });
    expect(state.velocity).toEqual({ x: 5, y: 5 });
  });

  it("長時間でも velocity/position は有限", () => {
    const state = stateAt(0, 0);
    const m = new FleeMovement({ dirX: 2, dirY: -1, speed: 900 });
    for (let i = 0; i < 5000; i++) {
      m.update(state, 1 / 60, ctx);
    }
    expect(Number.isFinite(state.position.x)).toBe(true);
    expect(Number.isFinite(state.position.y)).toBe(true);
    expect(Number.isFinite(state.velocity.x)).toBe(true);
    expect(Number.isFinite(state.velocity.y)).toBe(true);
  });

  // dangle 系(foxtail/toys)の捕獲時、sway 傾き(state.rotation)を 0 へ戻して起き上がらせる修正。
  describe("rotation の 0 への減衰（dangle 系の起き上がり）", () => {
    it("正の初期回転(0.6rad)から単調に 0 へ近づき、十分な時間後に厳密に 0 になる", () => {
      const state = stateAt(400, 300);
      state.rotation = 0.6; // dangle 系の最大 sway 角相当。
      const m = new FleeMovement({ dirX: 1, dirY: 0, speed: FLEE_DEFAULT_SPEED });
      // 単調減少（各フレームで直前より小さく、かつ非負を維持）。
      let prev = state.rotation;
      for (let i = 0; i < 10; i++) {
        m.update(state, 1 / 60, ctx);
        expect(state.rotation).toBeGreaterThanOrEqual(0);
        expect(state.rotation).toBeLessThan(prev);
        prev = state.rotation;
      }
      // 約 0.2s で概ね起き上がる（残り傾きは十分小さい）。
      expect(Math.abs(state.rotation)).toBeLessThan(0.05);
      // 十分な時間後は EPS スナップで厳密に 0。
      for (let i = 0; i < 300; i++) {
        m.update(state, 1 / 60, ctx);
      }
      expect(state.rotation).toBe(0);
    });

    it("負の初期回転(-0.5rad)でも 0 へ収束する（符号非依存）", () => {
      const state = stateAt(400, 300);
      state.rotation = -0.5;
      const m = new FleeMovement({ dirX: 1, dirY: 0, speed: FLEE_DEFAULT_SPEED });
      let prev = state.rotation;
      for (let i = 0; i < 10; i++) {
        m.update(state, 1 / 60, ctx);
        // 0 へ向かって増加（負→0）し、0 を超えて正へ跳ねない。
        expect(state.rotation).toBeLessThanOrEqual(0);
        expect(state.rotation).toBeGreaterThan(prev);
        prev = state.rotation;
      }
      for (let i = 0; i < 300; i++) {
        m.update(state, 1 / 60, ctx);
      }
      expect(state.rotation).toBe(0);
    });

    it("rotation=0 の critter は update しても 0 のまま（rotate/flip 系の no-op 担保）", () => {
      const state = stateAt(400, 300);
      expect(state.rotation).toBe(0); // 既定 0。
      const m = new FleeMovement({ dirX: 1, dirY: 0, speed: FLEE_DEFAULT_SPEED });
      for (let i = 0; i < 30; i++) {
        m.update(state, 1 / 60, ctx);
        expect(state.rotation).toBe(0);
      }
    });

    it("dt<=0 では rotation を触らない（NaN・暴走ガードと一貫）", () => {
      const state = stateAt(400, 300);
      state.rotation = 0.4;
      const m = new FleeMovement({ dirX: 1, dirY: 0, speed: FLEE_DEFAULT_SPEED });
      m.update(state, 0, ctx);
      expect(state.rotation).toBe(0.4);
      m.update(state, -1, ctx);
      expect(state.rotation).toBe(0.4);
    });
  });
});
