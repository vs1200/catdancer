import type { Vec2 } from "../core/vec2";
import type { WorldBounds } from "../core/worldBounds";
import type { CritterState, Facing } from "../critters/CritterState";
import type { Movement, MovementContext } from "./Movement";

/** ゼロ割ガード用の微小値。 */
const EPS = 1e-6;

/**
 * exit を world 端から押し出す最小クリアランス(px)。size=0 でも exit が world 境界上
 * (isInsideWorld は inclusive) に留まらず必ず strictly outside になるようにし、despawn を保証する。
 */
const MIN_EXIT_CLEARANCE = 1;

/** 出現/退場の辺。 */
export type ErraticEdge = "left" | "right" | "top" | "bottom";

/**
 * 虫らしい「不規則ダッシュ」の計画（純データ）。1 個体の
 * 「画面外から素早く進入 → 視界内で複数回の高速ダッシュ→短い停止(微小ジッター)→急旋回 → world 外へ退場」
 * の全経路を規定する。位置は計画＋経過時間の純関数で決まるため Vitest で検証できる（PixiJS/DOM 非依存）。
 *
 * タイムライン（合計 = {@link erraticTotalSeconds}）:
 *   entry[enter→wp0] → (pause@wp0 → dash[wp0→wp1]) → ... → (pause@wp(n-1) → exit[wp(n-1)→exit])
 * 停止中は wp を中心に微小ジッター（両端 0 の窓で連続）。ダッシュ/退場は smoothstep で加減速する。
 */
export interface ErraticPlan {
  /** 進入開始位置（world 端＝完全に画面外。inclusive なので初フレームで即 despawn しない）。 */
  enter: Vec2;
  /** 視界内のダッシュ先 waypoint 列（各点で停止しジッター、次へ急旋回ダッシュ）。1 個以上。 */
  waypoints: Vec2[];
  /** 退場先（world 外へ確実に抜ける点。despawn 判定に委ねる）。 */
  exit: Vec2;
  /** 進入(enter→waypoints[0])にかける秒数。 */
  entrySec: number;
  /** 1 回のダッシュ(waypoint 間)にかける秒数。 */
  dashSec: number;
  /** waypoint での停止秒（微小ジッター区間）。 */
  pauseSec: number;
  /** 退場(最終 waypoint→exit)にかける秒数。 */
  exitSec: number;
  /** 停止中の微小ジッター振幅(px)。 */
  jitterAmp: number;
  /** 停止中の微小ジッター角速度(rad/秒)。 */
  jitterFreq: number;
  /** ジッター位相(rad)。 */
  jitterPhase: number;
  /** 初期の表示向き（rotate 系なので heading が主だが型上必要）。 */
  facing: Facing;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** smoothstep（端で速度0）。ダッシュ/進入/退場の加減速を滑らかにする。 */
function ease(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 計画の総寿命(秒)。この時刻で位置は exit（world 外）に達する。 */
export function erraticTotalSeconds(plan: ErraticPlan): number {
  const n = plan.waypoints.length;
  const innerDashes = n > 0 ? n - 1 : 0;
  return plan.entrySec + n * plan.pauseSec + innerDashes * plan.dashSec + plan.exitSec;
}

/**
 * 停止中の微小ジッター位置。両端(th=0, th=pauseSec)で 0 になる窓を掛けるため、直前のダッシュ着地点・
 * 直後のダッシュ発進点（＝ wp）と位置が連続する。|オフセット| は概ね jitterAmp 以内に収まる。
 */
function jitterAround(plan: ErraticPlan, wp: Vec2, th: number): Vec2 {
  const window = Math.sin((Math.PI * th) / Math.max(plan.pauseSec, EPS));
  const jx = plan.jitterAmp * window * Math.sin(plan.jitterFreq * th + plan.jitterPhase);
  const jy = plan.jitterAmp * window * Math.cos(plan.jitterFreq * th * 1.3 + plan.jitterPhase);
  return { x: wp.x + jx, y: wp.y + jy };
}

/**
 * 経過時刻 t(秒) における位置を返す純関数。
 * - t<=0: enter（world 端＝画面外）。
 * - t>=total: exit（world 外）に留まる＝寿命後は確実に despawn 対象。
 * - entry: enter→wp0 を smoothstep 補間（素早く視界内へ）。
 * - roam: 各 wp で停止(微小ジッター)→次の wp へダッシュ(急旋回)を繰り返す。
 * - exit: 最終 wp→exit を smoothstep 補間（world 外へ抜ける）。
 */
export function erraticPositionAt(plan: ErraticPlan, t: number): Vec2 {
  const wps = plan.waypoints;
  const n = wps.length;
  const total = erraticTotalSeconds(plan);
  if (t <= 0) {
    return { x: plan.enter.x, y: plan.enter.y };
  }
  if (t >= total) {
    return { x: plan.exit.x, y: plan.exit.y };
  }
  // waypoint が無い退化ケースは enter→exit を直接補間する（実運用では planErraticSpawn が n>=1 を保証）。
  if (n === 0) {
    const k = ease(t / Math.max(total, EPS));
    return { x: lerp(plan.enter.x, plan.exit.x, k), y: lerp(plan.enter.y, plan.exit.y, k) };
  }
  // 進入: enter → wp0
  if (t < plan.entrySec) {
    const k = ease(t / Math.max(plan.entrySec, EPS));
    return { x: lerp(plan.enter.x, wps[0].x, k), y: lerp(plan.enter.y, wps[0].y, k) };
  }
  let cursor = plan.entrySec;
  for (let i = 0; i < n; i++) {
    // 停止（微小ジッター）区間。
    if (t < cursor + plan.pauseSec) {
      return jitterAround(plan, wps[i], t - cursor);
    }
    cursor += plan.pauseSec;
    // ダッシュ区間: wp[i] → 次の点（最後の wp は exit へ、それ以外は次の wp へ）。
    const isLast = i === n - 1;
    const next = isLast ? plan.exit : wps[i + 1];
    const dur = isLast ? plan.exitSec : plan.dashSec;
    if (t < cursor + dur) {
      const k = ease((t - cursor) / Math.max(dur, EPS));
      return { x: lerp(wps[i].x, next.x, k), y: lerp(wps[i].y, next.y, k) };
    }
    cursor += dur;
  }
  return { x: plan.exit.x, y: plan.exit.y };
}

/**
 * 進入初速（enter→wp0 の平均速度ベクトル）。spawn 時の heading 初期化に使う（進入方向を鼻先へ）。
 * waypoint が無い/距離 0 のときはゼロベクトル。
 */
export function erraticEntryVelocity(plan: ErraticPlan): Vec2 {
  const target = plan.waypoints[0] ?? plan.exit;
  const dx = target.x - plan.enter.x;
  const dy = target.y - plan.enter.y;
  const dist = Math.hypot(dx, dy);
  if (dist < EPS) {
    return { x: 0, y: 0 };
  }
  const speed = dist / Math.max(plan.entrySec, EPS);
  return { x: (dx / dist) * speed, y: (dy / dist) * speed };
}

/**
 * 虫の不規則ダッシュ動作。ErraticPlan に沿って画面外から素早く進入し、視界内で
 * 「高速ダッシュ→短い停止(微小ジッター)→急旋回」を繰り返し、やがて world 外へ抜ける。
 *
 * 位置は {@link erraticPositionAt}（純関数）から毎フレーム求める。velocity は位置差分から与えるので
 * SE の速度連動・heading(faceMode='rotate')・despawn 判定が速度から一貫して読める。PixiJS 非依存。
 */
export class ErraticMovement implements Movement {
  private readonly plan: ErraticPlan;
  private elapsedSeconds = 0;

  constructor(plan: ErraticPlan) {
    this.plan = plan;
  }

  update(state: CritterState, dtSeconds: number, _ctx: MovementContext): void {
    // 非正の dt では何もしない（tab 復帰直後などの 0/負値で NaN・暴走を出さない）。
    if (!(dtSeconds > 0)) {
      return;
    }
    this.elapsedSeconds += dtSeconds;
    const next = erraticPositionAt(this.plan, this.elapsedSeconds);
    // velocity は位置差分から与える（heading/SE/despawn が速度から一貫して読めるように）。
    state.velocity.x = (next.x - state.position.x) / dtSeconds;
    state.velocity.y = (next.y - state.position.y) / dtSeconds;
    state.position.x = next.x;
    state.position.y = next.y;
    // faceMode='rotate' なので heading は表示層(Critter)が velocity から更新する。
    // facing（左右反転）は rotate 系では未使用だが一貫のため速度符号で更新しておく。
    if (state.velocity.x > EPS) {
      state.facing = 1;
    } else if (state.velocity.x < -EPS) {
      state.facing = -1;
    }
  }
}

/** ErraticPlan を rng から生成するためのレンジ（種別ごとに CritterType が持つ）。 */
export interface ErraticSpawnRange {
  /** waypoint 個数の下限/上限（整数、1 以上）。 */
  waypointsMin: number;
  waypointsMax: number;
  entrySecMin: number;
  entrySecMax: number;
  dashSecMin: number;
  dashSecMax: number;
  pauseSecMin: number;
  pauseSecMax: number;
  exitSecMin: number;
  exitSecMax: number;
  jitterAmpMin: number;
  jitterAmpMax: number;
  jitterFreqMin: number;
  jitterFreqMax: number;
  /** waypoint を viewport 端から内側へ寄せる比率(0..0.5)。端に寄りすぎないようにする。 */
  insetFrac: number;
}

/**
 * 虫の既定レンジ。キビキビ速いダッシュ＋短い停止＋急旋回で「生きている」不規則さを出す。
 * 総寿命は概ね 2〜4 秒（有界）。
 */
export const ERRATIC_SPAWN_DEFAULTS: ErraticSpawnRange = {
  waypointsMin: 3,
  waypointsMax: 6,
  entrySecMin: 0.25,
  entrySecMax: 0.45,
  dashSecMin: 0.18,
  dashSecMax: 0.4,
  pauseSecMin: 0.12,
  pauseSecMax: 0.35,
  exitSecMin: 0.25,
  exitSecMax: 0.45,
  jitterAmpMin: 4,
  jitterAmpMax: 12,
  jitterFreqMin: 16,
  jitterFreqMax: 30,
  insetFrac: 0.16,
};

function pickEdge(sel: number): ErraticEdge {
  return sel < 0.25 ? "left" : sel < 0.5 ? "right" : sel < 0.75 ? "top" : "bottom";
}

/**
 * 指定 edge の world 端上に、内側点 inner と同軸の進入点を置く（まっすぐ視界へ入る）。
 * enter は world 端＝完全に画面外だが inclusive なので初フレームで即 despawn しない。
 */
function edgeEnter(world: WorldBounds, edge: ErraticEdge, inner: Vec2): Vec2 {
  switch (edge) {
    case "left":
      return { x: world.minX, y: inner.y };
    case "right":
      return { x: world.maxX, y: inner.y };
    case "top":
      return { x: inner.x, y: world.minY };
    default:
      return { x: inner.x, y: world.maxY };
  }
}

/**
 * 指定 edge の world 外へ内側点 inner と同軸の退場点を置く（確実に despawn）。
 * 押し出し量は max(size, MIN_EXIT_CLEARANCE)＝size=0 でも最低 1px 外側へ出し、world 境界上
 * (inclusive で inside 扱い) に留まらないようにする（size に依らず strictly outside を保証）。
 */
function edgeExit(world: WorldBounds, edge: ErraticEdge, inner: Vec2, size: number): Vec2 {
  const push = Math.max(size, MIN_EXIT_CLEARANCE);
  switch (edge) {
    case "left":
      return { x: world.minX - push, y: inner.y };
    case "right":
      return { x: world.maxX + push, y: inner.y };
    case "top":
      return { x: inner.x, y: world.minY - push };
    default:
      return { x: inner.x, y: world.maxY + push };
  }
}

/**
 * 虫の spawn を計画する純関数。rng は [0,1) を返す関数（テストで決定化できる）。
 *
 * rng 消費順（固定 10 回 + waypoint ごとに 2 回）:
 *   enterEdge, waypointCount, entrySec, dashSec, pauseSec, exitSec,
 *   jitterAmp, jitterFreq, jitterPhase, exitEdge, [wpX, wpY] * n
 *
 * - waypoint は viewport の inset 内に散らす（無限遠へ飛ばさない＝概ね viewport 近辺に留まる）。
 * - enter は enterEdge の world 端上で wp0 と同軸、exit は exitEdge の world 外へ押し出す
 *   （size に依らず必ず strictly outside＝寿命後に確実に despawn。押し出し量は edgeExit 参照）。
 */
export function planErraticSpawn(
  world: WorldBounds,
  rng: () => number,
  range: ErraticSpawnRange = ERRATIC_SPAWN_DEFAULTS,
  size = 0,
): ErraticPlan {
  const { width, height } = world.viewport;

  const enterEdge = pickEdge(rng());
  const span = Math.max(1, Math.round(range.waypointsMax - range.waypointsMin));
  const count = range.waypointsMin + Math.min(span, Math.floor(rng() * (span + 1)));

  const entrySec = lerp(range.entrySecMin, range.entrySecMax, rng());
  const dashSec = lerp(range.dashSecMin, range.dashSecMax, rng());
  const pauseSec = lerp(range.pauseSecMin, range.pauseSecMax, rng());
  const exitSec = lerp(range.exitSecMin, range.exitSecMax, rng());
  const jitterAmp = lerp(range.jitterAmpMin, range.jitterAmpMax, rng());
  const jitterFreq = lerp(range.jitterFreqMin, range.jitterFreqMax, rng());
  const jitterPhase = rng() * Math.PI * 2;
  const exitEdge = pickEdge(rng());

  const inset = range.insetFrac;
  const waypoints: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const x = lerp(width * inset, width * (1 - inset), rng());
    const y = lerp(height * inset, height * (1 - inset), rng());
    waypoints.push({ x, y });
  }

  const enter = edgeEnter(world, enterEdge, waypoints[0]);
  const exit = edgeExit(world, exitEdge, waypoints[waypoints.length - 1], size);

  return {
    enter,
    waypoints,
    exit,
    entrySec,
    dashSec,
    pauseSec,
    exitSec,
    jitterAmp,
    jitterFreq,
    jitterPhase,
    facing: 1,
  };
}

/**
 * クリック(タップ)位置を始点にした虫の spawn を計画する純関数（[UR-6] マウス操作の虫クリック出現）。
 * {@link planErraticSpawn} が world 端(画面外)から進入させるのに対し、本関数は enter=start（＝画面内の
 * クリック位置）から始め、視界内 waypoint を素早くダッシュで巡り、最後に world 外(exit)へ抜けて despawn する。
 *
 * rng 消費順（固定 8 回 + waypoint ごとに 2 回。enterEdge が無いぶん planErraticSpawn より 1 個少ない）:
 *   waypointCount, entrySec, dashSec, pauseSec, exitSec, jitterAmp, jitterFreq, jitterPhase, exitEdge,
 *   [wpX, wpY] * n
 *
 * - enter=start はクリック位置そのまま（canvas クリックは viewport 内＝world 内なので初フレームで即 despawn しない）。
 * - waypoint は viewport の inset 内に散らす（無限遠へ飛ばさない）。
 * - exit は exitEdge の world 外へ押し出す（size に依らず必ず strictly outside＝寿命後に確実に despawn）。
 */
export function planErraticFromPoint(
  start: Vec2,
  world: WorldBounds,
  rng: () => number,
  range: ErraticSpawnRange = ERRATIC_SPAWN_DEFAULTS,
  size = 0,
): ErraticPlan {
  const { width, height } = world.viewport;

  const span = Math.max(1, Math.round(range.waypointsMax - range.waypointsMin));
  const count = range.waypointsMin + Math.min(span, Math.floor(rng() * (span + 1)));

  const entrySec = lerp(range.entrySecMin, range.entrySecMax, rng());
  const dashSec = lerp(range.dashSecMin, range.dashSecMax, rng());
  const pauseSec = lerp(range.pauseSecMin, range.pauseSecMax, rng());
  const exitSec = lerp(range.exitSecMin, range.exitSecMax, rng());
  const jitterAmp = lerp(range.jitterAmpMin, range.jitterAmpMax, rng());
  const jitterFreq = lerp(range.jitterFreqMin, range.jitterFreqMax, rng());
  const jitterPhase = rng() * Math.PI * 2;
  const exitEdge = pickEdge(rng());

  const inset = range.insetFrac;
  const waypoints: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const x = lerp(width * inset, width * (1 - inset), rng());
    const y = lerp(height * inset, height * (1 - inset), rng());
    waypoints.push({ x, y });
  }

  // enter はクリック位置そのもの（画面外進入ではなく「その場から」始める）。
  const enter = { x: start.x, y: start.y };
  const exit = edgeExit(world, exitEdge, waypoints[waypoints.length - 1], size);

  return {
    enter,
    waypoints,
    exit,
    entrySec,
    dashSec,
    pauseSec,
    exitSec,
    jitterAmp,
    jitterFreq,
    jitterPhase,
    facing: 1,
  };
}
