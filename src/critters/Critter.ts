import type { Texture } from "pixi.js";
import { Container, Sprite } from "pixi.js";
import type { Movement, MovementContext } from "../movement/Movement";
import type { CritterState } from "./CritterState";
import type { CritterSpawnOptions } from "./registry";
import { createCritterStateFromType, getCritterType } from "./registry";

/**
 * CritterState(純) と PixiJS 表示(Container + Sprite)を結ぶ実体。
 * update() で Movement を適用し、state を表示へ同期する（位置・左右反転）。
 * 尻尾(MeshRope)や反転演出は次タスクで view を拡張する（sprite を差し替える or 子を足す）。
 */
export class Critter {
  readonly state: CritterState;
  readonly view: Container;
  private readonly sprite: Sprite;
  private readonly movement: Movement;
  /** テクスチャ実寸から baseSize(最大辺) に合わせる基準スケール。 */
  private readonly baseScale: number;

  constructor(state: CritterState, texture: Texture, movement: Movement) {
    this.state = state;
    this.movement = movement;

    this.view = new Container();
    this.sprite = new Sprite(texture);
    this.sprite.anchor.set(0.5);

    const maxSide = Math.max(texture.width, texture.height) || 1;
    this.baseScale = state.size / maxSide;
    this.sprite.scale.set(this.baseScale);

    this.view.addChild(this.sprite);
    this.syncView();
  }

  update(dtSeconds: number, ctx: MovementContext): void {
    this.movement.update(this.state, dtSeconds, ctx);
    this.syncView();
  }

  /** state → 表示同期。位置反映と facing による左右反転(scale.x 符号)。 */
  private syncView(): void {
    this.view.position.set(this.state.position.x, this.state.position.y);
    this.sprite.scale.x = this.baseScale * this.state.facing;
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

/**
 * 種別 id から表示付き Critter を生成するファクトリ（PixiJS 依存）。
 * texture は呼び出し側が Assets.load 済みのものを渡す。
 */
export function createCritter(
  id: string,
  texture: Texture,
  options?: CritterSpawnOptions,
): Critter {
  const type = getCritterType(id);
  const state = createCritterStateFromType(id, options);
  return new Critter(state, texture, type.createMovement());
}
