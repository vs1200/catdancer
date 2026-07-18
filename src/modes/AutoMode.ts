import type { Texture } from "pixi.js";
import type { Scene } from "../app/Scene";
import type { AudioSink } from "../audio/AudioManager";
import { CritterAudioController } from "../audio/CritterAudioController";
import { type CritterAudioState, driveForType, groupMaxSpeedByType } from "../audio/perTypeLevels";
import type { Critter } from "../critters/Critter";
import { spawnCritter } from "../critters/Critter";
import { getCritterType } from "../critters/registry";
import { hasExitedWorld } from "../movement/CrossMovement";
import type { MovementContext } from "../movement/Movement";
import type { Mode } from "./Mode";
import { SpawnScheduler } from "./spawnScheduler";
import { weightedIndex } from "./weightedChoice";

/** 同時に存在できる critter 数の上限（頭打ち＝despawn とセットでリークを防ぐ）。 */
const DEFAULT_MAX_ACTIVE = 12;

/** AutoMode で出現させる種別 1 つぶんの設定。 */
export interface AutoModeEntry {
  /** レジストリ登録済みの種別 id。createAutoSpawn を持つ種別のみ対象。 */
  typeId: string;
  /** 本体テクスチャ（共有。多数 spawn でも増えない）。 */
  bodyTexture: Texture;
  /** 尻尾テクスチャ（尻尾を持つ種別のみ。共有）。 */
  tailTexture?: Texture;
  /** 重み付き乱択の重み（相対値、正）。大きいほど出やすい。 */
  weight: number;
}

export interface AutoModeDeps {
  scene: Scene;
  /** 出現させる種別群（mouse / foxtail / toys ...）。重みで選んで spawn する。 */
  entries: AutoModeEntry[];
  audio: AudioSink;
  /** 出現間隔(ms)。 */
  intervalMs: number;
  /** 同時上限（既定 12）。 */
  maxActive?: number;
  /** 乱数源（テスト差し替え用。既定 Math.random）。 */
  rng?: () => number;
}

/**
 * 猫用動画モード。一定間隔で登録済みの「auto 対象」種別（mouse / foxtail / toys）から重み付き
 * 乱数で選んで画面外(world 端)から spawn し、種別ごとの Movement（mouse=CrossMovement で横断,
 * foxtail/toys=DangleMovement で揺れて誘い縁へ退場）で動かし、world 外へ抜けたら despawn する。
 *
 * spawn/despawn 基盤（v2 から継続）:
 * - 同時数を maxActive で頭打ちにし、despawn とセットで critter 数が単調増加しないようにする。
 * - despawn 述語は 1 度だけ束縛（this.shouldDespawn）して毎フレームの new を避ける。
 * - 生成物は全て Scene のアクティブ集合に載せ、stop で despawnAll し完全解放する。
 * - 種別ごとの spawn 計画・Movement は CritterType.createAutoSpawn に委譲（種別追加が容易）。
 *
 * SE は種別別ルーティング: sounds を持つ種別ごとに CritterAudioController を 1 本保持し
 * （Map<typeId, controller>）、毎フレーム画面上の critter を typeId でグループ化して
 * 「その種別が居るか(present)＋その種別の最大速度」で各コントローラを駆動する。present でない種別は
 * move レベル0・voice 非発火にするので、虫だけの時にネズミのチューが混ざる等が起きない。
 * voice も move も無い種別（custom 等）はコントローラを作らず無音のまま。
 */
export class AutoMode implements Mode {
  private readonly deps: AutoModeDeps;
  private readonly scheduler: SpawnScheduler;
  private readonly ctx: MovementContext;
  /** 種別別SEコントローラ（sounds を持つ種別のみ）。start/stop/駆動を種別ごとに行う。 */
  private readonly audioCtrls = new Map<string, CritterAudioController>();
  /** 毎フレームの種別グループ化で使う再利用バッファ（配列を作り直さない）。 */
  private readonly audioStateBuf: CritterAudioState[] = [];
  private readonly rng: () => number;
  private readonly maxActive: number;
  /** entries に対応する重み配列（毎フレーム再生成しないよう保持）。 */
  private readonly weights: number[];
  /** spawn 対象から除外する種別 id の集合（オプションの「出現する種類」ON/OFF）。 */
  private disabledTypes: Set<string> = new Set();
  /** spawnOne での有効種別マスク済み重みの再利用バッファ（毎回 new しない）。 */
  private readonly spawnWeightsBuf: number[] = [];
  private running = false;
  private paused = false;
  /** 毎フレーム再生成しないよう束縛した despawn 述語。 */
  private readonly shouldDespawn = (critter: Critter): boolean =>
    hasExitedWorld(critter.state.position, this.deps.scene.worldBounds);

  constructor(deps: AutoModeDeps) {
    this.deps = deps;
    this.rng = deps.rng ?? Math.random;
    this.maxActive = deps.maxActive ?? DEFAULT_MAX_ACTIVE;
    this.weights = deps.entries.map((e) => e.weight);
    this.scheduler = new SpawnScheduler({ intervalMs: deps.intervalMs });
    this.ctx = { world: deps.scene.worldBounds, pointer: null };
    // sounds を持つ種別ごとにコントローラを用意する（無音種別は作らない）。
    for (let i = 0; i < deps.entries.length; i++) {
      this.ensureController(deps.entries[i].typeId);
    }
  }

  /**
   * 指定 typeId の SE コントローラを（未生成なら）用意する。
   * sounds に voice も move も無い種別はコントローラを作らない（custom 等は無音のまま）。
   * running 中に用意したものは即 start する（実行中の addEntry に追随）。
   */
  private ensureController(typeId: string): void {
    if (this.audioCtrls.has(typeId)) {
      return;
    }
    const type = getCritterType(typeId);
    if (!type.sounds.voice && !type.sounds.move) {
      return;
    }
    const ctrl = new CritterAudioController(this.deps.audio, type.sounds, {
      scurry: type.moveLevel,
    });
    this.audioCtrls.set(typeId, ctrl);
    if (this.running) {
      ctrl.start();
    }
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.paused = false;
    this.scheduler.reset();
    for (const ctrl of this.audioCtrls.values()) {
      ctrl.start();
    }
    // 起動直後に 1 体出して即フィードバックを与える。
    this.spawnOne();
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.deps.scene.despawnAll();
    for (const ctrl of this.audioCtrls.values()) {
      ctrl.stop();
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** 出現間隔(ms)を変更する（実行中でも即反映）。 */
  setInterval(ms: number): void {
    this.scheduler.setInterval(ms);
  }

  /**
   * 出現を無効化する種別 id の集合を設定する（実行中でも即反映）。
   * 無効種別は spawnOne の重み付き乱択から除外される（SE/despawn ロジックは不変）。
   */
  setDisabledTypes(ids: readonly string[]): void {
    this.disabledTypes = new Set(ids);
  }

  /**
   * 出現対象の種別エントリを動的に追加する（実行中でも即反映）。
   * 同一 typeId が既にあれば置換する（bodyTexture/weight を差し替え、重複出現を防ぐ）。
   * entries と weights は常に同じ index 対応を保つ（weightedIndex が破綻しないため）。
   */
  addEntry(entry: AutoModeEntry): void {
    const idx = this.deps.entries.findIndex((e) => e.typeId === entry.typeId);
    if (idx >= 0) {
      this.deps.entries[idx] = entry;
      this.weights[idx] = entry.weight;
    } else {
      this.deps.entries.push(entry);
      this.weights.push(entry.weight);
    }
    // sounds を持つ種別なら SE コントローラを用意（running 中なら即 start）。
    this.ensureController(entry.typeId);
  }

  /** 指定 typeId の種別エントリを取り除く（未登録は no-op。実行中でも即反映）。 */
  removeEntry(typeId: string): void {
    const idx = this.deps.entries.findIndex((e) => e.typeId === typeId);
    if (idx < 0) {
      return;
    }
    this.deps.entries.splice(idx, 1);
    this.weights.splice(idx, 1);
    // 対応する SE コントローラを停止して破棄する（不在種別のループを残さない）。
    const ctrl = this.audioCtrls.get(typeId);
    if (ctrl) {
      ctrl.stop();
      this.audioCtrls.delete(typeId);
    }
  }

  update(dtSeconds: number): void {
    if (!this.running || this.paused) {
      return;
    }
    const { scene } = this.deps;
    // 1) スケジュールに従い spawn（上限で頭打ち）。
    const due = this.scheduler.update(dtSeconds);
    for (let i = 0; i < due; i++) {
      this.spawnOne();
    }
    // 2) 全 critter を更新（配列を作り直さない）。
    this.ctx.world = scene.worldBounds;
    scene.updateAll(dtSeconds, this.ctx);
    // 3) world 外へ抜けたものを despawn（完全破棄）。
    scene.despawnWhere(this.shouldDespawn);
    // 4) SE: 種別別ルーティング。画面上の critter を typeId でグループ化し、各コントローラを
    //    「その種別の在否(present)＋最大速度」で駆動する。present でない種別は無音（他種別が居ても
    //    その種別のSEは鳴らさない）。
    const buf = this.audioStateBuf;
    buf.length = 0;
    const list = scene.critterList;
    for (let i = 0; i < list.length; i++) {
      buf.push(list[i].state);
    }
    const maxByType = groupMaxSpeedByType(buf);
    for (const [typeId, ctrl] of this.audioCtrls) {
      const drive = driveForType(maxByType, typeId);
      ctrl.update(drive.maxSpeed, dtSeconds, drive.present);
    }
  }

  /**
   * 重み付き乱数で 1 種別を選び spawn する。
   * 無効化された種別は重み 0 でマスクして対象外にする（index 対応は entries と一致させる）。
   * 全種別が無効なら合計重み 0 で weightedIndex が -1 を返し、no-op になる。
   */
  private spawnOne(): void {
    const entries = this.deps.entries;
    const buf = this.spawnWeightsBuf;
    buf.length = entries.length;
    for (let i = 0; i < entries.length; i++) {
      buf[i] = this.disabledTypes.has(entries[i].typeId) ? 0 : this.weights[i];
    }
    const idx = weightedIndex(buf, this.rng());
    if (idx < 0) {
      return;
    }
    this.spawnEntry(entries[idx]);
  }

  /**
   * 指定 typeId を確実に spawn する（DEV フックの force-spawn 用。sway/pivot/出入りの確認）。
   * 未登録/未対象の typeId は無視する。
   */
  spawnType(typeId: string): void {
    const entry = this.deps.entries.find((e) => e.typeId === typeId);
    if (entry) {
      this.spawnEntry(entry);
    }
  }

  private spawnEntry(entry: AutoModeEntry): void {
    const { scene } = this.deps;
    if (scene.critterCount >= this.maxActive) {
      return;
    }
    const type = getCritterType(entry.typeId);
    if (!type.createAutoSpawn) {
      return;
    }
    const plan = type.createAutoSpawn(scene.worldBounds, this.rng);
    const critter = spawnCritter({
      typeId: entry.typeId,
      bodyTexture: entry.bodyTexture,
      tailTexture: entry.tailTexture,
      movement: plan.movement,
      spawn: { position: plan.position, velocity: plan.velocity, facing: plan.facing },
    });
    scene.add(critter);
  }
}
