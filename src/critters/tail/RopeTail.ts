import { MeshRope, Point, Texture } from "pixi.js";
import type { TailConfig } from "../CritterType";
import {
  createTailChain,
  resetTailChain,
  type TailChain,
  type TailChainParams,
  updateTailChain,
} from "./tailChain";

/** dt のクランプ上限(秒)。タブ復帰などの巨大 dt で尻尾を暴走させない。 */
const MAX_DT = 1 / 30;
/** 頭がこの倍率×全長を超えて瞬間移動したらチェーンをリセットする（resize 等の飛び対策）。 */
const TELEPORT_RESET_FACTOR = 1.5;
/** 元テクスチャ 541x90 の縦横比。texture が退化(1x1 等)した場合の width 算出フォールバック。 */
const FALLBACK_TEX_ASPECT = 90 / 541;

export interface RopeTailOptions {
  /** 尻尾テクスチャ（mouse-tail.webp 等。左=根元(attach) / 右=先端）。共有・破棄しない。 */
  texture: Texture;
  /** リボン幅(px)。テクスチャの縦横比を保つよう呼び出し側で算出する。 */
  width: number;
  /** 点数 N（MeshRope 分割数, 2 以上）。 */
  pointCount: number;
  /** 隣接点間の静止長(px)。全長 = segmentLength * (N-1)。 */
  segmentLength: number;
  /** チェーン物理パラメータ。 */
  params: TailChainParams;
  /** 初期の頭ワールド座標。 */
  headX: number;
  headY: number;
  /** 初期の後方単位ベクトル（頭から尻尾が伸びる向き）。 */
  backX: number;
  backY: number;
}

/**
 * MeshRope による尻尾コンポーネント（ワールド空間の物理トレイル）。
 *
 * 頭(point0)＝本体後方 attach のワールド座標を毎フレーム外から受け取り、{@link updateTailChain}
 * （純ロジック）でチェーンを 1 ステップ進め、結果を MeshRope の points（ワールド座標）へ in-place
 * 反映する。mesh は本体 view の子ではなく critters レイヤ（ワールド空間）へ置かれ、本体の回転から
 * 独立してトレイルする（頭だけが本体 attach に固定）。テクスチャは全個体で共有し破棄しない。
 */
export class RopeTail {
  readonly mesh: MeshRope;
  private readonly chain: TailChain;
  private readonly points: Point[];
  private readonly params: TailChainParams;
  /** 全長(px)。瞬間移動リセット判定に使う。 */
  private readonly totalLength: number;

  constructor(options: RopeTailOptions) {
    this.params = options.params;
    this.totalLength = options.segmentLength * (Math.max(2, options.pointCount) - 1);
    this.chain = createTailChain(
      options.pointCount,
      options.segmentLength,
      options.headX,
      options.headY,
      options.backX,
      options.backY,
    );
    // points は MeshRope と参照を共有し、in-place 更新で毎レンダー geometry が再計算される。
    this.points = this.chain.x.map((_, i) => new Point(this.chain.x[i], this.chain.y[i]));
    this.mesh = new MeshRope({
      texture: options.texture,
      points: this.points,
      width: options.width,
    });
    // mesh はワールド（critters レイヤ）へ無変換で置く＝points のワールド座標がそのまま画面座標。
    this.mesh.position.set(0, 0);
  }

  /**
   * 尻尾を 1 フレーム更新する。head はワールド座標の本体後方 attach、(backX,backY) は後方単位ベクトル。
   * 頭が全長を大きく超えて飛んだら（resize/タブ復帰）真っ直ぐ後方へリセットしてから反映する。
   */
  update(headX: number, headY: number, backX: number, backY: number, dt: number): void {
    const jx = headX - this.chain.x[0];
    const jy = headY - this.chain.y[0];
    const limit = this.totalLength * TELEPORT_RESET_FACTOR;
    if (jx * jx + jy * jy > limit * limit) {
      resetTailChain(this.chain, headX, headY, backX, backY);
    } else {
      updateTailChain(this.chain, headX, headY, dt, this.params);
    }
    for (let i = 0; i < this.points.length; i++) {
      this.points[i].x = this.chain.x[i];
      this.points[i].y = this.chain.y[i];
    }
  }

  /** 尻尾先端のワールド座標（静止検証・DEV フック用）。 */
  get tip(): { x: number; y: number } {
    const last = this.chain.n - 1;
    return { x: this.chain.x[last], y: this.chain.y[last] };
  }

  /**
   * 破棄: MeshRope（geometry/shader）を破棄する。テクスチャは共有のため破棄しない
   * （mesh.destroy() の既定は texture=false）。
   */
  destroy(): void {
    this.mesh.destroy();
  }
}

/**
 * {@link TailConfig}（正規化・係数指定）と表示寸法・初期状態から {@link RopeTail} を組み立てる。
 *
 * - 全長 = lengthFactor * displayWidth、セグメント長 = 全長 / (N-1)。
 * - リボン幅 = widthScale * (テクスチャ高/幅) * 全長 として渡すが、PixiJS の MeshRope は autoUpdate 時に
 *   毎フレーム geometry 幅をテクスチャ縦(px)へ上書きするため、実描画幅は「テクスチャ縦px」に固定される
 *   （＝widthScale は初期フレームのみで実質無効）。太さの調整はテクスチャの縦px側で行う。見た目のテーパー
 *   はテクスチャのアルファが担う（RopeGeometry の ratio による先細りは当バージョンでは未使用）。
 * - 頭/後方ベクトルは Critter が本体 state（位置・向き）から算出して渡す（ワールド空間）。
 */
export function createRopeTail(
  config: TailConfig,
  displayWidth: number,
  head: { headX: number; headY: number; backX: number; backY: number },
  texture?: Texture,
): RopeTail {
  const tex = texture ?? Texture.WHITE;
  const pointCount = Math.max(2, config.pointCount);
  const totalLength = config.lengthFactor * displayWidth;
  const segmentLength = totalLength / (pointCount - 1);
  const aspect = tex.width > 0 && tex.height > 0 ? tex.height / tex.width : FALLBACK_TEX_ASPECT;
  const width = config.widthScale * aspect * totalLength;
  const params: TailChainParams = {
    damping: config.damping,
    gravity: config.gravity,
    constraintIterations: config.constraintIterations,
    maxDt: MAX_DT,
  };
  return new RopeTail({
    texture: tex,
    width,
    pointCount,
    segmentLength,
    params,
    headX: head.headX,
    headY: head.headY,
    backX: head.backX,
    backY: head.backY,
  });
}
