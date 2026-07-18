import type { AudioManager } from "./AudioManager";
import { makeSqueakParams } from "./audioMath";
import { createBuzzVoice, createScurryVoice, playCatch, playSqueak } from "./synth";

/**
 * SE カタログ。CritterType.sounds が参照する SE id と、その合成ビルダを AudioManager へ登録する。
 * 将来 CC0 音源に差し替える場合は、同じ id で buffer 版ビルダを登録し直すだけでよい。
 */

/** ネズミの鳴き声（チューチュー）ワンショットSE id。 */
export const MOUSE_SQUEAK_ID = "mouse-squeak";
/** ネズミの走行音（scurry）ループSE id。 */
export const MOUSE_SCURRY_ID = "mouse-scurry";
/** 虫の羽音（buzz）ループSE id。 */
export const INSECT_BUZZ_ID = "insect-buzz";
/** 汎用「キャッチ」ワンショットSE id（voice を持たない種別の捕獲フィードバック用）。 */
export const CATCH_ID = "catch";

/** 合成SEを AudioManager のバンクへ登録する。main の起動時に一度呼ぶ。 */
export function registerCritterSounds(audio: AudioManager): void {
  // 鳴くたびに音程/長さを揺らして単調さを避ける。
  audio.registerOneShot(MOUSE_SQUEAK_ID, (engine) => {
    playSqueak(engine, makeSqueakParams());
  });
  audio.registerLoop(MOUSE_SCURRY_ID, (engine) => createScurryVoice(engine));
  audio.registerLoop(INSECT_BUZZ_ID, (engine) => createBuzzVoice(engine));
  // voice を持たない種別（虫/猫じゃらし/おもちゃ/カスタム）の捕獲フィードバック用の汎用SE。
  audio.registerOneShot(CATCH_ID, (engine) => playCatch(engine));
}
