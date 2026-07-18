import { MOUSE_SCURRY_ID, MOUSE_SQUEAK_ID } from "../../audio/sounds";
import { CrossMovement, planCrossSpawn } from "../../movement/CrossMovement";
import { MouseFollowMovement } from "../../movement/MouseFollowMovement";
import type { CritterType } from "../CritterType";
import { registerCritterType } from "../registry";

export const MOUSE_TYPE_ID = "mouse";

// Vite は base:"./" 環境。絶対 /assets ではなく BASE_URL 基点で解決する。
const MOUSE_TEXTURE_URL = `${import.meta.env.BASE_URL}assets/critters/mouse-body.webp`;

/**
 * ネズミ種別。元画像は右向き(defaultFacing=1)。本体幅 ~220px。
 * 尻尾は MeshRope で手続き生成（hasTail=true, tail 設定参照）。SE 識別子はプレースホルダ。
 *
 * tail: 付け根は本体後方下 (x≈0.06, y≈0.83)。各 *Factor は表示幅(=baseSize)に対する比率。
 * 尻尾は本体幅とほぼ同長で細く、先端が大きく揺れる。値はスクショで微調整済み。
 */
export const mouseType: CritterType = {
  id: MOUSE_TYPE_ID,
  displayName: "ネズミ",
  textureUrl: MOUSE_TEXTURE_URL,
  baseSize: 220,
  defaultFacing: 1,
  // v1 マウス操作モードの既定。ポインタへ慣性追従＋画面外バッファで出現/消失する。
  createMovement: () => new MouseFollowMovement(),
  // AutoMode では左右いずれかの端から横断する（CrossMovement）。進行方向で水平反転する。
  flipWithFacing: true,
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
  sounds: { voice: MOUSE_SQUEAK_ID, move: MOUSE_SCURRY_ID },
  hasTail: true,
  tail: {
    attach: { x: 0.06, y: 0.83 },
    lengthFactor: 0.95,
    thicknessFactor: 0.075,
    amplitudeFactor: 0.11,
    sagFactor: 0.1,
    pointCount: 20,
    waveCount: 1.1,
    speed: 6.0,
    amplitudeExponent: 1.6,
  },
};

/** ネズミ種別をレジストリへ登録する。 */
export function registerMouseType(): void {
  registerCritterType(mouseType);
}
