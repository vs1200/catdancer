import { Container } from "pixi.js";
import type { Viewport, WorldBounds } from "../core/worldBounds";
import { createWorldBounds } from "../core/worldBounds";
import type { Critter } from "../critters/Critter";
import type { MovementContext } from "../movement/Movement";
import { BackgroundLayer } from "./BackgroundLayer";

/**
 * world margin(画面外バッファ)の fallback 値(px)。
 *
 * critter は中心座標で管理し表示は中心アンカー。中心が margin ぶん画面外へ出れば全パーツが
 * 隠れる、という前提で margin を決める。実運用の margin は登録済み種別の
 * hideRadius（本体＋尻尾先端の到達距離）から動的算出する（critters/worldMargin の
 * computeWorldMargin, main.ts で適用）。本定数は種別未登録時などの fallback として用いる。
 */
export const DEFAULT_WORLD_MARGIN = 220;

/**
 * 背景レイヤと critter レイヤ、および world 領域(画面外バッファ)を管理する。
 * root をステージに追加して使う。
 */
export class Scene {
  /** ステージへ追加するルート。 */
  readonly root: Container;
  /** 背景レイヤ Container（BackgroundLayer の描画物を格納。critter より背面）。 */
  readonly background: Container;
  /** critter レイヤ（前面）。 */
  readonly critters: Container;
  /** エフェクトレイヤ（最前面）。捕獲バースト等の短命な演出を置く。 */
  private readonly effectsLayer: Container;
  private readonly backgroundLayerValue: BackgroundLayer;
  private worldBoundsValue: WorldBounds;
  /**
   * アクティブな critter 集合（表示レイヤと並行して保持）。
   * spawn/despawn の単一の真実源。毎フレーム更新はこの配列を作り直さずに走査する。
   */
  private readonly active: Critter[] = [];

  constructor(viewport: Viewport, margin: number = DEFAULT_WORLD_MARGIN) {
    this.root = new Container();
    this.background = new Container();
    this.critters = new Container();
    this.effectsLayer = new Container();
    // 背景を奥、critter を前面、エフェクトを最前面に。
    this.root.addChild(this.background);
    this.root.addChild(this.critters);
    this.root.addChild(this.effectsLayer);
    // 背景描画（単色 fill + 任意画像）を background 内に構築する。
    this.backgroundLayerValue = new BackgroundLayer(viewport);
    this.background.addChild(this.backgroundLayerValue.root);
    this.worldBoundsValue = createWorldBounds(viewport, margin);
  }

  get worldBounds(): WorldBounds {
    return this.worldBoundsValue;
  }

  /**
   * エフェクトレイヤ（最前面）。捕獲バースト等の短命な演出の描画先。
   * transient なので resize 対象外（world 座標系で都度生成/破棄される）。
   */
  get effects(): Container {
    return this.effectsLayer;
  }

  /** 背景描画レイヤ（色/画像の適用は BackgroundController が駆動する）。 */
  get backgroundLayer(): BackgroundLayer {
    return this.backgroundLayerValue;
  }

  /**
   * リサイズ時に world 領域を作り直し、背景も再フィットする。
   * [UR4-1] margin を渡すと更新する（解像度非依存化で拡大した critter を隠せるよう resize で再計算した
   * 値を反映）。省略時は現在の margin を維持（後方互換）。
   */
  resize(viewport: Viewport, margin: number = this.worldBoundsValue.margin): void {
    this.worldBoundsValue = createWorldBounds(viewport, margin);
    this.backgroundLayerValue.resize(viewport);
  }

  /**
   * critter を追加する（表示レイヤへ + アクティブ集合へ登録）。
   * 尻尾（ワールド空間の MeshRope）は本体 view の背面になるよう先に addChild する。
   */
  add(critter: Critter): void {
    this.active.push(critter);
    const tail = critter.tailMesh;
    if (tail) {
      this.critters.addChild(tail);
    }
    this.critters.addChild(critter.view);
  }

  /** 指定 critter を despawn する（アクティブ集合/表示レイヤから外し、完全破棄）。 */
  despawn(critter: Critter): void {
    const i = this.active.indexOf(critter);
    if (i >= 0) {
      this.active.splice(i, 1);
    }
    this.removeFromLayer(critter);
    critter.destroy();
  }

  /** 全 critter を despawn する（モード切替時の後始末）。 */
  despawnAll(): void {
    for (let i = 0; i < this.active.length; i++) {
      const c = this.active[i];
      this.removeFromLayer(c);
      c.destroy();
    }
    this.active.length = 0;
  }

  /**
   * 述語に一致する critter を despawn する（後方走査で in-place 除去＝配列を作り直さない）。
   * pred は呼び出し側で 1 度だけ束縛したもの（毎フレームの new を避ける）を渡すこと。
   */
  despawnWhere(pred: (critter: Critter) => boolean): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const c = this.active[i];
      if (pred(c)) {
        this.active.splice(i, 1);
        this.removeFromLayer(c);
        c.destroy();
      }
    }
  }

  /** critter の本体 view と尻尾 mesh を表示レイヤから外す（destroy 前の後始末）。 */
  private removeFromLayer(critter: Critter): void {
    const tail = critter.tailMesh;
    if (tail) {
      this.critters.removeChild(tail);
    }
    this.critters.removeChild(critter.view);
  }

  /** アクティブ全 critter を更新する（配列を作り直さず index 走査）。 */
  updateAll(dtSeconds: number, ctx: MovementContext): void {
    for (let i = 0; i < this.active.length; i++) {
      this.active[i].update(dtSeconds, ctx);
    }
  }

  /** 現在のアクティブ critter 数（DEV フック・リーク検証で観測する）。 */
  get critterCount(): number {
    return this.active.length;
  }

  /** アクティブ critter の読み取り専用ビュー（走査用。改変しないこと）。 */
  get critterList(): readonly Critter[] {
    return this.active;
  }
}
