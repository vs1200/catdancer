import type { Texture } from "pixi.js";
import { Texture as PixiTexture } from "pixi.js";

/**
 * 手続き生成する尻尾テクスチャの設定。
 * テクスチャは「U=長さ方向(付け根→先端)」「V=太さ方向」でレイアウトする
 * （MeshRope/RopeGeometry の UV マッピングに一致）。
 */
export interface TailTextureOptions {
  /** テクスチャ解像度（長さ方向, px）。 */
  length?: number;
  /** テクスチャ解像度（太さ方向, px）。 */
  thickness?: number;
  /** 付け根側の色（ネズミ尻尾のピンク）。 */
  baseColor?: string;
  /** 先端側の色（やや暗いピンク）。 */
  tipColor?: string;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(hex: string): Rgb {
  const h = hex.replace("#", "");
  return {
    r: Number.parseInt(h.slice(0, 2), 16),
    g: Number.parseInt(h.slice(2, 4), 16),
    b: Number.parseInt(h.slice(4, 6), 16),
  };
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

function shade(c: Rgb, factor: number): Rgb {
  return { r: c.r * factor, g: c.g * factor, b: c.b * factor };
}

function rgba(c: Rgb, alpha: number): string {
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${alpha})`;
}

/**
 * 付け根が太く先端へ細くなるテーパー形状のピンク尻尾テクスチャを生成する。
 *
 * RopeGeometry はリボン幅が一定（頂点計算のテーパーは無効化されている）ため、
 * 見た目のテーパーはテクスチャのアルファで表現する:
 * - 各列(=長さ方向 t)で不透明帯の太さを付け根(全幅)→先端(極細)へ縮める
 * - 帯は上下端をアルファでソフトに（縁の馴染み）、中央をわずかに明るく（丸み）
 * - 先端は列アルファでフェードして自然に消える
 *
 * 生成にはオフスクリーン canvas を用い、Pixi の {@link Texture} に変換して返す。
 */
export function createTailTexture(options?: TailTextureOptions): Texture {
  const width = Math.max(2, Math.floor(options?.length ?? 256));
  const height = Math.max(2, Math.floor(options?.thickness ?? 48));
  const base = parseHex(options?.baseColor ?? "#d9a89a");
  const tip = parseHex(options?.tipColor ?? "#c98b7f");

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("尻尾テクスチャ生成に必要な 2D コンテキストを取得できませんでした");
  }
  ctx.clearRect(0, 0, width, height);

  const cy = height / 2;
  const maxHalf = height * 0.46; // 上下に少し余白を残しソフトエッジの余地を作る

  for (let x = 0; x < width; x++) {
    const t = x / (width - 1); // 0=付け根, 1=先端
    // 付け根(全幅)→先端(極細)へ滑らかに縮める。tip 側に下限を残し尖りすぎを防ぐ。
    const half = Math.max(maxHalf * (1 - t) ** 0.6, 0.6);
    // 長さ方向の色補間。
    const col = lerpRgb(base, tip, t);
    // 先端側を緩くフェードアウト（t>0.9 から 0 へ）。
    const tipFade = t < 0.9 ? 1 : Math.max(0, 1 - (t - 0.9) / 0.1);

    // 太さ方向のグラデ: 上下端は透明、中央付近は不透明＋わずかな陰影で丸みを出す。
    const grad = ctx.createLinearGradient(0, cy - half, 0, cy + half);
    grad.addColorStop(0, rgba(shade(col, 0.82), 0));
    grad.addColorStop(0.22, rgba(shade(col, 0.86), 0.85));
    grad.addColorStop(0.42, rgba(shade(col, 1.08), 1));
    grad.addColorStop(0.6, rgba(col, 1));
    grad.addColorStop(0.82, rgba(shade(col, 0.82), 0.85));
    grad.addColorStop(1, rgba(shade(col, 0.78), 0));

    ctx.globalAlpha = tipFade;
    ctx.fillStyle = grad;
    ctx.fillRect(x, cy - half, 1, half * 2);
  }
  ctx.globalAlpha = 1;

  return PixiTexture.from(canvas);
}
