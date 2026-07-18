import type { Texture } from "pixi.js";
import { MeshRope, Point } from "pixi.js";
import type { Vec2 } from "../../core/vec2";
import type { TailConfig } from "../CritterType";
import { computeTailPoints, type TailParams } from "./computeTailPoints";
import { createTailTexture } from "./tailTexture";

export interface RopeTailOptions {
  /** 揺れ・形状の純パラメータ（付け根 local 座標系）。 */
  params: TailParams;
  /** リボンの太さ(px)。RopeGeometry は一定幅のため付け根太さの目安になる。 */
  width: number;
  /** 付け根の配置（Critter Container ローカル座標, px）。 */
  attach: Vec2;
  /** 差し込みテクスチャ（省略時は手続き生成）。 */
  texture?: Texture;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * MeshRope による尻尾コンポーネント。
 * {@link computeTailPoints}（純ロジック）の結果を毎フレーム MeshRope の points 配列へ
 * 反映して「紐のように揺れる」動きを出す。points は MeshRope と参照を共有し、
 * autoUpdate(既定 true) により毎レンダーでジオメトリが再計算される。
 *
 * Container の子として attach point に置き、Critter の Container 反転(scale.x)で
 * 本体と一緒に反転する。points は -x へ伸ばしてあるため、左向き時は +x=体の後方へ回る。
 */
export class RopeTail {
  readonly mesh: MeshRope;
  private readonly baseParams: TailParams;
  private readonly points: Point[];
  private readonly texture: Texture;
  /** テクスチャを自前生成したか（＝破棄責任を持つか）。共有テクスチャ渡しなら false。 */
  private readonly ownsTexture: boolean;

  constructor(options: RopeTailOptions) {
    this.baseParams = options.params;
    // 共有テクスチャを渡されたらそれを使い破棄しない。省略時のみ自前生成し破棄責任を持つ
    // （AutoMode の多数 spawn では共有テクスチャを渡してテクスチャの都度生成/リークを避ける）。
    this.ownsTexture = options.texture === undefined;
    this.texture = options.texture ?? createTailTexture();
    const initial = computeTailPoints(this.baseParams, 0);
    this.points = initial.map((p) => new Point(p.x, p.y));
    this.mesh = new MeshRope({ texture: this.texture, points: this.points, width: options.width });
    this.mesh.position.set(options.attach.x, options.attach.y);
  }

  /**
   * 尻尾を更新する。timeSec は経過秒。
   * intensity(0..1) は移動速度連動の勢い。振幅と速さをわずかに増して生き生きさせる。
   */
  update(timeSec: number, intensity = 0): void {
    const i = clamp01(intensity);
    const params: TailParams = {
      ...this.baseParams,
      amplitude: this.baseParams.amplitude * (1 + 0.5 * i),
      speed: this.baseParams.speed * (1 + 0.7 * i),
    };
    const pts = computeTailPoints(params, timeSec);
    for (let k = 0; k < this.points.length; k++) {
      // Point を in-place 更新（配列参照は MeshRope と共有）。
      this.points[k].x = pts[k].x;
      this.points[k].y = pts[k].y;
    }
  }

  /** 単体破棄: MeshRope（geometry）を破棄し、自前生成テクスチャなら解放する。 */
  destroy(): void {
    this.mesh.destroy();
    this.releaseTexture();
  }

  /**
   * 自前生成テクスチャのみを解放する（共有テクスチャは解放しない）。
   * mesh を親 Container 側でまとめて破棄する場合に、テクスチャの取りこぼしを防ぐため使う
   * （mesh の二重破棄を避けつつ、生成テクスチャのリークだけを塞ぐ）。
   */
  releaseTexture(): void {
    if (this.ownsTexture) {
      this.texture.destroy(true);
    }
  }
}

/**
 * {@link TailConfig}（正規化・係数指定）と表示寸法から {@link RopeTail} を組み立てる。
 * attach は本体テクスチャの正規化座標(0..1, 左上原点)を Container ローカル px へ変換する
 * （sprite は anchor 0.5 = 中心が Container 原点）。各 *Factor は表示幅に対する比率。
 */
export function createRopeTail(
  config: TailConfig,
  displayWidth: number,
  displayHeight: number,
  texture?: Texture,
): RopeTail {
  const attach: Vec2 = {
    x: (config.attach.x - 0.5) * displayWidth,
    y: (config.attach.y - 0.5) * displayHeight,
  };
  const params: TailParams = {
    pointCount: config.pointCount,
    length: config.lengthFactor * displayWidth,
    baseSag: config.sagFactor * displayWidth,
    amplitude: config.amplitudeFactor * displayWidth,
    amplitudeExponent: config.amplitudeExponent,
    waveCount: config.waveCount,
    speed: config.speed,
    phase: 0,
  };
  return new RopeTail({
    params,
    width: config.thicknessFactor * displayWidth,
    attach,
    texture,
  });
}
