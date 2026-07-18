import type { Texture } from "pixi.js";
import { Container, Graphics, Sprite } from "pixi.js";
import type { Viewport } from "../core/worldBounds";
import { DEFAULT_BACKGROUND_COLOR } from "../settings/settingsData";
import { computeCoverFit } from "./backgroundFit";

/**
 * 背景レイヤの描画。critter より背面に置く（Scene の background Container に追加）。
 *
 * 構成: 常に viewport を覆う単色 Graphics（fill）＋ その上に任意のユーザー画像 Sprite。
 * - 単色モード: fill が見える（sprite は非表示）。既定は白。
 * - 画像モード: sprite を cover-fit（アスペクト維持で viewport を覆う）で表示。
 * resize で fill を描き直し、sprite を再フィットする。
 *
 * テクスチャの生成/解放（objectURL 含む）は呼び出し側（BackgroundController）が管理し、
 * 本クラスは受け取った Texture を貼るだけ（表示責務に限定）。
 */
export class BackgroundLayer {
  /** Scene.background へ追加するルート。 */
  readonly root: Container;
  private readonly fill: Graphics;
  private sprite: Sprite | null = null;
  private viewport: Viewport;
  private color: string;

  constructor(viewport: Viewport, color: string = DEFAULT_BACKGROUND_COLOR) {
    this.viewport = viewport;
    this.color = color;
    this.root = new Container();
    this.fill = new Graphics();
    this.root.addChild(this.fill);
    this.redrawFill();
  }

  /** 単色背景の色を設定する（hex 文字列、Pixi が CSS 色として解釈）。 */
  setColor(hex: string): void {
    this.color = hex;
    this.redrawFill();
  }

  /** ユーザー画像を cover-fit で表示する（sprite を生成/更新して前面に表示）。 */
  setImage(texture: Texture): void {
    if (!this.sprite) {
      const sprite = new Sprite();
      sprite.anchor.set(0.5);
      // fill より前面（addChild 順で奥→手前）。
      this.root.addChild(sprite);
      this.sprite = sprite;
    }
    this.sprite.texture = texture;
    this.sprite.visible = true;
    this.fitSprite();
  }

  /** ユーザー画像を隠して単色 fill を見せる（sprite は保持したまま非表示）。 */
  clearImage(): void {
    if (this.sprite) {
      this.sprite.visible = false;
    }
  }

  /** リサイズ追従: fill を描き直し、表示中の画像を再 cover-fit する。 */
  resize(viewport: Viewport): void {
    this.viewport = viewport;
    this.redrawFill();
    this.fitSprite();
  }

  /** 検証/デバッグ用の現在状態（cover-fit / resize 追従を eval で確認する）。 */
  debugInfo(): {
    color: string;
    imageVisible: boolean;
    viewport: Viewport;
    sprite: { width: number; height: number; x: number; y: number } | null;
  } {
    const s = this.sprite;
    const visible = s?.visible ?? false;
    return {
      color: this.color,
      imageVisible: visible,
      viewport: { width: this.viewport.width, height: this.viewport.height },
      sprite: s && visible ? { width: s.width, height: s.height, x: s.x, y: s.y } : null,
    };
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.sprite = null;
  }

  private redrawFill(): void {
    this.fill.clear();
    this.fill.rect(0, 0, this.viewport.width, this.viewport.height);
    this.fill.fill(this.color);
  }

  private fitSprite(): void {
    const sprite = this.sprite;
    if (!sprite?.visible) {
      return;
    }
    const tex = sprite.texture;
    const fit = computeCoverFit({ width: tex.width, height: tex.height }, this.viewport);
    sprite.scale.set(fit.scale);
    // anchor 0.5 なので中心に置くと自動で中央寄せ cover-fit になる。
    sprite.position.set(this.viewport.width / 2, this.viewport.height / 2);
  }
}
