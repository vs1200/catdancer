import type { Scene } from "../app/Scene";
import type { WorldBounds } from "../core/worldBounds";
import { hasExitedWorld } from "../movement/CrossMovement";
import type { MovementContext } from "../movement/Movement";
import type { Critter, SpawnCritterParams } from "./Critter";
import { spawnCritter } from "./Critter";

/** タップ当たり判定の半径係数（critter の最大辺 size に対する比）。AutoMode と同一。 */
const HIT_RADIUS_FACTOR = 0.6;
/** タップ当たり判定の最小半径(px)。小さい critter でも指先が当たる下限。AutoMode と同一。 */
const MIN_HIT_RADIUS = 28;

/** critter の当たり半径(px)。size ベース＋指先が当たる下限。 */
function hitRadius(size: number): number {
  return Math.max(size * HIT_RADIUS_FACTOR, MIN_HIT_RADIUS);
}

/** {@link CritterPopulation} の構築パラメータ。 */
export interface CritterPopulationDeps {
  /** 生成物の追加/破棄先。表示レイヤとアクティブ集合を握る。 */
  scene: Scene;
  /**
   * critter ファクトリ（テスト差し替え用。既定 {@link spawnCritter}）。
   * Pixi 生成をここへ閉じ込めるための唯一の seam（node テストは fake を注入して Pixi 非依存で回す）。
   */
  createCritter?: (params: SpawnCritterParams) => Critter;
}

/**
 * [RF-S0] 複数 critter を持つコントローラ（manual/auto）に散在していた
 * 「active list 管理・自己修復 prune（破棄済み critter の除去）・world 退出/expired despawn・
 * tap hit-test」の重複を一点集約する Facade。Pixi 依存（{@link spawnCritter} / {@link Scene}）は
 * ここに閉じ、呼び出し側は spawn 方針・cap/evict・音声など固有ロジックだけを持てばよい。
 *
 * 本ステップでは {@link import("../modes/manual/InsectManualController")} が委譲する。
 * cap/evict や spawn 計画・羽音は呼び出し側（Insect 固有）に残す（Population は「identically
 * 重複している機構」のみを担う）ため、Population はいつ/どう spawn するかを一切決めない。
 */
export class CritterPopulation {
  private readonly scene: Scene;
  private readonly createCritter: (params: SpawnCritterParams) => Critter;
  /**
   * アクティブな critter 集合（生成順を保つ）。cap/evict の「最古」判定に呼び出し側が
   * {@link list} を参照できるよう、push 追加・in-place 除去で順序を維持する。
   */
  private readonly active: Critter[] = [];

  constructor(deps: CritterPopulationDeps) {
    this.scene = deps.scene;
    this.createCritter = deps.createCritter ?? spawnCritter;
  }

  /**
   * 指定 params で critter を生成し、Scene（表示レイヤ＋アクティブ集合）と内部 list に載せる。
   * spawn 方針（どこに/いつ出すか・cap/evict）は呼び出し側の責務で、ここは「生成→追加→追跡」のみ。
   */
  spawn(params: SpawnCritterParams): Critter {
    const critter = this.createCritter(params);
    this.scene.add(critter);
    this.active.push(critter);
    return critter;
  }

  /** アクティブ critter の読み取り専用ビュー（cap/evict の最古参照・走査用。改変しないこと）。 */
  get list(): readonly Critter[] {
    return this.active;
  }

  /** 現在のアクティブ critter 数。 */
  get count(): number {
    return this.active.length;
  }

  /**
   * 毎フレーム更新: 自己修復 prune → 全 critter 更新の順で行う。
   * - 自己修復 prune: 外部 despawn（DEV `__catScene.clear()` 等）で破棄された critter を内部 list から
   *   除去する。破棄済み Container を更新すると syncView が null 参照でクラッシュするため後方走査で splice。
   *   既に destroy 済みなので {@link Scene.despawn} は呼ばない（二重破棄回避＝#48 と同一挙動）。
   * - 更新: 残った critter を index 走査で更新（配列を作り直さない）。
   *
   * despawn 判定（world 退出/expired）は含めない。呼び出し側が更新後に {@link reapExited} を呼ぶ
   * （順序: prune → update → reap を呼び出し側が保つ）。
   */
  update(dtSeconds: number, ctx: MovementContext): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (this.active[i].destroyed) {
        this.active.splice(i, 1);
      }
    }
    for (let i = 0; i < this.active.length; i++) {
      this.active[i].update(dtSeconds, ctx);
    }
  }

  /**
   * world 外へ抜けた（{@link hasExitedWorld}）／退場アニメ完了（{@link Critter.hasExpired}）critter を
   * despawn（完全破棄）し内部 list から除去する（後方走査で in-place 除去＝配列を作り直さない）。
   */
  reapExited(world: WorldBounds): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const c = this.active[i];
      if (hasExitedWorld(c.state.position, world) || c.hasExpired) {
        this.active.splice(i, 1);
        this.scene.despawn(c);
      }
    }
  }

  /**
   * 指定 critter を despawn（完全破棄）し内部 list から除去する。
   * cap/evict で呼び出し側が {@link list} から選んだ 1 体（最古など）を退場させる用途。
   */
  despawn(critter: Critter): void {
    const i = this.active.indexOf(critter);
    if (i >= 0) {
      this.active.splice(i, 1);
    }
    this.scene.despawn(critter);
  }

  /** 全 critter を despawn（完全破棄）して list を空にする（種別切替/停止時の後始末）。 */
  despawnAll(): void {
    for (let i = 0; i < this.active.length; i++) {
      this.scene.despawn(this.active[i]);
    }
    this.active.length = 0;
  }

  /**
   * world 座標 (x,y) を全 critter とヒットテストし、当たり半径（{@link hitRadius}＝size ベース＋
   * 指先下限）内で最も近い 1 体を返す（誰にも当たらなければ null）。AutoMode の捕獲(flee)ヒット
   * テストと同一ロジック（将来の AutoMode 委譲用。Insect は使わない）。
   */
  hitTest(worldX: number, worldY: number): Critter | null {
    let best: Critter | null = null;
    let bestDistSq = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.active.length; i++) {
      const c = this.active[i];
      const dx = c.state.position.x - worldX;
      const dy = c.state.position.y - worldY;
      const distSq = dx * dx + dy * dy;
      const radius = hitRadius(c.state.size);
      if (distSq <= radius * radius && distSq < bestDistSq) {
        best = c;
        bestDistSq = distSq;
      }
    }
    return best;
  }
}
