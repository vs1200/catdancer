/**
 * ユーザー任意画像の「デコード後の画素寸法」を上限内へ収める計算（PixiJS/DOM 非依存 =
 * Vitest で単体テスト可能）。ファイルサイズが小さくても超高解像度の写真（例 6000×4000）は
 * 数百 MB の VRAM を要求し描画詰まり/クラッシュ要因になるため、テクスチャ化前に等比縮小する。
 */

/** カスタム画像/背景画像のテクスチャ最大辺(px)。超過分は等比縮小してから Texture 化する。 */
export const MAX_IMAGE_TEXTURE_SIDE = 2048;

/** {@link fitWithinMax} の結果。scaled=true のとき width/height は縮小後の寸法。 */
export interface ImageFit {
  /** 収めた後の幅(px)。 */
  width: number;
  /** 収めた後の高さ(px)。 */
  height: number;
  /** 縮小したか（false=上限内で素通し。呼び出し側は原寸をそのまま使う）。 */
  scaled: boolean;
}

/**
 * width/height の長辺が maxSide を超える場合に、アスペクト比を保って maxSide 以内へ等比縮小する。
 *
 * - 長辺が maxSide 以下ならそのまま（scaled=false）。呼び出し側は原画像をそのまま Texture 化する。
 * - 長辺が maxSide 超なら scale = maxSide / 長辺 で等比縮小し、四捨五入した寸法（最低 1px）を返す。
 * - 0/NaN/負値/非有限のガード: 判定不能な入力は縮小せず scaled=false で素通しさせる（呼び出し側は
 *   scaled を見てから width/height を使う。無効入力の width/height はそのまま返すが利用されない想定）。
 *
 * @param width 元画像の幅(px, 通常は naturalWidth)。
 * @param height 元画像の高さ(px, 通常は naturalHeight)。
 * @param maxSide 許容する最大辺(px)。既定は {@link MAX_IMAGE_TEXTURE_SIDE}。
 */
export function fitWithinMax(
  width: number,
  height: number,
  maxSide: number = MAX_IMAGE_TEXTURE_SIDE,
): ImageFit {
  // 不正値ガード: 有限かつ正でなければ縮小を判断できない。scaled=false で素通しを促す。
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(maxSide) ||
    width <= 0 ||
    height <= 0 ||
    maxSide <= 0
  ) {
    return { width, height, scaled: false };
  }
  const longest = Math.max(width, height);
  if (longest <= maxSide) {
    return { width, height, scaled: false };
  }
  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: true,
  };
}
