import type { Mode } from "./Mode";
import type {
  ManualController,
  ManualControllerFactory,
  ManualControllerSnapshot,
} from "./manual/ManualController";

export interface ManualModeDeps {
  /**
   * 操作対象 typeId → コントローラ factory のマップ。UR-4 では全対象が FollowManualController に
   * マップされる（全種カーソル追従）。UR-5/UR-6 は foxtail/insect のエントリを専用コントローラの
   * factory に差し替えることで固有 manual 挙動へ置き換える拡張点になる。
   */
  factories: Map<string, ManualControllerFactory>;
  /** 起動時の操作対象 typeId（factories に無ければ fallback へ正規化する）。 */
  initialTypeId: string;
  /** 選択解決の最終フォールバック typeId（通常 mouse。必ず factories に存在すること）。 */
  fallbackTypeId: string;
}

/**
 * [UR-4] マウス操作モードのコーディネータ。選択中 typeId の {@link ManualController} 1 本を保持し、
 * start/stop/setPaused/setSpeedScale/update/onPointerDown/debugSnapshot を委譲する。
 *
 * 従来のネズミ 1 体固定を「操作対象を選べる基盤」へ一般化した。実挙動は各コントローラが担い、本クラスは
 * ライフサイクル管理と種別切替（{@link setManualType}）に集中する。切替では旧コントローラを stop→新規
 * create+start で差し替え、critter/pointer/audio をリークなく破棄する（同時に出るのは常に 1 体）。
 * speedScale/paused はコーディネータが保持し、切替後の新コントローラへ再適用して状態を引き継ぐ。
 */
export class ManualMode implements Mode {
  private readonly factories: Map<string, ManualControllerFactory>;
  private readonly fallbackTypeId: string;
  private currentTypeId: string;
  private controller: ManualController | null = null;
  private running = false;
  private paused = false;
  /** 現在の速度倍率（コントローラ切替をまたいで保持し、新コントローラへ再適用する）。 */
  private speedScale = 1;

  constructor(deps: ManualModeDeps) {
    this.factories = deps.factories;
    this.fallbackTypeId = deps.fallbackTypeId;
    this.currentTypeId = this.resolveTypeId(deps.initialTypeId);
  }

  /** factories に存在する typeId ならそのまま、無ければ fallback へ解決する。 */
  private resolveTypeId(typeId: string): string {
    return this.factories.has(typeId) ? typeId : this.fallbackTypeId;
  }

  /** 現在の操作対象 typeId（DEV フック/検証の観測用）。 */
  get currentType(): string {
    return this.currentTypeId;
  }

  /** 現在の typeId のコントローラを生成し、保持中の speedScale を反映して返す。 */
  private createController(): ManualController {
    const factory =
      this.factories.get(this.currentTypeId) ?? this.factories.get(this.fallbackTypeId);
    if (!factory) {
      throw new Error(`manual コントローラの factory がありません: ${this.currentTypeId}`);
    }
    const controller = factory();
    controller.setSpeedScale(this.speedScale);
    return controller;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.paused = false;
    this.controller = this.createController();
    this.controller.start();
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.controller?.stop();
    this.controller = null;
  }

  /**
   * 操作対象を切り替える（実行中でも即反映）。旧コントローラを stop→新種別で create+start し、
   * 前の 1 体（critter/pointer/audio）をリークなく破棄して新 1 体のみにする。paused 中の切替では
   * 新コントローラにも paused を再適用して状態を保つ（パネル開いたまま種別変更時など）。
   */
  setManualType(typeId: string): void {
    const next = this.resolveTypeId(typeId);
    if (next === this.currentTypeId) {
      return;
    }
    this.currentTypeId = next;
    if (!this.running || !this.controller) {
      return; // 未起動なら typeId 更新のみ（次の start が新種別で立ち上げる）。
    }
    this.controller.stop();
    const controller = this.createController();
    this.controller = controller;
    controller.start();
    if (this.paused) {
      controller.setPaused(true);
    }
  }

  /** 動きの速さ倍率を設定する（保持しつつ現行コントローラへ即反映）。 */
  setSpeedScale(scale: number): void {
    this.speedScale = scale;
    this.controller?.setSpeedScale(scale);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.controller?.setPaused(paused);
  }

  update(dtSeconds: number): void {
    this.controller?.update(dtSeconds);
  }

  /** クリック/タップ（world 座標）を現行コントローラへ委譲する（種別固有のクリック挙動）。 */
  onPointerDown(worldX: number, worldY: number): void {
    this.controller?.onPointerDown(worldX, worldY);
  }

  /** DEV フック用の観測スナップショット（現行コントローラへ委譲。未起動/未生成は null）。 */
  debugSnapshot(): ManualControllerSnapshot | null {
    return this.controller?.debugSnapshot() ?? null;
  }
}
