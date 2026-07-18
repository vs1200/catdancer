import type { Vec2 } from "../core/vec2";
import type { CritterState } from "../critters/CritterState";
import { applyMovement, updateFacingFromVelocity } from "../critters/CritterState";
import type { Movement, MovementContext } from "./Movement";

export interface DriftMovementOptions {
  /** 初速 (px/秒)。state.velocity が未設定(0)のときにのみ適用する。 */
  velocity?: Vec2;
}

/**
 * デモ用プレースホルダの動き。一定速度で進み、world 端で跳ね返る（速度を反転）。
 * world は画面外バッファを含むため、跳ね返り前に完全に画面外へ隠れる挙動が出る。
 * 本命のマウス追従は次タスクで別 Movement として実装する。
 */
export class DriftMovement implements Movement {
  private readonly initialVelocity: Vec2;

  constructor(options?: DriftMovementOptions) {
    // 既定はゆるやかに右下へ流れる程度（px/秒）。
    this.initialVelocity = options?.velocity ?? { x: 60, y: 24 };
  }

  update(state: CritterState, dtSeconds: number, ctx: MovementContext): void {
    // 速度未設定なら初速を与える（demo が必ず動くように）。
    if (state.velocity.x === 0 && state.velocity.y === 0) {
      state.velocity = { x: this.initialVelocity.x, y: this.initialVelocity.y };
    }

    applyMovement(state, dtSeconds);

    // world 端での跳ね返り: はみ出したら端にクランプし、その軸の速度を内向きに反転。
    const { world } = ctx;
    if (state.position.x <= world.minX) {
      state.position.x = world.minX;
      state.velocity.x = Math.abs(state.velocity.x);
    } else if (state.position.x >= world.maxX) {
      state.position.x = world.maxX;
      state.velocity.x = -Math.abs(state.velocity.x);
    }
    if (state.position.y <= world.minY) {
      state.position.y = world.minY;
      state.velocity.y = Math.abs(state.velocity.y);
    } else if (state.position.y >= world.maxY) {
      state.position.y = world.maxY;
      state.velocity.y = -Math.abs(state.velocity.y);
    }

    // 反転後の進行方向で向きを更新。
    updateFacingFromVelocity(state);
  }
}
