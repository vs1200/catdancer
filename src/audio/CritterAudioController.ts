import type { CritterSoundSet } from "../critters/CritterType";
import type { AudioSink } from "./AudioManager";
import { SCURRY_LEVEL_DEFAULTS, type ScurryLevelOptions, scurryLevelFromSpeed } from "./audioMath";
import { SqueakScheduler, type SqueakSchedulerOptions } from "./SqueakScheduler";
import type { LoopVoice } from "./synth";

/**
 * 1 体の critter の状態を SE に橋渡しする薄いコントローラ。
 * - move ループSE の gain を移動速度に連動させる（scurryLevelFromSpeed）。
 * - voice ワンショットSE を SqueakScheduler で断続再生する（速度非依存＝待機/出現/移動中いつでも）。
 * 純ロジック(audioMath / SqueakScheduler)と Web Audio(AudioSink) を結ぶだけで、判断は純関数側に置く。
 */

export interface CritterAudioOptions {
  /** 走行音の速度写像。既定は SCURRY_LEVEL_DEFAULTS。 */
  scurry?: ScurryLevelOptions;
  /** チューチューの発火間隔設定。 */
  squeak?: SqueakSchedulerOptions;
}

export class CritterAudioController {
  private readonly audio: AudioSink;
  private readonly sounds: CritterSoundSet;
  private readonly scurryOpts: ScurryLevelOptions;
  private readonly scheduler: SqueakScheduler;
  private moveVoice: LoopVoice | null = null;
  private currentLevel = 0;
  private started = false;

  constructor(audio: AudioSink, sounds: CritterSoundSet, options?: CritterAudioOptions) {
    this.audio = audio;
    this.sounds = sounds;
    this.scurryOpts = options?.scurry ?? SCURRY_LEVEL_DEFAULTS;
    this.scheduler = new SqueakScheduler(options?.squeak);
  }

  /** ループSEの生成/開始。ユーザー操作前(suspended)でも安全（無音で待機）。 */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    if (this.sounds.move) {
      this.moveVoice = this.audio.createLoop(this.sounds.move);
      this.moveVoice.setLevel(0);
    }
  }

  /**
   * 毎フレーム: 速さ(px/秒)で走行音 gain を更新し、チューチューを断続発火する。
   * present=false（この種別の critter が画面に居ない）のときは move レベル0・voice 非発火にし、
   * 他種別が居てもこの種別のSEが鳴らないようにする（種別別ルーティングの在否ゲート）。
   */
  update(speed: number, dtSeconds: number, present: boolean): void {
    if (!present) {
      this.currentLevel = 0;
      this.moveVoice?.setLevel(0);
      return;
    }
    this.currentLevel = scurryLevelFromSpeed(speed, this.scurryOpts);
    this.moveVoice?.setLevel(this.currentLevel);
    if (this.sounds.voice && this.scheduler.update(dtSeconds)) {
      this.audio.playOneShot(this.sounds.voice);
    }
  }

  /** 現在の走行音レベル(0..1)。検証/デバッグ用。 */
  get scurryLevel(): number {
    return this.currentLevel;
  }

  /**
   * ループSE(走行音/羽音)を即座に無音化する（pause 時のミュート）。
   * pause 中は update が呼ばれず gain が最後の値で凍結したまま鳴り続けるため、明示的に 0 へ落とす。
   * voice ワンショットは update でしか鳴らないので追加操作は不要。冪等（多重呼び出し安全）。
   * unpause 後は次フレームの update が通常の速度連動に戻すので、復帰処理は不要。
   */
  silence(): void {
    this.currentLevel = 0;
    this.moveVoice?.setLevel(0);
  }

  /** ループSEを停止して解放する。 */
  stop(): void {
    this.moveVoice?.stop();
    this.moveVoice = null;
    this.started = false;
  }
}
