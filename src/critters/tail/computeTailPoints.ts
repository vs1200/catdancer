import type { Vec2 } from "../../core/vec2";

/**
 * 尻尾(MeshRope)の点列を生成するための純パラメータ（PixiJS 非依存）。
 * 座標系は「付け根 local」: 付け根 i=0 が原点(0,0)、尻尾は -x 方向（体の後方）へ伸びる。
 * 実際の配置(attach point への移動)と反転は表示側(RopeTail / Critter)が担う。
 */
export interface TailParams {
  /** 点数 N（2 以上。MeshRope の分割数）。 */
  pointCount: number;
  /** 尻尾全長(px)。付け根から先端まで -x 方向へこの長さで伸ばす。 */
  length: number;
  /** 静止時の垂れ下がり(px)。先端で最大の緩い放物線状のたるみ。 */
  baseSag: number;
  /** 揺れの最大振幅(px)。先端(t=1)での振幅。付け根は常に 0。 */
  amplitude: number;
  /** 振幅の先端方向への増大指数(>=1 で先端ほど大きく揺れる)。 */
  amplitudeExponent: number;
  /** 長さ方向の空間波数（尻尾上に乗る波の数）。位相 k = waveCount * 2π。 */
  waveCount: number;
  /** 時間方向の角速度(rad/秒)。波が長さ方向へ流れる速さ。 */
  speed: number;
  /** 位相オフセット(rad)。複数個体で揺れをずらす用途。 */
  phase: number;
}

/**
 * 進行波の sin で尻尾の点列を生成する純関数（PixiJS/DOM 非依存 = 単体テスト可能）。
 *
 * 各点 i（t = i/(N-1), 0=付け根 / 1=先端）:
 * - x = -length * t                      … 後方(-x)へ地面沿いに伸ばす
 * - restY = baseSag * t^2                … 緩く垂れる静止曲線（付け根で 0）
 * - amp(i) = amplitude * t^exponent      … 先端ほど大きく（付け根は 0 で固定）
 * - wave = amp(i) * sin(speed*t_sec - k*t + phase)  … 尻尾軸(±x)に垂直な y 方向へ
 * - y = restY + wave
 *
 * 付け根(i=0)は t=0 のため amp=0 かつ restY=0 で常に原点固定。位相項 -k*t により
 * 揺れが波として長さ方向へ伝わって見える。
 */
export function computeTailPoints(params: TailParams, timeSec: number): Vec2[] {
  const n = Math.max(2, Math.floor(params.pointCount));
  const k = params.waveCount * Math.PI * 2;
  const points: Vec2[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    // t=0 は付け根で厳密に 0（-0 を避け、付け根固定を明示する）。
    const x = t === 0 ? 0 : -params.length * t;
    const restY = params.baseSag * t * t;
    const amp = params.amplitude * t ** params.amplitudeExponent;
    const wave = amp * Math.sin(params.speed * timeSec - k * t + params.phase);
    points[i] = { x, y: restY + wave };
  }
  return points;
}
