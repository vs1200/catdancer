/**
 * 遊びすぎ防止の自動停止オーバーレイ（DOM オーバーレイ）。
 *
 * auto（猫用動画）モードで上限時間に達すると自動停止し、画面中央へ穏やかなカードを表示する。
 * 人間が「再開」ボタンを押すと {@link PlayLimitOverlayOptions.onResume} を呼んで再生を再開する。
 *
 * 方針（OptionsButton/OptionsPanel の流儀に合わせる）:
 * - element を持ち mount/destroy。スタイルは専用 ensure 関数で一度だけ注入（グローバル汚染しない）。
 * - 半透明で穏やかに覆う（背景色/画像は透けて見える＝猫が背景すら見られないほど濃くしない）。
 * - 表示中は前面の pointer をこのオーバーレイで受け止め、背後 canvas へ漏らさない
 *   （カード上の pointerdown も stopPropagation する）。設定ボタン(歯車)は更に前面なので押せる。
 */

const STYLE_ELEMENT_ID = "catdancer-playlimit-styles";

/**
 * オプション UI（optionsStyles）の z-index より低く、設定ボタンより下に敷く。
 * これにより自動停止中でも右下の歯車から設定を開ける（上限変更で再武装＝停止のまま固まらない）。
 */
const OVERLAY_Z_INDEX = 2147482000;

const CSS = `
.cd-playlimit-overlay {
  position: fixed;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  /* 半透明の穏やかな暗幕。背景は透けて見える（猫が背景を見られる）。 */
  background: rgba(16, 18, 26, 0.42);
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
  z-index: ${OVERLAY_Z_INDEX};
}
.cd-playlimit-overlay.cd-open {
  display: flex;
}

.cd-playlimit-card {
  box-sizing: border-box;
  width: min(360px, calc(100vw - 48px));
  padding: 28px 26px 24px;
  border-radius: 18px;
  text-align: center;
  background: rgba(24, 26, 32, 0.92);
  color: #f4f4f6;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.cd-playlimit-title {
  margin: 0 0 10px;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.3;
}
.cd-playlimit-message {
  margin: 0 0 20px;
  font-size: 14px;
  line-height: 1.6;
  color: #cfd2da;
}
.cd-playlimit-resume {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 140px;
  padding: 11px 22px;
  border: none;
  border-radius: 999px;
  background: #7cc4ff;
  color: #10141c;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.05s ease;
}
.cd-playlimit-resume:hover {
  background: #97d2ff;
}
.cd-playlimit-resume:active {
  transform: translateY(1px);
}
.cd-playlimit-resume:focus-visible {
  outline: 2px solid #f4f4f6;
  outline-offset: 2px;
}
`;

/** 遊びすぎ防止オーバーレイ用のスタイルを（未注入なら）head へ一度だけ差し込む。 */
function ensurePlayLimitStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ELEMENT_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

export interface PlayLimitOverlayOptions {
  /** 「再開」ボタン押下時のコールバック（呼び出し側で auto を再開する）。 */
  onResume: () => void;
}

export class PlayLimitOverlay {
  /** ルート要素（半透明バックドロップ＋中央カード）。 */
  readonly element: HTMLDivElement;

  private open = false;

  constructor(options: PlayLimitOverlayOptions) {
    ensurePlayLimitStyles();

    const overlay = document.createElement("div");
    overlay.className = "cd-playlimit-overlay";
    overlay.setAttribute("role", "dialog");
    // aria-modal は付けない: 停止中も外側の歯車ボタンから設定を開いて再武装できる設計のため
    // （外側を inert とする aria-modal="true" は本機能の導線と矛盾する）。
    overlay.setAttribute("aria-labelledby", "cd-playlimit-title");
    // 背後 canvas へ pointer を漏らさない（このオーバーレイが受け止める）。
    overlay.addEventListener("pointerdown", (event) => event.stopPropagation());

    const card = document.createElement("div");
    card.className = "cd-playlimit-card";

    const title = document.createElement("h2");
    title.className = "cd-playlimit-title";
    title.id = "cd-playlimit-title";
    title.textContent = "おやすみタイム 🌙";

    const message = document.createElement("p");
    message.className = "cd-playlimit-message";
    message.textContent = "たくさん遊びました。少し休憩しましょう。";

    const resumeButton = document.createElement("button");
    resumeButton.type = "button";
    resumeButton.className = "cd-playlimit-resume";
    resumeButton.textContent = "再開";
    resumeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      options.onResume();
    });

    card.append(title, message, resumeButton);
    overlay.appendChild(card);
    this.element = overlay;
  }

  /** 指定親へマウントする（通常 document.body）。 */
  mount(parent: HTMLElement): void {
    parent.appendChild(this.element);
  }

  /** オーバーレイを表示する。 */
  show(): void {
    if (this.open) {
      return;
    }
    this.open = true;
    this.element.classList.add("cd-open");
  }

  /** オーバーレイを隠す。 */
  hide(): void {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.element.classList.remove("cd-open");
  }

  /** 表示中か。 */
  get isOpen(): boolean {
    return this.open;
  }

  /** DOM から取り除く。 */
  destroy(): void {
    this.element.remove();
  }
}
