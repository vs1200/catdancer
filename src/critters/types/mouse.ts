import { MOUSE_SCURRY_ID, MOUSE_SQUEAK_ID } from "../../audio/sounds";
import { CrossMovement, planCrossSpawn } from "../../movement/CrossMovement";
import { MouseFollowMovement } from "../../movement/MouseFollowMovement";
import type { CritterType } from "../CritterType";
import { registerCritterType } from "../registry";

export const MOUSE_TYPE_ID = "mouse";

// Vite は base:"./" 環境。絶対 /assets ではなく BASE_URL 基点で解決する。
const MOUSE_TEXTURE_URL = `${import.meta.env.BASE_URL}assets/critters/mouse-body.webp`;

/**
 * 尻尾テクスチャ（元 house-mouse から抽出した本物。左=根元(attach) / 右=先端）。共有ロードする。
 * リボン幅は PixiJS MeshRope の仕様上「テクスチャの縦(px)」で決まる（widthScale は効かない。詳細は
 * RopeTail.ts）。UR-2 で元画像のように細くするため 541x90 → 541x30 に縦圧縮（縦パディング trim + 縦 30px
 * へ縮小）して差し替え済み。太さを変える場合はこの webp の縦 px を調整する。
 */
export const MOUSE_TAIL_TEXTURE_URL = `${import.meta.env.BASE_URL}assets/critters/mouse-tail.webp`;

/**
 * ネズミ種別。元画像は右向き(defaultFacing=1)。本体幅 ~220px。
 * 尻尾は本物テクスチャ(mouse-tail.webp)＋ワールド空間の物理トレイル（hasTail=true, tail 設定参照）。
 * SE 識別子はプレースホルダ。
 *
 * tail: 付け根は本体後方下 (x≈0.06, y≈0.83)。lengthFactor は表示幅に対する係数。damping で尾の引き具合、
 * constraintIterations で張り、gravity=0 で純トレイル（静止で止まる）。太さ(widthScale)は MeshRope 仕様で
 * 無効化される（実幅=テクスチャ縦px）ため、細さはテクスチャ側で調整する（MOUSE_TAIL_TEXTURE_URL 参照）。
 */
export const mouseType: CritterType = {
  id: MOUSE_TYPE_ID,
  displayName: "ネズミ",
  textureUrl: MOUSE_TEXTURE_URL,
  baseSize: 220,
  defaultFacing: 1,
  // v1 マウス操作モードの既定。ポインタへ慣性追従＋画面外バッファで出現/消失する。
  createMovement: () => new MouseFollowMovement(),
  // 進行方向へ360度回頭（左半分は鏡像反転で上下を自然に保つ）。右向きテクスチャ前提。
  faceMode: "rotate",
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
    lengthFactor: 0.9,
    widthScale: 1.0,
    pointCount: 18,
    damping: 0.82,
    constraintIterations: 16,
    gravity: 0,
  },
};

/** ネズミ種別をレジストリへ登録する。 */
export function registerMouseType(): void {
  registerCritterType(mouseType);
}
