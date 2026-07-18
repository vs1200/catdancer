/**
 * 背景画像の cover-fit（viewport を覆う・アスペクト維持・はみ出し切り取り）の
 * サイズ/位置計算（PixiJS/DOM 非依存 = Vitest で単体テスト可能）。
 */

export interface Size {
  width: number;
  height: number;
}

/**
 * cover-fit の結果。
 * - scale: コンテンツ実寸に掛ける拡縮率（縦横同一＝アスペクト維持）。
 * - width/height: 拡縮後の表示寸法（どちらも viewport 以上になる）。
 * - x/y: viewport 内で中央寄せしたときの左上座標（負なら左/上へはみ出す）。
 */
export interface CoverFit {
  scale: number;
  width: number;
  height: number;
  x: number;
  y: number;
}

/**
 * cover-fit を計算する純関数。
 *
 * scale = max(viewport.w / content.w, viewport.h / content.h) とすることで、
 * アスペクト比を保ったまま viewport を完全に覆う（短辺基準で拡大し長辺ははみ出す）。
 * 中央寄せのため左上は (viewport - scaled)/2。content が 0 以下のときは
 * ゼロ除算を避け scale=1 とする（呼び出し側は描画しない想定）。
 */
export function computeCoverFit(content: Size, viewport: Size): CoverFit {
  const cw = content.width;
  const ch = content.height;
  if (!(cw > 0) || !(ch > 0)) {
    return { scale: 1, width: 0, height: 0, x: viewport.width / 2, y: viewport.height / 2 };
  }
  const scale = Math.max(viewport.width / cw, viewport.height / ch);
  const width = cw * scale;
  const height = ch * scale;
  return {
    scale,
    width,
    height,
    x: (viewport.width - width) / 2,
    y: (viewport.height - height) / 2,
  };
}
