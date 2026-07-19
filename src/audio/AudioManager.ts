import { clamp01, clampPan, pickRandomIndex } from "./audioMath";
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
  /**
   * id のワンショットSEを 1 発再生。
   * [UR4-4] pan は発火位置の左右定位(-1..1, 中央0)。省略時 0（後方互換＝中央）。
   */
  playOneShot(id: string, pan?: number): void;
  /** id のループSE声部を生成。未登録/無効時は無音のダミーを返す。 */
  createLoop(id: string): LoopVoice;
}

/** ワンショットSEのビルダ（バンク登録用）。[UR4-4] pan は発火位置の左右定位(-1..1, 中央0)。 */
export type OneShotBuilder = (engine: AudioEngine, pan: number) => void;
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
/** [UR4-4] サンプル走行ループのパン追従時定数(秒)。合成声部の PAN_SMOOTH_TAU と揃えてゼッパーを避ける。 */
const SAMPLE_LOOP_PAN_TAU = 0.04;

/** 何もしないループ声部（無効時のフォールバック。呼び出し側は常に安全）。 */
const NULL_LOOP: LoopVoice = {
  setLevel: () => undefined,
  setPan: () => undefined,
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
  // [UR4-4] DEV ステレオ検証タップ: master 出力を ChannelSplitter で L/R に分け、各 analyser で RMS を採る
  // （左右定位を数値で客観確認する）。既存 master→analyser→destination とは独立の純タップ（gain=0 の
  // silentSink 経由で destination へ落とすため音は二重に出ない）。context 未生成/生成失敗時は null。
  private readonly analyserL: AnalyserNode | null;
  private readonly analyserR: AnalyserNode | null;
  private readonly timeDataL: Float32Array<ArrayBuffer> | null;
  private readonly timeDataR: Float32Array<ArrayBuffer> | null;
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
    let analyserL: AnalyserNode | null = null;
    let analyserR: AnalyserNode | null = null;
    let timeDataL: Float32Array<ArrayBuffer> | null = null;
    let timeDataR: Float32Array<ArrayBuffer> | null = null;
    try {
      const Ctor = getAudioContextCtor();
      if (Ctor) {
        ctx = new Ctor();
        master = ctx.createGain();
        // ミュート中は初期から 0（映像のみモードで起動時から無音）。音量値そのものは保持する。
        master.gain.value = this.mutedValue ? 0 : this.masterVolumeValue;
        const fftSize = options?.analyserFftSize ?? DEFAULT_FFT_SIZE;
        analyser = ctx.createAnalyser();
        analyser.fftSize = fftSize;
        timeData = new Float32Array(new ArrayBuffer(fftSize * Float32Array.BYTES_PER_ELEMENT));
        // sources → master → analyser → destination（analyser は素通しで master 出力を観測）。
        master.connect(analyser);
        analyser.connect(ctx.destination);

        // [UR4-4] DEV ステレオ検証タップ（既存 master→analyser→destination は不変のまま増設する）。
        // master → splitter で L/R に分岐し、それぞれ analyserL/analyserR で観測する。両 analyser は
        // gain=0 の silentSink を介して destination へ落とす（analyser は下流 gain に関わらず入力を観測できる
        // ので RMS は正しく採れ、かつ音は二重に出ない）。mute/volume は master.gain のままなので、
        // この分岐にもそのまま反映される（master 以降の分岐なので両タップに同じ実効ゲインが乗る）。
        const splitter = ctx.createChannelSplitter(2);
        master.connect(splitter);
        analyserL = ctx.createAnalyser();
        analyserL.fftSize = fftSize;
        analyserR = ctx.createAnalyser();
        analyserR.fftSize = fftSize;
        splitter.connect(analyserL, 0);
        splitter.connect(analyserR, 1);
        const silentSink = ctx.createGain();
        silentSink.gain.value = 0;
        analyserL.connect(silentSink);
        analyserR.connect(silentSink);
        silentSink.connect(ctx.destination);
        timeDataL = new Float32Array(new ArrayBuffer(fftSize * Float32Array.BYTES_PER_ELEMENT));
        timeDataR = new Float32Array(new ArrayBuffer(fftSize * Float32Array.BYTES_PER_ELEMENT));
      }
    } catch (error) {
      console.warn("AudioContext の生成に失敗しました。音声は無効化されます。", error);
      ctx = null;
      master = null;
      analyser = null;
      timeData = null;
      analyserL = null;
      analyserR = null;
      timeDataL = null;
      timeDataR = null;
    }
    this.ctx = ctx;
    this.master = master;
    this.analyser = analyser;
    this.timeData = timeData;
    this.analyserL = analyserL;
    this.analyserR = analyserR;
    this.timeDataL = timeDataL;
    this.timeDataR = timeDataR;
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
  playOneShot(id: string, pan = 0): void {
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
    // [UR4-4] pan は発火位置の左右定位（発火時に固定＝one-shot は追従しない）。
    const fire = (): void => {
      if (samples) {
        this.fireSampleOneShot(samples, engine, id, pan);
      } else if (builder) {
        this.fireOneShot(builder, engine, id, pan);
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
  private fireOneShot(builder: OneShotBuilder, engine: AudioEngine, id: string, pan: number): void {
    try {
      builder(engine, pan);
    } catch (error) {
      console.warn(`SE 再生に失敗しました: ${id}`, error);
    }
  }

  /**
   * サンプル集合からランダムに 1 つ選び、AudioBufferSourceNode で 1 発再生する。
   * [UR4-4] 固定 gain(SAMPLE_ONESHOT_GAIN) → panner(発火位置の左右定位) → master(→analyser→destination) へ出す
   * （muted/volume を尊重）。終了後 onended で panner 含む全ノードを切断しリークさせない。失敗は警告のみで握りつぶす。
   */
  private fireSampleOneShot(
    buffers: AudioBuffer[],
    engine: AudioEngine,
    id: string,
    pan: number,
  ): void {
    try {
      const index = pickRandomIndex(buffers.length);
      this.lastSampleIndex.set(id, index);
      const src = engine.context.createBufferSource();
      src.buffer = buffers[index];
      const gain = engine.context.createGain();
      gain.gain.value = SAMPLE_ONESHOT_GAIN;
      const panner = engine.context.createStereoPanner();
      panner.pan.value = clampPan(pan);
      src.connect(gain);
      gain.connect(panner);
      panner.connect(engine.output);
      src.onended = (): void => {
        src.disconnect();
        gain.disconnect();
        panner.disconnect();
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
   * サンプル走行音のループ声部を生成する（LoopVoice 互換）。run バッファ集合を gapless（無音ギャップ無し）に
   * 連結再生する。onended 起点の再トリガだと主スレッド遅延ぶんの無音がクリップ境界に入り走行音がプツプツ
   * するため、AudioContext クロックで各クリップの開始時刻を事前計算する先読みスケジューリング
   * （"A Tale of Two Clocks" パターン）に切り替える。nextStartTime を保持し、各クリップを
   * `src.start(nextStartTime)` で未来時刻に予約→`nextStartTime += buffer.duration` で連結し、常に 1 クリップ
   * 先まで予約済みにしておく（初回は 2 本予約）。現在再生中クリップの onended 発火時点で次クリップは既に予約・
   * 再生開始済みなので、onended は「クリーンアップ＋次の 1 本を予約」だけ行えばよく、コールバック遅延に依存せず
   * サンプル精度で連結できる。周回ごとに 3 種からランダムに選び直して単調さ（mechanical/repetitive）を避ける。
   * level→gain は setTargetAtTime で平滑追従（setLevel(0) で無音へ収束）、stop で予約済み全ソースと gain を切断。
   * present-gate（不在/pause 時の setLevel(0)/silence/stop）は既存経路のまま効く。gain 0 の間も予約は裏で
   * 回り続けるが無音・軽量（同時に走る source は常に 2 本＝再生中＋次の予約）。
   */
  private createSampleLoopVoice(
    buffers: AudioBuffer[],
    engine: AudioEngine,
    id: string,
  ): LoopVoice {
    const { context, output } = engine;
    const level = context.createGain();
    level.gain.value = 0;
    // [UR4-4] 発音元 x に追従して左右定位する（level → panner → output）。
    const panner = context.createStereoPanner();
    level.connect(panner);
    panner.connect(output);

    let stopped = false;
    // 予約済み（再生中＋未来予約）の全ソースを追跡し、stop() で確実に stop+disconnect する（リーク/二重再生防止）。
    const scheduled = new Set<AudioBufferSourceNode>();
    // 次クリップを開始する AudioContext クロック時刻。各クリップを buffer.duration ぶん先へ連結して予約する。
    let nextStartTime = context.currentTime;

    // 次の 1 クリップを nextStartTime に予約する（周回のたび 3 種からランダムに選び直して単調さを避ける）。
    // n1: createBufferSource/start の稀な throw（実行中の context close 等）でループが無言死・ノード孤児化しない
    // よう try/catch で覆い、警告のみ出す（createLoop の catch→NULL_LOOP 方針と整合）。
    const scheduleNext = (): void => {
      if (stopped) {
        return;
      }
      try {
        const index = pickRandomIndex(buffers.length);
        this.lastSampleIndex.set(id, index);
        const buffer = buffers[index];
        const src = context.createBufferSource();
        src.buffer = buffer;
        src.connect(level);
        scheduled.add(src);
        src.onended = (): void => {
          scheduled.delete(src);
          src.disconnect();
          // 「常に 1 クリップ先まで予約済み」を保つため、終了ぶんを次の 1 本で補充する（gapless 維持）。
          if (!stopped) {
            scheduleNext();
          }
        };
        // 予約が遅延で currentTime より過去へ落ちた場合（背景タブのコールバック絞り等）は currentTime へスナップ
        // し、連鎖的な即時再生（重なり）を防ぐ。通常のアクティブ時は nextStartTime > currentTime で連続予約になる。
        const startAt = nextStartTime > context.currentTime ? nextStartTime : context.currentTime;
        src.start(startAt);
        nextStartTime = startAt + buffer.duration;
      } catch (error) {
        console.warn(`サンプルループSE の予約に失敗しました: ${id}`, error);
      }
    };

    // 初回は 2 本（再生中＋次）を予約して開始する。以後は各 onended が 1 本ずつ補充し、常に 1 クリップ先まで
    // 予約済みの状態を保つ（＝境界で無音ギャップが入らずサンプル精度でシームレスに連結される）。
    scheduleNext();
    scheduleNext();

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
      setPan(pan: number): void {
        if (stopped) {
          return;
        }
        panner.pan.setTargetAtTime(clampPan(pan), context.currentTime, SAMPLE_LOOP_PAN_TAU);
      },
      stop(): void {
        if (stopped) {
          return;
        }
        stopped = true;
        // 予約済み（再生中＋未来予約）を全て stop+disconnect する。stop() が誘発する onended は
        // stopped=true を見て再予約しない（scheduled は clear 済みで delete/disconnect も安全な no-op）。
        for (const src of scheduled) {
          try {
            src.stop();
          } catch {
            // 既に停止済み/未再生でも問題なし。
          }
          src.disconnect();
        }
        scheduled.clear();
        level.disconnect();
        panner.disconnect();
      },
    };
  }

  /** master 出力の RMS(0..1目安)。debug/検証フック用（ヘッドレスで音を客観確認する）。 */
  getRms(): number {
    if (!this.analyser || !this.timeData) {
      return 0;
    }
    return AudioManager.rmsOf(this.analyser, this.timeData);
  }

  /** analyser の時間波形を buf へ読み出して RMS(0..1目安)を返す（getRms/getStereoLevels 共通）。 */
  private static rmsOf(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const s = buf[i];
      sum += s * s;
    }
    const rms = Math.sqrt(sum / buf.length);
    return Number.isFinite(rms) ? rms : 0;
  }

  /**
   * [UR4-4] master 出力の左右チャンネル別 RMS(0..1目安)。DEV ステレオ検証フック用（左右定位を数値で確認する）。
   * 各 SE は発音元 x に応じて StereoPanner でパンされるので、画面左を走る音は left>right、右は right>left になる。
   * context 未生成/タップ無しなら {left:0,right:0}（安全既定）。getRms と同じ RMS 計算。
   */
  getStereoLevels(): { left: number; right: number } {
    if (!this.analyserL || !this.analyserR || !this.timeDataL || !this.timeDataR) {
      return { left: 0, right: 0 };
    }
    return {
      left: AudioManager.rmsOf(this.analyserL, this.timeDataL),
      right: AudioManager.rmsOf(this.analyserR, this.timeDataR),
    };
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
