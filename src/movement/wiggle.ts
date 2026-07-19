/**
 * [UR3-6] クリック/タップ時の一時的な「フリフリ」= 回転 sway オーバーレイの純ロジック
 * （PixiJS/DOM 非依存 = Vitest で検証可能）。
 *
 * マウス操作モードでおもちゃがカーソル追従している最中にクリックすると、追従は止めずに
 * 短時間の回転 sway を重ねる（動画モードの dangle 回転 sway と体感を揃えつつ、クリック＝
 * インパルスから時間で減衰する）。角度は時刻の純関数で決まるため、フレームレート非依存で
 * 再現・検証できる。表示側(Critter)が pivot を支点に state.rotation として反映する。
 */

/** フリフリ（クリック時の一時的な回転 sway）の設定。 */
export interface WiggleConfig {
  /** 揺れ角の振幅(rad)。開始直後が最大で、durationSec に向けて減衰する。 */
  amp: number;
  /** 揺れ角の角速度(rad/秒)。動画モードの swayFreq 相当。 */
  freq: number;
  /** フリフリの継続時間(秒)。この時刻で角は 0 に戻る（以降は 0＝終了）。 */
  durationSec: number;
  /** 揺れ角の位相(rad)。省略時 0。 */
  phase?: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 経過時刻 t(秒) における回転角(rad)を返す純関数。
 * - t<=0 または t>=durationSec → 0（開始前/終了後は揺れなし）。
 * - それ以外: 線形減衰の包絡(1→0) × amp × sin(freq*t + phase)。
 *
 * 不変条件: |angle| <= amp（包絡∈[0,1]）・両端で 0・NaN 無し。開始直後は sin(0)=0 から
 * 立ち上がるため角がカクつかず、時間経過で包絡が下がり自然に鳴り止む（ring-down）。
 */
export function wiggleAngleAt(cfg: WiggleConfig, t: number): number {
  if (!(t > 0) || t >= cfg.durationSec) {
    return 0;
  }
  // 1→0 の線形減衰（クリックのインパルスが時間で収まる ring-down）。
  const env = 1 - clamp01(t / cfg.durationSec);
  return env * cfg.amp * Math.sin(cfg.freq * t + (cfg.phase ?? 0));
}
