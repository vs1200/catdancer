import type { AudioManager } from "../audio/AudioManager";
import type { SettingsStore } from "../settings/SettingsStore";
import type { AppSettings, BackgroundSettings } from "../settings/settingsData";
import { ensureOptionsStyles } from "./optionsStyles";
import { sliderToVolume, volumeToSlider } from "./volumeScale";

/**
 * 設定パネル（DOM オーバーレイ）。右下ボタンから開閉し、背景（色/画像）と音量を設定する。
 *
 * 責務:
 * - コントロール（color / file / range / reset）→ SettingsStore の公開 API を呼ぶ。
 *   音量は settings.setMasterVolume 経由で AudioManager にも適用・永続化される（実配線は main.ts）。
 * - 現在値の反映と外部変更への追従: settings.subscribe でコントロールを同期する。
 * - 閉じる導線を 3 系統用意: ×ボタン / Esc / パネル外（透明バックドロップ）クリック。
 * - 開閉は onOpenChange で通知（main.ts が PointerInput の detach/attach 等に使う）。
 *
 * イベント分離: バックドロップ（透明）は背後の描画を遮らず、猫は開いている間もアニメを見られる。
 * カード上の pointerdown は stopPropagation してバックドロップの外側クリック判定に漏らさない。
 *
 * 拡張余地(v2): body の先頭に「モード」セクションを差し込めば、同じ枠でモード切替を追加できる。
 */

export interface OptionsPanelOptions {
  /** 設定の単一の真実源。全ての変更はこの公開 API を呼ぶ。 */
  settings: SettingsStore;
  /** 音量表示の現在値ソース（現在の masterVolume を反映する）。書き込みは settings 経由。 */
  audio: AudioManager;
  /** 開閉時の通知（開=true）。 */
  onOpenChange?: (open: boolean) => void;
}

export class OptionsPanel {
  /** ルート要素（透明バックドロップ兼クリックキャッチャ）。 */
  readonly element: HTMLDivElement;

  private readonly settings: SettingsStore;
  private readonly audio: AudioManager;
  private onOpenChange?: (open: boolean) => void;

  private readonly closeButton: HTMLButtonElement;
  private readonly colorInput: HTMLInputElement;
  private readonly fileInput: HTMLInputElement;
  private readonly volumeInput: HTMLInputElement;
  private readonly volumeValue: HTMLSpanElement;

  private readonly unsubscribe: () => void;
  private open = false;

  constructor(options: OptionsPanelOptions) {
    ensureOptionsStyles();
    this.settings = options.settings;
    this.audio = options.audio;
    this.onOpenChange = options.onOpenChange;

    // --- バックドロップ（透明・外側クリックで閉じる） ---
    const overlay = document.createElement("div");
    overlay.className = "cd-options-overlay";
    // 外側 pointerdown で閉じる（click でなく pointerdown: スライダのドラッグ終了が外側でも誤閉じしない）。
    overlay.addEventListener("pointerdown", () => this.close());

    // --- カード本体 ---
    const card = document.createElement("div");
    card.className = "cd-options-panel";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "cd-options-title");
    // カード上の pointerdown はバックドロップへ漏らさない（外側クリック判定・canvas 追従の保険）。
    card.addEventListener("pointerdown", (event) => event.stopPropagation());

    // ヘッダ（タイトル＋×）
    const header = document.createElement("div");
    header.className = "cd-options-header";
    const title = document.createElement("h2");
    title.className = "cd-options-title";
    title.id = "cd-options-title";
    title.textContent = "設定";
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "cd-options-close";
    closeButton.setAttribute("aria-label", "設定を閉じる");
    closeButton.textContent = "×";
    closeButton.addEventListener("click", () => this.close());
    header.append(title, closeButton);

    // --- 背景セクション ---
    const bgSection = document.createElement("section");
    bgSection.className = "cd-options-section";
    const bgTitle = document.createElement("h3");
    bgTitle.className = "cd-options-section-title";
    bgTitle.textContent = "背景";
    bgSection.appendChild(bgTitle);

    // 背景色
    const colorRow = document.createElement("div");
    colorRow.className = "cd-options-row";
    const colorLabel = document.createElement("label");
    colorLabel.className = "cd-options-label";
    colorLabel.textContent = "背景色";
    colorLabel.htmlFor = "cd-bg-color-input";
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.id = "cd-bg-color-input";
    colorInput.addEventListener("input", () => {
      this.settings.setBackgroundColor(colorInput.value);
    });
    colorRow.append(colorLabel, colorInput);

    // 背景画像（label でボタン化し、実 input は視覚的に隠す）
    const imageRow = document.createElement("div");
    imageRow.className = "cd-options-row";
    const imageLabelText = document.createElement("span");
    imageLabelText.className = "cd-options-label";
    imageLabelText.textContent = "背景画像";
    const fileButton = document.createElement("label");
    fileButton.className = "cd-options-file-button";
    fileButton.textContent = "画像を選択";
    fileButton.htmlFor = "cd-bg-image-input";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.id = "cd-bg-image-input";
    fileInput.accept = "image/*";
    fileInput.className = "cd-visually-hidden";
    fileInput.addEventListener("change", () => this.onFileChange());
    fileButton.appendChild(fileInput);
    imageRow.append(imageLabelText, fileButton);

    // リセット（白に戻す/画像クリア）
    const resetRow = document.createElement("div");
    resetRow.className = "cd-options-row";
    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.className = "cd-options-secondary";
    resetButton.textContent = "白に戻す / 画像をクリア";
    resetButton.addEventListener("click", () => {
      this.settings.setBackgroundColor("#ffffff");
      void this.settings.clearBackgroundImage();
    });
    resetRow.appendChild(resetButton);

    bgSection.append(colorRow, imageRow, resetRow);

    // --- 音量セクション ---
    const volSection = document.createElement("section");
    volSection.className = "cd-options-section";
    const volTitle = document.createElement("h3");
    volTitle.className = "cd-options-section-title";
    volTitle.textContent = "音量";
    const volRow = document.createElement("div");
    volRow.className = "cd-options-row";
    const volLabel = document.createElement("label");
    volLabel.className = "cd-options-label";
    volLabel.textContent = "音量";
    volLabel.htmlFor = "cd-volume-input";
    const volumeInput = document.createElement("input");
    volumeInput.type = "range";
    volumeInput.id = "cd-volume-input";
    volumeInput.min = "0";
    volumeInput.max = "100";
    volumeInput.step = "1";
    const volumeValue = document.createElement("span");
    volumeValue.className = "cd-volume-value";
    volumeInput.addEventListener("input", () => this.onVolumeInput());
    volRow.append(volLabel, volumeInput, volumeValue);
    volSection.append(volTitle, volRow);

    card.append(header, bgSection, volSection);
    overlay.appendChild(card);

    this.element = overlay;
    this.closeButton = closeButton;
    this.colorInput = colorInput;
    this.fileInput = fileInput;
    this.volumeInput = volumeInput;
    this.volumeValue = volumeValue;

    // Esc で閉じる（入力中にフォーカスがどこにあっても効くよう document で購読）。
    document.addEventListener("keydown", this.onKeyDown);

    // 現在値を反映しつつ外部変更にも追従。
    this.unsubscribe = this.settings.subscribe((next) => this.syncFromSettings(next));
    this.syncFromSettings(this.settings.settings);
  }

  /** 指定親へマウントする（通常 document.body）。 */
  mount(parent: HTMLElement): void {
    parent.appendChild(this.element);
  }

  /** 開閉通知コールバックを差し替える（相互参照を避けるため構築後に配線する用）。 */
  setOnOpenChange(callback: (open: boolean) => void): void {
    this.onOpenChange = callback;
  }

  /** 開いていれば閉じ、閉じていれば開く。 */
  toggle(): void {
    if (this.open) {
      this.close();
    } else {
      this.openPanel();
    }
  }

  /** パネルを開く。 */
  openPanel(): void {
    if (this.open) {
      return;
    }
    this.open = true;
    this.element.classList.add("cd-open");
    // 開いた時点の最新値を反映してからフォーカスを移す。
    this.syncFromSettings(this.settings.settings);
    this.closeButton.focus();
    this.onOpenChange?.(true);
  }

  /** パネルを閉じる。 */
  close(): void {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.element.classList.remove("cd-open");
    this.onOpenChange?.(false);
  }

  /** 開いているか。 */
  get isOpen(): boolean {
    return this.open;
  }

  /** 破棄（購読解除・リスナ除去・DOM 撤去）。 */
  destroy(): void {
    this.unsubscribe();
    document.removeEventListener("keydown", this.onKeyDown);
    this.element.remove();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.open && event.key === "Escape") {
      this.close();
    }
  };

  private onFileChange(): void {
    const file = this.fileInput.files?.[0];
    // 同一ファイルの再選択でも change が発火するよう毎回クリアする。
    this.fileInput.value = "";
    if (!file) {
      return;
    }
    // 非画像ファイルの耐性: type が明示的に非画像なら無駄な IDB 書き込みをせず無視する
    // （type 空は判定不能なので通し、BackgroundController のデコード失敗フォールバックに委ねる）。
    if (file.type && !file.type.startsWith("image/")) {
      console.warn("画像ファイルではないため無視します。", file.type);
      return;
    }
    void this.settings.setBackgroundImage(file);
  }

  private onVolumeInput(): void {
    const volume = sliderToVolume(Number(this.volumeInput.value));
    this.volumeValue.textContent = String(volumeToSlider(volume));
    // 永続化 + AudioManager への適用は settings 経由（main.ts の購読で実配線）。
    this.settings.setMasterVolume(volume);
  }

  /** 現在の設定値をコントロールへ反映する（起動時・外部変更・開いた時に呼ぶ）。 */
  private syncFromSettings(settings: AppSettings): void {
    this.syncBackground(settings.background);
    this.syncVolume();
  }

  private syncBackground(background: BackgroundSettings): void {
    // color input は #rrggbb を要求。settings 側で正規化済み。
    if (this.colorInput.value !== background.color) {
      this.colorInput.value = background.color;
    }
  }

  private syncVolume(): void {
    // 現在の masterVolume（AudioManager の実値）を反映する。
    const slider = volumeToSlider(this.audio.masterVolume);
    const text = String(slider);
    if (this.volumeInput.value !== text) {
      this.volumeInput.value = text;
    }
    this.volumeValue.textContent = text;
  }
}
