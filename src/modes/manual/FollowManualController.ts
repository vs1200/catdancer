import type { Texture } from "pixi.js";
import type { PointerInput } from "../../app/PointerInput";
import type { Scene } from "../../app/Scene";
import type { AudioSink } from "../../audio/AudioManager";
import { SCURRY_LEVEL_MOUSE_FOLLOW } from "../../audio/audioMath";
import { CritterAudioController } from "../../audio/CritterAudioController";
import type { Critter } from "../../critters/Critter";
import { spawnCritter } from "../../critters/Critter";
import { getCritterType } from "../../critters/registry";
import { MouseFollowMovement } from "../../movement/MouseFollowMovement";
import type { MovementContext } from "../../movement/Movement";
import type { ManualController, ManualControllerSnapshot } from "./ManualController";

/** {@link FollowManualController} の構築パラメータ（種別ごとに差し替える）。 */
export interface FollowManualControllerDeps {
  /** 操作対象の種別 id（レジストリ登録済み）。sounds は getCritterType(typeId).sounds を使う。 */
  typeId: string;
  /** 本体テクスチャ（呼び出し側が Assets.load 済みのものを渡す）。 */
  bodyTexture: Texture;
  /** 尻尾テクスチャ（尻尾を持つ種別のみ。共有）。 */
  tailTexture?: Texture;
  audio: AudioSink;
  /** ポインタ入力（本コントローラが attach/detach を占有管理する。ManualMode 経由で共有）。 */
  pointer: PointerInput;
  scene: Scene;
}

/**
 * [UR-4] 任意種別を 1 体だけカーソル追従させる manual コントローラ（旧 ManualMode のネズミ追従を抽出・一般化）。
 *
 * 中央に 1 体 spawn し、MouseFollowMovement を movement override してポインタへ慣性追従させる
 * （種別既定 movement が dangle/erratic でも必ず追従になる＝UR-4 のプレースホルダ挙動）。mouse では
 * override 値が種別既定と同一のため従来挙動が完全に不変。走行音/鳴きSE は種別の sounds を使い、
 * 走行音写像はポインタ追従のピーク速度に合わせた SCURRY_LEVEL_MOUSE_FOLLOW を用いる（sounds が空の
 * foxtail/toys は無音）。
 *
 * onPointerDown は種別に voice(鳴き声)SEがあれば鳴らす（mouse→squeak。UR-3 のクリック鳴きをここへ移設）。
 * voice を持たない種別（foxtail/insect/toys）は無音。worldX/worldY は本コントローラでは未使用だが、
 * UR-6 の虫クリック出現がこの引数で spawn 位置を決める拡張点になる。
 */
export class FollowManualController implements ManualController {
  private readonly deps: FollowManualControllerDeps;
  private readonly ctx: MovementContext;
  private readonly audioCtrl: CritterAudioController;
  private critter: Critter | null = null;
  private running = false;
  private paused = false;

  constructor(deps: FollowManualControllerDeps) {
    this.deps = deps;
    // speedScale=1 で明示初期化（省略時1扱いだが意図を明確化）。update は world/pointer のみ
    // 上書きし speedScale は触らないため、mutate 再利用の ctx に設定は持続する。
    this.ctx = { world: deps.scene.worldBounds, pointer: null, speedScale: 1 };
    // ポインタ追従はピーク速度が大きい(~6480)ため、走行音写像は上方調整版で抑揚を残す。
    // sounds は種別定義から解決（mouse=チュー+走行 / foxtail・toys=空で無音 / insect=羽音）。
    this.audioCtrl = new CritterAudioController(deps.audio, getCritterType(deps.typeId).sounds, {
      scurry: SCURRY_LEVEL_MOUSE_FOLLOW,
    });
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.paused = false;
    const { scene, pointer } = this.deps;
    pointer.attach();
    pointer.centerToViewport();
    const vp = scene.worldBounds.viewport;
    this.critter = spawnCritter({
      typeId: this.deps.typeId,
      bodyTexture: this.deps.bodyTexture,
      tailTexture: this.deps.tailTexture,
      // 全種別をカーソル追従にするため movement を MouseFollowMovement で上書きする
      // （mouse は種別既定と同一値のため従来挙動が不変）。
      movement: new MouseFollowMovement(),
      spawn: { position: { x: vp.width / 2, y: vp.height / 2 } },
    });
    scene.add(this.critter);
    this.audioCtrl.start();
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.deps.pointer.detach();
    this.audioCtrl.stop();
    if (this.critter) {
      this.deps.scene.despawn(this.critter);
      this.critter = null;
    }
  }

  /**
   * 動きの速さの全体倍率を設定する（実行中でも即反映）。ctx に載せておき、Critter.update が
   * dt に乗じて追従の動き全体へ均一適用する（マウス追従の速さが倍率で変わる）。
   */
  setSpeedScale(scale: number): void {
    this.ctx.speedScale = scale;
  }

  /**
   * 一時停止。paused の間はポインタを外し中央へ寄せて、パネル操作でオブジェクトを画面外へ
   * 飛ばさないようにする（v1 の onOpenChange 挙動の踏襲）。復帰でポインタを再配線する。
   */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!this.running) {
      return;
    }
    if (paused) {
      // ループSE(走行音)を即無音化する（パネルを開くと最後の音量のまま鳴り続けるのを防ぐ）。
      this.audioCtrl.silence();
      this.deps.pointer.detach();
      this.deps.pointer.centerToViewport();
    } else {
      this.deps.pointer.attach();
    }
  }

  update(dtSeconds: number): void {
    // 外部 despawn（DEV `__catScene.clear()` 等）で破棄された critter への参照を落とす自己修復。
    // 破棄済み Container を更新すると syncView が null 参照でクラッシュするため、参照を null にして
    // 既存ガードで早期 return させる（既に destroy 済みなので scene.despawn は呼ばない）。
    if (this.critter?.destroyed) {
      this.critter = null;
    }
    if (!this.running || this.paused || !this.critter) {
      return;
    }
    this.ctx.world = this.deps.scene.worldBounds;
    this.ctx.pointer = this.deps.pointer.pointer.value;
    this.critter.update(dtSeconds, this.ctx);
    const speed = Math.hypot(this.critter.state.velocity.x, this.critter.state.velocity.y);
    // 1 体で常に存在するため present=true 固定。
    this.audioCtrl.update(speed, dtSeconds, true);
  }

  /**
   * クリック/タップ（world 座標）。種別に voice(鳴き声)SEがあれば即時発火する（mouse→squeak）。
   * pointerdown は信頼済みユーザージェスチャなので AudioContext の resume 契機にもなる。
   * voice を持たない種別（foxtail/insect/toys）は無音。worldX/worldY は UR-6 の受け皿（現状未使用）。
   */
  onPointerDown(_worldX: number, _worldY: number): void {
    const voice = getCritterType(this.deps.typeId).sounds.voice;
    if (voice) {
      this.deps.audio.playOneShot(voice);
    }
  }

  /**
   * DEV フック用の観測スナップショット。現在の critter 位置/速度とポインタ（=追従目標）を返す。
   * 追従応答性の客観計測に使う（従来 ManualMode.debugSnapshot と同形）。
   */
  debugSnapshot(): ManualControllerSnapshot | null {
    if (!this.critter) {
      return null;
    }
    const p = this.deps.pointer.pointer.value;
    return {
      position: { x: this.critter.state.position.x, y: this.critter.state.position.y },
      velocity: { x: this.critter.state.velocity.x, y: this.critter.state.velocity.y },
      pointer: p ? { x: p.x, y: p.y } : null,
      running: this.running,
      paused: this.paused,
      heading: this.critter.state.heading,
      viewRotation: this.critter.view.rotation,
      viewScaleY: this.critter.view.scale.y,
      tailTip: this.critter.tailTip,
    };
  }
}
