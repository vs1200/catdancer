/**
 * 設定パネルのタブ定義と、タブのキーボード移動を計算する純ロジック。
 *
 * DOM を持たない純関数/データに切り出すことで、タブの並び・キー操作の期待挙動を
 * ユニットテストで固定できる（DOM 生成・aria 反映は OptionsPanel 側＝agent-browser 担保）。
 */

/** タブ識別子（共通/マウスモード/動画モードの 3 種）。 */
export type OptionsTabId = "common" | "manual" | "auto";

/** タブ 1 つの定義（id とヘッダ表示ラベル）。 */
export interface OptionsTabDef {
  id: OptionsTabId;
  label: string;
}

/**
 * 設定パネルのタブ並び（左から表示順）。初期選択は先頭（共通）。
 * - common: モード/表示/動きの速さ/音量/背景/オブジェクトなど全モード共通の設定。
 * - manual: マウス操作モード専用（操作するもの）。
 * - auto: 動画モード専用（出現間隔/プリセット/出現する種類/遊びすぎ防止）。
 */
export const OPTIONS_TABS: readonly OptionsTabDef[] = [
  { id: "common", label: "共通" },
  { id: "manual", label: "マウスモード" },
  { id: "auto", label: "動画モード" },
];

/**
 * タブリスト上のキー操作で、フォーカス/選択を移す先インデックスを返す。
 * - ArrowRight/ArrowDown: 次へ（末尾は先頭へラップ）。
 * - ArrowLeft/ArrowUp: 前へ（先頭は末尾へラップ）。
 * - Home: 先頭 / End: 末尾。
 * - 対象外キー・タブ 0 個のときは -1（移動しない）を返す。
 */
export function tabKeyTarget(current: number, key: string, count: number): number {
  if (count <= 0) {
    return -1;
  }
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return -1;
  }
}
