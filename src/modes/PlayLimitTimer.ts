/**
 * 遊びすぎ防止タイマー（PixiJS/DOM 非依存 = 単体テスト可能）。
 *
 * auto（動画モード）の「active 再生時間」だけを累積し、上限（分）に達したフレームで
 * ちょうど 1 回だけ発火を通知する。過刺激（遊びすぎ）を避けるため、上限到達で呼び出し側が
 * 自動停止（動くオブジェクトを消して無音）へ移る。
 *
 * 前提:
 * - tick は auto の active 再生中のみ毎フレーム呼ぶ（pause 中/停止中/manual では呼ばない）。
 *   累積対象を呼び出し側で active 再生時間だけに絞ることで、このクラスは純粋に時間の積算のみを担う。
 * - reset は再開/モード再開始時に呼び、elapsed と発火状態を仕切り直す。
 * - 上限変更は setLimitMinutes で行い、elapsed/発火状態をリセットして再武装する
 *   （上限を短くした瞬間に即発火する事故を防ぐ）。
 *
 * 純関数・純状態で NaN を出さない（非有限/負の入力は無効=OFF 扱いに正規化する）。
 */
export class PlayLimitTimer {
  /** 上限(ms)。0 以下は無効（OFF＝無制限）。 */
  private limitMs: number;
  /** active 再生の累積時間(ms)。 */
  private elapsedMs = 0;
  /** 上限到達を既に通知済みか（reset まで再発火しない）。 */
  private fired = false;

  constructor(limitMinutes: number) {
    this.limitMs = toLimitMs(limitMinutes);
  }

  /**
   * 上限(分)を変更する。elapsed と発火状態をリセットして再武装する。
   * （上限を短縮しても、その瞬間に累積が上限を跨いで即発火する事故を防ぐ。）
   */
  setLimitMinutes(minutes: number): void {
    this.limitMs = toLimitMs(minutes);
    this.reset();
  }

  /**
   * active 再生 1 フレームぶんの経過を積算する。
   * 無効(上限≤0)/既発火/非正dt では false を返し、累積もしない。
   * 累積が上限に達したフレームで true を **1 回だけ** 返し、以降 reset まで false。
   */
  tick(dtSeconds: number): boolean {
    if (this.limitMs <= 0 || this.fired || !(dtSeconds > 0)) {
      return false;
    }
    this.elapsedMs += dtSeconds * 1000;
    if (this.elapsedMs >= this.limitMs) {
      this.fired = true;
      return true;
    }
    return false;
  }

  /** 累積と発火状態を仕切り直す（再開/モード再開始時に呼ぶ）。 */
  reset(): void {
    this.elapsedMs = 0;
    this.fired = false;
  }

  /** 上限が無効（≤0＝OFF）か。無効時 tick は常に false。 */
  get isDisabled(): boolean {
    return this.limitMs <= 0;
  }

  /** 上限到達を既に通知済みか。 */
  get hasFired(): boolean {
    return this.fired;
  }

  /**
   * 表示用の残り時間(ms)。無効時は Infinity、発火後/超過時は 0。
   */
  get remainingMs(): number {
    if (this.limitMs <= 0) {
      return Number.POSITIVE_INFINITY;
    }
    const remaining = this.limitMs - this.elapsedMs;
    return remaining > 0 ? remaining : 0;
  }
}

/** 分→ms 変換。非有限/負は 0（無効＝OFF）へ正規化する。 */
function toLimitMs(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes < 0) {
    return 0;
  }
  return minutes * 60_000;
}
