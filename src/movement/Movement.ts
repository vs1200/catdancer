import type { Vec2 } from "../core/vec2";
import type { WorldBounds } from "../core/worldBounds";
import type { CritterState } from "../critters/CritterState";

/**
 * Movement に毎フレーム渡す文脈。将来 pointer 追従や複数 critter 相互作用のため拡張する。
 */
export interface MovementContext {
  /** 現在の world 領域（画面外バッファ込み）。 */
  world: WorldBounds;
  /** ポインタ位置（world 座標）。無ければ null。次タスクのマウス追従で使用。 */
  pointer: Vec2 | null;
  /**
   * critter の動き全体の速度倍率。Critter が dt に乗じる（未指定=1）。
   * movement 実装はこの値を読まない（透過）＝ Critter がスケール済み dt を渡すため、
   * 個別 movement を改変せず全 movement へ均一に効かせられる。倍率1のとき挙動は現状と同一。
   */
  speedScale?: number;
}

/**
 * 動きの戦略（Strategy）。state を in-place で更新する。
 * 実装は PixiJS 非依存の純ロジックにすること（テスト容易性）。
 */
export interface Movement {
  update(state: CritterState, dtSeconds: number, ctx: MovementContext): void;
}
