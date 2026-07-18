import type { AudioManager } from "./AudioManager";
import { makeSqueakParams } from "./audioMath";
import { createScurryVoice, playSqueak } from "./synth";

/**
 * SE カタログ。CritterType.sounds が参照する SE id と、その合成ビルダを AudioManager へ登録する。
 * 将来 CC0 音源に差し替える場合は、同じ id で buffer 版ビルダを登録し直すだけでよい。
 */

/** ネズミの鳴き声（チューチュー）ワンショットSE id。 */
export const MOUSE_SQUEAK_ID = "mouse-squeak";
/** ネズミの走行音（scurry）ループSE id。 */
export const MOUSE_SCURRY_ID = "mouse-scurry";

/** 合成SEを AudioManager のバンクへ登録する。main の起動時に一度呼ぶ。 */
export function registerCritterSounds(audio: AudioManager): void {
  // 鳴くたびに音程/長さを揺らして単調さを避ける。
  audio.registerOneShot(MOUSE_SQUEAK_ID, (engine) => {
    playSqueak(engine, makeSqueakParams());
  });
  audio.registerLoop(MOUSE_SCURRY_ID, (engine) => createScurryVoice(engine));
}
