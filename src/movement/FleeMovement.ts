import type { CritterState } from "../critters/CritterState";
import type { Movement, MovementContext } from "./Movement";

/** ゼロ割ガード用の微小値。 */
const EPS = 1e-6;

/** 既定の逃走速度(px/秒)。タップに驚いて素早く画面外へ去る強さ。 */
export const FLEE_DEFAULT_SPEED = 900;

/** FleeMovement のパラメータ（方向は正規化前でよい）。 */
export interface FleeMovementOptions {
  /** 逃走方向の x 成分（正規化前でよい）。 */
  dirX: number;
  /** 逃走方向の y 成分（正規化前でよい）。 */
  dirY: number;
  /** 逃走速度(px/秒)。高速で world 外へ抜ける。 */
  speed: number;
}

/**
 * タップ/クリック等の刺激から高速直線で逃げる Movement（startle）。
 *
 * 生成時に与えた方向へ正規化した単位ベクトル×speed の一定速度で直進し、world 内へクランプしない
 * （＝画面外へ完全に抜けて既存の {@link hasExitedWorld} 判定で despawn される）。速度は毎フレーム
 * state.velocity へ反映するので facing（速度x符号）も rotate 系の heading（Critter 側が velocity から
 * 平滑更新）も速度から一貫して読める。純ロジック（PixiJS/DOM 非依存）。
 *
 * 方向がほぼ零ベクトル（タップ点が中心とほぼ一致）の場合は +x へフォールバックする。
 */
export class FleeMovement implements Movement {
  private readonly vx: number;
  private readonly vy: number;

  constructor(options: FleeMovementOptions) {
    const { dirX, dirY, speed } = options;
    const len = Math.hypot(dirX, dirY);
    // 零ベクトルは NaN を避けて +x へフォールバック（中心とタップ点がほぼ一致した時）。
    const ux = len > EPS ? dirX / len : 1;
    const uy = len > EPS ? dirY / len : 0;
    this.vx = ux * speed;
    this.vy = uy * speed;
  }

  update(state: CritterState, dtSeconds: number, _ctx: MovementContext): void {
    // 非正の dt では何もしない（tab 復帰直後などの 0/負値で NaN・暴走を出さない）。
    if (!(dtSeconds > 0)) {
      return;
    }
    // 一定速度で直進（クランプしない＝画面外へ抜ける）。
    state.velocity.x = this.vx;
    state.velocity.y = this.vy;
    state.position.x += this.vx * dtSeconds;
    state.position.y += this.vy * dtSeconds;
    // 進行方向で facing 更新（flip 系はこれで、rotate 系は Critter が velocity から heading を更新）。
    if (this.vx > EPS) {
      state.facing = 1;
    } else if (this.vx < -EPS) {
      state.facing = -1;
    }
  }
}
