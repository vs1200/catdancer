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
  // [UR-3] ネズミの走行音/鳴き声はこの合成登録をフォールバックとして残しつつ、loadCritterSamples が
  // 同 id で実録サンプルを登録すると playOneShot/createLoop がそちらを優先する（ロード失敗時は合成のまま）。
  // [UR4-4] 発火位置の pan を one-shot ビルダへ転送し、発音元の x で左右定位する（音 id は不変）。
  audio.registerOneShot(MOUSE_SQUEAK_ID, (engine, pan) => {
    playSqueak(engine, makeSqueakParams(), pan);
  });
  audio.registerLoop(MOUSE_SCURRY_ID, (engine) => createScurryVoice(engine));
  audio.registerLoop(INSECT_BUZZ_ID, (engine) => createBuzzVoice(engine));
  // voice を持たない種別（虫/猫じゃらし/おもちゃ/カスタム）の捕獲フィードバック用の汎用SE。
  audio.registerOneShot(CATCH_ID, (engine, pan) => playCatch(engine, pan));
}

/**
 * [UR-3] ネズミの走行音サンプル（run）ファイル名。走行ループの周回ごとにこの 3 種からランダム選択する。
 * public/assets/audio/ に配置（元は .workbench の 44.1kHz/16bit ステレオをモノラル化したコピー）。
 */
const MOUSE_SCURRY_SAMPLE_FILES = ["se_run_1.wav", "se_run_2.wav", "se_run_3.wav"] as const;
/** [UR-3] ネズミの鳴き声サンプル（squeak）ファイル名。発火のたびこの 3 種からランダム選択する。 */
const MOUSE_SQUEAK_SAMPLE_FILES = [
  "se_squeak_1_chuchu.wav",
  "se_squeak_2_single.wav",
  "se_squeak_3_short.wav",
] as const;

/** public/assets/audio/ 配下の SE を BASE_URL 基点で解決する（Vite は base:"./" のサブパス配信対応）。 */
function audioAssetUrl(file: string): string {
  return `${import.meta.env.BASE_URL}assets/audio/${file}`;
}

/**
 * 指定ファイル群を fetch → decode して AudioBuffer 配列にする。個々の失敗はスキップし成功分だけ返す
 * （1 つでも生きていれば差し替え、全滅なら空配列＝合成フォールバックのまま）。例外は投げない。
 */
async function loadSampleGroup(
  audio: AudioManager,
  files: readonly string[],
): Promise<AudioBuffer[]> {
  const results = await Promise.all(
    files.map(async (file): Promise<AudioBuffer | null> => {
      try {
        const res = await fetch(audioAssetUrl(file));
        if (!res.ok) {
          return null;
        }
        const bytes = await res.arrayBuffer();
        return await audio.decodeSample(bytes);
      } catch (error) {
        console.warn(`SE サンプルのロードに失敗しました: ${file}`, error);
        return null;
      }
    }),
  );
  return results.filter((b): b is AudioBuffer => b !== null);
}

/**
 * [UR-3] ネズミの走行音/鳴き声をユーザー提供の実録サンプルへ差し替える（非同期・起動時に一度 await）。
 * 走行ループ(createLoop)の生成より前に登録が済むよう、bootstrap で switchTo の前に await する。
 * ロードできたグループだけ register*Samples で登録し、以後 playOneShot/createLoop が合成より優先して使う。
 * 全滅グループは登録しない＝合成SEがそのまま残る（壊れても無音にしない）。虫の羽音/汎用キャッチSEは不変。
 * この関数自体は例外を投げない（内部で握りつぶす）ので bootstrap の起動失敗フォールバックには波及しない。
 */
export async function loadCritterSamples(audio: AudioManager): Promise<void> {
  const [squeaks, runs] = await Promise.all([
    loadSampleGroup(audio, MOUSE_SQUEAK_SAMPLE_FILES),
    loadSampleGroup(audio, MOUSE_SCURRY_SAMPLE_FILES),
  ]);
  audio.registerOneShotSamples(MOUSE_SQUEAK_ID, squeaks);
  audio.registerLoopSamples(MOUSE_SCURRY_ID, runs);
}
