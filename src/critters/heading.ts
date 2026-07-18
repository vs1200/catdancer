/**
 * 進行方向(heading)まわりの純ロジック（PixiJS 非依存 = Vitest で単体テスト可能）。
 *
 * faceMode='rotate' の critter（ネズミ等）が、速度ベクトルから鼻先を進行方向へ向けるために使う。
 * テクスチャ既定は右向き（heading 0 = +x）。左半分(cos(heading)<0)は単純回転だと腹が上を向くため、
 * 表示側で局所水平軸の鏡像反転(scale.y=-1)を併用する（判定は {@link isMirroredHeading}）。
 * heading は速度から atan2 で求めた目標へ最短経路で平滑補間し、静止時は保持する。
 */

const TWO_PI = Math.PI * 2;

/** ゼロ速度ガード用の微小値。 */
const EPS = 1e-6;

/** 角度を (-π, π] へ正規化する。 */
export function normalizeAngle(angle: number): number {
  const x = angle % TWO_PI;
  if (x > Math.PI) {
    return x - TWO_PI;
  }
  if (x <= -Math.PI) {
    return x + TWO_PI;
  }
  return x;
}

/** from→to の最短符号付き角度差（(-π, π]）。±180°境界を最短側に回る。 */
export function shortestAngleDelta(from: number, to: number): number {
  return normalizeAngle(to - from);
}

/**
 * current を target へ最短経路で指数的に近づける（フレームレート非依存）。
 * smoothTime は時定数(秒)で、小さいほど俊敏に向く。dt<=0 は現在角(正規化)をそのまま返す。
 * 補間係数 k = 1 - e^{-dt/τ} は常に (0,1) なのでオーバーシュートしない。結果は正規化して返す。
 */
export function approachAngle(
  current: number,
  target: number,
  dt: number,
  smoothTime: number,
): number {
  if (!(dt > 0)) {
    return normalizeAngle(current);
  }
  const tau = Math.max(1e-4, smoothTime);
  const k = 1 - Math.exp(-dt / tau);
  return normalizeAngle(current + shortestAngleDelta(current, target) * k);
}

/**
 * 左半分（cos(heading)<0）は鏡像反転が要る（右向きテクスチャを単純回転すると腹が上を向くため）。
 * 真上/真下(cos≈0)は反転なしの通常回転側に含める（境界での判定を安定させる）。
 */
export function isMirroredHeading(heading: number): boolean {
  return Math.cos(heading) < 0;
}

/** {@link updateHeading} の調整パラメータ。 */
export interface HeadingUpdateOptions {
  /** これ以下の速さ(px/秒)では回頭せず現在角を保つ（静止時のくるくる回り防止）。 */
  readonly holdMinSpeed: number;
  /** 回頭の時定数(秒)。小さいほど俊敏に向く（生き物らしい旋回速度に調整）。 */
  readonly smoothTime: number;
}

/**
 * 速度ベクトルから heading を 1 フレーム更新する純関数。
 * - 速さが holdMinSpeed 以下: 現在角を維持（静止時に回らない＝直前の向きを保つ）。
 * - それ以外: 目標 atan2(vy,vx) へ最短経路で smoothTime 補間して回頭する。
 */
export function updateHeading(
  current: number,
  vx: number,
  vy: number,
  dt: number,
  opts: HeadingUpdateOptions,
): number {
  const speed = Math.hypot(vx, vy);
  if (speed <= opts.holdMinSpeed || speed < EPS) {
    return normalizeAngle(current);
  }
  const target = Math.atan2(vy, vx);
  return approachAngle(current, target, dt, opts.smoothTime);
}
