import { clamp01, pickRandomIndex } from "./audioMath";
import type { AudioEngine, LoopVoice } from "./synth";

/**
 * Web Audio の薄いラッパ。AudioContext と master gain / analyser を管理し、
 * SE のワンショット/ループ再生 API と master 音量、debug 用の RMS/peak 取得を提供する。
 *
 * 設計:
 * - SE の実体は「バンク」に id で登録する（registerOneShot/registerLoop）。今回は合成SEを
 *   登録するが、将来 CC0 音源(AudioBuffer)版を同じ id で登録し直せば差し替えられる薄い抽象。
 * - autoplay 制限: context は初期 suspended。最初のユーザージェスチャ
 *   (pointerdown/keydown/touchstart) で resume する導線を attachAutoResume が張る
 *   （pointermove は gesture として無効なので使わない）。
 * - 敵対的ガード: context 生成失敗時は全 API が安全な no-op になる（available=false）。
 *   resume 前/未生成でも playOneShot/createLoop はクラッシュしない。
 */

/** SE を鳴らす最小インターフェース。CritterAudioController はこれに依存（テスト時に差し替え可能）。 */
export interface AudioSink {
  /** id のワンショットSEを 1 発再生。 */
  playOneShot(id: string): void;
  /** id のループSE声部を生成。未登録/無効時は無音のダミーを返す。 */
  createLoop(id: string): LoopVoice;
}

/** ワンショットSEのビルダ（バンク登録用）。 */
export type OneShotBuilder = (engine: AudioEngine) => void;
/** ループSEのビルダ（バンク登録用）。 */
export type LoopBuilder = (engine: AudioEngine) => LoopVoice;

/** 公開する context 状態。context 未生成は "unavailable"。 */
export type AudioManagerState = "unavailable" | AudioContextState;

export interface AudioManagerOptions {
  /** master 音量(0..1)。既定 0.5。 */
  masterVolume?: number;
  /**
   * 一括ミュート（映像のみモード）。既定 false。true の間は master gain を 0 にして無音化するが、
   * masterVolume 値そのものは保持する（ミュート解除で元の音量に戻る）。
   */
  muted?: boolean;
  /** AnalyserNode の fftSize（RMS 窓長）。既定 1024。 */
  analyserFftSize?: number;
}

const DEFAULT_MASTER_VOLUME = 0.5;
const DEFAULT_FFT_SIZE = 1024;
/** master 音量変更の平滑化時定数(秒)。 */
const MASTER_SMOOTH_TAU = 0.02;
/**
 * サンプル・ワンショット（鳴き声）を master 前で通す固定 gain。素材は -3dBFS 正規化済みで、
 * そのままだと合成SEより大きいため少し抑えて他SEと音量感を揃える。
 */
const SAMPLE_ONESHOT_GAIN = 0.8;
/** サンプル走行ループの level(0..1)→実 gain の最大値（合成 scurry の SCURRY_MAX_GAIN と揃える）。 */
const SAMPLE_LOOP_MAX_GAIN = 0.7;
/** サンプル走行ループの level 追従時定数(秒)。合成 scurry と同じく段差なく滑らかに追う。 */
const SAMPLE_LOOP_SMOOTH_TAU = 0.05;

/** 何もしないループ声部（無効時のフォールバック。呼び出し側は常に安全）。 */
const NULL_LOOP: LoopVoice = {
  setLevel: () => undefined,
  stop: () => undefined,
};

/** window から AudioContext コンストラクタ（webkit prefix 込み）を取り出す。無ければ null。 */
function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export class AudioManager implements AudioSink {
  private readonly ctx: AudioContext | null;
  private readonly master: GainNode | null;
  private readonly analyser: AnalyserNode | null;
  // 明示的に ArrayBuffer 裏付けで確保（getFloatTimeDomainData の Float32Array<ArrayBuffer> 要求に合わせる）。
  private readonly timeData: Float32Array<ArrayBuffer> | null;
  private readonly oneShots = new Map<string, OneShotBuilder>();
  private readonly loops = new Map<string, LoopBuilder>();
  // サンプル音源バンク（実録WAVの decode 済み AudioBuffer 集合）。登録があれば同 id の合成ビルダより優先する。
  private readonly oneShotSamples = new Map<string, AudioBuffer[]>();
  private readonly loopSamples = new Map<string, AudioBuffer[]>();
  // id ごとに最後に選ばれたサンプル index（DEV 検証: ランダム選択が複数種に散るかの観測用）。
  private readonly lastSampleIndex = new Map<string, number>();
  private masterVolumeValue: number;
  private mutedValue: boolean;
  private resumeAttached = false;

  constructor(options?: AudioManagerOptions) {
    this.masterVolumeValue = clamp01(options?.masterVolume ?? DEFAULT_MASTER_VOLUME);
    this.mutedValue = options?.muted ?? false;

    let ctx: AudioContext | null = null;
    let master: GainNode | null = null;
    let analyser: AnalyserNode | null = null;
    let timeData: Float32Array<ArrayBuffer> | null = null;
    try {
      const Ctor = getAudioContextCtor();
      if (Ctor) {
        ctx = new Ctor();
        master = ctx.createGain();
        // ミュート中は初期から 0（映像のみモードで起動時から無音）。音量値そのものは保持する。
        master.gain.value = this.mutedValue ? 0 : this.masterVolumeValue;
        analyser = ctx.createAnalyser();
        analyser.fftSize = options?.analyserFftSize ?? DEFAULT_FFT_SIZE;
        timeData = new Float32Array(
          new ArrayBuffer(analyser.fftSize * Float32Array.BYTES_PER_ELEMENT),
        );
        // sources → master → analyser → destination（analyser は素通しで master 出力を観測）。
        master.connect(analyser);
        analyser.connect(ctx.destination);
      }
    } catch (error) {
      console.warn("AudioContext の生成に失敗しました。音声は無効化されます。", error);
      ctx = null;
      master = null;
      analyser = null;
      timeData = null;
    }
    this.ctx = ctx;
    this.master = master;
    this.analyser = analyser;
    this.timeData = timeData;
  }

  /** context が生成できたか（false なら全 API は安全な no-op）。 */
  get available(): boolean {
    return this.ctx !== null;
  }

  /** context 状態。未生成なら "unavailable"、それ以外は "suspended"/"running"/"closed" 等。 */
  get state(): AudioManagerState {
    return this.ctx ? this.ctx.state : "unavailable";
  }

  /** 現在の master 音量(0..1)。ミュート中でも実音量値を返す（スライダ値の保持）。 */
  get masterVolume(): number {
    return this.masterVolumeValue;
  }

  /** 一括ミュート中か（映像のみモード）。 */
  get muted(): boolean {
    return this.mutedValue;
  }

  /** master 音量を設定（[0,1] にクランプ）。オプション画面から呼べる公開 API。 */
  setMasterVolume(value: number): void {
    this.masterVolumeValue = clamp01(value);
    this.applyMasterGain();
  }

  /**
   * 一括ミュートを設定する（映像のみモード）。masterVolume 値は変えず、実効ゲインだけ切り替える
   * （解除で元の音量に戻る）。context 未生成時は状態のみ更新し安全に no-op。
   */
  setMuted(muted: boolean): void {
    this.mutedValue = muted;
    this.applyMasterGain();
  }

  /**
   * 実効 master gain を現在の muted/masterVolume から反映する（ミュート中は 0）。
   * context 未生成(available=false)なら安全に no-op（既存のガード流儀を維持）。
   */
  private applyMasterGain(): void {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(
        this.mutedValue ? 0 : this.masterVolumeValue,
        this.ctx.currentTime,
        MASTER_SMOOTH_TAU,
      );
    }
  }

  /** context を resume（suspended→running）。未生成/既 running/失敗時も安全に解決する。 */
  async resume(): Promise<void> {
    if (!this.ctx || this.ctx.state === "running") {
      return;
    }
    try {
      await this.ctx.resume();
    } catch {
      // autoplay ポリシー等で拒否されても落とさない（次のジェスチャで再試行）。
    }
  }

  /**
   * 最初のユーザージェスチャで resume する導線を張る。
   * pointerdown/keydown/touchstart を購読し（pointermove は gesture 無効なので含めない）、
   * running になったらリスナを外す。多重呼び出しは無視。
   */
  attachAutoResume(target: EventTarget = window): void {
    if (this.resumeAttached || !this.ctx) {
      return;
    }
    this.resumeAttached = true;
    const detach = (): void => {
      target.removeEventListener("pointerdown", handler);
      target.removeEventListener("keydown", handler);
      target.removeEventListener("touchstart", handler);
    };
    const handler = (): void => {
      void this.resume().then(() => {
        if (this.ctx?.state === "running") {
          detach();
        }
      });
    };
    target.addEventListener("pointerdown", handler);
    target.addEventListener("keydown", handler);
    target.addEventListener("touchstart", handler, { passive: true });
  }

  /** ワンショットSEを id でバンク登録。 */
  registerOneShot(id: string, builder: OneShotBuilder): void {
    this.oneShots.set(id, builder);
  }

  /** ループSEを id でバンク登録。 */
  registerLoop(id: string, builder: LoopBuilder): void {
    this.loops.set(id, builder);
  }

  /**
   * fetch 済みバイト列を decodeAudioData で AudioBuffer 化する（fetch は呼び出し側が担う）。
   * context は suspended でも decode 可能。context 未生成/decode 失敗時は null を返すので、
   * 呼び出し側は「登録しない＝合成SEをフォールバックのまま残す」ことで無音化を避けられる。
   */
  async decodeSample(bytes: ArrayBuffer): Promise<AudioBuffer | null> {
    if (!this.ctx) {
      return null;
    }
    try {
      return await this.ctx.decodeAudioData(bytes);
    } catch (error) {
      console.warn("音声サンプルの decode に失敗しました。", error);
      return null;
    }
  }

  /**
   * ワンショットSEをサンプル集合で登録する（playOneShot が発火のたびランダムに 1 つ選ぶ）。
   * 空配列は無視する（＝登録されず、同 id の合成ビルダがそのままフォールバックとして残る）。
   */
  registerOneShotSamples(id: string, buffers: AudioBuffer[]): void {
    if (buffers.length > 0) {
      this.oneShotSamples.set(id, buffers);
    }
  }

  /**
   * ループSE(走行音)をサンプル集合で登録する（createLoop が周回ごとにランダムに選び直す）。
   * 空配列は無視する（＝同 id の合成ループビルダがフォールバックとして残る）。
   */
  registerLoopSamples(id: string, buffers: AudioBuffer[]): void {
    if (buffers.length > 0) {
      this.loopSamples.set(id, buffers);
    }
  }

  /** DEV 検証用: 登録済みサンプルの id→各バッファ duration(秒) 一覧（decode 成功と長さの客観確認）。 */
  sampleInfo(): Record<string, number[]> {
    const info: Record<string, number[]> = {};
    for (const [id, bufs] of this.oneShotSamples) {
      info[id] = bufs.map((b) => b.duration);
    }
    for (const [id, bufs] of this.loopSamples) {
      info[id] = bufs.map((b) => b.duration);
    }
    return info;
  }

  /** id で最後に再生したサンプルの index。未再生/非サンプル id は null（DEV 検証用）。 */
  getLastSampleIndex(id: string): number | null {
    return this.lastSampleIndex.get(id) ?? null;
  }

  private engine(): AudioEngine | null {
    if (!this.ctx || !this.master) {
      return null;
    }
    return { context: this.ctx, output: this.master };
  }

  /**
   * ワンショットSEを再生。context 状態で分岐する（未生成/未登録なら安全に何もしない）。
   * - running: 従来どおり同期で即発火する（挙動不変）。
   * - suspended: 初回ユーザージェスチャ起点の呼び出しを想定し、resume() を試みて、
   *   resume が成功して running になった時だけ 1 回発火する（初回捕獲タップの反応SEを鳴らすため）。
   *   autoplay ポリシーで resume が拒否され suspended のままなら発火しない
   *   （＝suspended 中にスケジュールを溜め込まない元意図を維持。resume は冪等なので連続呼びも安全）。
   * - closed / unavailable(context 未生成): 従来どおり何もしない（無音維持）。
   */
  playOneShot(id: string): void {
    const engine = this.engine();
    if (!engine) {
      return;
    }
    const samples = this.oneShotSamples.get(id);
    const builder = this.oneShots.get(id);
    if (!samples && !builder) {
      return;
    }
    // サンプル登録があれば合成ビルダより優先（同 id で実録サンプルへ差し替え）。無ければ合成フォールバック。
    const fire = (): void => {
      if (samples) {
        this.fireSampleOneShot(samples, engine, id);
      } else if (builder) {
        this.fireOneShot(builder, engine, id);
      }
    };
    const state = this.ctx?.state;
    if (state === "running") {
      // running 経路は同期で即発火（既存挙動を変えない）。
      fire();
      return;
    }
    if (state === "suspended") {
      // 初回ジェスチャ起点: resume が成功して running になった時だけ遅延発火する。
      void this.resume().then(() => {
        if (this.ctx?.state === "running") {
          fire();
        }
      });
    }
    // closed 等は何もしない（無音維持）。
  }

  /** バンクビルダを実行して 1 発鳴らす。発火失敗は警告のみで握りつぶす（running/遅延 両経路で共通）。 */
  private fireOneShot(builder: OneShotBuilder, engine: AudioEngine, id: string): void {
    try {
      builder(engine);
    } catch (error) {
      console.warn(`SE 再生に失敗しました: ${id}`, error);
    }
  }

  /**
   * サンプル集合からランダムに 1 つ選び、AudioBufferSourceNode で 1 発再生する。
   * 固定 gain(SAMPLE_ONESHOT_GAIN) を挟んでから master(→analyser→destination) へ出す（muted/volume を尊重）。
   * 終了後 onended で全ノードを切断しリークさせない。失敗は警告のみで握りつぶす。
   */
  private fireSampleOneShot(buffers: AudioBuffer[], engine: AudioEngine, id: string): void {
    try {
      const index = pickRandomIndex(buffers.length);
      this.lastSampleIndex.set(id, index);
      const src = engine.context.createBufferSource();
      src.buffer = buffers[index];
      const gain = engine.context.createGain();
      gain.gain.value = SAMPLE_ONESHOT_GAIN;
      src.connect(gain);
      gain.connect(engine.output);
      src.onended = (): void => {
        src.disconnect();
        gain.disconnect();
      };
      src.start();
    } catch (error) {
      console.warn(`サンプルSE 再生に失敗しました: ${id}`, error);
    }
  }

  /**
   * ループSE声部を生成。未生成/未登録/生成失敗なら無音のダミーを返すので、
   * 呼び出し側は返り値の null チェック不要で常に安全に setLevel/stop できる。
   */
  createLoop(id: string): LoopVoice {
    const engine = this.engine();
    if (!engine) {
      return NULL_LOOP;
    }
    // サンプル走行音の登録があれば合成ループより優先（同 id で実録サンプルへ差し替え）。
    const samples = this.loopSamples.get(id);
    if (samples) {
      try {
        return this.createSampleLoopVoice(samples, engine, id);
      } catch (error) {
        console.warn(`サンプルループSE 生成に失敗しました: ${id}`, error);
        return NULL_LOOP;
      }
    }
    const builder = this.loops.get(id);
    if (!builder) {
      return NULL_LOOP;
    }
    try {
      return builder(engine);
    } catch (error) {
      console.warn(`ループSE 生成に失敗しました: ${id}`, error);
      return NULL_LOOP;
    }
  }

  /**
   * サンプル走行音のループ声部を生成する（LoopVoice 互換）。run バッファ集合を 1 クリップずつ再生し、
   * 周回（onended）ごとにランダムで選び直して単調さを避ける（＝走行音も 3 種からランダム/周回で変化）。
   * level→gain は setTargetAtTime で平滑追従（setLevel(0) で無音へ収束）、stop で現行 source と gain を切断。
   * present-gate（不在/pause 時の setLevel(0)/silence/stop）は既存経路のまま効く。gain 0 の間もチェーンは
   * 裏で回り続けるが無音・軽量（同時に走る source は常に 1 本）。
   */
  private createSampleLoopVoice(
    buffers: AudioBuffer[],
    engine: AudioEngine,
    id: string,
  ): LoopVoice {
    const { context, output } = engine;
    const level = context.createGain();
    level.gain.value = 0;
    level.connect(output);

    let stopped = false;
    let current: AudioBufferSourceNode | null = null;

    const playNext = (): void => {
      if (stopped) {
        return;
      }
      const index = pickRandomIndex(buffers.length);
      this.lastSampleIndex.set(id, index);
      const src = context.createBufferSource();
      src.buffer = buffers[index];
      src.connect(level);
      src.onended = (): void => {
        src.disconnect();
        // 停止していなければ次のクリップへ（周回のたびランダムに選び直す）。
        if (!stopped && current === src) {
          playNext();
        }
      };
      current = src;
      src.start();
    };
    playNext();

    return {
      setLevel(value: number): void {
        if (stopped) {
          return;
        }
        const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
        level.gain.setTargetAtTime(
          clamped * SAMPLE_LOOP_MAX_GAIN,
          context.currentTime,
          SAMPLE_LOOP_SMOOTH_TAU,
        );
      },
      stop(): void {
        if (stopped) {
          return;
        }
        stopped = true;
        try {
          current?.stop();
        } catch {
          // 既に停止済みでも問題なし。
        }
        current?.disconnect();
        current = null;
        level.disconnect();
      },
    };
  }

  /** master 出力の RMS(0..1目安)。debug/検証フック用（ヘッドレスで音を客観確認する）。 */
  getRms(): number {
    if (!this.analyser || !this.timeData) {
      return 0;
    }
    this.analyser.getFloatTimeDomainData(this.timeData);
    let sum = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const s = this.timeData[i];
      sum += s * s;
    }
    const rms = Math.sqrt(sum / this.timeData.length);
    return Number.isFinite(rms) ? rms : 0;
  }

  /** master 出力の瞬時 peak(0..1目安)。 */
  getPeak(): number {
    if (!this.analyser || !this.timeData) {
      return 0;
    }
    this.analyser.getFloatTimeDomainData(this.timeData);
    let peak = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const a = Math.abs(this.timeData[i]);
      if (a > peak) {
        peak = a;
      }
    }
    return Number.isFinite(peak) ? peak : 0;
  }

  /** context を閉じて解放する。 */
  dispose(): void {
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
    }
  }
}
