import { ensureOptionsStyles } from "./optionsStyles";

/**
 * 画面右下の控えめな設定ボタン（歯車）。canvas の上に重なる HTML 要素。
 *
 * - 低主張（低 opacity・小サイズ）。hover/focus で前面化する（CSS は optionsStyles）。
 * - クリックで {@link OptionsButtonOptions.onClick}（パネル開閉トグル）を呼ぶ。
 * - aria-label / aria-expanded を持ち、スクリーンリーダから設定ボタンと分かる。
 */

export interface OptionsButtonOptions {
  /** クリック時のコールバック（通常はパネルの toggle）。 */
  onClick: () => void;
  /** aria-label（既定「設定を開く」）。 */
  label?: string;
}

export class OptionsButton {
  /** ルート要素（mount 先へ append する）。 */
  readonly element: HTMLButtonElement;

  constructor(options: OptionsButtonOptions) {
    ensureOptionsStyles();

    const button = document.createElement("button");
    button.type = "button";
    button.className = "cd-options-button";
    button.setAttribute("aria-label", options.label ?? "設定を開く");
    button.setAttribute("aria-expanded", "false");
    // U+FE0E で歯車を絵文字でなくテキスト字形（単色）で描画し、低主張の見た目にする。
    button.textContent = "⚙︎";

    button.addEventListener("click", (event) => {
      // canvas 側へイベントを漏らさない（保険。canvas は別要素なので基本届かない）。
      event.stopPropagation();
      options.onClick();
    });

    this.element = button;
  }

  /** 指定親へマウントする（通常 document.body）。 */
  mount(parent: HTMLElement): void {
    parent.appendChild(this.element);
  }

  /** パネル開閉状態を aria-expanded に反映する。 */
  setExpanded(expanded: boolean): void {
    this.element.setAttribute("aria-expanded", String(expanded));
  }

  /** DOM から取り除く。 */
  destroy(): void {
    this.element.remove();
  }
}
