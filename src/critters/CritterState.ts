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
  /**
   * 回転 sway 角(rad)。pivot 周りの振り子揺れに用いる（dangle 系のみ非0）。
   * 表示側(Critter)が pivot を支点とした回転へ反映する。既定 0（走る/追従系は使わない）。
   */
  rotation: number;
  /**
   * 進行方向角(rad)。faceMode='rotate' の critter が全方位回転に用いる（速度の atan2(vy,vx) を
   * 最短経路で平滑補間した値）。表示側(Critter)が view.rotation と鏡像反転(scale.y)へ反映する。
   * facing（左右反転）とは独立: flip 系は facing、rotate 系は heading を使う。既定 0（右向き）。
   */
  heading: number;
}

export interface CritterStateInit {
  typeId: string;
  position: Vec2;
  velocity?: Vec2;
  facing?: Facing;
  size: number;
  /** 初期回転角(rad)。省略時 0。 */
  rotation?: number;
  /** 初期 heading(rad)。省略時は初速の向き→facing(左=π/右=0) から導く。 */
  heading?: number;
}

export function createCritterState(init: CritterStateInit): CritterState {
  const facing = init.facing ?? 1;
  const vx = init.velocity?.x ?? 0;
  const vy = init.velocity?.y ?? 0;
  const speed = Math.hypot(vx, vy);
  return {
    typeId: init.typeId,
    position: { x: init.position.x, y: init.position.y },
    velocity: init.velocity ? { x: init.velocity.x, y: init.velocity.y } : { x: 0, y: 0 },
    facing,
    size: init.size,
    rotation: init.rotation ?? 0,
    // spawn 直後に不要な回頭をしないよう、指定 > 初速の向き > facing(左=π/右=0) の順で決める。
    heading: init.heading ?? (speed > 1e-6 ? Math.atan2(vy, vx) : facing === -1 ? Math.PI : 0),
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
