import type { Texture } from "pixi.js";
import type { Scene } from "../app/Scene";
import type { AudioSink } from "../audio/AudioManager";
import { CritterAudioController } from "../audio/CritterAudioController";
import type { Critter } from "../critters/Critter";
import { spawnCritter } from "../critters/Critter";
import type { CritterSoundSet } from "../critters/CritterType";
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
  /** 共有SE（当面は全種別で流用。オブジェクト別SEは次タスク）。 */
  sounds: CritterSoundSet;
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
 * SE は共有コントローラで最大速度連動＋断続チューチューを鳴らす（種別別SEは次タスク）。
 */
export class AutoMode implements Mode {
  private readonly deps: AutoModeDeps;
  private readonly scheduler: SpawnScheduler;
  private readonly ctx: MovementContext;
  private readonly audioCtrl: CritterAudioController;
  private readonly rng: () => number;
  private readonly maxActive: number;
  /** entries に対応する重み配列（毎フレーム再生成しないよう保持）。 */
  private readonly weights: number[];
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
    this.audioCtrl = new CritterAudioController(deps.audio, deps.sounds);
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.paused = false;
    this.scheduler.reset();
    this.audioCtrl.start();
    // 起動直後に 1 体出して即フィードバックを与える。
    this.spawnOne();
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.deps.scene.despawnAll();
    this.audioCtrl.stop();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** 出現間隔(ms)を変更する（実行中でも即反映）。 */
  setInterval(ms: number): void {
    this.scheduler.setInterval(ms);
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
      return;
    }
    this.deps.entries.push(entry);
    this.weights.push(entry.weight);
  }

  /** 指定 typeId の種別エントリを取り除く（未登録は no-op。実行中でも即反映）。 */
  removeEntry(typeId: string): void {
    const idx = this.deps.entries.findIndex((e) => e.typeId === typeId);
    if (idx < 0) {
      return;
    }
    this.deps.entries.splice(idx, 1);
    this.weights.splice(idx, 1);
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
    // 4) SE: 最大速度で走行音、断続でチューチュー（critter が居るときのみ進める）。
    const count = scene.critterCount;
    if (count > 0) {
      let maxSpeed = 0;
      const list = scene.critterList;
      for (let i = 0; i < list.length; i++) {
        const v = list[i].state.velocity;
        const s = Math.hypot(v.x, v.y);
        if (s > maxSpeed) {
          maxSpeed = s;
        }
      }
      this.audioCtrl.update(maxSpeed, dtSeconds);
    }
  }

  /** 重み付き乱数で 1 種別を選び spawn する。 */
  private spawnOne(): void {
    const idx = weightedIndex(this.weights, this.rng());
    if (idx < 0) {
      return;
    }
    this.spawnEntry(this.deps.entries[idx]);
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
