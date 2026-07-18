import type { SqueakParams } from "./audioMath";

/**
 * Web Audio によるSE合成（オシレータ/ノイズのグラフ構築）。
 * 純パラメータは audioMath.ts に分離し、ここは AudioContext 依存のノード生成のみ担う。
 * 将来 CC0 音源(AudioBuffer)へ差し替える際も、同じ AudioEngine/LoopVoice 抽象で置換できる。
 */

/** SE が音を差し込む先。output は master gain の入力ノード（→ analyser → destination）。 */
export interface AudioEngine {
  readonly context: AudioContext;
  readonly output: AudioNode;
}

/** gain を動的更新できるループSEのハンドル（走行音など）。 */
export interface LoopVoice {
  /** 強さ 0..1。0 でほぼ無音。範囲外は内部でクランプ。 */
  setLevel(level: number): void;
  /** 停止して全ノードを切断（リーク防止）。 */
  stop(): void;
}

/**
 * 「キャッチ」ワンショットSEを 1 発再生する（voice を持たない種別＝虫/猫じゃらし/おもちゃ/カスタムの
 * 捕獲フィードバック用）。立ち上がりの帯域制限ノイズ・クリック（"tk"）＋速いピッチ下降のブリップ（"ポッ"）で、
 * 猫がタップに反応した狩猟の手応えを短く出す。終了後に onended で全ノードを切断しリークさせない。
 */
export function playCatch(engine: AudioEngine): void {
  const { context, output } = engine;
  const t0 = context.currentTime;
  const duration = 0.12;

  // ピッチ下降のブリップ（"ポッ"）: 高→低へ速く落ちる短音。
  const osc = context.createOscillator();
  osc.type = "triangle";
  const oscGain = context.createGain();
  osc.connect(oscGain);
  oscGain.connect(output);
  osc.frequency.setValueAtTime(920, t0);
  osc.frequency.exponentialRampToValueAtTime(220, t0 + duration);
  oscGain.gain.setValueAtTime(0.0001, t0);
  oscGain.gain.exponentialRampToValueAtTime(0.4, t0 + 0.01);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  // 立ち上がりのクリック（"tk"）: 極短の帯域制限ノイズ。
  const noise = context.createBufferSource();
  noise.buffer = createNoiseBuffer(context, 0.05);
  const bandpass = context.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.value = 2000;
  bandpass.Q.value = 0.7;
  const noiseGain = context.createGain();
  noise.connect(bandpass);
  bandpass.connect(noiseGain);
  noiseGain.connect(output);
  noiseGain.gain.setValueAtTime(0.3, t0);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04);

  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
  noise.start(t0);
  noise.stop(t0 + 0.06);
  // osc が最後に終わるので、その onended で全ノードをまとめて切断する。
  osc.onended = (): void => {
    osc.disconnect();
    oscGain.disconnect();
    noise.disconnect();
    bandpass.disconnect();
    noiseGain.disconnect();
  };
}

/** ループ用の帯域制限ホワイトノイズを生成する（seconds 秒ぶんをループ）。 */
function createNoiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/**
 * squeak（チューチュー）を 1 発ワンショット再生する。
 * ピッチ: start→peak→end の速い上下チャープ。アンプ: 速いアタック→減衰の短音。
 * 終了後に onended で全ノードを切断し、長時間再生でもノードがリークしないようにする。
 */
export function playSqueak(engine: AudioEngine, params: SqueakParams): void {
  const { context, output } = engine;
  const t0 = context.currentTime;
  const { startFreq, peakFreq, endFreq, duration, peakTime, gainPeak } = params;

  const osc = context.createOscillator();
  osc.type = params.waveform;
  const gain = context.createGain();
  osc.connect(gain);
  gain.connect(output);

  // ピッチ・エンベロープ（上下チャープ）。exponentialRamp は 0 を扱えないため周波数は正値のみ。
  osc.frequency.setValueAtTime(startFreq, t0);
  osc.frequency.exponentialRampToValueAtTime(peakFreq, t0 + duration * peakTime);
  osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + duration);

  // アンプ・エンベロープ（0 を避けて微小値からランプ）。
  const tAttack = t0 + duration * 0.15;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(gainPeak, tAttack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
  osc.onended = (): void => {
    osc.disconnect();
    gain.disconnect();
  };
}

/** 走行音レベル(0..1)に掛ける実 gain の最大値（master と合わせて過大にしない）。 */
const SCURRY_MAX_GAIN = 0.5;
/** レベル追従の時定数(秒)。setTargetAtTime で段差なく滑らかに追う。 */
const SCURRY_SMOOTH_TAU = 0.05;

/**
 * 走行音（scurry）ループ声部を生成する。
 * フィルタ済みノイズ + 速い LFO トレモロで「細かいパター/擦れ」を作り、
 * setLevel で移動速度に連動して gain を上下させる（静止で 0 へ収束）。
 */
export function createScurryVoice(engine: AudioEngine): LoopVoice {
  const { context, output } = engine;

  const noise = context.createBufferSource();
  noise.buffer = createNoiseBuffer(context, 2);
  noise.loop = true;

  // 高域寄りの擦れ音に整形。
  const highpass = context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 1200;
  const bandpass = context.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.value = 2600;
  bandpass.Q.value = 0.9;

  // トレモロ（細かいパター感）: LFO で trem.gain を 0.2..1.0 に揺らす。
  const trem = context.createGain();
  trem.gain.value = 0.6;
  const lfo = context.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 17;
  const lfoDepth = context.createGain();
  lfoDepth.gain.value = 0.4;
  lfo.connect(lfoDepth);
  lfoDepth.connect(trem.gain);

  // 速度連動 gain（初期は無音）。
  const level = context.createGain();
  level.gain.value = 0;

  noise.connect(highpass);
  highpass.connect(bandpass);
  bandpass.connect(trem);
  trem.connect(level);
  level.connect(output);

  noise.start();
  lfo.start();

  let stopped = false;
  return {
    setLevel(value: number): void {
      if (stopped) {
        return;
      }
      const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
      const target = clamped * SCURRY_MAX_GAIN;
      level.gain.setTargetAtTime(target, context.currentTime, SCURRY_SMOOTH_TAU);
    },
    stop(): void {
      if (stopped) {
        return;
      }
      stopped = true;
      try {
        noise.stop();
        lfo.stop();
      } catch {
        // 既に停止済みでも問題なし。
      }
      noise.disconnect();
      highpass.disconnect();
      bandpass.disconnect();
      trem.disconnect();
      lfoDepth.disconnect();
      lfo.disconnect();
      level.disconnect();
    },
  };
}

/** 羽音レベル(0..1)に掛ける実 gain の最大値（sawtooth は成分が濃いので scurry より控えめ）。 */
const BUZZ_MAX_GAIN = 0.3;
/** レベル追従の時定数(秒)。虫の停止(pause)を挟んでも羽音が途切れすぎないよう scurry より長め。 */
const BUZZ_SMOOTH_TAU = 0.08;

/**
 * 虫の羽音（buzz）ループ声部を生成する。
 * 羽ばたき周波数(~180Hz)の sawtooth を基音に、遅い LFO でピッチをわずかに揺らし（生きている不規則さ）、
 * 速い LFO でアンプ・トレモロ（羽ばたきのフラッタ）を掛け、bandpass で虫らしい帯域へ整形する。
 * setLevel で移動速度に連動して gain を上下させ、stop で全ノードを切断する（scurry と同じくリーク防止）。
 */
export function createBuzzVoice(engine: AudioEngine): LoopVoice {
  const { context, output } = engine;

  // 基音: 羽ばたき ~180Hz の sawtooth（倍音が濃く「ブーン」というブザー感を作る）。
  const osc = context.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 180;

  // ピッチ揺らぎ（遅い LFO で ±約 14Hz）。飛翔の不規則さを出す。
  const pitchLfo = context.createOscillator();
  pitchLfo.type = "sine";
  pitchLfo.frequency.value = 6;
  const pitchDepth = context.createGain();
  pitchDepth.gain.value = 14;
  pitchLfo.connect(pitchDepth);
  pitchDepth.connect(osc.frequency);

  // 虫らしい帯域へ整形（低め中心のバンドパスで金属的な高域を抑える）。
  const bandpass = context.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.value = 520;
  bandpass.Q.value = 0.8;

  // アンプ・トレモロ（速い LFO で羽ばたきのフラッタ）。base 0.75 を ±0.22 揺らす。
  const trem = context.createGain();
  trem.gain.value = 0.75;
  const ampLfo = context.createOscillator();
  ampLfo.type = "sine";
  ampLfo.frequency.value = 24;
  const ampDepth = context.createGain();
  ampDepth.gain.value = 0.22;
  ampLfo.connect(ampDepth);
  ampDepth.connect(trem.gain);

  // 速度連動 gain（初期は無音）。
  const level = context.createGain();
  level.gain.value = 0;

  osc.connect(bandpass);
  bandpass.connect(trem);
  trem.connect(level);
  level.connect(output);

  osc.start();
  pitchLfo.start();
  ampLfo.start();

  let stopped = false;
  return {
    setLevel(value: number): void {
      if (stopped) {
        return;
      }
      const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
      const target = clamped * BUZZ_MAX_GAIN;
      level.gain.setTargetAtTime(target, context.currentTime, BUZZ_SMOOTH_TAU);
    },
    stop(): void {
      if (stopped) {
        return;
      }
      stopped = true;
      try {
        osc.stop();
        pitchLfo.stop();
        ampLfo.stop();
      } catch {
        // 既に停止済みでも問題なし。
      }
      osc.disconnect();
      pitchLfo.disconnect();
      pitchDepth.disconnect();
      bandpass.disconnect();
      trem.disconnect();
      ampLfo.disconnect();
      ampDepth.disconnect();
      level.disconnect();
    },
  };
}
