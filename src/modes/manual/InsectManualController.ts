import type { Texture } from "pixi.js";
import type { Scene } from "../../app/Scene";
import type { AudioSink } from "../../audio/AudioManager";
import { CritterAudioController } from "../../audio/CritterAudioController";
import type { Critter } from "../../critters/Critter";
import { spawnCritter } from "../../critters/Critter";
import { getCritterType } from "../../critters/registry";
import { INSECT_TYPE_ID } from "../../critters/types/insect";
import { hasExitedWorld } from "../../movement/CrossMovement";
import {
  ErraticMovement,
  erraticEntryVelocity,
  planErraticFromPoint,
} from "../../movement/ErraticMovement";
import type { MovementContext } from "../../movement/Movement";
import type { ManualController, ManualControllerSnapshot } from "./ManualController";

/** {@link InsectManualController} の構築パラメータ。 */
export interface InsectManualControllerDeps {
  /** 虫の本体テクスチャ（呼び出し側が Assets.load 済み。多数 spawn でも共有）。 */
  bodyTexture: Texture;
  audio: AudioSink;
  scene: Scene;
  /** 乱数源（テスト差し替え用。既定 Math.random）。 */
  rng?: () => number;
}

/**
 * 同時に存在できる虫の上限（頭打ち＝暴走/リーク防止）。超過クリックでは最古の 1 体を despawn して席を空ける。
 * 連打でも画面が埋まり続けず、かつ複数同時に賑やかに飛べる程度の値。
 */
const MAX_ACTIVE = 18;

/**
 * [UR-6] マウス操作モードの「虫」固有コントローラ。
 *
 * クリック(タップ)した位置に虫を 1 体 spawn し、既存の {@link ErraticMovement}（不規則ダッシュ）で
 * 素早く飛び回らせ、やがて world 外へ抜けたら despawn する。連続クリックで複数を同時に出せる。
 *
 * - onPointerDown(worldX, worldY): クリック位置を始点にした {@link planErraticFromPoint} の plan で
 *   虫を spawn（自前リストで保持）。上限 MAX_ACTIVE で頭打ちし、超過は最古を退場させる。
 * - update: 各虫を更新し、world 外に出たものを despawn（後方走査で in-place 除去）。羽音は present-gate
 *   （虫が居る間・最大速度連動）で 1 本の {@link CritterAudioController} を駆動する（複数の羽音を
 *   個別に鳴らさず 1 本で代表。AutoMode の per-type 方式に倣う）。
 * - start: 選択直後の初期フィードバックとして中央に 1 体出す。以後はクリックで追加。
 * - setPaused: paused 中は update 早期 return（虫停止）＋羽音を silence。復帰で継続。
 * - stop: 全虫を despawn＋羽音 stop（リークなく全解放）。pointer は追従に使わないので attach しない。
 */
export class InsectManualController implements ManualController {
  private readonly deps: InsectManualControllerDeps;
  private readonly ctx: MovementContext;
  private readonly audioCtrl: CritterAudioController;
  private readonly rng: () => number;
  private readonly baseSize: number;
  /** 生成順を保つアクティブな虫の集合（cap 超過時に先頭＝最古から退場させる）。 */
  private readonly critters: Critter[] = [];
  private running = false;
  private paused = false;

  constructor(deps: InsectManualControllerDeps) {
    this.deps = deps;
    this.rng = deps.rng ?? Math.random;
    // speedScale=1 で明示初期化（update は world のみ上書きし speedScale は保持＝虫の動きの速さ倍率）。
    this.ctx = { world: deps.scene.worldBounds, pointer: null, speedScale: 1 };
    const type = getCritterType(INSECT_TYPE_ID);
    this.baseSize = type.baseSize;
    // 羽音のみ（voice なし・move=速度連動の buzz）。虫向けの速度写像(moveLevel=BUZZ)で早く飽和させる。
    this.audioCtrl = new CritterAudioController(deps.audio, type.sounds, {
      scurry: type.moveLevel,
    });
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.paused = false;
    this.audioCtrl.start();
    // 選択直後の初期フィードバック: 画面中央に 1 体出す（以後はクリックで追加）。
    const vp = this.deps.scene.worldBounds.viewport;
    this.spawnAt(vp.width / 2, vp.height / 2);
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.audioCtrl.stop();
    // 全虫を despawn（表示物ごと完全破棄）してリストを空にする＝種別切替でリークしない。
    for (let i = 0; i < this.critters.length; i++) {
      this.deps.scene.despawn(this.critters[i]);
    }
    this.critters.length = 0;
  }

  /** 虫の動きの速さ倍率（実行中でも即反映。Critter.update が dt に乗じて movement 全体へ適用）。 */
  setSpeedScale(scale: number): void {
    this.ctx.speedScale = scale;
  }

  /**
   * 一時停止の切替。paused 中は update が早期 return（虫が止まる）ため、鳴り続ける羽音ループを
   * 明示的に無音化する。復帰時は次フレームの update が通常の速度連動へ戻す（追加処理不要）。
   */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!this.running) {
      return;
    }
    if (paused) {
      this.audioCtrl.silence();
    }
  }

  update(dtSeconds: number): void {
    if (!this.running || this.paused) {
      return;
    }
    const { scene } = this.deps;
    this.ctx.world = scene.worldBounds;
    // 0) 外部 despawn（DEV `__catScene.clear()` 等）で破棄された虫を内部リストから除去する自己修復。
    //    破棄済み Container を更新すると syncView が null 参照でクラッシュするため、後方走査で splice する。
    //    既に destroy 済みなので scene.despawn は呼ばない（二重破棄回避）。
    for (let i = this.critters.length - 1; i >= 0; i--) {
      if (this.critters[i].destroyed) {
        this.critters.splice(i, 1);
      }
    }
    // 1) 各虫を更新（自前リストを走査。scene には本コントローラの虫しか居ない）。
    for (let i = 0; i < this.critters.length; i++) {
      this.critters[i].update(dtSeconds, this.ctx);
    }
    // 2) world 外へ抜けた虫を despawn（後方走査で in-place 除去＝配列を作り直さない）。
    for (let i = this.critters.length - 1; i >= 0; i--) {
      const c = this.critters[i];
      if (hasExitedWorld(c.state.position, scene.worldBounds) || c.hasExpired) {
        this.critters.splice(i, 1);
        scene.despawn(c);
      }
    }
    // 3) 羽音: present=虫が居る間、level=虫の最大速度連動（複数の羽音を 1 本で代表）。
    let maxSpeed = 0;
    for (let i = 0; i < this.critters.length; i++) {
      const v = this.critters[i].state.velocity;
      const s = Math.hypot(v.x, v.y);
      if (s > maxSpeed) {
        maxSpeed = s;
      }
    }
    this.audioCtrl.update(maxSpeed, dtSeconds, this.critters.length > 0);
  }

  /**
   * クリック/タップ（world 座標）でその位置に虫を 1 体出現させる（複数同時に出せる）。
   * pointerdown は信頼済みユーザージェスチャなので AudioContext の resume 契機にもなる（羽音が鳴り出す）。
   */
  onPointerDown(worldX: number, worldY: number): void {
    if (!this.running) {
      return;
    }
    this.spawnAt(worldX, worldY);
  }

  /**
   * (x,y) を始点にした虫を 1 体 spawn する。上限 MAX_ACTIVE に達していれば最古(先頭)を先に退場させて
   * 席を空ける（連打でも数が単調増加しない＝リーク防止）。
   */
  private spawnAt(x: number, y: number): void {
    if (this.critters.length >= MAX_ACTIVE) {
      const oldest = this.critters.shift();
      if (oldest) {
        this.deps.scene.despawn(oldest);
      }
    }
    const plan = planErraticFromPoint(
      { x, y },
      this.deps.scene.worldBounds,
      this.rng,
      undefined,
      this.baseSize,
    );
    const critter = spawnCritter({
      typeId: INSECT_TYPE_ID,
      bodyTexture: this.deps.bodyTexture,
      movement: new ErraticMovement(plan),
      // 始点=クリック位置。進入方向(→wp0)を初速に与え spawn 直後の heading を進行方向へ向ける。
      spawn: {
        position: plan.enter,
        velocity: erraticEntryVelocity(plan),
        facing: plan.facing,
      },
    });
    this.deps.scene.add(critter);
    this.critters.push(critter);
  }

  /**
   * DEV フック用の観測スナップショット。最新(末尾)の虫の位置/速度と、虫の総数(insectCount)を返す。
   * 虫が 1 体も居なければ null（放置で 0 に戻った状態）。
   */
  debugSnapshot(): ManualControllerSnapshot | null {
    const c = this.critters[this.critters.length - 1];
    if (!c) {
      return null;
    }
    return {
      position: { x: c.state.position.x, y: c.state.position.y },
      velocity: { x: c.state.velocity.x, y: c.state.velocity.y },
      pointer: null,
      running: this.running,
      paused: this.paused,
      heading: c.state.heading,
      viewRotation: c.view.rotation,
      viewScaleY: c.view.scale.y,
      tailTip: null,
      insectCount: this.critters.length,
    };
  }
}
