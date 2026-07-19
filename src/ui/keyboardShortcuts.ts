/**
 * デスクトップ向けキーボードショートカットの「キー → アクション写像」（純ロジック）と、
 * 発火要素が入力欄かを判定する DOM ヘルパ。
 *
 * 責務分離: DOM 非依存の純関数（keyToShortcutAction）と、document/DOM に触れる副作用関数
 * （isEditableEventTarget）を分ける。純関数はキー割り当てと無効化ガードの期待挙動を Vitest で
 * 固定でき、実際の keydown 配線（main.ts の 1 リスナ）は agent-browser で担保する。
 */

/**
 * ショートカットのアクション種別。
 * - toggle-pause: 現行モードの一時停止トグル（合成pause の keyPaused 要因）。
 * - toggle-fullscreen: 全画面表示のトグル。
 * - toggle-mode: 表示モード切替（マウス操作 ⇄ 動画モード）。
 */
export type ShortcutAction = "toggle-pause" | "toggle-fullscreen" | "toggle-mode";

/**
 * キー写像の判定に必要な文脈（keydown イベントから抽出した boolean 群）。
 * 純関数に留めるため、DOM 参照は呼び出し側（main.ts）で解決してこの形に渡す。
 */
export interface ShortcutContext {
  /**
   * 修飾キー（Ctrl/Meta/Alt）付きか。付いていればブラウザ標準ショートカットを奪わないよう無視する。
   * Shift 単独は対象外（f/F・m/M は大小どちらも同じアクションに写像するため自然に許容される）。
   */
  hasModifier: boolean;
  /** IME 変換中（event.isComposing）か。変換確定の Space 等を奪わないよう無視する。 */
  isComposing: boolean;
  /** 設定パネルが開いているか。開いている間は設定操作を優先し無視する（Esc は OptionsPanel が処理）。 */
  panelOpen: boolean;
  /** フォーカスが入力欄（input/textarea/select/contentEditable）にあるか。タイピング/選択を奪わないよう無視する。 */
  editableTarget: boolean;
}

/**
 * 押されたキー（event.key）と文脈からショートカットのアクションを返す純関数。
 *
 * 無効化ガード（いずれか該当で null）:
 * - 修飾キー付き（Ctrl/Meta/Alt）／IME 変換中／設定パネル開／入力欄フォーカス。
 *
 * 割り当て（ガード通過時）:
 * - Space（" "／旧仕様 "Spacebar"）→ toggle-pause
 * - f / F → toggle-fullscreen
 * - m / M → toggle-mode
 * それ以外のキーは null（＝既定動作を邪魔しない）。
 */
export function keyToShortcutAction(key: string, ctx: ShortcutContext): ShortcutAction | null {
  if (ctx.hasModifier || ctx.isComposing || ctx.panelOpen || ctx.editableTarget) {
    return null;
  }
  switch (key) {
    case " ":
    case "Spacebar":
      return "toggle-pause";
    case "f":
    case "F":
      return "toggle-fullscreen";
    case "m":
    case "M":
      return "toggle-mode";
    default:
      return null;
  }
}

/**
 * イベントの発火要素がテキスト入力/選択系（input/textarea/select/contentEditable）かを判定する。
 * DOM 依存のため node env の Vitest 対象外（配線は agent-browser で担保する）。
 * 設定のタイピング/選択操作をショートカットが奪わないためのガードに使う。
 */
export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
