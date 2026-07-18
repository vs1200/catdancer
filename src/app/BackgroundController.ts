import type { Texture } from "pixi.js";
import { getImage } from "../settings/imageStore";
import type { AppSettings } from "../settings/settingsData";
import type { BackgroundLayer } from "./BackgroundLayer";
import { textureFromImageWithin } from "./imageTexture";

interface LoadedImage {
  texture: Texture;
  /** テクスチャ元の objectURL（差し替え/破棄時に revoke する）。 */
  url: string;
}

/**
 * SettingsStore の背景設定を BackgroundLayer の描画へ反映する橋渡し。
 *
 * 責務:
 * - type=color: 単色 fill を反映（画像は隠す）。
 * - type=image: imageId で IndexedDB から Blob を取得 → objectURL → Texture を生成し貼る。
 * - **objectURL/テクスチャのライフサイクル管理**: 差し替え時は旧 url を revoke し旧テクスチャを破棄、
 *   破棄時も現行を解放する（リーク防止）。
 * - 連続変更の競合ガード: token で最新要求以外の結果を破棄（古い画像が後から出る/リークするのを防ぐ）。
 *
 * 起動時復元も setBackgroundImage 後の再描画も、この apply(settings) 一本に集約する。
 */
export class BackgroundController {
  private readonly layer: BackgroundLayer;
  private current: LoadedImage | null = null;
  private token = 0;

  constructor(layer: BackgroundLayer) {
    this.layer = layer;
  }

  /** 設定を描画へ反映する（画像ロードのため非同期）。 */
  async apply(settings: AppSettings): Promise<void> {
    const { type, color, imageId } = settings.background;
    // 色は常に先に反映（画像ロード待ち中でも背景色が正しくなる）。
    this.layer.setColor(color);

    if (type !== "image" || !imageId) {
      this.layer.clearImage();
      this.releaseCurrent();
      return;
    }

    const token = ++this.token;

    let blob: Blob | null = null;
    try {
      blob = await getImage(imageId);
    } catch {
      // getImage は本来 null を返すが、念のため握りつぶす。
      blob = null;
    }
    if (token !== this.token) {
      // 後続の apply に追い越された。何もしない（current は後続が管理）。
      return;
    }
    if (!blob) {
      // imageId が IDB に無い（削除済み/未対応）→ 単色フォールバック。
      this.layer.clearImage();
      this.releaseCurrent();
      return;
    }

    let loaded: LoadedImage;
    try {
      loaded = await loadTextureFromBlob(blob);
    } catch {
      if (token === this.token) {
        this.layer.clearImage();
        this.releaseCurrent();
      }
      return;
    }
    if (token !== this.token) {
      // デコード中に追い越された → 生成物を破棄（リーク防止）。
      destroyLoaded(loaded);
      return;
    }

    this.layer.setImage(loaded.texture);
    this.releaseCurrent();
    this.current = loaded;
  }

  /** 現在の画像テクスチャ/objectURL を解放する。 */
  private releaseCurrent(): void {
    if (this.current) {
      destroyLoaded(this.current);
      this.current = null;
    }
  }

  /** 破棄時に保持リソースを解放する。 */
  destroy(): void {
    // 進行中の apply を無効化してから解放。
    this.token++;
    this.releaseCurrent();
  }
}

/**
 * Blob から objectURL 経由で Texture を生成する（失敗時は url を revoke して throw）。
 * 背景は全画面 cover-fit で拡大されるため巨大画像の VRAM リスクが critter より大きい。
 * 画素寸法が上限超なら textureFromImageWithin が等比縮小してから Texture 化する。
 */
async function loadTextureFromBlob(blob: Blob): Promise<LoadedImage> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const texture = textureFromImageWithin(image);
    return { texture, url };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error instanceof Error ? error : new Error("背景画像のデコードに失敗しました");
  }
}

function destroyLoaded(loaded: LoadedImage): void {
  loaded.texture.destroy(true);
  URL.revokeObjectURL(loaded.url);
}
