import type { Viewport } from "./worldBounds";

/**
 * [UR4-1] 表示サイズを解像度非依存にするためのスケール係数（純ロジック・PixiJS 非依存＝Vitest 可能）。
 *
 * 問題: 各種別の baseSize は固定 CSS px なので、viewport（＝ウィンドウの CSS px）が大きいほど
 * オブジェクトが画面に占める割合が小さくなる（大画面で小さく見える）。DPR は既に PixiJS の
 * autoDensity + resolution=devicePixelRatio が吸収済み（高 DPI でもボケず物理サイズ一定）なので、
 * 真因は DPR ではなく viewport の CSS px サイズである。
 *
 * 対策: viewport の短辺(min(w,h))を設計基準短辺 {@link REFERENCE_MIN_DIM} で割った係数を baseSize に
 * 乗じ、「画面に占める割合」を解像度に対して一定化する。係数 1.0 の基準（1080）では従来の baseSize と
 * 完全に一致し、既存の見え/feel を変えない。短辺基準は縦横どちらが小さくても破綻せず（縦長スマホ含む）、
 * 既に viewport 相対で L を決めている manual foxtail（{@link import("../modes/manual/foxtailGeometry").foxtailLength}）と
 * 同じ min(w,h) 規約に揃えて二重スケールを避ける。
 */

/** 設計基準となる viewport 短辺(px)。この短辺で sizeScale=1（＝従来の baseSize と一致）。 */
export const REFERENCE_MIN_DIM = 1080;

/**
 * sizeScale の下限。極小画面でオブジェクトが小さくなりすぎて視認/操作できなくなるのを防ぐ。
 * 短辺 540px 未満で頭打ち（540/1080=0.5）。
 */
export const MIN_SIZE_SCALE = 0.5;

/**
 * sizeScale の上限（＝画質維持の肝）。組み込みアセットの中で最も余裕の小さい toys
 * （native 最大辺 1384px / baseSize 680px ≈ 2.03）から決める。これ以上に拡大すると
 * toys の表示最大辺(CSS px)がテクスチャの native px を超え、アップスケールでボケる。2.0 で頭打ちに
 * すれば、DPR=1 では全組み込み種別（mouse 821/220≈3.7 / foxtail 1390/360≈3.9 / insect 300/56≈5.4）が
 * native 解像度内に収まりボケない。高 DPR 端末は CSS 短辺が相対的に小さく sizeScale が 1 以下へ寄る
 * ため、実質的に拡大が起きるのは低 DPI の大画面（＝アセットの余裕が大きい環境）に限られる。
 */
export const MAX_SIZE_SCALE = 2.0;

/** {@link computeSizeScale} の調整オプション（テストや将来調整用。省略時は上記の定数）。 */
export interface SizeScaleOptions {
  /** 基準短辺(px)。省略時 {@link REFERENCE_MIN_DIM}。 */
  referenceDim?: number;
  /** 下限。省略時 {@link MIN_SIZE_SCALE}。 */
  min?: number;
  /** 上限。省略時 {@link MAX_SIZE_SCALE}。 */
  max?: number;
}

/** v を [min,max] へクランプする（min>max を渡されても入れ替えて壊れない）。 */
function clampScale(v: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.min(Math.max(v, lo), hi);
}

/**
 * viewport の短辺から解像度非依存の表示スケール係数を求める純関数。
 * `scale = clamp(min(width,height) / referenceDim, min, max)`。
 *
 * - referenceDim の短辺を持つ viewport でちょうど 1.0（＝従来の baseSize）。
 * - 大画面ほど >1（大きく）、小画面ほど <1（小さく）にして「画面に占める割合」を一定化する。
 * - 異常入力（viewport が無い / 幅高が NaN・Inf・非正 / referenceDim が非正）は等倍 1.0 相当へ
 *   フォールバックし、暴発（size が 0/∞/NaN になる）を防ぐ。1.0 は既定 [0.5,2.0] 内なので clamp 後も 1.0。
 */
export function computeSizeScale(
  viewport: Viewport | null | undefined,
  options?: SizeScaleOptions,
): number {
  const referenceDim = options?.referenceDim ?? REFERENCE_MIN_DIM;
  const min = options?.min ?? MIN_SIZE_SCALE;
  const max = options?.max ?? MAX_SIZE_SCALE;
  const w = viewport?.width;
  const h = viewport?.height;
  if (
    typeof w !== "number" ||
    typeof h !== "number" ||
    !Number.isFinite(w) ||
    !Number.isFinite(h) ||
    !(referenceDim > 0)
  ) {
    return clampScale(1, min, max);
  }
  const shortSide = Math.min(w, h);
  if (!(shortSide > 0)) {
    return clampScale(1, min, max);
  }
  return clampScale(shortSide / referenceDim, min, max);
}
