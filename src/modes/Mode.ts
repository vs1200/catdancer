/**
 * 表示モードの抽象（Strategy）。main が設定に応じて 1 つを start/stop し、毎フレーム update する。
 *
 * - ManualMode: マウス操作。1 体のネズミをポインタへ慣性追従させる（v1 の挙動を包む）。
 * - AutoMode: 動画モード。一定間隔でオブジェクトを画面外から spawn → 横切り → 画面外で despawn。
 *
 * 各モードは自分が生成した critter・入力配線・SE を start/stop で完全に確保/解放する
 * （切替時にリーク・二重 spawn を出さない）。start/stop は多重呼び出しに対して冪等にする。
 */
export interface Mode {
  /** モード開始。必要な critter/入力/SE を確保する。 */
  start(): void;
  /** モード終了。生成物を後始末する（despawn・入力解除・SE 停止）。 */
  stop(): void;
  /** 毎フレーム更新。dtSeconds は経過秒。 */
  update(dtSeconds: number): void;
  /** 一時停止の切替（オプション画面表示中など）。true の間 update は何もしない。 */
  setPaused(paused: boolean): void;
}
