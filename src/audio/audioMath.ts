/**
 * SE 合成のパラメータ写像（PixiJS/Web Audio 非依存 = Vitest で単体テスト可能）。
 * 実際のノード生成は synth.ts が担い、ここは「速度→gain」や squeak パラメータの純関数のみ置く。
 */

/** 値を [0,1] に収める。NaN は 0 に落とす（gain の暴走・NaN 混入を防ぐ）。 */
export function clamp01(v: number): number {
  if (Number.isNaN(v)) {
    return 0;
  }
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 走行音レベルの速度写像パラメータ（px/秒）。 */
export interface ScurryLevelOptions {
  /** これ以下の速さでは 0（静止でほぼ無音）。 */
  minSpeed: number;
  /** これ以上の速さで 1（フル）。min..max を線形補間する。 */
  maxSpeed: number;
}

/** 既定の速度写像。ゆっくりでも少し鳴り、全力疾走で飽和する値（AutoMode の横断ネズミ向け）。 */
export const SCURRY_LEVEL_DEFAULTS = {
  minSpeed: 15,
  maxSpeed: 480,
} as const satisfies ScurryLevelOptions;

/**
 * ポインタ追従ネズミ（ManualMode）の走行音写像。
 * MouseFollowMovement はピーク速度が大きい(~6480, [UR-8]で上方調整)ため、既定 maxSpeed=480 では即飽和して抑揚が
 * 出ない。maxSpeed を上方調整して「速いほど活発」の抑揚が残るようにする。
 */
export const SCURRY_LEVEL_MOUSE_FOLLOW = {
  minSpeed: 15,
  maxSpeed: 1500,
} as const satisfies ScurryLevelOptions;

/**
 * 虫の羽音(buzz)の速度写像。虫のダッシュは速度が非常にスパイキー（ダッシュで高速→停止で ~0）なので、
 * 小さめ maxSpeed で「飛んでいれば概ね鳴る」よう早く飽和させ、minSpeed も低くして微動でも途切れにくくする。
 */
export const BUZZ_LEVEL_DEFAULTS = {
  minSpeed: 6,
  maxSpeed: 140,
} as const satisfies ScurryLevelOptions;

/**
 * 移動速度(px/秒)→走行音レベル(0..1) の純写像。
 * minSpeed 以下で 0、maxSpeed 以上で 1、その間は線形。NaN/負値は 0 に落ちる。
 * 「速いほど活発、静止でほぼ無音」を一次関数で表現する。
 */
export function scurryLevelFromSpeed(
  speed: number,
  opts: ScurryLevelOptions = SCURRY_LEVEL_DEFAULTS,
): number {
  const { minSpeed, maxSpeed } = opts;
  // `!(speed > minSpeed)` は NaN と minSpeed 以下をまとめて 0 にする。
  if (!(speed > minSpeed)) {
    return 0;
  }
  if (maxSpeed <= minSpeed) {
    return 1;
  }
  return clamp01((speed - minSpeed) / (maxSpeed - minSpeed));
}

/** オシレータ波形（squeak 用）。 */
export type OscillatorWaveform = "sine" | "triangle" | "sawtooth" | "square";

/**
 * 1 発ぶんの squeak（チューチュー）合成パラメータ。
 * ピッチは start→peak→end の上下チャープ、アンプは短いアタック→減衰。
 */
export interface SqueakParams {
  waveform: OscillatorWaveform;
  /** 開始周波数(Hz)。 */
  startFreq: number;
  /** チャープ頂点の周波数(Hz)。startFreq より高い。 */
  peakFreq: number;
  /** 終端周波数(Hz)。startFreq より低め。 */
  endFreq: number;
  /** 音の長さ(秒)。 */
  duration: number;
  /** ピッチ頂点の位置（0..1, duration に対する比）。 */
  peakTime: number;
  /** アンプのピーク gain(0..1)。 */
  gainPeak: number;
}

/** squeak パラメータ生成のチューニング。 */
export interface SqueakParamOptions {
  waveform?: OscillatorWaveform;
  /** 開始周波数の中心(Hz)。 */
  baseFreq?: number;
  /** 開始周波数の揺らぎ幅（±比率）。 */
  freqJitter?: number;
  /** 長さの中心(秒)。 */
  baseDuration?: number;
  /** 長さの揺らぎ幅（±比率）。 */
  durationJitter?: number;
}

export const SQUEAK_PARAM_DEFAULTS = {
  waveform: "triangle",
  baseFreq: 1900,
  freqJitter: 0.18,
  baseDuration: 0.12,
  durationJitter: 0.4,
} as const satisfies Required<SqueakParamOptions>;

/** squeak の最小長(秒)。ジッタが効いても極端に短くしない下限。 */
const MIN_SQUEAK_DURATION = 0.03;

/**
 * squeak 合成パラメータを生成する純関数（rng 注入でテスト可能）。
 * 音程/長さを少しランダムに揺らし、毎回わずかに違う「チュッ」を作る。
 * rng は [0,1) を返す関数（既定 Math.random）。返り値は全て有限・範囲内。
 */
export function makeSqueakParams(
  rng: () => number = Math.random,
  opts: SqueakParamOptions = {},
): SqueakParams {
  const waveform = opts.waveform ?? SQUEAK_PARAM_DEFAULTS.waveform;
  const baseFreq = opts.baseFreq ?? SQUEAK_PARAM_DEFAULTS.baseFreq;
  const freqJitter = opts.freqJitter ?? SQUEAK_PARAM_DEFAULTS.freqJitter;
  const baseDuration = opts.baseDuration ?? SQUEAK_PARAM_DEFAULTS.baseDuration;
  const durationJitter = opts.durationJitter ?? SQUEAK_PARAM_DEFAULTS.durationJitter;

  // [0,1) → 対称ジッタ [-1,1)
  const symmetric = (): number => rng() * 2 - 1;

  const startFreq = baseFreq * (1 + freqJitter * symmetric());
  // 上へ跳ね上がってから下がる（チューという上下チャープ）。
  const peakFreq = startFreq * (1.4 + 0.25 * rng());
  const endFreq = startFreq * (0.7 + 0.15 * rng());
  const duration = Math.max(MIN_SQUEAK_DURATION, baseDuration * (1 + durationJitter * symmetric()));
  const peakTime = 0.3 + 0.2 * rng();
  const gainPeak = 0.32 + 0.12 * rng();

  return { waveform, startFreq, peakFreq, endFreq, duration, peakTime, gainPeak };
}
