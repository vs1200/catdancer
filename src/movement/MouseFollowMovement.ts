import type { Vec2 } from "../core/vec2";
import type { WorldBounds } from "../core/worldBounds";
import { clampToWorld } from "../core/worldBounds";
import type { CritterState } from "../critters/CritterState";
import { updateFacingFromVelocity } from "../critters/CritterState";
import type { Movement, MovementContext } from "./Movement";

/** MouseFollowMovement の調整パラメータ（すべて px / 秒 系）。 */
export interface MouseFollowOptions {
  /** 目標へ向かう加速度(px/秒^2)。大きいほど機敏に追う。 */
  accel?: number;
  /** 最高速度(px/秒)。慣性で行き過ぎても速度はここで頭打ち。 */
  maxSpeed?: number;
  /** 減衰率(1/秒)。速度は毎秒 exp(-damping) 倍に。大きいほど早く止まる。 */
  damping?: number;
  /** 到達半径(px)。この距離内では加速を距離比で弱め、静止目標での無限振動を防ぐ。 */
  arriveRadius?: number;
  /** 画面端からこの距離(px)以内 or 画面外のポインタは、その辺の world 端(margin側)を目標にする。 */
  edgeThreshold?: number;
}

/** 既定パラメータ。ネズミが「少し遅れて追い、行き過ぎて戻る」じゃれる挙動になる値。 */
export const MOUSE_FOLLOW_DEFAULTS = {
  accel: 2200,
  maxSpeed: 640,
  damping: 2.6,
  arriveRadius: 100,
  edgeThreshold: 40,
} as const satisfies Required<MouseFollowOptions>;

/** ゼロ割・微小値ガード用。 */
const EPS = 1e-6;
/** これ未満の |velocity.x| では facing を更新しない（静止付近のちらつき防止）。 */
const FACING_MIN_SPEED = 5;

/**
 * ポインタが null（ウィンドウ外へ逃げた）ときの「画面外へ走り去る」目標を求める純関数。
 * 進行方向（velocity）へ world 対角ぶん延長し、world 内へクランプ＝進行方向の world 端。
 * 速度がほぼ 0 のときは画面中心→現在位置の向き（＝近い辺）へ、それも 0 なら右へ逃がす。
 */
export function computeEscapeTarget(position: Vec2, velocity: Vec2, world: WorldBounds): Vec2 {
  const speed = Math.hypot(velocity.x, velocity.y);
  let dx: number;
  let dy: number;
  if (speed > EPS) {
    dx = velocity.x / speed;
    dy = velocity.y / speed;
  } else {
    const cx = world.viewport.width / 2;
    const cy = world.viewport.height / 2;
    const rx = position.x - cx;
    const ry = position.y - cy;
    const rlen = Math.hypot(rx, ry);
    if (rlen > EPS) {
      dx = rx / rlen;
      dy = ry / rlen;
    } else {
      dx = 1;
      dy = 0;
    }
  }
  // world 対角以上を進めた点をクランプすれば、進行方向の world 端（画面外）に落ちる。
  const reach = Math.hypot(world.maxX - world.minX, world.maxY - world.minY);
  return clampToWorld(world, { x: position.x + dx * reach, y: position.y + dy * reach });
}

/**
 * 追従目標を求める純関数（PixiJS/DOM 非依存 = 単体テスト可能）。
 * - pointer===null（ウィンドウ外へ逃げた）→ {@link computeEscapeTarget}（画面外へ走り去る）。
 * - pointer が画面内 → その位置を目標（カーソル追従）。
 * - pointer が画面端に近い/画面外 → その軸の world 端(margin側)へ延長し、ネズミが画面外へ抜ける。
 */
export function computeFollowTarget(
  pointer: Vec2 | null,
  position: Vec2,
  velocity: Vec2,
  world: WorldBounds,
  edgeThreshold: number,
): Vec2 {
  if (pointer === null) {
    return computeEscapeTarget(position, velocity, world);
  }
  const { width, height } = world.viewport;
  let x = pointer.x;
  let y = pointer.y;
  // 左右: 端に近い/外なら margin 側へ延長。
  if (pointer.x <= edgeThreshold) {
    x = world.minX;
  } else if (pointer.x >= width - edgeThreshold) {
    x = world.maxX;
  }
  // 上下: 同様。
  if (pointer.y <= edgeThreshold) {
    y = world.minY;
  } else if (pointer.y >= height - edgeThreshold) {
    y = world.maxY;
  }
  return { x, y };
}

/**
 * v1 の中核: ポインタ(world 座標)へ慣性追従する Movement。
 *
 * 物理は「目標方向へ加速(accel) → 減衰(damping) → 最高速(maxSpeed)で頭打ち → 位置積分」。
 * 到達半径内では加速を弱めるため静止目標でも無限振動せず自然に収束する。慣性ゆえに
 * 目標へ少し遅れて追い、行き過ぎて戻る「じゃれる」挙動が出る。
 *
 * 画面外バッファ(design 3.3): ポインタが画面端/外/null のとき目標を world 端へ延長し、
 * ネズミが画面外へ完全に隠れる。ポインタが戻れば再び画面内へ加速して再出現する。
 * 位置は world 内へクランプし（跳ね返らない）、壁に当たった軸の外向き速度は 0 にして暴走を防ぐ。
 */
export class MouseFollowMovement implements Movement {
  private readonly accel: number;
  private readonly maxSpeed: number;
  private readonly damping: number;
  private readonly arriveRadius: number;
  private readonly edgeThreshold: number;

  constructor(options?: MouseFollowOptions) {
    this.accel = options?.accel ?? MOUSE_FOLLOW_DEFAULTS.accel;
    this.maxSpeed = options?.maxSpeed ?? MOUSE_FOLLOW_DEFAULTS.maxSpeed;
    this.damping = options?.damping ?? MOUSE_FOLLOW_DEFAULTS.damping;
    this.arriveRadius = options?.arriveRadius ?? MOUSE_FOLLOW_DEFAULTS.arriveRadius;
    this.edgeThreshold = options?.edgeThreshold ?? MOUSE_FOLLOW_DEFAULTS.edgeThreshold;
  }

  update(state: CritterState, dtSeconds: number, ctx: MovementContext): void {
    // 非正の dt では何もしない（tab 復帰直後などの 0/負値で NaN・暴走を出さない）。
    if (!(dtSeconds > 0)) {
      return;
    }
    const { world } = ctx;
    const target = computeFollowTarget(
      ctx.pointer,
      state.position,
      state.velocity,
      world,
      this.edgeThreshold,
    );

    // 1) 目標方向へ加速（到達半径内では距離比で弱め、収束させる）。
    const tx = target.x - state.position.x;
    const ty = target.y - state.position.y;
    const dist = Math.hypot(tx, ty);
    if (dist > EPS) {
      const inv = 1 / dist;
      const scale = dist < this.arriveRadius ? dist / this.arriveRadius : 1;
      const a = this.accel * scale * dtSeconds;
      state.velocity.x += tx * inv * a;
      state.velocity.y += ty * inv * a;
    }

    // 2) 減衰（フレームレート非依存の指数摩擦）。
    const k = Math.exp(-this.damping * dtSeconds);
    state.velocity.x *= k;
    state.velocity.y *= k;

    // 3) 最高速で頭打ち。
    const speed = Math.hypot(state.velocity.x, state.velocity.y);
    if (speed > this.maxSpeed) {
      const s = this.maxSpeed / speed;
      state.velocity.x *= s;
      state.velocity.y *= s;
    }

    // 4) 位置を積分。
    state.position.x += state.velocity.x * dtSeconds;
    state.position.y += state.velocity.y * dtSeconds;

    // 5) world 内へクランプ（跳ね返らない）。壁に当たった軸の外向き速度は 0 に。
    if (state.position.x < world.minX) {
      state.position.x = world.minX;
      if (state.velocity.x < 0) state.velocity.x = 0;
    } else if (state.position.x > world.maxX) {
      state.position.x = world.maxX;
      if (state.velocity.x > 0) state.velocity.x = 0;
    }
    if (state.position.y < world.minY) {
      state.position.y = world.minY;
      if (state.velocity.y < 0) state.velocity.y = 0;
    } else if (state.position.y > world.maxY) {
      state.position.y = world.maxY;
      if (state.velocity.y > 0) state.velocity.y = 0;
    }

    // 6) 進行方向で facing 更新（静止付近のちらつきは閾値で抑制）。
    if (Math.abs(state.velocity.x) > FACING_MIN_SPEED) {
      updateFacingFromVelocity(state);
    }
  }
}
