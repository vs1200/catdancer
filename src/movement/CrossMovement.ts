import type { Vec2 } from "../core/vec2";
import type { WorldBounds } from "../core/worldBounds";
import { isOutsideWorld } from "../core/worldBounds";
import type { CritterState, Facing } from "../critters/CritterState";
import type { Movement, MovementContext } from "./Movement";

/** ゼロ割ガード用の微小値。 */
const EPS = 1e-6;

/** CrossMovement のパラメータ。すべて px / 秒 / rad 系。 */
export interface CrossMovementOptions {
  /** 主進行速度の x 成分(px/秒)。符号が横断方向（+ で右、- で左）。 */
  vx: number;
  /** 主進行速度の y 成分(px/秒)。ゆるやかな上下ドリフト。 */
  vy: number;
  /** 進行方向に垂直な揺れ振幅(px)。0 で直線。 */
  wobbleAmp?: number;
  /** 揺れの角速度(rad/秒)。 */
  wobbleFreq?: number;
  /** 揺れの位相オフセット(rad)。個体ごとにずらす用途。 */
  phase?: number;
}

/**
 * 画面外の一辺から出現し、主進行方向(vx,vy)へ一定速度で横切って反対側/斜めの画面外へ抜ける Movement。
 *
 * MouseFollow と異なり world 内へクランプしない（＝画面外へ完全に抜けさせて despawn 判定に委ねる）。
 * 直線移動に、進行方向へ垂直な sin 揺れを重ねて経路にゆらぎを与える（生き生きした動き）。
 * 揺れ速度は振幅 sin の時間微分（amp*freq*cos）で与え、位置ではなく速度に足すので
 * 尻尾 intensity・SE・facing が速度から一貫して読める。純ロジック（PixiJS/DOM 非依存）。
 */
export class CrossMovement implements Movement {
  private readonly vx: number;
  private readonly vy: number;
  private readonly wobbleAmp: number;
  private readonly wobbleFreq: number;
  private readonly phase: number;
  /** 進行方向に垂直な単位ベクトル（揺れの向き）。 */
  private readonly perpX: number;
  private readonly perpY: number;
  private elapsedSeconds = 0;

  constructor(options: CrossMovementOptions) {
    this.vx = options.vx;
    this.vy = options.vy;
    this.wobbleAmp = options.wobbleAmp ?? 0;
    this.wobbleFreq = options.wobbleFreq ?? 0;
    this.phase = options.phase ?? 0;
    // 進行方向 (vx,vy) の左手側を揺れ方向にする。速度がほぼ 0 なら y 方向へ。
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > EPS) {
      this.perpX = -this.vy / speed;
      this.perpY = this.vx / speed;
    } else {
      this.perpX = 0;
      this.perpY = 1;
    }
  }

  update(state: CritterState, dtSeconds: number, _ctx: MovementContext): void {
    // 非正の dt では何もしない（tab 復帰直後などの 0/負値で NaN・暴走を出さない）。
    if (!(dtSeconds > 0)) {
      return;
    }
    this.elapsedSeconds += dtSeconds;
    // 揺れ速度 = d/dt [amp*sin(freq*t+phase)] = amp*freq*cos(...)。振幅 0 なら 0。
    const wobbleVel =
      this.wobbleAmp *
      this.wobbleFreq *
      Math.cos(this.wobbleFreq * this.elapsedSeconds + this.phase);
    state.velocity.x = this.vx + this.perpX * wobbleVel;
    state.velocity.y = this.vy + this.perpY * wobbleVel;
    // 位置積分（クランプしない＝画面外へ抜ける）。
    state.position.x += state.velocity.x * dtSeconds;
    state.position.y += state.velocity.y * dtSeconds;
    // 進行方向で facing 更新（横断は水平主体なので符号は安定）。
    if (state.velocity.x > EPS) {
      state.facing = 1;
    } else if (state.velocity.x < -EPS) {
      state.facing = -1;
    }
  }
}

/** 横断 spawn の計画（純データ）。AutoMode が Critter / CrossMovement 生成に用いる。 */
export interface CrossSpawnPlan {
  /** 出現位置（world 座標。画面外バッファの一辺）。 */
  position: Vec2;
  /** 初速（= 主進行速度）。 */
  velocity: Vec2;
  /** 初期向き。 */
  facing: Facing;
  /** 揺れ振幅(px)。 */
  wobbleAmp: number;
  /** 揺れ角速度(rad/秒)。 */
  wobbleFreq: number;
  /** 揺れ位相(rad)。 */
  phase: number;
}

/** 横断 spawn の生成レンジ。既定値でネズミが自然に横切る。 */
export interface CrossSpawnRange {
  speedMin: number;
  speedMax: number;
  /** 上下ドリフトの最大比率（vy = ±driftFactor*speed の範囲）。 */
  driftFactor: number;
  /** 出現 y の viewport 高さに対する下限/上限比率。 */
  entryYMinFrac: number;
  entryYMaxFrac: number;
  wobbleAmpMin: number;
  wobbleAmpMax: number;
  wobbleFreqMin: number;
  wobbleFreqMax: number;
}

export const CROSS_SPAWN_DEFAULTS: CrossSpawnRange = {
  speedMin: 150,
  speedMax: 340,
  driftFactor: 0.35,
  entryYMinFrac: 0.12,
  entryYMaxFrac: 0.88,
  wobbleAmpMin: 6,
  wobbleAmpMax: 20,
  wobbleFreqMin: 2.5,
  wobbleFreqMax: 5.5,
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 横断 spawn を計画する純関数。rng は [0,1) を返す関数（テストで決定化できる）。
 *
 * - 左右いずれかの world 端(minX/maxX, ＝完全に画面外)から出現。
 * - 反対側へ向かう水平速度＋ゆるやかな上下ドリフトで斜めにも横切る。
 * - 出現 y は viewport の可視域内寄りに散らす。揺れ振幅/周期/位相もばらつかせる。
 * 出現位置は必ず world 内（minX/maxX は inclusive）なので、初フレームで即 despawn しない。
 */
export function planCrossSpawn(
  world: WorldBounds,
  rng: () => number,
  range: CrossSpawnRange = CROSS_SPAWN_DEFAULTS,
): CrossSpawnPlan {
  const fromLeft = rng() < 0.5;
  const speed = lerp(range.speedMin, range.speedMax, rng());
  const vx = fromLeft ? speed : -speed;
  const vy = (rng() * 2 - 1) * range.driftFactor * speed;
  const h = world.viewport.height;
  const y = lerp(h * range.entryYMinFrac, h * range.entryYMaxFrac, rng());
  const x = fromLeft ? world.minX : world.maxX;
  const facing: Facing = vx >= 0 ? 1 : -1;
  const wobbleAmp = lerp(range.wobbleAmpMin, range.wobbleAmpMax, rng());
  const wobbleFreq = lerp(range.wobbleFreqMin, range.wobbleFreqMax, rng());
  const phase = rng() * Math.PI * 2;
  return { position: { x, y }, velocity: { x: vx, y: vy }, facing, wobbleAmp, wobbleFreq, phase };
}

/**
 * critter が world 外（＝完全に画面外）へ抜けたかの despawn 述語（純関数）。
 * core/worldBounds の {@link isOutsideWorld} に委譲する薄い意味付けラッパ。
 */
export function hasExitedWorld(position: Vec2, world: WorldBounds): boolean {
  return isOutsideWorld(world, position);
}
