import {
  DangleMovement,
  type DanglePlan,
  type DangleSpawnRange,
  planDangleSpawn,
} from "../../movement/DangleMovement";
import type { WiggleConfig } from "../../movement/wiggle";
import type { CritterSoundSet, CritterType, SwayConfig } from "../CritterType";

/**
 * dangle 系（猫じゃらし/おもちゃ）の CritterType を組み立てる共有ファクトリ。
 * 新しい「振って猫を誘う」オブジェクトは、このファクトリに pivot と揺れレンジを渡すだけで足せる
 * （尻尾なし・水平反転なし・回転 sway が主）。
 */
export interface DangleTypeConfig {
  id: string;
  displayName: string;
  /** public/assets/critters/ 配下のファイル名（例: "foxtail.webp"）。 */
  textureFile: string;
  /** 表示時の最大辺(px)目安。 */
  baseSize: number;
  /** 回転の支点（本体テクスチャ正規化座標 0..1）。 */
  pivot: SwayConfig["pivot"];
  /** 揺れ/出入りのレンジ。 */
  range: DangleSpawnRange;
  /** SE セット（当面は空＝AutoMode 側の共有SEを流用）。 */
  sounds?: CritterSoundSet;
  /** [UR3-6] マウス操作モードのクリックで起こす一時的なフリフリ設定（省略時はフリフリしない）。 */
  clickWiggle?: WiggleConfig;
}

/**
 * createMovement（ManualMode 等で movement 未指定時のフォールバック）用の、その場で揺れる計画。
 * AutoMode は createAutoSpawn の plan を使うため、通常この経路は通らない（安全側の既定）。
 */
function inPlacePlan(range: DangleSpawnRange): DanglePlan {
  return {
    edge: "left",
    enter: { x: 0, y: 0 },
    hold: { x: 0, y: 0 },
    exit: { x: 0, y: 0 },
    entrySec: range.entrySecMax,
    holdSec: range.holdSecMax,
    exitSec: range.exitSecMax,
    swayAmp: (range.swayAmpMin + range.swayAmpMax) / 2,
    swayFreq: (range.swayFreqMin + range.swayFreqMax) / 2,
    swayPhase: 0,
    bobAmp: 0,
    bobFreq: 0,
    bobPhase: 0,
    facing: 1,
  };
}

export function makeDangleType(config: DangleTypeConfig): CritterType {
  // Vite は base:"./" 環境。絶対 /assets ではなく BASE_URL 基点で解決する。
  const textureUrl = `${import.meta.env.BASE_URL}assets/critters/${config.textureFile}`;
  return {
    id: config.id,
    displayName: config.displayName,
    textureUrl,
    baseSize: config.baseSize,
    defaultFacing: 1,
    createMovement: () => new DangleMovement(inPlacePlan(config.range)),
    createAutoSpawn: (world, rng) => {
      const plan = planDangleSpawn(world, rng, config.range, config.baseSize);
      return {
        // 進入辺（world 端）から開始し、DangleMovement が hold へ引き込む。
        position: plan.enter,
        velocity: { x: 0, y: 0 },
        facing: plan.facing,
        movement: new DangleMovement(plan),
      };
    },
    sounds: config.sounds ?? {},
    hasTail: false,
    sway: { pivot: config.pivot },
    // dangle 系は回転 sway が主。進行方向での水平反転は強制しない。
    flipWithFacing: false,
    // クリックのフリフリは種別が明示したものだけ有効（foxtail 等は undefined＝無効）。
    clickWiggle: config.clickWiggle,
  };
}
