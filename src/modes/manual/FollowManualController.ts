import type { Texture } from "pixi.js";
import type { PointerInput } from "../../app/PointerInput";
import type { Scene } from "../../app/Scene";
import type { AudioSink } from "../../audio/AudioManager";
import { panFromX, SCURRY_LEVEL_MOUSE_FOLLOW } from "../../audio/audioMath";
import { CritterAudioController } from "../../audio/CritterAudioController";
import type { Critter } from "../../critters/Critter";
import { spawnCritter } from "../../critters/Critter";
import { getCritterType } from "../../critters/registry";
import { MouseFollowMovement } from "../../movement/MouseFollowMovement";
import type { MovementContext } from "../../movement/Movement";
import type { WiggleConfig } from "../../movement/wiggle";
import { wiggleAngleAt } from "../../movement/wiggle";
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
  /**
   * [UR4-2] この種別のユーザー指定表示サイズ倍率（UR4-1 の viewport sizeScale の上へ乗せる純増倍率）。
   * 省略/undefined は 1（従来サイズ）。start の spawnCritter へ渡す。manual は同時 1 体なので、倍率変更は
   * main が rebuildCurrent()（＝新 deps の factory で作り直し）で反映する。
   */
  sizeMultiplier?: number;
  /**
   * [UR4-3] この種別の効果音が有効かをライブに返す closure（省略時は常に true）。update と onPointerDown が
   * 毎回呼んで最新値を読むため、トグルは respawn なしで即反映される（size と違い present は毎フレーム判定）。
   * false の間は追従中の自動SE（走行音/自動チュー）もクリック鳴きも駆動しない（ループ＋one-shot 両 gate）。
   */
  isSoundEnabled?: () => boolean;
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
 * [UR4-5] `manualFollowMuteAutoSound` 種別（mouse）は追従中の自動SE(走行音＋自動チュー)を一切駆動しない
 * （update で audioCtrl へ present=false を渡し、move ループSE の gain=0 固定＋voice スケジューラ非発火に
 * する）。鳴き声は onPointerDown のクリック時のみ発火する＝「自動で鳴かず、クリックでのみ鳴く」。
 *
 * [UR3-6] onPointerDown は種別ごとのクリック挙動を担う（typeId 直書きでなく種別データで分岐）:
 *  - voice(鳴き声)SE があれば鳴らす（mouse→squeak。UR-3 のクリック鳴きをここへ移設）。
 *  - clickWiggle を持つ種別（おもちゃ）は、カーソル追従を止めずに一時的な回転 sway（フリフリ）を
 *    重ねる（動画モードの dangle sway と体感を揃え、短時間で減衰）。
 * どちらも持たない種別（foxtail/insect）は無音・無反応。worldX/worldY は本コントローラでは未使用だが、
 * UR-6 の虫クリック出現がこの引数で spawn 位置を決める拡張点になる。
 */
export class FollowManualController implements ManualController {
  private readonly deps: FollowManualControllerDeps;
  private readonly ctx: MovementContext;
  private readonly audioCtrl: CritterAudioController;
  /** [UR3-6] クリックでのフリフリ設定（種別が持てば非 null＝おもちゃ）。無い種別はフリフリしない。 */
  private readonly clickWiggle: WiggleConfig | null;
  /**
   * [UR4-5] 追従中に自動SE(走行音/自動チュー)を駆動するか。`manualFollowMuteAutoSound` 種別（mouse）は
   * false になり、update で audioCtrl へ present=false を渡して自動音を止める（鳴き声はクリック時のみ）。
   * 省略/false の種別は true＝従来どおり追従速度に連動して自動音を鳴らす。
   */
  private readonly drivesAutoAudio: boolean;
  /**
   * [UR4-3] この種別の効果音が有効かをライブに読む closure（deps.isSoundEnabled ?? 常に true）。
   * update/onPointerDown が毎回呼んで最新値を反映するため、SE トグルは respawn なしで即効く。
   */
  private readonly isSoundEnabled: () => boolean;
  private critter: Critter | null = null;
  private running = false;
  private paused = false;
  /**
   * [UR3-6] 進行中のフリフリ（クリックで開始・時間経過で減衰し終了で null）。elapsed は経過秒。
   * MouseFollowMovement は state.rotation を触らないため、これを追従の上へオーバーレイできる。
   */
  private wiggle: { elapsed: number } | null = null;

  constructor(deps: FollowManualControllerDeps) {
    this.deps = deps;
    // speedScale=1 で明示初期化（省略時1扱いだが意図を明確化）。update は world/pointer のみ
    // 上書きし speedScale は触らないため、mutate 再利用の ctx に設定は持続する。
    this.ctx = { world: deps.scene.worldBounds, pointer: null, speedScale: 1 };
    const type = getCritterType(deps.typeId);
    // ポインタ追従はピーク速度が大きい(~6480)ため、走行音写像は上方調整版で抑揚を残す。
    // sounds は種別定義から解決（mouse=チュー+走行 / foxtail・toys=空で無音 / insect=羽音）。
    this.audioCtrl = new CritterAudioController(deps.audio, type.sounds, {
      scurry: SCURRY_LEVEL_MOUSE_FOLLOW,
    });
    // クリック挙動は種別データで決める（おもちゃ=フリフリ / mouse=鳴き声のみ＝undefined）。
    this.clickWiggle = type.clickWiggle ?? null;
    // [UR4-5] mouse は追従中の自動SE(走行音/自動チュー)を鳴らさない（クリック鳴きのみ）。他種別は従来どおり。
    this.drivesAutoAudio = !(type.manualFollowMuteAutoSound ?? false);
    // [UR4-3] SE トグルをライブに読む（未指定は常に有効＝従来挙動）。
    this.isSoundEnabled = deps.isSoundEnabled ?? (() => true);
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
      // [UR4-1] 現在の viewport を渡して baseSize を解像度非依存にスケールする。
      viewport: vp,
      // [UR4-2] この種別のユーザー指定サイズ倍率を viewport sizeScale の上へ乗せる（未設定は 1）。
      sizeMultiplier: this.deps.sizeMultiplier,
    });
    scene.add(this.critter);
    this.audioCtrl.start();
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.wiggle = null;
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
    // [UR3-6] クリックのフリフリ（回転 sway オーバーレイ）を追従の上へ重ねる。MouseFollowMovement は
    // state.rotation を触らないため、critter.update(=movement→syncView) の前に rotation を設定すれば
    // 同フレームの syncView が pivot 周りの回転として反映する（追従＝位置/速度はそのまま継続）。
    // フリフリの時計は実 dt で進める（追従の speedScale とは独立のクリック演出）。
    if (this.wiggle && this.clickWiggle) {
      this.wiggle.elapsed += dtSeconds;
      if (this.wiggle.elapsed >= this.clickWiggle.durationSec) {
        this.wiggle = null;
        this.critter.state.rotation = 0;
      } else {
        this.critter.state.rotation = wiggleAngleAt(this.clickWiggle, this.wiggle.elapsed);
      }
    }
    this.critter.update(dtSeconds, this.ctx);
    const speed = Math.hypot(this.critter.state.velocity.x, this.critter.state.velocity.y);
    // [UR4-4] 追従中の critter の x 位置で走行音を左右定位する（画面左を走れば左、右なら右）。
    const pan = panFromX(this.critter.state.position.x, this.deps.scene.worldBounds.viewport.width);
    // 1 体で常に存在するため通常は present=true。[UR4-5] manualFollowMuteAutoSound 種別(mouse)は
    // present=false を渡し、自動SE(走行音 move ループの gain=0 固定＋voice スケジューラの自動チュー)を
    // 一切駆動しない（鳴き声は onPointerDown のクリック時のみ）。present=false 経路は pan を無視する。
    // [UR4-3] この種別のSEがオフなら present=false 相当で無音化する（走行音/自動チューを止める＝ループ gate）。
    // ライブに読むので respawn なしで即反映する（UR4-5 の drivesAutoAudio と合成＝どちらかが false なら無音）。
    this.audioCtrl.update(speed, dtSeconds, this.drivesAutoAudio && this.isSoundEnabled(), pan);
  }

  /**
   * クリック/タップ（world 座標）。種別ごとのクリック挙動を発火する:
   *  - voice(鳴き声)SE があれば即時再生（mouse→squeak）。pointerdown は信頼済みユーザージェスチャ
   *    なので AudioContext の resume 契機にもなる。
   *  - [UR3-6] clickWiggle を持つ種別（おもちゃ）は、追従を維持したままフリフリを (再)開始する
   *    （既にフリフリ中でも elapsed を 0 に戻して振り直す＝連打で振り続けられる）。
   * どちらも持たない種別（foxtail/insect）は無反応。worldX/worldY は UR-6 の受け皿（現状未使用）。
   */
  onPointerDown(_worldX: number, _worldY: number): void {
    const voice = getCritterType(this.deps.typeId).sounds.voice;
    // [UR4-3] この種別のSEがオフなら鳴き声(one-shot)を鳴らさない（mouse をオフにするとクリック鳴き squeak も
    // 止まる＝UR4-5 と整合。ループ gate と合わせて one-shot も gate し、その種別のSEを完全に止める）。
    if (voice && this.isSoundEnabled()) {
      // [UR4-4] クリック鳴きも現在の critter の x 位置で左右定位する（左を追従中は左から鳴く）。
      const pan = this.critter
        ? panFromX(this.critter.state.position.x, this.deps.scene.worldBounds.viewport.width)
        : 0;
      this.deps.audio.playOneShot(voice, pan);
    }
    if (this.clickWiggle) {
      this.wiggle = { elapsed: 0 };
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
      // [UR3-6] フリフリ検証用: sway 系(おもちゃ)は state.rotation が pivot 周りの揺れ角。flip 系では
      // view.rotation=0 のため、揺れは view.rotation でなくこの値に現れる（クリックで振れて減衰）。
      swayRotation: this.critter.state.rotation,
    };
  }
}
