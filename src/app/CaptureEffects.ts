import { type Container, Graphics } from "pixi.js";
import { CAPTURE_BURST_DURATION_SEC, captureBurstVisual } from "./captureBurst";

/**
 * 同時に存在できるバースト数の上限。連続捕獲でも現実的には少数だが、暴走（描画物の際限ない
 * 増加＝リーク）を防ぐため頭打ちにする。超過時は最古の 1 発を即 destroy して席を空ける
 * （無音で溢れさせない）。
 */
const MAX_ACTIVE_BURSTS = 24;

/** リング本体の基準半径(px, scale=1 のときの半径)。実表示は captureBurstVisual の scale を掛ける。 */
const RING_BASE_RADIUS_PX = 46;
/** リング線幅(px)。細めで穏やか（猫を驚かさない）。 */
const RING_STROKE_WIDTH_PX = 4;
/**
 * 演出色（淡い暖色の明色）。背景色に依存せず視認でき、かつ穏やかな“きらめき”。
 * 全体の消え方は Graphics.alpha（captureBurstVisual の alpha）が駆動する。
 */
const BURST_COLOR = 0xfff2c4;
/** リング線の基準 alpha（全体 alpha に乗算される）。 */
const RING_STROKE_ALPHA = 0.95;

/** 添える粒（きらめき）の数。scale 拡大に乗って外へ飛ぶ火花のように見える。 */
const SPARK_COUNT = 5;
/** 粒の配置半径(px, scale=1 基準)。リングより内側に置き、拡大で外へ広がる。 */
const SPARK_ORBIT_RADIUS_PX = 26;
/** 粒 1 つの半径(px, scale=1 基準)。 */
const SPARK_DOT_RADIUS_PX = 3;
/** 粒の基準 alpha（全体 alpha に乗算される）。 */
const SPARK_ALPHA = 0.9;

/** 進行中のバースト 1 発。 */
interface Burst {
  /** 単位図形を 1 度だけ描いた Graphics。毎フレームは transform(scale) と alpha のみ更新する。 */
  gfx: Graphics;
  /** 経過時間(秒)。progress = elapsed / DURATION。 */
  elapsed: number;
}

/**
 * 捕獲成功の視覚演出（バースト）を管理する（PixiJS 描画層）。
 *
 * 設計方針:
 * - 描画先 Container（= scene.effects, critter より前面）をコンストラクタで受け取る。
 * - burst(worldX, worldY) で world 座標に短命リングを 1 つ生成・開始（複数同時発火可）。
 * - リング本体は Graphics（テクスチャ不要＝共有テクスチャ問題が無く leak-safe）。単位図形
 *   （リング＋数個の粒）を 1 度だけ描き、毎フレームは scale と alpha のみ更新して再描画しない。
 * - update(dt) で全演出を進め、captureBurstVisual で scale/alpha を反映。progress>=1 で終了した
 *   ものは layer から removeChild して確実に destroy し、内部リストから in-place 除去する
 *   （毎フレーム配列を作り直さない後方走査）。
 * - destroy() で進行中の全演出を removeChild+destroy して内部リストを空にする（アプリ破棄/
 *   将来の再マウント用）。
 * - leak 厳守: 終了時・destroy 時・上限超過時のいずれも必ず gfx.destroy() する。Graphics には
 *   外部テクスチャを割り当てないため、destroy 既定で自前 context のみ解放され共有物は触らない。
 */
export class CaptureEffects {
  private readonly layer: Container;
  /** 進行中のバースト集合。後方走査で in-place 除去し、毎フレームの配列再生成を避ける。 */
  private readonly active: Burst[] = [];

  constructor(layer: Container) {
    this.layer = layer;
  }

  /** 進行中の演出数（DEV フック・リーク検証で「捕獲後しばらくして 0 に戻る」ことを観測する）。 */
  get activeCount(): number {
    return this.active.length;
  }

  /**
   * world 座標 (x,y) にリング演出を 1 つ生成して開始する（連続捕獲に耐えるよう複数同時発火可）。
   * 上限超過時は最古の 1 発を即 destroy して席を空ける（無音で溢れさせない）。
   */
  burst(worldX: number, worldY: number): void {
    // 上限超過: 最古の 1 発を removeChild+destroy して席を空ける（描画物を溢れさせない）。
    if (this.active.length >= MAX_ACTIVE_BURSTS) {
      const oldest = this.active.shift();
      if (oldest) {
        this.layer.removeChild(oldest.gfx);
        oldest.gfx.destroy();
      }
    }

    const gfx = new Graphics();
    // 単位図形を 1 度だけ描く（以降は scale/alpha のみ更新＝再描画しない）。
    gfx.circle(0, 0, RING_BASE_RADIUS_PX).stroke({
      width: RING_STROKE_WIDTH_PX,
      color: BURST_COLOR,
      alpha: RING_STROKE_ALPHA,
    });
    // 添える粒（きらめき）。リングと同じ Graphics に描くので destroy は 1 回で済む（leak-safe）。
    for (let i = 0; i < SPARK_COUNT; i++) {
      const angle = (i / SPARK_COUNT) * Math.PI * 2;
      const dx = Math.cos(angle) * SPARK_ORBIT_RADIUS_PX;
      const dy = Math.sin(angle) * SPARK_ORBIT_RADIUS_PX;
      gfx.circle(dx, dy, SPARK_DOT_RADIUS_PX).fill({ color: BURST_COLOR, alpha: SPARK_ALPHA });
    }

    gfx.position.set(worldX, worldY);
    const v = captureBurstVisual(0);
    gfx.scale.set(v.scale);
    gfx.alpha = v.alpha;

    this.layer.addChild(gfx);
    this.active.push({ gfx, elapsed: 0 });
  }

  /**
   * 進行中の全演出を 1 フレーム進める。progress>=1 で終了したものは removeChild+destroy して
   * 内部リストから外す（後方走査で in-place 除去＝配列を作り直さない）。
   */
  update(dtSeconds: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      b.elapsed += dtSeconds;
      const progress = b.elapsed / CAPTURE_BURST_DURATION_SEC;
      if (progress >= 1) {
        this.layer.removeChild(b.gfx);
        b.gfx.destroy();
        this.active.splice(i, 1);
        continue;
      }
      const v = captureBurstVisual(progress);
      b.gfx.scale.set(v.scale);
      b.gfx.alpha = v.alpha;
    }
  }

  /**
   * 進行中の全演出を removeChild+destroy して内部リストを空にする（アプリ破棄/再マウント用の後始末）。
   */
  destroy(): void {
    for (let i = 0; i < this.active.length; i++) {
      const b = this.active[i];
      this.layer.removeChild(b.gfx);
      b.gfx.destroy();
    }
    this.active.length = 0;
  }
}
