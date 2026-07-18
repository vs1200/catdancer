import { Texture } from "pixi.js";
import { fitWithinMax, MAX_IMAGE_TEXTURE_SIDE } from "../critters/imageFit";

/**
 * デコード済み画像から PixiJS Texture を生成する（カスタム画像クリッター/背景画像 共通）。
 *
 * 画素寸法（naturalWidth/Height）の長辺が maxSide を超える場合は OffscreenCanvas（無ければ
 * HTMLCanvasElement）へ等比縮小描画してから Texture 化する。超高解像度画像がそのまま VRAM を
 * 圧迫して描画詰まり/クラッシュを招くのを防ぐ（＝画像は拒否せず受理してダウンスケール＝良UX）。
 * 上限内ならそのまま {@link Texture.from}(image)。2D コンテキストが取れない環境では縮小を諦め
 * 原寸で作る（受理優先）。縮小計算は純関数 {@link fitWithinMax} に切り出してテスト可能にしている。
 *
 * @param image `image.decode()` 済みの画像要素。
 * @param maxSide テクスチャ最大辺(px)。既定 {@link MAX_IMAGE_TEXTURE_SIDE}。
 */
export function textureFromImageWithin(
  image: HTMLImageElement,
  maxSide: number = MAX_IMAGE_TEXTURE_SIDE,
): Texture {
  const fit = fitWithinMax(image.naturalWidth, image.naturalHeight, maxSide);
  if (!fit.scaled) {
    return Texture.from(image);
  }
  const canvas = drawDownscaled(image, fit.width, fit.height);
  if (!canvas) {
    // 2D コンテキストが取れない環境では縮小を諦めて原寸で作る（拒否より受理を優先）。
    return Texture.from(image);
  }
  return Texture.from(canvas);
}

/**
 * 画像を指定寸法へ縮小描画したキャンバスを返す（OffscreenCanvas 優先、無ければ HTMLCanvasElement）。
 * 2D コンテキストが取れなければ null。getContext のオーバーロード差を避けるため型ごとに分岐する。
 */
function drawDownscaled(
  image: HTMLImageElement,
  width: number,
  height: number,
): OffscreenCanvas | HTMLCanvasElement | null {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    ctx.drawImage(image, 0, 0, width, height);
    return canvas;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.drawImage(image, 0, 0, width, height);
  return canvas;
}
