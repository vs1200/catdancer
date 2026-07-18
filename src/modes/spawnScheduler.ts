/**
 * 一定間隔で spawn を発火させる純ロジックのスケジューラ（PixiJS/DOM 非依存 = 単体テスト可能）。
 *
 * 経過時間を積算し、間隔ごとに 1 回発火する。フレームスキップ（大きな dt）で複数回分溜まった
 * 場合はまとめて返すが、maxPerUpdate で 1 フレームの発火数を上限し、極小間隔での暴走を防ぐ
 * （上限に達したら溜まりを捨てて次フレームに持ち越さない）。
 */

export interface SpawnSchedulerOptions {
  /** 発火間隔(ms)。1 未満は 1 に丸める。 */
  intervalMs: number;
  /** 1 回の update で返す最大発火数（暴走ガード）。既定 4。 */
  maxPerUpdate?: number;
}

const DEFAULT_MAX_PER_UPDATE = 4;

export class SpawnScheduler {
  private accumMs = 0;
  private intervalMs: number;
  private readonly maxPerUpdate: number;

  constructor(options: SpawnSchedulerOptions) {
    this.intervalMs = Math.max(1, options.intervalMs);
    this.maxPerUpdate = Math.max(1, Math.floor(options.maxPerUpdate ?? DEFAULT_MAX_PER_UPDATE));
  }

  /** 間隔(ms)を変更する（1 未満は 1 に丸める）。 */
  setInterval(ms: number): void {
    this.intervalMs = Math.max(1, ms);
  }

  /** 積算をリセットする（モード開始時など）。 */
  reset(): void {
    this.accumMs = 0;
  }

  /**
   * dtSeconds ぶん経過を積算し、このフレームで発火すべき spawn 回数(0..maxPerUpdate)を返す。
   * 非正の dt は 0 を返す（NaN・巻き戻しガード）。
   */
  update(dtSeconds: number): number {
    if (!(dtSeconds > 0)) {
      return 0;
    }
    this.accumMs += dtSeconds * 1000;
    if (this.accumMs < this.intervalMs) {
      return 0;
    }
    let count = Math.floor(this.accumMs / this.intervalMs);
    this.accumMs -= count * this.intervalMs;
    if (count > this.maxPerUpdate) {
      count = this.maxPerUpdate;
      // 溜まりすぎは持ち越さず破棄（次フレームでのまとめ発火＝暴走を防ぐ）。
      this.accumMs = 0;
    }
    return count;
  }
}
