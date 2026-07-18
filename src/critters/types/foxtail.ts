import type { DangleSpawnRange } from "../../movement/DangleMovement";
import type { CritterType } from "../CritterType";
import { registerCritterType } from "../registry";
import { makeDangleType } from "./dangleType";

export const FOXTAIL_TYPE_ID = "foxtail";

/**
 * 猫じゃらし(エノコログサ)の揺れレンジ。「全体が大きく揺れる」を強めに。
 * 斜め構図（穂=右上/茎=左下）なので pivot は茎の根元＝左下寄り。振り子のように大きく振れて
 * 穂先が大きく動く。位置バウンドも強め（手で振っている見え方）。
 */
const FOXTAIL_RANGE: DangleSpawnRange = {
  entrySecMin: 0.7,
  entrySecMax: 1.1,
  holdSecMin: 3.0,
  holdSecMax: 5.0,
  exitSecMin: 0.7,
  exitSecMax: 1.1,
  swayAmpMin: 0.45,
  swayAmpMax: 0.7,
  swayFreqMin: 3.5,
  swayFreqMax: 5.5,
  bobAmpMin: 30,
  bobAmpMax: 60,
  bobFreqMin: 2.5,
  bobFreqMax: 4.5,
  holdInsetFrac: 0.24,
};

/**
 * 猫じゃらし種別。尻尾なし・回転 sway が主・水平反転なし（makeDangleType）。
 * pivot は茎の根元(左下寄り)。実測はスクショで微調整する。
 */
export const foxtailType: CritterType = makeDangleType({
  id: FOXTAIL_TYPE_ID,
  displayName: "猫じゃらし",
  textureFile: "foxtail.webp",
  baseSize: 360,
  pivot: { x: 0.14, y: 0.85 },
  range: FOXTAIL_RANGE,
});

/** 猫じゃらし種別をレジストリへ登録する。 */
export function registerFoxtailType(): void {
  registerCritterType(foxtailType);
}
