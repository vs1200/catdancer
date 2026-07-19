/**
 * [UR-5b] マウス操作モードの「ねこじゃらし」挙動の純ジオメトリ/物理ロジック（PixiJS/DOM 非依存＝Vitest 可能）。
 *
 * 挙動モデル（人が画面端から猫じゃらしを差し込んで振る）:
 * - 穂(head) はマウスへバネ的ラグで追従する（{@link springStep}）＝速く動かすと遅れて振れる「ふりふり」。
 * - 基部(hand) は「マウスに最も近い画面端」の外向きへ head から foxtail 長 L ぶん離れた点
 *   （{@link computeBasePosition}）。手が端/画面外側にあり穂が内側=中央寄りを向く。
 * - 最も近い端はヒステリシス付きで選び（{@link nearestEdge}）、端の切替でのガタつきを抑える。
 * - マウスが端に近いほど retract 0→1（{@link computeRetract}）で全体を端の外へスライドして隠す。
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
