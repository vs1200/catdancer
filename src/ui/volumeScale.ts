/**
 * 音量スライダ(0..100 の整数)と master 音量(0..1)の相互写像。
 * DOM/PixiJS/Web Audio 非依存の純関数 = Vitest で単体テスト可能。
 *
 * オプション画面の `<input type="range" min=0 max=100>` と SettingsStore/AudioManager の
 * masterVolume(0..1) を橋渡しする。範囲外・非数は安全側（[範囲内]、非数は 0）へ丸める。
 */

/** スライダ値(0..100)→音量(0..1)。非有限は 0、範囲外は [0,1] にクランプ。 */
export function sliderToVolume(slider: number): number {
  const n = typeof slider === "number" ? slider : Number(slider);
  if (!Number.isFinite(n)) {
    return 0;
  }
  const v = n / 100;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 音量(0..1)→スライダ値(0..100 の整数)。非有限は 0、範囲外は [0,100] にクランプ。 */
export function volumeToSlider(volume: number): number {
  const n = typeof volume === "number" ? volume : Number(volume);
  if (!Number.isFinite(n)) {
    return 0;
  }
  const s = Math.round(n * 100);
  return s < 0 ? 0 : s > 100 ? 100 : s;
}
