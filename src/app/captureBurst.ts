/**
 * 捕獲成功バースト演出の時間関数（PixiJS/DOM 非依存 = Vitest で単体テスト可能）。
 * 実際の描画（Graphics 生成/破棄）は CaptureEffects が担い、ここは「進捗(0..1)→リングの
 * scale/alpha」という純写像のみを置く（描画から演出カーブを分離する）。
 */

/** バースト 1 発の寿命(秒)。この時間で拡がり切って消える（短命＝狩りの即時報酬感）。 */
export const CAPTURE_BURST_DURATION_SEC = 0.45;

/** リング scale の始点（小さく出て）。 */
export const CAPTURE_BURST_START_SCALE = 0.35;
/** リング scale の終点（大きく拡がって消える）。 */
export const CAPTURE_BURST_END_SCALE = 1.6;

/** 値を [0,1] に収める。NaN は 0 に落とす（scale/alpha の NaN 混入を防ぐ）。 */
function clamp01(v: number): number {
  if (Number.isNaN(v)) {
    return 0;
  }
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** ease-out（cubic）。序盤に速く拡がり、終盤ゆるやかに収束する（弾けて広がる見え方）。 */
function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

/** {@link captureBurstVisual} の戻り値。リングの拡大率と不透明度。 */
export interface CaptureBurstVisual {
  /** リングの拡大率（START→END へ ease-out で単調増加）。 */
  scale: number;
  /** リングの不透明度（1→0 へ単調減少）。 */
  alpha: number;
}

/**
 * 進捗 progress(0..1) をリングの scale/alpha へ写す純関数。
 * - progress は内部で [0,1] にクランプ（範囲外の負値/1超・NaN も安全に扱う）。
 * - scale: START→END を ease-out で補間（progress 単調増加に対し単調増加）。
 * - alpha: 1 - progress^2（progress 単調増加に対し単調減少、序盤は明るく残り終盤で速く消える）。
 * 返り値は常に有限・範囲内（scale∈[START,END], alpha∈[0,1]）。
 */
export function captureBurstVisual(progress: number): CaptureBurstVisual {
  const p = clamp01(progress);
  const scale =
    CAPTURE_BURST_START_SCALE +
    (CAPTURE_BURST_END_SCALE - CAPTURE_BURST_START_SCALE) * easeOutCubic(p);
  const alpha = 1 - p * p;
  return { scale, alpha };
}
