import type { Texture } from "pixi.js";
import { Container, Sprite } from "pixi.js";
import type { Movement, MovementContext } from "../movement/Movement";
import type { CritterState, Facing } from "./CritterState";
import type { TailConfig } from "./CritterType";
import type { CritterSpawnOptions } from "./registry";
import { createCritterStateFromType, getCritterType } from "./registry";
import type { RopeTail } from "./tail/RopeTail";
import { createRopeTail } from "./tail/RopeTail";

/** 尻尾の揺れ勢い(intensity)を 1 に飽和させる基準速度(px/秒)。 */
const TAIL_INTENSITY_REF_SPEED = 220;

export interface CritterViewOptions {
  /** 素材の既定向き。反転式 scale.x = facing * defaultFacing に用いる。 */
  defaultFacing?: Facing;
  /** 尻尾設定。あれば MeshRope 尻尾を本体後方に付ける。 */
  tail?: TailConfig;
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
  /** 尻尾（無ければ null）。 */
  private readonly tail: RopeTail | null;
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

    this.view = new Container();
    this.sprite = new Sprite(texture);
    this.sprite.anchor.set(0.5);

    const maxSide = Math.max(texture.width, texture.height) || 1;
    this.baseScale = state.size / maxSide;
    this.sprite.scale.set(this.baseScale);

    // 尻尾は本体の後方に垂れるため sprite より背面に置く（addChild 順で奥→手前）。
    if (options?.tail) {
      const displayWidth = texture.width * this.baseScale;
      const displayHeight = texture.height * this.baseScale;
      this.tail = createRopeTail(options.tail, displayWidth, displayHeight);
      this.view.addChild(this.tail.mesh);
    } else {
      this.tail = null;
    }

    this.view.addChild(this.sprite);
    this.syncView();
  }

  update(dtSeconds: number, ctx: MovementContext): void {
    this.movement.update(this.state, dtSeconds, ctx);
    this.elapsedSeconds += dtSeconds;

    if (this.tail) {
      const speed = Math.hypot(this.state.velocity.x, this.state.velocity.y);
      const intensity = Math.min(speed / TAIL_INTENSITY_REF_SPEED, 1);
      this.tail.update(this.elapsedSeconds, intensity);
    }

    this.syncView();
  }

  /** state → 表示同期。位置反映と facing*defaultFacing による Container 左右反転。 */
  private syncView(): void {
    this.view.position.set(this.state.position.x, this.state.position.y);
    this.view.scale.x = this.state.facing * this.defaultFacing;
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

/**
 * 種別 id から表示付き Critter を生成するファクトリ（PixiJS 依存）。
 * texture は呼び出し側が Assets.load 済みのものを渡す。
 * defaultFacing と尻尾設定は種別定義から表示層へ橋渡しする。
 */
export function createCritter(
  id: string,
  texture: Texture,
  options?: CritterSpawnOptions,
): Critter {
  const type = getCritterType(id);
  const state = createCritterStateFromType(id, options);
  return new Critter(state, texture, type.createMovement(), {
    defaultFacing: type.defaultFacing,
    tail: type.hasTail ? type.tail : undefined,
  });
}
