import { Container } from "pixi.js";
import type { Viewport, WorldBounds } from "../core/worldBounds";
import { createWorldBounds } from "../core/worldBounds";
import type { Critter } from "../critters/Critter";

/**
 * world margin(画面外バッファ)の既定値(px)。
 *
 * 根拠: critter は中心座標で管理し表示は中心アンカー。最大 critter の表示最大辺は
 * 現状ネズミの baseSize=160px（将来オブジェクト追加で増える）。中心が margin ぶん
 * 画面外へ出れば最大辺の半分(80px)を優に超えて隠れられるよう、余裕を持たせて 220px とする。
 * 斜め出入りや今後の大きめオブジェクト(猫じゃらし等)も見据えた値。
 * 将来は登録済み種別の最大 baseSize から動的算出できる（registry.listCritterTypes 参照）。
 */
export const DEFAULT_WORLD_MARGIN = 220;

/**
 * 背景レイヤと critter レイヤ、および world 領域(画面外バッファ)を管理する。
 * root をステージに追加して使う。
 */
export class Scene {
  /** ステージへ追加するルート。 */
  readonly root: Container;
  /** 背景レイヤ（当面単色運用のため空。背景画像/Graphics は後続タスク）。 */
  readonly background: Container;
  /** critter レイヤ（前面）。 */
  readonly critters: Container;
  private worldBoundsValue: WorldBounds;

  constructor(viewport: Viewport, margin: number = DEFAULT_WORLD_MARGIN) {
    this.root = new Container();
    this.background = new Container();
    this.critters = new Container();
    // 背景を奥、critter を前面に。
    this.root.addChild(this.background);
    this.root.addChild(this.critters);
    this.worldBoundsValue = createWorldBounds(viewport, margin);
  }

  get worldBounds(): WorldBounds {
    return this.worldBoundsValue;
  }

  /** リサイズ時に world 領域を作り直す（margin は維持）。 */
  resize(viewport: Viewport): void {
    this.worldBoundsValue = createWorldBounds(viewport, this.worldBoundsValue.margin);
  }

  add(critter: Critter): void {
    this.critters.addChild(critter.view);
  }

  remove(critter: Critter): void {
    this.critters.removeChild(critter.view);
  }
}
