import { BUZZ_LEVEL_DEFAULTS } from "../../audio/audioMath";
import { INSECT_BUZZ_ID } from "../../audio/sounds";
import {
  ERRATIC_SPAWN_DEFAULTS,
  ErraticMovement,
  type ErraticPlan,
  erraticEntryVelocity,
  planErraticSpawn,
} from "../../movement/ErraticMovement";
import type { CritterType } from "../CritterType";
import { registerCritterType } from "../registry";

export const INSECT_TYPE_ID = "insect";

// Vite は base:"./" 環境。絶対 /assets ではなく BASE_URL 基点で解決する。
const INSECT_TEXTURE_URL = `${import.meta.env.BASE_URL}assets/critters/insect.webp`;

/** 表示時の最大辺(px)。小さな虫らしく小さめ。 */
const INSECT_BASE_SIZE = 56;

/**
 * createMovement（ManualMode 等で movement 未指定時のフォールバック）用の、その場で微動する計画。
 * AutoMode は createAutoSpawn の plan を使うため、通常この経路は通らない（安全側の既定）。
 */
function inPlaceErraticPlan(): ErraticPlan {
  return {
    enter: { x: 0, y: 0 },
    waypoints: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
    exit: { x: 0, y: 0 },
    entrySec: 0.3,
    dashSec: 0.3,
    pauseSec: 0.3,
    exitSec: 0.3,
    jitterAmp: 0,
    jitterFreq: 0,
    jitterPhase: 0,
    facing: 1,
  };
}

/**
 * 虫種別。元画像は右向き(defaultFacing=1)＝頭が +x。faceMode='rotate' でダッシュ方向へ回頭する。
 * 尻尾なし・sway なし。素早い不規則ダッシュ(ErraticMovement)で猫の狩猟本能を刺激する。
 * SE は羽音(buzz)のみ（鳴き声 voice なし）＝飛翔速度に連動して「ブーン」と鳴る。
 */
export const insectType: CritterType = {
  id: INSECT_TYPE_ID,
  displayName: "虫",
  textureUrl: INSECT_TEXTURE_URL,
  baseSize: INSECT_BASE_SIZE,
  defaultFacing: 1,
  // Manual では使わないが型上必須。その場で微動するフォールバック。
  createMovement: () => new ErraticMovement(inPlaceErraticPlan()),
  // ダッシュ方向へ360度回頭（右向きテクスチャ前提。左半分は鏡像で上下を自然に保つ）。
  faceMode: "rotate",
  createAutoSpawn: (world, rng) => {
    const plan = planErraticSpawn(world, rng, ERRATIC_SPAWN_DEFAULTS, INSECT_BASE_SIZE);
    return {
      // 進入辺（world 端）から開始し、ErraticMovement が視界内へダッシュさせる。
      position: plan.enter,
      // 進入方向を初速に与え、spawn 直後の heading を進行方向へ向ける。
      velocity: erraticEntryVelocity(plan),
      facing: plan.facing,
      movement: new ErraticMovement(plan),
    };
  },
  // 羽音のみ（voice=鳴き声なし, move=速度連動の羽音ループ）。虫向けの速度写像で早く飽和させる。
  sounds: { move: INSECT_BUZZ_ID },
  moveLevel: BUZZ_LEVEL_DEFAULTS,
  hasTail: false,
};

/** 虫種別をレジストリへ登録する。 */
export function registerInsectType(): void {
  registerCritterType(insectType);
}
