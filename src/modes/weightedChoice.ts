/**
 * 重み付き乱択の純ロジック（PixiJS/DOM 非依存 = 単体テスト可能）。
 * AutoMode の種別ミックス（mouse / foxtail / toys を重みで選ぶ）に用いる。
 */

/**
 * 重み配列と r∈[0,1) から index を選ぶ純関数。累積重みで写像する。
 * - 重みが正のもののみ対象。合計が 0 以下、または配列が空なら -1 を返す（呼び出し側でガード）。
 * - r は [0,1) にクランプ。負/非有限の重みは 0 扱い（無視）。
 */
export function weightedIndex(weights: readonly number[], r: number): number {
  let total = 0;
  for (const w of weights) {
    if (Number.isFinite(w) && w > 0) {
      total += w;
    }
  }
  if (total <= 0) {
    return -1;
  }
  const clamped = r < 0 ? 0 : r >= 1 ? 1 - 1e-9 : r;
  let threshold = clamped * total;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (!Number.isFinite(w) || w <= 0) {
      continue;
    }
    threshold -= w;
    if (threshold < 0) {
      return i;
    }
  }
  // 浮動小数の誤差で末尾に落ちた場合は最後の正の重みの index を返す。
  for (let i = weights.length - 1; i >= 0; i--) {
    const w = weights[i];
    if (Number.isFinite(w) && w > 0) {
      return i;
    }
  }
  return -1;
}
