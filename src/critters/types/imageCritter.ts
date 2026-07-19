import { CrossMovement } from "../../movement/CrossMovement";
import type { CritterType } from "../CritterType";

/**
 * ユーザー任意画像クリッターの固定種別 id（単一スロット。imageId は設定 customCritterImageId に持つ）。
 *
 * [UR3-10] main.ts（ライフサイクル）と manualTargets.ts（「操作するもの」候補）が共有する単一の真実源。
 * ここに置くことで settings→manualTargets→この定数 という一方向の import になり循環を避ける
 * （imageCritter.ts は movement / CritterType(type) のみに依存し、settings/manual を import しない）。
 */
export const CUSTOM_CRITTER_TYPE_ID = "custom";

/** 画像クリッターの既定表示サイズ(最大辺 px)。任意画像を程よい画面サイズに収める。 */
export const DEFAULT_IMAGE_CRITTER_BASE_SIZE = 200;

/**
 * createMovement（ManualMode 等で movement 未指定時のフォールバック）用の既定横断速度(px/秒)。
 * 実際のマウス操作モードでは FollowManualController が MouseFollowMovement で override するため、
 * この既定 movement は通常使われない（型上必須のフォールバック）。
 */
const FALLBACK_CROSS_SPEED = 220;

/**
 * ユーザー任意画像から画像ベースの CritterType をランタイム生成する。
 *
 * [UR3-10] 任意画像は **マウス操作モード専用**（動画モードには出さない）。そのため
 * createAutoSpawn を持たない＝AutoMode の spawn 対象になり得ない（型としての二重防御）。
 * マウス操作モードでは FollowManualController が 1 体だけカーソル追従させる。
 *
 * 任意画像は上下左右が不定なので **無回転が安全**:
 * - faceMode は既定 'flip'（水平反転のみ。上下は絶対に反転させない）。faceMode='rotate' は使わない。
 * - flipWithFacing=true で進行方向の左右反転は出すが、上下反転は起きない（ネズミ相当の見た目）。
 * - 尻尾なし・sway なし。
 *
 * 注意: image critter は **textureUrl を描画に使わない**。呼び出し側（FollowManualController）が
 * Assets 済みの bodyTexture を渡すため、この型の textureUrl は消費されない。よって objectURL を
 * 埋めず空文字プレースホルダを持たせる（objectURL の revoke は main.ts の保持変数のみが握る）。
 *
 * @param id レジストリ登録 id（単一スロットでは固定 {@link CUSTOM_CRITTER_TYPE_ID}）。
 * @param baseSize 表示時の最大辺(px)。既定 {@link DEFAULT_IMAGE_CRITTER_BASE_SIZE}。
 */
export function createImageCritterType(
  id: string,
  baseSize: number = DEFAULT_IMAGE_CRITTER_BASE_SIZE,
): CritterType {
  return {
    id,
    displayName: "カスタム画像",
    // 描画に使わない死値。objectURL を埋めない（revoke は main.ts 側の保持変数が担う）。
    textureUrl: "",
    baseSize,
    defaultFacing: 1,
    // 上下反転を絶対に起こさないため 'rotate' は使わず 'flip'（既定）＝水平反転のみ。
    faceMode: "flip",
    flipWithFacing: true,
    // FollowManualController は MouseFollowMovement で override するため通常は使わないが型上必須。
    createMovement: () => new CrossMovement({ vx: FALLBACK_CROSS_SPEED, vy: 0 }),
    // createAutoSpawn は持たない＝AutoMode の対象外（マウス操作モード専用）。
    sounds: {},
    hasTail: false,
  };
}
