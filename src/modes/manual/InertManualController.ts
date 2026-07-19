import type { ManualController, ManualControllerSnapshot } from "./ManualController";

/**
 * [UR3-10] 何もしない manual コントローラ（critter を出さず・入力配線もしない・無音）。
 *
 * 任意画像（custom）を「操作するもの」に選んだが、まだ画像がロードされていない状態を表す。
 * このとき画面には critter を出さず、OptionsPanel の画像設定 UI だけを見せて待機する。
 * 画像がロードされると main.ts が {@link ManualMode.rebuildCurrent} を呼び、テクスチャありの
 * factory 分岐が {@link FollowManualController} を生成して追従を開始する（inert → 追従へ差し替え）。
 *
 * ManualController interface を全て no-op で満たす（start/stop/update などは冪等で副作用なし）。
 * debugSnapshot は critter 未生成として null を返す（DEV フックの追従計測は「未追従」と解釈できる）。
 */
export class InertManualController implements ManualController {
  start(): void {
    // no-op（critter/入力/SE を一切確保しない）。
  }

  stop(): void {
    // no-op（後始末する生成物が無い）。
  }

  setPaused(_paused: boolean): void {
    // no-op（一時停止する対象が無い）。
  }

  setSpeedScale(_scale: number): void {
    // no-op（動かす対象が無い）。
  }

  update(_dtSeconds: number): void {
    // no-op（更新する critter が無い）。
  }

  onPointerDown(_worldX: number, _worldY: number): void {
    // no-op（クリックで起こす挙動が無い）。
  }

  debugSnapshot(): ManualControllerSnapshot | null {
    return null;
  }
}
