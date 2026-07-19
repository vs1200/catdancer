import type { Vec2 } from "../core/vec2";
import type { WorldBounds } from "../core/worldBounds";
import type { CritterState, Facing } from "../critters/CritterState";
import type { Movement, MovementContext } from "./Movement";

/** ゼロ割ガード用の微小値。 */
const EPS = 1e-6;

/** 出現/退場の辺。 */
export type DangleEdge = "left" | "right" | "top" | "bottom";

/**
 * じゃらす動きの計画（純データ）。1 個体の「進入→視界内で大きく sway→縁へ退場」の全経路を規定する。
 * 位置・角度はこの計画から時間の純関数で決まるため Vitest で検証できる（PixiJS/DOM 非依存）。
 */
export interface DanglePlan {
  edge: DangleEdge;
  /** 進入開始位置（world 端＝完全に画面外。inclusive なので初フレームで即 despawn しない）。 */
  enter: Vec2;
  /** 視界内で揺れる定位置（＝振り子の支点となる基準位置）。 */
  hold: Vec2;
  /** 退場先（world 外へ確実に抜ける点。despawn 判定に委ねる）。 */
  exit: Vec2;
  /** 進入にかける秒数。 */
  entrySec: number;
  /** 視界内で揺れる秒数。 */
  holdSec: number;
  /** 退場にかける秒数。 */
  exitSec: number;
  /** 揺れ角の振幅(rad)。 */
  swayAmp: number;
  /** 揺れ角の角速度(rad/秒)。 */
  swayFreq: number;
  /** 揺れ角の位相(rad)。 */
  swayPhase: number;
  /** 位置バウンスの振幅(px)。0 で回転 sway のみ。 */
  bobAmp: number;
  /** 位置バウンスの角速度(rad/秒)。 */
  bobFreq: number;
  /** 位置バウンスの位相(rad)。 */
  bobPhase: number;
  /** 表示向き（dangle 系は反転しないため defaultFacing のまま固定）。 */
  facing: Facing;
}

/** 計画の総寿命(秒)。この時刻で位置は exit（world 外）に達する。 */
export function dangleTotalSeconds(plan: DanglePlan): number {
  return plan.entrySec + plan.holdSec + plan.exitSec;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** smoothstep（端で速度0）。進入/退場の加減速を滑らかにする。 */
function ease(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 揺れ角の包絡(0..1)。進入中に 0→1、hold 中は 1、退場中に 1→0 とし、端で角を 0 にして
 * 出入りで角度がカクつかないようにする（|angle| は常に swayAmp 以下＝範囲内を保証）。
 */
function angleEnvelope(plan: DanglePlan, t: number): number {
  const total = dangleTotalSeconds(plan);
  if (t <= 0 || t >= total) {
    return 0;
  }
  if (t < plan.entrySec) {
    return ease(t / Math.max(plan.entrySec, EPS));
  }
  const holdEnd = plan.entrySec + plan.holdSec;
  if (t < holdEnd) {
    return 1;
  }
  return ease((total - t) / Math.max(plan.exitSec, EPS));
}

/**
 * 経過時刻 t(秒) における角度(rad)を返す純関数。
 * 包絡×swayAmp×sin(...) なので |angle| <= swayAmp（範囲内）・時間で振動・NaN 無し。
 */
export function dangleAngleAt(plan: DanglePlan, t: number): number {
  const env = angleEnvelope(plan, t);
  if (env <= 0) {
    return 0;
  }
  return env * plan.swayAmp * Math.sin(plan.swayFreq * t + plan.swayPhase);
}

/**
 * 経過時刻 t(秒) における基準位置(＝支点)を返す純関数。
 * - 進入 [0,entry]: enter→hold を smoothstep 補間。
 * - hold [entry,entry+hold]: hold の周りを bob（窓関数で両端 0＝進入/退場と連続）。
 * - 退場 [.., total]: hold→exit を smoothstep 補間（exit は world 外）。
 * - total 以降: exit（world 外）に留まる＝寿命後は確実に despawn 対象。
 */
export function danglePositionAt(plan: DanglePlan, t: number): Vec2 {
  const total = dangleTotalSeconds(plan);
  if (t <= 0) {
    return { x: plan.enter.x, y: plan.enter.y };
  }
  if (t >= total) {
    return { x: plan.exit.x, y: plan.exit.y };
  }
  if (t < plan.entrySec) {
    const k = ease(t / Math.max(plan.entrySec, EPS));
    return { x: lerp(plan.enter.x, plan.hold.x, k), y: lerp(plan.enter.y, plan.hold.y, k) };
  }
  const holdEnd = plan.entrySec + plan.holdSec;
  if (t < holdEnd) {
    const th = t - plan.entrySec;
    // 両端 0 の窓（sin 半周期）で hold への出入りと位置を連続にする。
    const window = Math.sin((Math.PI * th) / Math.max(plan.holdSec, EPS));
    const bx = plan.bobAmp * 0.4 * window * Math.sin(plan.bobFreq * th + plan.bobPhase);
    const by = plan.bobAmp * window * Math.sin(plan.bobFreq * th * 1.3 + plan.bobPhase);
    return { x: plan.hold.x + bx, y: plan.hold.y + by };
  }
  const k = ease((t - holdEnd) / Math.max(plan.exitSec, EPS));
  return { x: lerp(plan.hold.x, plan.exit.x, k), y: lerp(plan.hold.y, plan.exit.y, k) };
}

/**
 * じゃらす動き（猫じゃらし/おもちゃ）。DanglePlan に沿って画面外の一辺から視界内へ入り、
 * 支点(pivot)周りに大きく回転 sway（＋位置バウンド）で猫を誘い、やがて縁へ引っ込む。
 *
 * 位置・角度は {@link danglePositionAt} / {@link dangleAngleAt}（純関数）から毎フレーム求める。
 * velocity は位置差分から与えるので SE の速度連動・despawn 判定が一貫して読める。
 * facing は計画値で固定（dangle 系は水平反転しない）。PixiJS 非依存。
 */
export class DangleMovement implements Movement {
  private readonly plan: DanglePlan;
  private elapsedSeconds = 0;

  constructor(plan: DanglePlan) {
    this.plan = plan;
  }

  update(state: CritterState, dtSeconds: number, _ctx: MovementContext): void {
    // 非正の dt では何もしない（tab 復帰直後などの 0/負値で NaN・暴走を出さない）。
    if (!(dtSeconds > 0)) {
      return;
    }
    this.elapsedSeconds += dtSeconds;
    const next = danglePositionAt(this.plan, this.elapsedSeconds);
    state.velocity.x = (next.x - state.position.x) / dtSeconds;
    state.velocity.y = (next.y - state.position.y) / dtSeconds;
    state.position.x = next.x;
    state.position.y = next.y;
    state.rotation = dangleAngleAt(this.plan, this.elapsedSeconds);
    state.facing = this.plan.facing;
  }

  hasExpired(): boolean {
    return this.elapsedSeconds >= dangleTotalSeconds(this.plan);
  }
}

/** DanglePlan を rng から生成するためのレンジ（種別ごとに CritterType が持つ）。 */
export interface DangleSpawnRange {
  entrySecMin: number;
  entrySecMax: number;
  holdSecMin: number;
  holdSecMax: number;
  exitSecMin: number;
  exitSecMax: number;
  /** 揺れ角振幅(rad)。 */
  swayAmpMin: number;
  swayAmpMax: number;
  /** 揺れ角速度(rad/秒)。 */
  swayFreqMin: number;
  swayFreqMax: number;
  /** 位置バウンス振幅(px)。 */
  bobAmpMin: number;
  bobAmpMax: number;
  /** 位置バウンス角速度(rad/秒)。 */
  bobFreqMin: number;
  bobFreqMax: number;
  /** hold 位置を viewport 端から内側へ寄せる比率(0..0.5)。端に寄りすぎないようにする。 */
  holdInsetFrac: number;
}

/** 汎用の既定レンジ（大きめに揺れる猫じゃらし寄り）。種別で上書きする。 */
export const DANGLE_SPAWN_DEFAULTS: DangleSpawnRange = {
  entrySecMin: 0.7,
  entrySecMax: 1.2,
  holdSecMin: 2.5,
  holdSecMax: 4.5,
  exitSecMin: 0.7,
  exitSecMax: 1.2,
  swayAmpMin: 0.35,
  swayAmpMax: 0.6,
  swayFreqMin: 4.0,
  swayFreqMax: 6.5,
  bobAmpMin: 20,
  bobAmpMax: 45,
  bobFreqMin: 3.0,
  bobFreqMax: 5.0,
  holdInsetFrac: 0.22,
};

/**
 * じゃらす spawn を計画する純関数。rng は [0,1) を返す関数（テストで決定化できる）。
 * rng 消費順: edge, hold.x, hold.y, entrySec, holdSec, exitSec, swayAmp, swayFreq,
 *            bobAmp, bobFreq, swayPhase, bobPhase の計 12 回。
 *
 * - 上下左右いずれかの world 端(＝完全に画面外)から進入し、視界内の hold で揺れ、同じ辺の
 *   world 外(exit)へ退場する。exit は world 端の外側へ size ぶん押し出すので確実に despawn される。
 * - enter は進入辺で hold と同軸に置き、まっすぐ視界へ入る。
 */
export function planDangleSpawn(
  world: WorldBounds,
  rng: () => number,
  range: DangleSpawnRange = DANGLE_SPAWN_DEFAULTS,
  size = 0,
): DanglePlan {
  const { width, height } = world.viewport;
  const edgeSel = rng();
  const edge: DangleEdge =
    edgeSel < 0.25 ? "left" : edgeSel < 0.5 ? "right" : edgeSel < 0.75 ? "top" : "bottom";

  const inset = range.holdInsetFrac;
  const holdX = lerp(width * inset, width * (1 - inset), rng());
  const holdY = lerp(height * inset, height * (1 - inset), rng());
  const hold: Vec2 = { x: holdX, y: holdY };

  // enter は進入辺、exit は同じ辺の world 外へ押し出す（size ぶん確実に外側）。
  let enter: Vec2;
  let exit: Vec2;
  switch (edge) {
    case "left":
      enter = { x: world.minX, y: holdY };
      exit = { x: world.minX - size, y: holdY };
      break;
    case "right":
      enter = { x: world.maxX, y: holdY };
      exit = { x: world.maxX + size, y: holdY };
      break;
    case "top":
      enter = { x: holdX, y: world.minY };
      exit = { x: holdX, y: world.minY - size };
      break;
    default:
      enter = { x: holdX, y: world.maxY };
      exit = { x: holdX, y: world.maxY + size };
      break;
  }

  const entrySec = lerp(range.entrySecMin, range.entrySecMax, rng());
  const holdSec = lerp(range.holdSecMin, range.holdSecMax, rng());
  const exitSec = lerp(range.exitSecMin, range.exitSecMax, rng());
  const swayAmp = lerp(range.swayAmpMin, range.swayAmpMax, rng());
  const swayFreq = lerp(range.swayFreqMin, range.swayFreqMax, rng());
  const bobAmp = lerp(range.bobAmpMin, range.bobAmpMax, rng());
  const bobFreq = lerp(range.bobFreqMin, range.bobFreqMax, rng());
  const swayPhase = rng() * Math.PI * 2;
  const bobPhase = rng() * Math.PI * 2;

  return {
    edge,
    enter,
    hold,
    exit,
    entrySec,
    holdSec,
    exitSec,
    swayAmp,
    swayFreq,
    swayPhase,
    bobAmp,
    bobFreq,
    bobPhase,
    facing: 1,
  };
}
