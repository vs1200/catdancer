/**
 * [UR-4] マウス操作モードの「操作対象 1 種別ぶんの挙動」を抽象化するコントローラ。
 *
 * ManualMode（コーディネータ）は選択中 typeId のコントローラ 1 本を保持し、start/stop/setPaused/
 * setSpeedScale/update/onPointerDown/debugSnapshot を委譲する。種別切替では旧コントローラを stop→
 * 新規 create+start して差し替える（critter/pointer/audio をリークなく破棄）。
 *
 * UR-4 時点は全対象が {@link FollowManualController}（カーソル追従＝プレースホルダ）にマップされる。
 * UR-5（ねこじゃらしの画面端フリック）/ UR-6（虫のクリック出現・複数）は、この interface を実装した
 * 専用コントローラを factory マップに差し込むことで固有 manual 挙動へ置き換える拡張点になる。
 */

/**
 * DEV フック（QA の追従応答性計測）が使う観測スナップショット。
 * 従来 ManualMode.debugSnapshot が返していた形と同一（互換維持）。
 */
export interface ManualControllerSnapshot {
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
  /**
   * [UR-5b] 猫じゃらし固有の観測値（他コントローラでは未設定＝optional・QA 用）。
   * retract=しまう係数(0..1)、base=基部(hand)の world 座標（飛び出し端の可変検証）、
   * headRender=描画上の穂先（retract で画面外へ抜けるかの検証）。
   */
  retract?: number;
  base?: { x: number; y: number };
  headRender?: { x: number; y: number };
}

/** 操作対象 1 種別ぶんの manual 挙動。 */
export interface ManualController {
  /** 開始。必要な critter/入力配線/SE を確保する。多重呼び出しは冪等。 */
  start(): void;
  /** 終了。生成物を後始末する（despawn・入力解除・SE 停止）。多重呼び出しは冪等。 */
  stop(): void;
  /** 一時停止の切替（パネル開/タブ非表示）。 */
  setPaused(paused: boolean): void;
  /** 動きの速さ倍率を設定する（実行中でも即反映）。 */
  setSpeedScale(scale: number): void;
  /** 毎フレーム更新。dtSeconds は経過秒。 */
  update(dtSeconds: number): void;
  /**
   * canvas 上のクリック/タップ（world 座標）。種別に voice(鳴き声)SEがあれば鳴らす等、
   * 種別固有のクリック挙動を担う（UR-6 の虫クリック出現の受け皿）。
   */
  onPointerDown(worldX: number, worldY: number): void;
  /** DEV フック用の観測スナップショット。critter 未生成時は null。 */
  debugSnapshot(): ManualControllerSnapshot | null;
}

/** 操作対象コントローラの生成関数（ManualMode の factory マップの値）。 */
export type ManualControllerFactory = () => ManualController;
