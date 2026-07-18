import type { Movement } from "../movement/Movement";
import type { Facing } from "./CritterState";

/**
 * オブジェクトに紐づく SE 識別子（プレースホルダ）。
 * 実際の解決は後続タスクの AudioManager が担う。
 */
export interface CritterSoundSet {
  /** 待機時のループSE識別子。 */
  idle?: string;
  /** 移動時のSE識別子。 */
  move?: string;
}

/**
 * 種別定義。新オブジェクトは「この型を1つ定義 + アセット」で追加できる。
 */
export interface CritterType {
  /** 一意な種別 id（例: "mouse"）。 */
  readonly id: string;
  /** 人間向け表示名。 */
  readonly displayName: string;
  /** テクスチャ URL（BASE_URL 基点で解決済みの文字列）。 */
  readonly textureUrl: string;
  /** 表示時の最大辺(px)目安。 */
  readonly baseSize: number;
  /** 既定の向き（元画像の向き）。 */
  readonly defaultFacing: Facing;
  /** この種別の既定 Movement を生成する。critter ごとに独立インスタンスを持てるよう関数で渡す。 */
  readonly createMovement: () => Movement;
  /** SE セット（プレースホルダ）。 */
  readonly sounds: CritterSoundSet;
  /** 尻尾(MeshRope)など特殊描画が必要か。尻尾実装は次タスク。 */
  readonly hasTail: boolean;
}
