import { CrossMovement, planCrossSpawn } from "../../movement/CrossMovement";
import type { CritterType } from "../CritterType";

/** 画像クリッターの既定表示サイズ(最大辺 px)。任意画像を程よい画面サイズに収める。 */
export const DEFAULT_IMAGE_CRITTER_BASE_SIZE = 200;

/**
 * createMovement（ManualMode 等で movement 未指定時のフォールバック）用の既定横断速度(px/秒)。
 * AutoMode は createAutoSpawn の plan（planCrossSpawn）を使うため通常この経路は通らない。
 */
const FALLBACK_CROSS_SPEED = 220;

/**
 * ユーザー任意画像から画像ベースの CritterType をランタイム生成する。
 *
 * 任意画像は上下左右が不定なので **無回転が安全**:
 * - faceMode は既定 'flip'（水平反転のみ。上下は絶対に反転させない）。faceMode='rotate' は使わない。
 * - flipWithFacing=true で横断の進行方向感（左右反転）は出すが、上下反転は起きない。
 * - 尻尾なし・sway なし。
 *
 * 動きは mouse と同様に画面外から横断し world 外へ抜ける（＝AutoMode が despawn する）:
 * - createAutoSpawn: planCrossSpawn(world, rng) → CrossMovement。
 * - createMovement: フォールバック（既定速度の CrossMovement）。
 *
 * 注意: image critter は **textureUrl を描画に使わない**。AutoMode は呼び出し側が Assets.load 済みで
 * addEntry に渡す bodyTexture を使うため、この型の textureUrl は消費されない。よって objectURL を
 * 埋めず空文字プレースホルダを持たせる（objectURL の revoke は main.ts の保持変数のみが握る）。
 *
 * @param id レジストリ登録 id（単一スロットでは固定 "custom"）。
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
    // Manual/フォールバックでは使わないが型上必須。既定速度で横断する。
    createMovement: () => new CrossMovement({ vx: FALLBACK_CROSS_SPEED, vy: 0 }),
    createAutoSpawn: (world, rng) => {
      const plan = planCrossSpawn(world, rng);
      return {
        position: plan.position,
        velocity: plan.velocity,
        facing: plan.facing,
        movement: new CrossMovement({
          vx: plan.velocity.x,
          vy: plan.velocity.y,
          wobbleAmp: plan.wobbleAmp,
          wobbleFreq: plan.wobbleFreq,
          phase: plan.phase,
        }),
      };
    },
    sounds: {},
    hasTail: false,
  };
}
