import type { DangleSpawnRange } from "../../movement/DangleMovement";
import type { CritterType } from "../CritterType";
import { registerCritterType } from "../registry";
import { makeDangleType } from "./dangleType";

export const TOYS_TYPE_ID = "toys";

/**
 * 羽根のおもちゃの揺れレンジ。「羽根側がしなる」＝回転 sway 中心（位置バウンドは控えめ）。
 * 柄=左/羽根=右なので pivot は柄の端＝左寄り。素早く大きめに振れて羽根側が跳ねる見え方。
 */
const TOYS_RANGE: DangleSpawnRange = {
  entrySecMin: 0.6,
  entrySecMax: 1.0,
  holdSecMin: 3.0,
  holdSecMax: 5.0,
  exitSecMin: 0.6,
  exitSecMax: 1.0,
  swayAmpMin: 0.55,
  swayAmpMax: 0.85,
  swayFreqMin: 5.0,
  swayFreqMax: 7.5,
  bobAmpMin: 8,
  bobAmpMax: 20,
  bobFreqMin: 3.0,
  bobFreqMax: 5.0,
  holdInsetFrac: 0.24,
};

/**
 * おもちゃ種別。尻尾なし・回転 sway が主・水平反転なし（makeDangleType）。
 * pivot は柄の端(左寄り)。実測はスクショで微調整する。
 */
export const toysType: CritterType = makeDangleType({
  id: TOYS_TYPE_ID,
  displayName: "おもちゃ",
  textureFile: "toys.webp",
  baseSize: 340,
  pivot: { x: 0.06, y: 0.5 },
  range: TOYS_RANGE,
});

/** おもちゃ種別をレジストリへ登録する。 */
export function registerToysType(): void {
  registerCritterType(toysType);
}
