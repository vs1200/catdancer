import type { Texture } from "pixi.js";
import { Sprite } from "pixi.js";
import type { PointerInput } from "../../app/PointerInput";
import type { Scene } from "../../app/Scene";
import type { Vec2 } from "../../core/vec2";
import {
  approach,
  approachAngle,
  computeBasePosition,
  computeHeadRender,
  computeRetract,
  distanceToNearestEdge,
  edgeOutwardAngle,
  type FoxtailEdge,
  foxtailLength,
  nearestEdge,
  springStep,
} from "./foxtailGeometry";
import type { ManualController, ManualControllerSnapshot } from "./ManualController";

/** {@link FoxtailManualController} の構築パラメータ。 */
export interface FoxtailManualControllerDeps {
  /** 手操作用の横向きねこじゃらしテクスチャ（foxtail-hand.webp。呼び出し側が Assets.load 済み）。 */
  handTexture: Texture;
  /** ポインタ入力（本コントローラが attach/detach を占有管理する。ManualMode 経由で共有）。 */
  pointer: PointerInput;
  scene: Scene;
}

// --- feel 調整用の主要 tunable 定数（メインが微調整しうる。各値の効きはコメント参照） ---

/**
 * foxtail 長 L = min(viewport幅,高さ) × この割合。基部(端)から穂先までの距離。
 * ネズミ(baseSize 220)より明確に大きく、画面の約半分を差し込む「大きな表示」にする。
 */
const FOXTAIL_LENGTH_FRAC = 0.52;

/** テクスチャ左端付近の「手で持つ基部」の正規化 x（asset: 茎の根元≈0.02）。回転/配置の pivot。 */
const BASE_ANCHOR_X = 0.02;

/**
 * バネ追従の剛性 k(=ω²) と減衰 c。ζ=c/(2√k)。ζ<1 で穂が遅れて振れる「ふりふり」。
 * k=360→ω≈19rad/s（時定数≈0.05s級の俊敏さ）、c=17→ζ≈0.45（軽いオーバーシュート＝生気）。
 * speedScale はここに効き、effK=k·s²・effC=c·s で ζ を保ったままバネ全体の反応速度を倍率変更する。
 */
const SPRING_STIFFNESS = 360;
const SPRING_DAMPING = 17;

/**
 * しまう(retract)判定: マウスが端からこの距離(px)以内で retract が 0→1 に立ち上がる。
 * プレイ領域内（端から十分離れている）では 0（出ている）。
 */
const RETRACT_THRESHOLD_PX = 96;

/**
 * retract=1 で rig 全体を端の外へスライドさせる距離(px)。穂先(tip)が端を越えて画面外へ隠れるだけの量。
 * tip のみが可視最内点なので、端＋この距離ぶん外へ出せば完全に隠れる。
 */
const RETRACT_SHIFT_PX = 240;

/** 端方向(基部の向き)を追う指数平滑の時定数(秒)。端切替の 90 度スナップを消す。 */
const OUTWARD_SMOOTH_TIME = 0.16;
/** retract 値を追う指数平滑の時定数(秒)。境界の滑らかさ（しまう/出るの遷移）。 */
const RETRACT_SMOOTH_TIME = 0.1;
/** 端切替のヒステリシス(px)。別の端がこれ以上近いときだけ乗り換える。 */
const EDGE_HYSTERESIS_PX = 80;

/** 穂の二次揺れ(生気)。回転へ載せる微小 sway の振幅(rad)と角周波数(rad/s)。過度でなく生きた感じ。 */
const SWAY_AMP_RAD = 0.05;
const SWAY_FREQ = 2 * Math.PI * 0.9;

/** バネ積分の 1 サブステップ上限(秒)。dt をこれ以下に刻んで数値安定(ω·dt≪1)を保証する。 */
const SPRING_SUBSTEP = 1 / 120;
/** update に渡る dt の上限(秒)。tab 復帰などの巨大 dt で暴れないようクランプ。 */
const MAX_DT = 0.05;
/** speedScale の許容域（極端値でバネが不安定化しないようクランプ）。 */
const SPEED_SCALE_MIN = 0.1;
const SPEED_SCALE_MAX = 3;

/**
 * [UR-5b] マウス操作モードの「ねこじゃらし」固有コントローラ。
 *
 * 人が画面端から大きな猫じゃらし(foxtail-hand.webp・横向き)を差し込んで振る挙動を、1 枚の Sprite を
 * 基部pivot(左端≈0.02)まわりに毎フレーム配置/回転して表現する:
 *  - 穂(head) はマウスへバネ的ラグで追従（{@link springStep}）＝速い振りで遅れて振れる「ふりふり」。
 *  - 基部(hand) は最寄り端(ヒステリシス選択・角度平滑)の外向きへ head から L 離れた点に置き、穂が
 *    中央寄りを向く。飛び出す端/位置はマウス位置で可変。
 *  - マウスが端に近いほど retract 0→1 で rig を端の外へスライドして隠す（しまえる）。
 *  - 穂に微小 sway を足して静止時も生きた感じにする。speedScale はバネの反応速度に効く。
 *
 * 音声/尻尾は無し（foxtail は元々無音）。onPointerDown は no-op。Sprite/リソースは stop で確実に破棄し、
 * 種別切替でのリークを防ぐ（共有テクスチャは破棄しない）。動画(auto)モードの foxtail.webp には非干渉。
 */
export class FoxtailManualController implements ManualController {
  private readonly deps: FoxtailManualControllerDeps;
  private sprite: Sprite | null = null;
  private running = false;
  private paused = false;
  private speedScale = 1;

  // 物理状態（毎フレーム更新。純ロジックは foxtailGeometry へ切り出し）。
  private readonly head: Vec2 = { x: 0, y: 0 };
  private readonly headVel: Vec2 = { x: 0, y: 0 };
  private lastPointer: Vec2 = { x: 0, y: 0 };
  private currentEdge: FoxtailEdge | null = null;
  private outwardAngle = Math.PI; // 既定は左端外向き(左から差し込む)
  private retract = 0;
  private time = 0;
  // 観測用（debugSnapshot）。
  private heading = 0;
  private base: Vec2 = { x: 0, y: 0 };
  private headRender: Vec2 = { x: 0, y: 0 };

  constructor(deps: FoxtailManualControllerDeps) {
    this.deps = deps;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.paused = false;
    const { scene, pointer, handTexture } = this.deps;
    pointer.attach();
    pointer.centerToViewport();
    const vp = scene.worldBounds.viewport;
    const center = { x: vp.width / 2, y: vp.height / 2 };
    // 中央から開始（起動時に画面内に猫じゃらしが居るように）。
    this.head.x = center.x;
    this.head.y = center.y;
    this.headVel.x = 0;
    this.headVel.y = 0;
    this.lastPointer = { ...center };
    this.currentEdge = nearestEdge(center.x, center.y, vp, null, EDGE_HYSTERESIS_PX);
    this.outwardAngle = edgeOutwardAngle(this.currentEdge);
    this.retract = 0;
    this.time = 0;

    const sprite = new Sprite(handTexture);
    // pivot=基部(左端≈0.02, 縦中央)。ここを支点に回して端→穂の向きへ差し込む。
    sprite.anchor.set(BASE_ANCHOR_X, 0.5);
    scene.critters.addChild(sprite);
    this.sprite = sprite;
    // 初期フレームを 1 度描いておく（start 直後の 1 フレーム分の見えを整える）。
    this.render(vp);
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.deps.pointer.detach();
    if (this.sprite) {
      // 表示レイヤから外して破棄（共有テクスチャは破棄しない＝切替でリークしない）。
      this.deps.scene.critters.removeChild(this.sprite);
      this.sprite.destroy({ texture: false, textureSource: false });
      this.sprite = null;
    }
  }

  /** バネ追従の反応速度に効く倍率（実行中でも即反映。ζ を保ったまま速さだけ変える）。 */
  setSpeedScale(scale: number): void {
    this.speedScale = scale;
  }

  /**
   * 一時停止の切替。paused 中はポインタを外し中央へ寄せて、パネル操作で穂が飛ばないようにする
   * （FollowManualController に倣う）。復帰でポインタを再配線する。update は paused 中 no-op。
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
    if (!this.running || this.paused || !this.sprite) {
      return;
    }
    const dt = Math.min(Math.max(dtSeconds, 0), MAX_DT);
    if (dt <= 0) {
      return;
    }
    this.time += dt;
    const vp = this.deps.scene.worldBounds.viewport;
    const pointer = this.deps.pointer.pointer.value;

    // 追従目標と retract 目標・最寄り端を決める。
    let retractTarget: number;
    if (pointer) {
      this.lastPointer = { x: pointer.x, y: pointer.y };
      this.currentEdge = nearestEdge(
        pointer.x,
        pointer.y,
        vp,
        this.currentEdge,
        EDGE_HYSTERESIS_PX,
      );
      const dist = distanceToNearestEdge(pointer.x, pointer.y, vp);
      retractTarget = computeRetract(dist, RETRACT_THRESHOLD_PX);
    } else {
      // ウィンドウ外へ出た → しまう（穂を端の外へ引っ込める）。head は最後の位置へ収束させる。
      retractTarget = 1;
    }
    const target = this.lastPointer;

    // 1) 穂をバネ的ラグでマウスへ追従（サブステップで数値安定）。speedScale で反応速度を倍率変更。
    const s = Math.min(SPEED_SCALE_MAX, Math.max(SPEED_SCALE_MIN, this.speedScale));
    const effK = SPRING_STIFFNESS * s * s;
    const effC = SPRING_DAMPING * s;
    let remaining = dt;
    while (remaining > 1e-6) {
      const h = Math.min(SPRING_SUBSTEP, remaining);
      springStep(this.head, this.headVel, target, effK, effC, h);
      remaining -= h;
    }

    // 2) 基部の向き(端外向き角)と retract を滑らかに追う（端切替スナップ/境界のガタつきを消す）。
    const edge = this.currentEdge ?? "left";
    this.outwardAngle = approachAngle(
      this.outwardAngle,
      edgeOutwardAngle(edge),
      OUTWARD_SMOOTH_TIME,
      dt,
    );
    this.retract = approach(this.retract, retractTarget, RETRACT_SMOOTH_TIME, dt);

    this.render(vp);
  }

  /** 現在の状態から Sprite の位置/回転/スケールを更新する（毎フレーム＋start 初期化）。 */
  private render(vp: { width: number; height: number }): void {
    if (!this.sprite) {
      return;
    }
    const length = foxtailLength(vp, FOXTAIL_LENGTH_FRAC);
    const outward: Vec2 = { x: Math.cos(this.outwardAngle), y: Math.sin(this.outwardAngle) };
    const retractShift = this.retract * RETRACT_SHIFT_PX;

    // 基部(配置点)= head + outward·(L + retractShift)。穂は基部から内側(=中央寄り)を向く。
    this.base = computeBasePosition(this.head, outward, length, retractShift);
    this.headRender = computeHeadRender(this.head, outward, retractShift);
    // 回転: 基部→穂 の向き = 外向きの逆(inward)。straight 素材なので atan2(-outward)＝outwardAngle+π。
    this.heading = this.outwardAngle + Math.PI;
    // 微小 sway を足して静止時も生きた感じに（過度でなく）。
    const sway = SWAY_AMP_RAD * Math.sin(this.time * SWAY_FREQ);

    // スケール: 基部pivot(0.02)から穂先(1.0)までの表示長を L に合わせる（大きく表示）。
    const scale = length / ((1 - BASE_ANCHOR_X) * this.deps.handTexture.width);
    this.sprite.scale.set(scale);
    this.sprite.position.set(this.base.x, this.base.y);
    this.sprite.rotation = this.heading + sway;
  }

  /** onPointerDown は特段の要求なし（no-op）。 */
  onPointerDown(_worldX: number, _worldY: number): void {}

  /**
   * DEV フック用の観測スナップショット。position=論理 head(穂の spring 位置)＝pointer との距離が
   * 「ふりふり(バネラグ)」の指標になる。base/headRender/retract は飛び出し端の可変・しまうの検証用。
   */
  debugSnapshot(): ManualControllerSnapshot | null {
    if (!this.sprite) {
      return null;
    }
    const p = this.deps.pointer.pointer.value;
    return {
      position: { x: this.head.x, y: this.head.y },
      velocity: { x: this.headVel.x, y: this.headVel.y },
      pointer: p ? { x: p.x, y: p.y } : null,
      running: this.running,
      paused: this.paused,
      heading: this.heading,
      viewRotation: this.sprite.rotation,
      viewScaleY: this.sprite.scale.y,
      tailTip: null,
      retract: this.retract,
      base: { x: this.base.x, y: this.base.y },
      headRender: { x: this.headRender.x, y: this.headRender.y },
    };
  }
}
