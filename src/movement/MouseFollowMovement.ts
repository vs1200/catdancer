import type { Vec2 } from "../core/vec2";
import type { WorldBounds } from "../core/worldBounds";
import { clampToWorld } from "../core/worldBounds";
import type { CritterState } from "../critters/CritterState";
import { updateFacingFromVelocity } from "../critters/CritterState";
import type { Movement, MovementContext } from "./Movement";

/** MouseFollowMovement の調整パラメータ。 */
export interface MouseFollowOptions {
  /**
   * 追従の時定数(秒)。目標へ寄り切るまでの概ねの所要時間。小さいほど俊敏に追う。
   * 臨界減衰スムージング(SmoothDamp)の smoothTime に対応（≒ τ）。
   */
  smoothTime?: number;
  /** 最高速度(px/秒)。巨大な瞬間移動でも速度はここで頭打ち。 */
  maxSpeed?: number;
  /** 画面端からこの距離(px)以内 or 画面外のポインタは、その辺の world 端(margin側)を目標にする。 */
  edgeThreshold?: number;
}

/**
 * 既定パラメータ。臨界減衰(ζ=1)で俊敏かつオーバーシュートせずに寄せる値。
 *
 * [UR-8] マウス操作の追従が全体的にもたつくとの要望を受け、基準の追従速度を引き上げた。
 * 旧値(smoothTime=0.09, maxSpeed=3600)を speedScale「とてもはやい」(1.8) で走らせたときの
 * 俊敏さ・速度上限を、speedScale「標準」(1.0) で再現するよう両値を 1.8 倍相当で再調整した:
 *   - smoothTime 0.09→0.05 (=0.09/1.8): 追従ラグ(時定数)を短縮。600px ジャンプの 90% 到達が
 *     約 0.23s→約 0.13s（＝旧とてもはやい相当）。small ほど俊敏。
 *   - maxSpeed 3600→6480 (=3600×1.8): 実効の追従速度上限(=maxSpeed×speedScale)も旧とてもはやい
 *     相当へ引き上げ。速い振り(flick)が上限で clip して遅く感じる退行を防ぐ。
 *     maxChange=maxSpeed×smoothTime=324 は旧値と不変なので瞬間ワープ抑制の効きは維持する。
 * speedScale の各段(ゆっくり0.6/標準1.0/はやい1.4/とてもはやい1.8)は引き続き相対的に機能する。
 * 本定数は MouseFollowMovement(=マウス操作モード専用)のみに効き、auto(動画)モードには波及しない。
 */
export const MOUSE_FOLLOW_DEFAULTS = {
  smoothTime: 0.05,
  maxSpeed: 6480,
  edgeThreshold: 40,
} as const satisfies Required<MouseFollowOptions>;

/** ゼロ割・微小値ガード用。 */
const EPS = 1e-6;
/** これ未満の |velocity.x| では facing を更新しない（静止付近のちらつき防止）。 */
const FACING_MIN_SPEED = 5;

/**
 * 臨界減衰スムージング(Unity `SmoothDamp` 型)を 2D に適用する純関数(in-place)。
 *
 * position を target へ時定数 `smoothTime` で寄せ、velocity を更新する。臨界減衰(ζ=1)なので
 * オーバーシュート・振動なしに素早く収束する。指数 e^{-x} を有理式で近似するため、極端な dt でも
 * 発散しない（無条件安定）。change ベクトルの大きさを `maxSpeed*smoothTime` で頭打ちして最高速を保証する。
 *
 * 旧モデル(加速度＋指数摩擦, ζ≈0.28 の underdamped)は「行き過ぎて戻る」もたつきが出ていた。
 * 本式は初速から一気に寄せて滑らかに止まる＝「素早く追従して離されない」体感になる。
 */
export function smoothDampToward(
  position: Vec2,
  velocity: Vec2,
  target: Vec2,
  smoothTime: number,
  maxSpeed: number,
  dt: number,
): void {
  const t = Math.max(1e-4, smoothTime);
  const omega = 2 / t;
  const x = omega * dt;
  // e^{-x} の Nordahl 有理式近似（x が大きくても正の小値に収束＝安定）。
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

  // change = 目標からの変位。大きさを maxSpeed*smoothTime で頭打ちし、実効目標を近づける。
  let cx = position.x - target.x;
  let cy = position.y - target.y;
  const maxChange = maxSpeed * t;
  const mag = Math.hypot(cx, cy);
  if (mag > maxChange && mag > EPS) {
    const s = maxChange / mag;
    cx *= s;
    cy *= s;
  }
  const effTargetX = position.x - cx;
  const effTargetY = position.y - cy;

  // 臨界減衰の閉形式（各軸独立）。position/velocity を同時に更新する。
  const tempX = (velocity.x + omega * cx) * dt;
  const tempY = (velocity.y + omega * cy) * dt;
  velocity.x = (velocity.x - omega * tempX) * exp;
  velocity.y = (velocity.y - omega * tempY) * exp;
  let outX = effTargetX + (cx + tempX) * exp;
  let outY = effTargetY + (cy + tempY) * exp;

  // オーバーシュート抑制: 元の目標を越えたら目標にスナップして速度を 0 に（振動を出さない）。
  const wasBeforeTargetX = target.x - position.x > 0;
  if (wasBeforeTargetX === outX > target.x) {
    outX = target.x;
    velocity.x = 0;
  }
  const wasBeforeTargetY = target.y - position.y > 0;
  if (wasBeforeTargetY === outY > target.y) {
    outY = target.y;
    velocity.y = 0;
  }
  position.x = outX;
  position.y = outY;
}

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
 * v1 の中核: ポインタ(world 座標)へ俊敏に追従する Movement。
 *
 * 追従モデルは臨界減衰スムージング(SmoothDamp, {@link smoothDampToward})。旧モデルの
 * 「加速＋指数摩擦(ζ≈0.28)」は行き過ぎて戻るもたつきが出ていたため、ζ=1 の閉形式へ刷新した。
 * 目標へ初速から一気に寄り、オーバーシュートせず滑らかに止まる＝「速いカーソルにも離されない」体感。
 * 生き物感は velocity 連続性（慣性）と短い時定数のわずかな遅れで担保する。
 *
 * 画面外バッファ(design 3.3): ポインタが画面端/外/null のとき目標を world 端へ延長し、
 * ネズミが画面外へ完全に隠れる。ポインタが戻れば再び画面内へ寄って再出現する。
 * 位置は world 内へクランプし（跳ね返らない）、壁に当たった軸の外向き速度は 0 にして暴走を防ぐ。
 */
export class MouseFollowMovement implements Movement {
  private readonly smoothTime: number;
  private readonly maxSpeed: number;
  private readonly edgeThreshold: number;

  constructor(options?: MouseFollowOptions) {
    this.smoothTime = options?.smoothTime ?? MOUSE_FOLLOW_DEFAULTS.smoothTime;
    this.maxSpeed = options?.maxSpeed ?? MOUSE_FOLLOW_DEFAULTS.maxSpeed;
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

    // 1) 臨界減衰スムージングで position/velocity を目標へ俊敏に寄せる（無条件安定）。
    smoothDampToward(
      state.position,
      state.velocity,
      target,
      this.smoothTime,
      this.maxSpeed,
      dtSeconds,
    );

    // 2) 最高速で厳密に頭打ち（保険。SmoothDamp の change 頭打ちに加え暴走を防ぐ）。
    const speed = Math.hypot(state.velocity.x, state.velocity.y);
    if (speed > this.maxSpeed) {
      const s = this.maxSpeed / speed;
      state.velocity.x *= s;
      state.velocity.y *= s;
    }

    // 3) world 内へクランプ（跳ね返らない）。壁に当たった軸の外向き速度は 0 に。
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

    // 4) 進行方向で facing 更新（静止付近のちらつきは閾値で抑制）。
    if (Math.abs(state.velocity.x) > FACING_MIN_SPEED) {
      updateFacingFromVelocity(state);
    }
  }
}
