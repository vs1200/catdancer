/**
 * squeak(チューチュー)の発火タイミングを決める純ロジック（Web Audio 非依存 = テスト可能）。
 * min..max の一様乱数間隔で断続的に「鳴らすべきか」を返す。鳴りっぱなしにしないための土台。
 */

export interface SqueakSchedulerOptions {
  /** 最短の発火間隔(秒)。 */
  minInterval?: number;
  /** 最長の発火間隔(秒)。 */
  maxInterval?: number;
  /** 乱数源（[0,1) を返す）。テスト用に注入可能。既定 Math.random。 */
  rng?: () => number;
}

/** 既定間隔。心地よい頻度（数秒に一度）でチューと鳴る。 */
export const SQUEAK_SCHEDULER_DEFAULTS = {
  minInterval: 1.8,
  maxInterval: 5.5,
} as const;

/**
 * 経過時間を貯めて、間隔を越えたら 1 度だけ発火する軽量スケジューラ。
 * update(dt) を毎フレーム呼び、true が返ったら SE を 1 発鳴らす。
 * 1 tick で複数発は返さない（長い dt でもチューを連打しない）。
 */
export class SqueakScheduler {
  private readonly minInterval: number;
  private readonly maxInterval: number;
  private readonly rng: () => number;
  private timeUntilNext: number;

  constructor(options?: SqueakSchedulerOptions) {
    this.minInterval = options?.minInterval ?? SQUEAK_SCHEDULER_DEFAULTS.minInterval;
    this.maxInterval = options?.maxInterval ?? SQUEAK_SCHEDULER_DEFAULTS.maxInterval;
    this.rng = options?.rng ?? Math.random;
    this.timeUntilNext = this.nextInterval();
  }

  /** min..max の一様乱数間隔(秒)。max<min の設定でも min を下限に保つ。 */
  private nextInterval(): number {
    const span = Math.max(0, this.maxInterval - this.minInterval);
    return this.minInterval + this.rng() * span;
  }

  /**
   * dt 秒進める。発火したら true（同時に次の間隔へリセット）。
   * dt<=0 は無視（tab 復帰直後などのガード）。
   */
  update(dtSeconds: number): boolean {
    if (!(dtSeconds > 0)) {
      return false;
    }
    this.timeUntilNext -= dtSeconds;
    if (this.timeUntilNext > 0) {
      return false;
    }
    // 越えた分(負のオーバーシュート)は捨てて次間隔へ。連打を避け 1 発のみ返す。
    this.timeUntilNext = this.nextInterval();
    return true;
  }

  /** 次発火までの残り秒（検証/デバッグ用）。 */
  get remaining(): number {
    return this.timeUntilNext;
  }
}
