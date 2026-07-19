import type { Texture } from "pixi.js";
import type { Scene } from "../../app/Scene";
import type { AudioSink } from "../../audio/AudioManager";
import { panFromX } from "../../audio/audioMath";
import { CritterAudioController } from "../../audio/CritterAudioController";
import { CritterPopulation } from "../../critters/CritterPopulation";
import { getCritterType } from "../../critters/registry";
import { INSECT_TYPE_ID } from "../../critters/types/insect";
import {
  ErraticMovement,
  erraticEntryVelocity,
  planErraticFromOffscreen,
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
  /**
   * [UR4-2] 虫のユーザー指定表示サイズ倍率（UR4-1 の viewport sizeScale の上へ乗せる純増倍率）。
   * 省略/undefined は 1（従来サイズ）。spawnAt の spawn へ渡す。倍率変更は main が rebuildCurrent() で
   * 新 deps の factory から作り直して反映する（既存の虫は次の spawn まで従来サイズ）。
   */
  sizeMultiplier?: number;
}

/**
 * 同時に存在できる虫の上限（頭打ち＝暴走/リーク防止）。超過クリックでは最古の 1 体を despawn して席を空ける。
 * 連打でも画面が埋まり続けず、かつ複数同時に賑やかに飛べる程度の値。
 */
const MAX_ACTIVE = 18;

/**
 * [UR3-4] マウス操作モードの「虫」固有コントローラ。
 *
 * クリック(タップ)すると虫を 1 体 spawn し、画面外(進入辺)からクリック位置へ素早く飛び込ませてから、
 * 既存の {@link ErraticMovement}（不規則ダッシュ）で飛び回らせ、やがて world 外へ抜けたら despawn する。
 * 連続クリックで複数を同時に出せる。
 *
 * active list 管理・自己修復 prune・world 退出/expired despawn は {@link CritterPopulation} へ委譲し、
 * cap/evict・spawn 計画・羽音は本コントローラ固有として残す（挙動は委譲前と不変）。
 *
 * - onPointerDown(worldX, worldY): クリック位置を飛び込み先(wp0)にした {@link planErraticFromOffscreen} の
 *   plan で虫を spawn（Population が保持。position=画面外の進入辺）。上限 MAX_ACTIVE で頭打ちし、超過は
 *   Population.list の最古を退場させる。
 * - update: Population で各虫を更新し、world 外/退場完了のものを despawn する。羽音は present-gate
 *   （虫が居る間・最大速度連動）で 1 本の {@link CritterAudioController} を駆動する（複数の羽音を
 *   個別に鳴らさず 1 本で代表。AutoMode の per-type 方式に倣う）。
 * - start: 選択直後の初期フィードバックとして、画面外から中央へ飛び込む虫を 1 体出す。以後はクリックで追加。
 * - setPaused: paused 中は update 早期 return（虫停止）＋羽音を silence。復帰で継続。
 * - stop: 全虫を despawn＋羽音 stop（リークなく全解放）。pointer は追従に使わないので attach しない。
 */
export class InsectManualController implements ManualController {
  private readonly deps: InsectManualControllerDeps;
  private readonly ctx: MovementContext;
  private readonly audioCtrl: CritterAudioController;
  private readonly rng: () => number;
  private readonly baseSize: number;
  /**
   * アクティブな虫の集合（active list 管理・自己修復 prune・world 退出/expired despawn）を担う Facade。
   * cap/evict（{@link MAX_ACTIVE}）は Insect 固有なので Population.list の最古を見て despawn する。
   */
  private readonly population: CritterPopulation;
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
    this.population = new CritterPopulation({ scene: deps.scene });
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.paused = false;
    this.audioCtrl.start();
    // 選択直後の初期フィードバック: 画面外から中央へ飛び込む虫を 1 体出す（以後はクリックで追加）。
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
    this.population.despawnAll();
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
    // 0-1) 自己修復 prune（破棄済み虫の除去）→ 各虫を更新。破棄済み Container を更新すると
    //      syncView が null 参照でクラッシュするため prune を先に行う（順序は Population 内で保証）。
    this.population.update(dtSeconds, this.ctx);
    // 2) world 外へ抜けた／退場アニメ完了の虫を despawn（完全破棄）。
    this.population.reapExited(scene.worldBounds);
    // 3) 羽音: present=虫が居る間、level=虫の最大速度連動（複数の羽音を 1 本で代表）。
    //    [UR4-4] 左右定位は最速個体の x を代表点にする（羽音も最も活発な虫の位置から鳴る）。
    const list = this.population.list;
    let maxSpeed = 0;
    // 代表 x の既定は最初の虫（居なければ中央）。以後は最速個体の x で上書きする。
    let fastestX =
      list.length > 0 ? list[0].state.position.x : scene.worldBounds.viewport.width / 2;
    for (let i = 0; i < list.length; i++) {
      const st = list[i].state;
      const s = Math.hypot(st.velocity.x, st.velocity.y);
      if (s > maxSpeed) {
        maxSpeed = s;
        fastestX = st.position.x;
      }
    }
    const pan = panFromX(fastestX, scene.worldBounds.viewport.width);
    this.audioCtrl.update(maxSpeed, dtSeconds, this.population.count > 0, pan);
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
   * (x,y) を飛び込み先(クリック位置)にした虫を 1 体 spawn する。虫は画面外の進入辺から (x,y) へ飛び込む。
   * 上限 MAX_ACTIVE に達していれば最古(先頭)を先に退場させて席を空ける（連打でも数が単調増加しない＝リーク防止）。
   */
  private spawnAt(x: number, y: number): void {
    // cap/evict は Insect 固有。上限に達していれば Population.list の最古(先頭)を先に退場させる。
    if (this.population.count >= MAX_ACTIVE) {
      const oldest = this.population.list[0];
      if (oldest) {
        this.population.despawn(oldest);
      }
    }
    const plan = planErraticFromOffscreen(
      { x, y },
      this.deps.scene.worldBounds,
      this.rng,
      undefined,
      this.baseSize,
    );
    this.population.spawn({
      typeId: INSECT_TYPE_ID,
      bodyTexture: this.deps.bodyTexture,
      movement: new ErraticMovement(plan),
      // 始点=画面外の進入辺(plan.enter)。進入方向(→wp0=クリック位置)を初速に与え、spawn 直後の heading を
      // クリック点へ飛び込む向きへ初期化する。
      spawn: {
        position: plan.enter,
        velocity: erraticEntryVelocity(plan),
        facing: plan.facing,
      },
      // [UR4-1] 現在の viewport を渡して baseSize を解像度非依存にスケールする。
      viewport: this.deps.scene.worldBounds.viewport,
      // [UR4-2] 虫のユーザー指定サイズ倍率を viewport sizeScale の上へ乗せる（未設定は 1）。
      sizeMultiplier: this.deps.sizeMultiplier,
    });
  }

  /**
   * DEV フック用の観測スナップショット。最新(末尾)の虫の位置/速度と、虫の総数(insectCount)を返す。
   * 虫が 1 体も居なければ null（放置で 0 に戻った状態）。
   */
  debugSnapshot(): ManualControllerSnapshot | null {
    const list = this.population.list;
    const c = list[list.length - 1];
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
      insectCount: this.population.count,
    };
  }
}
