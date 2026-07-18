/**
 * Fullscreen API の薄いラッパと純ヘルパ。
 *
 * 責務分離: DOM 非依存の純関数（ボタン文言生成）と、document に触れる副作用関数
 * （feature 検出・状態取得・要求/解除/トグル）を本モジュールへ集約する。OptionsPanel は
 * 本モジュールを呼ぶだけで、Fullscreen API の細部（reject の握りつぶし・feature 検出の勘所）を
 * 知らずに済む。
 *
 * テスト方針: 純関数（fullscreenButtonLabel / fullscreenButtonAriaLabel）のみ node env の
 * Vitest 対象。document に触れる関数は DOM 依存のため node テスト対象外（jsdom を使わない）。
 */

/**
 * Fullscreen API が使えるか（feature 検出）。DOM 依存・node テスト対象外。
 *
 * requestFullscreen メソッドの存在のみでゲートする。document.fullscreenEnabled は
 * permissions policy で false になり得（ヘッドレス等では検証不能になる）ため、ゲートには使わない。
 */
export function isFullscreenSupported(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof document.documentElement?.requestFullscreen === "function"
  );
}

/**
 * 現在アプリが全画面表示中か。DOM 依存・node テスト対象外。
 * document.fullscreenElement の有無で判定する。
 */
export function isFullscreenActive(): boolean {
  return typeof document !== "undefined" && document.fullscreenElement != null;
}

/**
 * ルート要素を全画面表示にする。DOM 依存・node テスト対象外。
 *
 * requestFullscreen はユーザージェスチャ外や権限拒否で reject するため、reject は catch して
 * 握りつぶし console.warn に留める（unhandledrejection を出さない）。
 */
export async function requestAppFullscreen(): Promise<void> {
  const el = document.documentElement;
  if (typeof el?.requestFullscreen !== "function") {
    return;
  }
  try {
    await el.requestFullscreen();
  } catch (error) {
    console.warn("全画面表示に失敗しました。", error);
  }
}

/**
 * 全画面表示を解除する。DOM 依存・node テスト対象外。
 * active の時のみ exitFullscreen を呼び、reject は catch して握りつぶす。
 */
export async function exitAppFullscreen(): Promise<void> {
  if (!isFullscreenActive()) {
    return;
  }
  try {
    await document.exitFullscreen();
  } catch (error) {
    console.warn("全画面の解除に失敗しました。", error);
  }
}

/**
 * 全画面表示をトグルする。DOM 依存・node テスト対象外。
 * active なら解除、そうでなければ要求する。
 */
export async function toggleAppFullscreen(): Promise<void> {
  if (isFullscreenActive()) {
    await exitAppFullscreen();
  } else {
    await requestAppFullscreen();
  }
}

/**
 * 全画面トグルボタンの表示文言を返す純関数。
 * active なら「全画面を解除」、そうでなければ「全画面表示」。
 */
export function fullscreenButtonLabel(active: boolean): string {
  return active ? "全画面を解除" : "全画面表示";
}

/**
 * 全画面トグルボタンの aria-label 用文言を返す純関数。
 * active なら「全画面表示を解除」、そうでなければ「全画面表示にする」。
 */
export function fullscreenButtonAriaLabel(active: boolean): string {
  return active ? "全画面表示を解除" : "全画面表示にする";
}
