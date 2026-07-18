import type { Vec2 } from "../core/vec2";

/** 向き。1=右向き(既定) / -1=左向き。左右反転は表示側で scale.x の符号に反映する。 */
export type Facing = 1 | -1;

/**
 * critter の純データ（PixiJS 非依存）。表示は Critter 側が本 state を参照して同期する。
 */
export interface CritterState {
  /** 種別レジストリ上の id（例: "mouse"）。 */
  typeId: string;
  /** world 座標系の位置（中心基準）。 */
  position: Vec2;
  /** 速度 (px/秒)。 */
  velocity: Vec2;
  /** 向き。 */
  facing: Facing;
  /** 表示時の最大辺(px)目安。margin 算出やスケールの基準。 */
  size: number;
}

export interface CritterStateInit {
  typeId: string;
  position: Vec2;
  velocity?: Vec2;
  facing?: Facing;
  size: number;
}

export function createCritterState(init: CritterStateInit): CritterState {
  return {
    typeId: init.typeId,
    position: { x: init.position.x, y: init.position.y },
    velocity: init.velocity ? { x: init.velocity.x, y: init.velocity.y } : { x: 0, y: 0 },
    facing: init.facing ?? 1,
    size: init.size,
  };
}

/**
 * 速度で位置を積分する（in-place）。dtSeconds は経過秒。
 */
export function applyMovement(state: CritterState, dtSeconds: number): void {
  state.position.x += state.velocity.x * dtSeconds;
  state.position.y += state.velocity.y * dtSeconds;
}

/**
 * 進行方向(velocity.x)の符号で向きを更新（in-place）。
 * x=0 のときは現状維持（真上/真下移動で向きがちらつかないように）。
 */
export function updateFacingFromVelocity(state: CritterState): void {
  if (state.velocity.x > 0) {
    state.facing = 1;
  } else if (state.velocity.x < 0) {
    state.facing = -1;
  }
}
