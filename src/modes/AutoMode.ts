import type { Texture } from "pixi.js";
import type { Scene } from "../app/Scene";
import type { AudioSink } from "../audio/AudioManager";
import { CritterAudioController } from "../audio/CritterAudioController";
import type { Critter } from "../critters/Critter";
import { spawnCritter } from "../critters/Critter";
import type { CritterSoundSet } from "../critters/CritterType";
import { CrossMovement, hasExitedWorld, planCrossSpawn } from "../movement/CrossMovement";
import type { MovementContext } from "../movement/Movement";
import type { Mode } from "./Mode";
import { SpawnScheduler } from "./spawnScheduler";

/** 同時に存在できる critter 数の上限（頭打ち＝despawn とセットでリークを防ぐ）。 */
const DEFAULT_MAX_ACTIVE = 12;

export interface AutoModeDeps {
  scene: Scene;
  bodyTexture: Texture;
  /** 尻尾テクスチャ（共有。多数 spawn でテクスチャを都度生成しない）。 */
  tailTexture?: Texture;
  audio: AudioSink;
  sounds: CritterSoundSet;
  typeId: string;
  /** 出現間隔(ms)。 */
  intervalMs: number;
  /** 同時上限（既定 12）。 */
  maxActive?: number;
  /** 乱数源（テスト差し替え用。既定 Math.random）。 */
  rng?: () => number;
}

/**
 * 猫用動画モード。一定間隔でオブジェクトを画面外(world 端)から spawn し、CrossMovement で
 * 横切らせ、world 外へ抜けたら despawn する。当面は種別=ネズミ（typeId で差し替え可能）。
 *
 * spawn/despawn 基盤:
 * - 同時数を maxActive で頭打ちにし、despawn とセットで critter 数が単調増加しないようにする。
 * - despawn 述語は 1 度だけ束縛（this.shouldDespawn）して毎フレームの new を避ける。
 * - 生成物は全て Scene のアクティブ集合に載せ、stop で despawnAll し完全解放する。
 * SE は既存ネズミSEを流用し、単一の共有コントローラで最大速度連動＋断続チューチューを鳴らす。
 */
export class AutoMode implements Mode {
  private readonly deps: AutoModeDeps;
  private readonly scheduler: SpawnScheduler;
  private readonly ctx: MovementContext;
  private readonly audioCtrl: CritterAudioController;
  private readonly rng: () => number;
  private readonly maxActive: number;
  private running = false;
  private paused = false;
  /** 毎フレーム再生成しないよう束縛した despawn 述語。 */
  private readonly shouldDespawn = (critter: Critter): boolean =>
    hasExitedWorld(critter.state.position, this.deps.scene.worldBounds);

  constructor(deps: AutoModeDeps) {
    this.deps = deps;
    this.rng = deps.rng ?? Math.random;
    this.maxActive = deps.maxActive ?? DEFAULT_MAX_ACTIVE;
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

  private spawnOne(): void {
    const { scene } = this.deps;
    if (scene.critterCount >= this.maxActive) {
      return;
    }
    const plan = planCrossSpawn(scene.worldBounds, this.rng);
    const movement = new CrossMovement({
      vx: plan.velocity.x,
      vy: plan.velocity.y,
      wobbleAmp: plan.wobbleAmp,
      wobbleFreq: plan.wobbleFreq,
      phase: plan.phase,
    });
    const critter = spawnCritter({
      typeId: this.deps.typeId,
      bodyTexture: this.deps.bodyTexture,
      tailTexture: this.deps.tailTexture,
      movement,
      spawn: { position: plan.position, velocity: plan.velocity, facing: plan.facing },
    });
    scene.add(critter);
  }
}
