/**
 * [UR-5b] マウス操作モードの「ねこじゃらし」挙動の純ジオメトリ/物理ロジック（PixiJS/DOM 非依存＝Vitest 可能）。
 *
 * [UR3-2/3] 挙動モデル（人が画面端から猫じゃらしを差し込んで振る）:
 * - 穂(head) はマウスへバネ的ラグで追従する（{@link springStep}）＝速く動かすと遅れて振れる「ふりふり」。
 * - 基部(base) は viewport の周長を辿る「かなり遅い独立点」。ポインタを最寄り周上点へ投影した弧長
 *   （{@link projectToPerimeter}）を target に、現在弧長を短い弧方向へ長い時定数で積分する（{@link approachArc}）。
 *   端に垂直な直行移動では投影の足が動かず根元も動かない／端に沿う（周回）移動でのみ根元が周上を旅する。
 * - 穂先(tip) は base から穂方向 unit(head−base) へ固定長 L の点＝穂先が base 周りに半径 L の弧を描く
 *   （{@link computeFoxtailRig}）。base と tip の距離は常に L だが向きは head 追従で可変。
 * - マウスが端に近いほど retract 0→1（{@link computeRetract}）で rig 全体（base pivot と tip の両方）を
 *   端の外へスライドして隠す。押し出し量を L 以上に取ることで、穂先が内向きに最大 L 戻っても端の外に残る。
 *
 * 表示側（FoxtailManualController, PixiJS 依存）はこの純ロジックの結果を Sprite の位置/回転へ載せるだけ。
 */

import type { Vec2 } from "../../core/vec2";
import type { Viewport } from "../../core/worldBounds";

/** マウスに最も近い画面端の識別子。 */
export type FoxtailEdge = "left" | "right" | "top" | "bottom";

const EDGES: readonly FoxtailEdge[] = ["left", "right", "top", "bottom"];

/** viewport 内の点 (px,py) から各辺までの距離（負値は端の外側＝呼び出し側で扱う）。 */
export interface EdgeDistances {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 点 (px,py) から left/right/top/bottom の各辺までの距離を返す純関数。 */
export function edgeDistances(px: number, py: number, vp: Viewport): EdgeDistances {
  return { left: px, right: vp.width - px, top: py, bottom: vp.height - py };
}

/** viewport 内の点から最も近い端までの距離（4 辺の最小。端の外なら負値）。 */
export function distanceToNearestEdge(px: number, py: number, vp: Viewport): number {
  const d = edgeDistances(px, py, vp);
  return Math.min(d.left, d.right, d.top, d.bottom);
}

/**
 * マウスに最も近い画面端を選ぶ（ヒステリシス付き）。
 * current が null（初回）なら単純に距離最小の端。current があるときは、別の端が current より
 * hysteresis 以上近い場合にだけ乗り換える（辺が拮抗する位置での小刻みな切替＝ガタつきを防ぐ）。
 */
export function nearestEdge(
  px: number,
  py: number,
  vp: Viewport,
  current: FoxtailEdge | null,
  hysteresis: number,
): FoxtailEdge {
  const d = edgeDistances(px, py, vp);
  if (current === null) {
    let best: FoxtailEdge = "left";
    for (const e of EDGES) {
      if (d[e] < d[best]) {
        best = e;
      }
    }
    return best;
  }
  // 乗り換え候補: current より hysteresis 以上近い端のうち最も近いもの。無ければ current 維持。
  let best: FoxtailEdge = current;
  let bestDist = d[current] - hysteresis;
  for (const e of EDGES) {
    if (e !== current && d[e] < bestDist) {
      bestDist = d[e];
      best = e;
    }
  }
  return best;
}

/** 端の外向き単位ベクトル（left=-x, right=+x, top=-y, bottom=+y。+y=画面下）。 */
export function edgeOutward(edge: FoxtailEdge): Vec2 {
  switch (edge) {
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
    case "top":
      return { x: 0, y: -1 };
    case "bottom":
      return { x: 0, y: 1 };
  }
}

/** 端の外向き方向の角度(rad)。approachAngle で滑らかに追う目標角に使う。 */
export function edgeOutwardAngle(edge: FoxtailEdge): number {
  const o = edgeOutward(edge);
  return Math.atan2(o.y, o.x);
}

/**
 * しまう(retract)係数を求める純関数。端までの距離 dist が threshold 以上なら 0（出ている）、
 * 0 なら 1（しまう）。その間は smoothstep で滑らかに補間する（境界を滑らかに）。
 */
export function computeRetract(dist: number, threshold: number): number {
  if (threshold <= 0) {
    return dist <= 0 ? 1 : 0;
  }
  const t = 1 - dist / threshold;
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c); // smoothstep
}

/** min(width,height) に対する割合 frac で foxtail 長 L(px) を決める（画面サイズへ追従）。 */
export function foxtailLength(vp: Viewport, frac: number): number {
  return Math.min(vp.width, vp.height) * frac;
}

/**
 * 基部(hand)＝スプライトの配置点を求める純関数。
 * head から outward 方向へ (length + retractShift) 進めた点。base→head の向きが「端から中央寄り」を向く。
 * retractShift を足すと rig 全体が端の外へスライドし、穂先が画面外へ引っ込む（しまう）。
 */
export function computeBasePosition(
  head: Vec2,
  outward: Vec2,
  length: number,
  retractShift: number,
): Vec2 {
  const d = length + retractShift;
  return { x: head.x + outward.x * d, y: head.y + outward.y * d };
}

/**
 * 描画上の穂先(tip)ワールド座標。head から outward 方向へ retractShift だけスライドした点
 * （retract で画面外へ抜ける。しまう検証・観測用）。
 */
export function computeHeadRender(head: Vec2, outward: Vec2, retractShift: number): Vec2 {
  return { x: head.x + outward.x * retractShift, y: head.y + outward.y * retractShift };
}

/** 角度差を最短経路 [-π, π] に正規化する。 */
export function shortestAngleDelta(from: number, to: number): number {
  const twoPi = 2 * Math.PI;
  let d = (to - from) % twoPi;
  if (d > Math.PI) {
    d -= twoPi;
  } else if (d < -Math.PI) {
    d += twoPi;
  }
  return d;
}

/**
 * current 角を target 角へ最短経路で寄せる（時定数 smoothTime の指数平滑・フレームレート非依存）。
 * 端切替時に基部方向を 90 度スナップさせず滑らかに旋回させて、ガタつきを消す。
 */
export function approachAngle(
  current: number,
  target: number,
  smoothTime: number,
  dt: number,
): number {
  if (!(dt > 0)) {
    return current;
  }
  const delta = shortestAngleDelta(current, target);
  const t = Math.max(1e-4, smoothTime);
  const a = 1 - Math.exp(-dt / t);
  return current + delta * a;
}

/**
 * 値 current を target へ指数平滑で寄せる（フレームレート非依存）。retract の平滑に使う。
 */
export function approach(current: number, target: number, smoothTime: number, dt: number): number {
  if (!(dt > 0)) {
    return current;
  }
  const t = Math.max(1e-4, smoothTime);
  const a = 1 - Math.exp(-dt / t);
  return current + (target - current) * a;
}

// --- [UR3-2/3] 根元(base/hand)の「周長に沿う連続移動」モデル -------------------------------
//
// base を head から距離 L 固定で導出する旧モデル（穂を振ると根元も同量動く／端反転で根元が半径 L で
// 高速掃引＝テレポート）をやめ、base を「viewport の周長(perimeter)を 1D ループとして辿る独立した
// 遅い点」にする。周長を弧長 s∈[0,P)（P=2(W+H)）でパラメトライズし、ポインタを最寄り周上点へ投影した
// 弧長を target に、現在弧長を **短い方の弧方向**（wrap 対応）へ **ゆっくり** 積分する。これにより
// (UR3-2) head と base の距離が可変になり穂先が base 周りに弧を描く／(UR3-3) 直行(対角)では周長を
// 突っ切れないので根元が瞬間移動しない、を同時に満たす。純ロジック＝Vitest 可能・UR3-7 で再利用。
//
// 弧長の割付（時計回り, +y=画面下）:
//   top   : (0,0)→(W,0)     s∈[0, W)
//   right : (W,0)→(W,H)     s∈[W, W+H)
//   bottom: (W,H)→(0,H)     s∈[W+H, 2W+H)
//   left  : (0,H)→(0,0)     s∈[2W+H, 2W+2H)=[.., P)

/** viewport の周長 P = 2(W+H)。弧長パラメトライズの周期。 */
export function perimeterLength(vp: Viewport): number {
  return 2 * (vp.width + vp.height);
}

/** 弧長 s を [0, perimeter) へ正規化する（負値・周回を wrap）。perimeter<=0 は 0。 */
export function wrapArc(s: number, perimeter: number): number {
  if (!(perimeter > 0) || !Number.isFinite(s)) {
    return 0;
  }
  const m = s % perimeter;
  return m < 0 ? m + perimeter : m;
}

/** 弧長差 to-from を周長ループの最短経路 [-P/2, P/2] へ正規化する（shortestAngleDelta の弧長版）。 */
export function shortestArcDelta(from: number, to: number, perimeter: number): number {
  if (!(perimeter > 0)) {
    return 0;
  }
  const half = perimeter / 2;
  let d = (to - from) % perimeter;
  if (d > half) {
    d -= perimeter;
  } else if (d < -half) {
    d += perimeter;
  }
  return d;
}

/** 弧長 s に対応する周上の 2D 点。s は自動で wrap。常に viewport 境界上（内部を突っ切らない不変条件）。 */
export function perimeterPoint(vp: Viewport, s: number): Vec2 {
  const { width: W, height: H } = vp;
  const u = wrapArc(s, perimeterLength(vp));
  if (u < W) {
    return { x: u, y: 0 }; // top
  }
  if (u < W + H) {
    return { x: W, y: u - W }; // right
  }
  if (u < 2 * W + H) {
    return { x: W - (u - (W + H)), y: H }; // bottom
  }
  return { x: 0, y: H - (u - (2 * W + H)) }; // left
}

/** 弧長 s が属する辺（外向き法線＝retract のスライド方向に使う）。 */
export function perimeterEdge(vp: Viewport, s: number): FoxtailEdge {
  const { width: W, height: H } = vp;
  const u = wrapArc(s, perimeterLength(vp));
  if (u < W) {
    return "top";
  }
  if (u < W + H) {
    return "right";
  }
  if (u < 2 * W + H) {
    return "bottom";
  }
  return "left";
}

/**
 * 点 (px,py) を最寄りの周上点へ投影した弧長を返す純関数。各辺へ垂線の足（線分へクランプ）を下ろし、
 * 最短距離の辺の弧長を採用する。内部点は最寄り辺、外部/隅ではクランプで隅へ寄る。base の target 弧長。
 */
export function projectToPerimeter(px: number, py: number, vp: Viewport): number {
  const { width: W, height: H } = vp;
  const cx = Math.min(Math.max(px, 0), W);
  const cy = Math.min(Math.max(py, 0), H);
  const cands: readonly { d: number; s: number }[] = [
    { d: Math.hypot(px - cx, py), s: cx }, // top: 足(cx,0)
    { d: Math.hypot(px - W, py - cy), s: W + cy }, // right: 足(W,cy)
    { d: Math.hypot(px - cx, py - H), s: W + H + (W - cx) }, // bottom: 足(cx,H)
    { d: Math.hypot(px, py - cy), s: 2 * W + H + (H - cy) }, // left: 足(0,cy)
  ];
  let best = cands[0];
  for (const c of cands) {
    if (c.d < best.d) {
      best = c;
    }
  }
  return wrapArc(best.s, perimeterLength(vp));
}

/**
 * 現在弧長 current を target 弧長へ **最短の弧方向**（wrap 対応）で指数平滑（フレームレート非依存）。
 * smoothTime を head のバネ時定数より十分大きく取ることで、base が「かなり遅い」独立点になる。速い/
 * 直行のポインタ移動では base はほとんど動かず、周長を辿る移動でのみ base が周上を旅する。
 */
export function approachArc(
  current: number,
  target: number,
  smoothTime: number,
  dt: number,
  perimeter: number,
): number {
  if (!(perimeter > 0)) {
    return current;
  }
  const c = wrapArc(current, perimeter);
  if (!(dt > 0)) {
    return c;
  }
  const t = wrapArc(target, perimeter);
  const delta = shortestArcDelta(c, t, perimeter);
  const tau = Math.max(1e-4, smoothTime);
  const a = 1 - Math.exp(-dt / tau);
  return wrapArc(c + delta * a, perimeter);
}

/** {@link computeFoxtailRig} の結果（base pivot・穂先 tip・穂の向き heading）。 */
export interface FoxtailRig {
  /** スプライトの配置点（周上点を retract 外向きに押し出した点）。回転 pivot。 */
  base: Vec2;
  /** 穂先ワールド座標（base から heading 方向へ固定長 length）。retract 検証・観測用。 */
  tip: Vec2;
  /** 穂の向き(rad)= atan2(head−base)。aim 退化時は prevHeading を維持。 */
  heading: number;
}

/**
 * [UR3-2/3] 表示 rig（base pivot と 穂先 tip）を求める純関数（PixiJS 非依存＝Vitest 可能）。
 *
 * - base = 周上点 perimeterPt を outwardAngle 方向へ retractShift だけ押し出した点。
 *   retract=0 では retractShift=0 で base = perimeterPt（端上）＝通常追従では周上を辿る。
 * - heading = atan2(head − base)。head のバネラグで aim がオーバーシュートし穂が振れる。
 *   aim が退化（|head−base| < aimMinPx）したら prevHeading を維持して atan2 ジッタを避ける。
 * - tip = base から heading 方向へ固定長 length。穂先が base 周りに半径 length の弧を描く。
 *
 * retract の「しまう」不変条件: retractShift ≥ length + ε を満たせば、head が viewport 内の
 * どこにあっても穂先が内向きに最大 length しか戻らないため、tip は端の外に ε 以上残り、base も
 * (length+ε) 外にあるので **rig 全体が viewport 外**になる（穂先が画面内へ貫入しない）。
 */
export function computeFoxtailRig(
  perimeterPt: Vec2,
  outwardAngle: number,
  retractShift: number,
  head: Vec2,
  length: number,
  prevHeading: number,
  aimMinPx: number,
): FoxtailRig {
  const base: Vec2 = {
    x: perimeterPt.x + Math.cos(outwardAngle) * retractShift,
    y: perimeterPt.y + Math.sin(outwardAngle) * retractShift,
  };
  const aimX = head.x - base.x;
  const aimY = head.y - base.y;
  let heading = prevHeading;
  if (Math.hypot(aimX, aimY) >= aimMinPx) {
    heading = Math.atan2(aimY, aimX);
  }
  const tip: Vec2 = {
    x: base.x + Math.cos(heading) * length,
    y: base.y + Math.sin(heading) * length,
  };
  return { base, tip, heading };
}

/**
 * バネ・ダンパで pos を target へ寄せる（in-place, semi-implicit Euler）。
 * stiffness=k(=ω²), damping=c。減衰比 ζ = c / (2√k)。ζ<1（不足減衰）で追従に僅かな
 * オーバーシュートが残り、速い振り(flick)で穂が遅れて振れる「ふりふり」の主要因になる。
 * dt は呼び出し側で安定域(ω·dt≲1)へクランプ/分割すること（本関数は生の Euler ステップ）。
 */
export function springStep(
  pos: Vec2,
  vel: Vec2,
  target: Vec2,
  stiffness: number,
  damping: number,
  dt: number,
): void {
  if (!(dt > 0)) {
    return;
  }
  const ax = (target.x - pos.x) * stiffness - vel.x * damping;
  const ay = (target.y - pos.y) * stiffness - vel.y * damping;
  vel.x += ax * dt;
  vel.y += ay * dt;
  pos.x += vel.x * dt;
  pos.y += vel.y * dt;
}
