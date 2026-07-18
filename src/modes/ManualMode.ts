import type { Texture } from "pixi.js";
import type { PointerInput } from "../app/PointerInput";
import type { Scene } from "../app/Scene";
import type { AudioSink } from "../audio/AudioManager";
import { CritterAudioController } from "../audio/CritterAudioController";
import type { Critter } from "../critters/Critter";
import { spawnCritter } from "../critters/Critter";
import type { CritterSoundSet } from "../critters/CritterType";
import type { MovementContext } from "../movement/Movement";
import type { Mode } from "./Mode";

export interface ManualModeDeps {
  scene: Scene;
  /** ポインタ入力（本モードが attach/detach を占有管理する）。 */
  pointer: PointerInput;
  bodyTexture: Texture;
  /** 尻尾テクスチャ（共有）。 */
  tailTexture?: Texture;
  audio: AudioSink;
  sounds: CritterSoundSet;
  typeId: string;
}

/**
 * v1 のマウス操作モードを Mode として包む（挙動は現状維持）。
 *
 * 1 体のネズミを画面中央に spawn し、PointerInput＋種別既定の MouseFollowMovement で
 * ポインタへ慣性追従させる。走行音/チューチューSE も連動させる。
 * start でポインタ配線・critter・SE を確保し、stop で全て解放する（切替リークなし）。
 */
export class ManualMode implements Mode {
  private readonly deps: ManualModeDeps;
  private readonly ctx: MovementContext;
  private readonly audioCtrl: CritterAudioController;
  private critter: Critter | null = null;
  private running = false;
  private paused = false;

  constructor(deps: ManualModeDeps) {
    this.deps = deps;
    this.ctx = { world: deps.scene.worldBounds, pointer: null };
    this.audioCtrl = new CritterAudioController(deps.audio, deps.sounds);
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
   * 一時停止。paused の間はポインタを外し中央へ寄せて、パネル操作でネズミを画面外へ
   * 飛ばさないようにする（v1 の onOpenChange 挙動の踏襲）。復帰でポインタを再配線する。
   */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!this.running) {
      return;
    }
    if (paused) {
      this.deps.pointer.detach();
      this.deps.pointer.centerToViewport();
    } else {
      this.deps.pointer.attach();
    }
  }

  update(dtSeconds: number): void {
    if (!this.running || this.paused || !this.critter) {
      return;
    }
    this.ctx.world = this.deps.scene.worldBounds;
    this.ctx.pointer = this.deps.pointer.pointer.value;
    this.critter.update(dtSeconds, this.ctx);
    const speed = Math.hypot(this.critter.state.velocity.x, this.critter.state.velocity.y);
    this.audioCtrl.update(speed, dtSeconds);
  }

  /**
   * DEV フック用の観測スナップショット（本番では main.ts 側の import.meta.env.DEV で除外）。
   * 現在のネズミ位置/速度とポインタ（=追従目標）を返す。追従応答性の客観計測に使う。
   */
  debugSnapshot(): {
    position: { x: number; y: number };
    velocity: { x: number; y: number };
    pointer: { x: number; y: number } | null;
    running: boolean;
    paused: boolean;
    /** state.heading(rad)。回転方式(rotate)の追従角。 */
    heading: number;
    /** 実 view.rotation(rad)。heading と一致するはず（回転検証用）。 */
    viewRotation: number;
    /** view.scale.y。左半分(鏡像)で -1（上下逆さ回避の検証用）。 */
    viewScaleY: number;
    /** 尻尾先端のワールド座標（静止/トレイル検証用）。尻尾が無ければ null。 */
    tailTip: { x: number; y: number } | null;
  } | null {
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
