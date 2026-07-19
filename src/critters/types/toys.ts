import type { DangleSpawnRange } from "../../movement/DangleMovement";
import type { WiggleConfig } from "../../movement/wiggle";
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
 * [UR3-6] マウス操作モードでクリックしたときのフリフリ（一時的な回転 sway）設定。
 * 動画モードの dangle 回転 sway（{@link TOYS_RANGE}）の swayAmp/swayFreq 中央値に揃えて体感を統一し、
 * クリック（インパルス）から短時間で減衰させる（追従は止めない）。角度は wiggleAngleAt の純関数で決まる。
 */
const TOYS_WIGGLE: WiggleConfig = {
  amp: (TOYS_RANGE.swayAmpMin + TOYS_RANGE.swayAmpMax) / 2, // = 0.70 rad
  freq: (TOYS_RANGE.swayFreqMin + TOYS_RANGE.swayFreqMax) / 2, // = 6.25 rad/s
  durationSec: 0.8,
};

/**
 * おもちゃ種別。尻尾なし・回転 sway が主・水平反転なし（makeDangleType）。
 * pivot は柄の端(左寄り)。実測はスクショで微調整する。
 * [UR3-6] 表示サイズを約2倍(340→680)に拡大し、マウス操作モードのクリックでフリフリ(clickWiggle)する。
 */
export const toysType: CritterType = makeDangleType({
  id: TOYS_TYPE_ID,
  displayName: "おもちゃ",
  textureFile: "toys.webp",
  baseSize: 680,
  pivot: { x: 0.06, y: 0.5 },
  range: TOYS_RANGE,
  clickWiggle: TOYS_WIGGLE,
});

/** おもちゃ種別をレジストリへ登録する。 */
export function registerToysType(): void {
  registerCritterType(toysType);
}
