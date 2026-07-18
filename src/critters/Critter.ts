import type { Texture } from "pixi.js";
import { Container, Sprite } from "pixi.js";
import type { Movement, MovementContext } from "../movement/Movement";
import type { CritterState, Facing } from "./CritterState";
import type { FaceMode, SwayConfig, TailConfig } from "./CritterType";
import { type HeadingUpdateOptions, isMirroredHeading, updateHeading } from "./heading";
import { pivotOffsetPx } from "./pivot";
import type { CritterSpawnOptions } from "./registry";
import { createCritterStateFromType, getCritterType } from "./registry";
import type { RopeTail } from "./tail/RopeTail";
import { createRopeTail } from "./tail/RopeTail";

/** 尻尾の揺れ勢い(intensity)を 1 に飽和させる基準速度(px/秒)。 */
const TAIL_INTENSITY_REF_SPEED = 220;

/**
 * faceMode='rotate' の回頭パラメータ。
 * holdMinSpeed: これ以下の速さでは回頭せず向きを保つ（静止で回らない）。
 * smoothTime: 回頭の時定数。生き物らしく素早いが滑らかに旋回する値。
 */
const HEADING_UPDATE_OPTS: HeadingUpdateOptions = { holdMinSpeed: 6, smoothTime: 0.06 };

export interface CritterViewOptions {
  /** 素材の既定向き。反転式 scale.x = facing * defaultFacing に用いる。 */
  defaultFacing?: Facing;
  /** 尻尾設定。あれば MeshRope 尻尾を本体後方に付ける。 */
  tail?: TailConfig;
  /**
   * 尻尾テクスチャ（省略時は RopeTail が自前生成）。多数 spawn する AutoMode では
   * 共有テクスチャを渡してテクスチャの都度生成/リークを避ける。
   */
  tailTexture?: Texture;
  /** 回転 sway 設定。あれば pivot 周りに state.rotation を反映する（dangle 系）。 */
  sway?: SwayConfig;
  /** 進行方向で水平反転するか（省略/true=反転。dangle 系は false）。 */
  flipWithFacing?: boolean;
  /**
   * 向きの表現方式（省略時 'flip'）。'rotate' は速度の heading へ全方位回転する（ネズミ）。
   * 右向きテクスチャ前提で、sway とは併用しない。
   */
  faceMode?: FaceMode;
}

/**
 * CritterState(純) と PixiJS 表示(Container + Sprite + optional 尻尾)を結ぶ実体。
 * update() で Movement を適用し、state を表示へ同期する（位置・左右反転・尻尾アニメ）。
 *
 * 反転は Container の scale.x に集約する（尻尾など子要素を本体と一緒に反転させるため）:
 *   view.scale.x = facing * defaultFacing
 * facing===defaultFacing なら等倍、異なれば水平反転。sprite 自身は baseScale のまま。
 */
export class Critter {
  readonly state: CritterState;
  readonly view: Container;
  private readonly sprite: Sprite;
  private readonly movement: Movement;
  /** テクスチャ実寸から baseSize(最大辺) に合わせる基準スケール。 */
  private readonly baseScale: number;
  /** 素材の既定向き（反転式で使用）。 */
  private readonly defaultFacing: Facing;
  /** 進行方向で水平反転するか（dangle 系は false）。faceMode='rotate' では未使用。 */
  private readonly flipWithFacing: boolean;
  /** 向きの表現方式（'flip'=水平反転 / 'rotate'=全方位回転）。 */
  private readonly faceMode: FaceMode;
  /** 尻尾（無ければ null）。 */
  private readonly tail: RopeTail | null;
  /** 回転 sway 用の内側 Container（pivot を支点に回す。無ければ null）。 */
  private readonly swayContainer: Container | null;
  /** 起動からの経過秒（尻尾アニメの位相に使用）。 */
  private elapsedSeconds = 0;

  constructor(
    state: CritterState,
    texture: Texture,
    movement: Movement,
    options?: CritterViewOptions,
  ) {
    this.state = state;
    this.movement = movement;
    this.defaultFacing = options?.defaultFacing ?? 1;
    this.flipWithFacing = options?.flipWithFacing ?? true;
    this.faceMode = options?.faceMode ?? "flip";

    this.view = new Container();
    this.sprite = new Sprite(texture);
    this.sprite.anchor.set(0.5);

    const maxSide = Math.max(texture.width, texture.height) || 1;
    this.baseScale = state.size / maxSide;
    this.sprite.scale.set(this.baseScale);
    const displayWidth = texture.width * this.baseScale;
    const displayHeight = texture.height * this.baseScale;

    // 尻尾は本体の後方に垂れるため sprite より背面に置く（addChild 順で奥→手前）。
    if (options?.tail) {
      this.tail = createRopeTail(options.tail, displayWidth, displayHeight, options.tailTexture);
      this.view.addChild(this.tail.mesh);
    } else {
      this.tail = null;
    }

    // 回転 sway があれば、pivot を支点に回すため sprite を内側 Container で包む。
    // Container.pivot=position=pivotOffset とすると、その点は親座標で固定され、rotation は
    // その点周りに掛かる（＝支点を持って振る見え方）。sway 無しなら sprite を直接載せる。
    if (options?.sway) {
      const off = pivotOffsetPx(options.sway.pivot, displayWidth, displayHeight);
      this.swayContainer = new Container();
      this.swayContainer.pivot.set(off.x, off.y);
      this.swayContainer.position.set(off.x, off.y);
      this.swayContainer.addChild(this.sprite);
      this.view.addChild(this.swayContainer);
    } else {
      this.swayContainer = null;
      this.view.addChild(this.sprite);
    }

    this.syncView();
  }

  update(dtSeconds: number, ctx: MovementContext): void {
    this.movement.update(this.state, dtSeconds, ctx);
    this.elapsedSeconds += dtSeconds;

    // rotate 系は速度ベクトルから heading を平滑更新（静止時は保持＝くるくる回らない）。
    if (this.faceMode === "rotate") {
      this.state.heading = updateHeading(
        this.state.heading,
        this.state.velocity.x,
        this.state.velocity.y,
        dtSeconds,
        HEADING_UPDATE_OPTS,
      );
    }

    if (this.tail) {
      const speed = Math.hypot(this.state.velocity.x, this.state.velocity.y);
      const intensity = Math.min(speed / TAIL_INTENSITY_REF_SPEED, 1);
      this.tail.update(this.elapsedSeconds, intensity);
    }

    this.syncView();
  }

  /**
   * state → 表示同期。位置反映と向きの反映を行う。
   * - faceMode='rotate': view を heading へ回転し、左半分は鏡像反転(scale.y=-1)で上下を自然に保つ。
   *   view ごと回すため子（尻尾 MeshRope）も付け根を保ったまま本体回転に追従する。
   *   右向きテクスチャ前提のため scale.x は反転せず defaultFacing(=1) のまま（heading が全方位を表現）。
   * - faceMode='flip'（既定）: 回転せず facing*defaultFacing で水平反転のみ。sway があれば
   *   pivot 周りの回転(state.rotation)を内側 Container に反映する。
   */
  private syncView(): void {
    this.view.position.set(this.state.position.x, this.state.position.y);
    if (this.faceMode === "rotate") {
      this.view.rotation = this.state.heading;
      this.view.scale.set(this.defaultFacing, isMirroredHeading(this.state.heading) ? -1 : 1);
    } else {
      this.view.rotation = 0;
      this.view.scale.set(
        this.flipWithFacing ? this.state.facing * this.defaultFacing : this.defaultFacing,
        1,
      );
    }
    if (this.swayContainer) {
      this.swayContainer.rotation = this.state.rotation;
    }
  }

  /**
   * Critter を完全破棄する（リークなく解放）。
   * - view.destroy({children:true}) で Sprite・MeshRope（geometry/shader）を破棄する。
   *   texture 既定 false なので共有テクスチャ（本体/共有尻尾）は保持される。
   * - 尻尾が自前生成テクスチャを持つ場合のみ releaseTexture で追加解放する
   *   （mesh は上で破棄済みなので二重破棄しない）。
   */
  destroy(): void {
    this.view.destroy({ children: true });
    this.tail?.releaseTexture();
  }
}

/** {@link spawnCritter} のパラメータ。 */
export interface SpawnCritterParams {
  /** 種別 id（レジストリ登録済み）。 */
  typeId: string;
  /** 本体テクスチャ（呼び出し側が Assets.load 済みのものを渡す。複数体で共有する）。 */
  bodyTexture: Texture;
  /** 尻尾テクスチャ（省略時は自前生成）。多数 spawn では共有テクスチャを渡す。 */
  tailTexture?: Texture;
  /** Movement を差し替える（省略時は種別の既定 createMovement()）。 */
  movement?: Movement;
  /** 初期 state（位置/速度/向き/サイズ）。 */
  spawn?: CritterSpawnOptions;
}

/**
 * 種別 id から表示付き Critter を生成するファクトリ（PixiJS 依存）。
 *
 * Movement を差し替え可能にしてあるため、同じ種別を ManualMode（追従）と AutoMode（横断）で
 * 使い回せる。将来オブジェクト種別を足す際は typeId を変えるだけでよい（拡張点）。
 * defaultFacing・尻尾設定は種別定義から表示層へ橋渡しする。
 */
export function spawnCritter(params: SpawnCritterParams): Critter {
  const type = getCritterType(params.typeId);
  const state = createCritterStateFromType(params.typeId, params.spawn);
  const movement = params.movement ?? type.createMovement();
  return new Critter(state, params.bodyTexture, movement, {
    defaultFacing: type.defaultFacing,
    tail: type.hasTail ? type.tail : undefined,
    tailTexture: params.tailTexture,
    sway: type.sway,
    flipWithFacing: type.flipWithFacing,
    faceMode: type.faceMode,
  });
}
