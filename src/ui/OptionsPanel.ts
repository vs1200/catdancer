import type { AudioManager } from "../audio/AudioManager";
import type { SettingsStore } from "../settings/SettingsStore";
import type { AppMode, AppSettings, BackgroundSettings } from "../settings/settingsData";
import {
  AUTO_PLAY_LIMIT_OPTIONS_MINUTES,
  MAX_AUTO_SPAWN_INTERVAL_MS,
  MIN_AUTO_SPAWN_INTERVAL_MS,
  SPEED_SCALE_OPTIONS,
} from "../settings/settingsData";
import { SPAWN_PRESETS } from "../settings/spawnPresets";
import {
  fullscreenButtonAriaLabel,
  fullscreenButtonLabel,
  isFullscreenActive,
  isFullscreenSupported,
  toggleAppFullscreen,
} from "./fullscreen";
import { ensureOptionsStyles } from "./optionsStyles";
import { sliderToVolume, volumeToSlider } from "./volumeScale";

/**
 * 設定パネル（DOM オーバーレイ）。右下ボタンから開閉し、モード（マウス操作/猫用動画）・
 * 出現間隔・背景（色/画像）・音量を設定する。
 *
 * 責務:
 * - コントロール（select / range / color / file / reset）→ SettingsStore の公開 API を呼ぶ。
 *   音量は settings.setMasterVolume、モードは setMode、出現間隔は setAutoSpawnInterval 経由で
 *   永続化され、main.ts の購読が AudioManager / モード切替へ実配線する。
 * - 現在値の反映と外部変更への追従: settings.subscribe でコントロールを同期する
 *   （出現間隔は auto モードのみ有効化）。
 * - 閉じる導線を 3 系統用意: ×ボタン / Esc / パネル外（透明バックドロップ）クリック。
 * - 開閉は onOpenChange で通知（main.ts が現行モードの一時停止等に使う）。
 *
 * イベント分離: バックドロップ（透明）は背後の描画を遮らず、猫は開いている間もアニメを見られる。
 * カード上の pointerdown は stopPropagation してバックドロップの外側クリック判定に漏らさない。
 */

/** カスタム画像クリッターの受理サイズ上限(bytes, ~8MB)。過大画像で IDB/描画を詰まらせない。 */
const MAX_CRITTER_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * 受理する画像 MIME の allowlist（背景/クリッター共通）。
 * intrinsic サイズを欠く SVG（0/既定寸法で崩れる）や、先頭フレームのみ表示される GIF 等を弾き、
 * 確実にラスタ寸法を持つ png/jpeg/webp のみ通す。file input の accept 属性もこの 3 種に揃える。
 */
const ACCEPTED_IMAGE_MIME_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp"];
/** file input の accept 属性値（allowlist と一致させる）。 */
const ACCEPTED_IMAGE_ACCEPT = ACCEPTED_IMAGE_MIME_TYPES.join(",");

/**
 * file.type が allowlist 外なら true（＝弾く）。
 * type 空（ブラウザが判定不能）は既存踏襲で通す（false）。背景/クリッターで扱いを一貫させ、
 * ロード側のデコード失敗フォールバックに委ねる。SVG/GIF 等は非空の明示 type を持つため弾かれる。
 */
function isRejectedImageType(type: string): boolean {
  return type !== "" && !ACCEPTED_IMAGE_MIME_TYPES.includes(type);
}

/** auto モードでトグルできる種別（id と表示名）。「出現する種類」チェックボックスに使う。 */
export interface AutoTypeOption {
  id: string;
  name: string;
}

export interface OptionsPanelOptions {
  /** 設定の単一の真実源。全ての変更はこの公開 API を呼ぶ。 */
  settings: SettingsStore;
  /** 音量表示の現在値ソース（現在の masterVolume を反映する）。書き込みは settings 経由。 */
  audio: AudioManager;
  /**
   * auto モードでON/OFFできる組み込み種別リスト（mouse/foxtail/toys/insect）。
   * 未指定/空なら「出現する種類」セクションを表示しない。
   */
  autoTypes?: readonly AutoTypeOption[];
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
  /** 全画面トグルボタン。未対応ブラウザでは「表示」セクションごと生成しないため null。 */
  private readonly fullscreenButton: HTMLButtonElement | null;
  private readonly modeSelect: HTMLSelectElement;
  /** 動きの速さ select（manual/auto 両モードに効くため常時有効）。 */
  private readonly speedSelect: HTMLSelectElement;
  /** 出現プリセット行（auto モードのみ有効。manual では presetRow ごと淡色化＋ボタン無効化）。 */
  private readonly presetRow: HTMLDivElement;
  /** 出現プリセットボタン群（manual モードで一括 disabled にする）。 */
  private readonly presetButtons: HTMLButtonElement[] = [];
  private readonly intervalInput: HTMLInputElement;
  private readonly intervalValue: HTMLSpanElement;
  private readonly intervalRow: HTMLDivElement;
  private readonly playLimitSelect: HTMLSelectElement;
  private readonly playLimitRow: HTMLDivElement;
  private readonly colorInput: HTMLInputElement;
  private readonly fileInput: HTMLInputElement;
  private readonly critterFileInput: HTMLInputElement;
  private readonly volumeInput: HTMLInputElement;
  private readonly volumeValue: HTMLSpanElement;
  private readonly muteInput: HTMLInputElement;
  /** 「出現する種類」チェックボックス（種別 id と input のペア）。 */
  private readonly autoTypeChecks: Array<{ id: string; input: HTMLInputElement }> = [];

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

    // --- 表示セクション（全画面トグル） ---
    // Fullscreen API 未対応の環境では死んだボタンを出さない（セクションごと生成しない）。
    // 生成できた時だけ card へ差し込む（差し込みは append 段で判定）。
    let fullscreenButton: HTMLButtonElement | null = null;
    let displaySection: HTMLElement | null = null;
    if (isFullscreenSupported()) {
      displaySection = document.createElement("section");
      displaySection.className = "cd-options-section";
      const displayTitle = document.createElement("h3");
      displayTitle.className = "cd-options-section-title";
      displayTitle.textContent = "表示";
      displaySection.appendChild(displayTitle);

      const fullscreenRow = document.createElement("div");
      fullscreenRow.className = "cd-options-row";
      fullscreenButton = document.createElement("button");
      fullscreenButton.type = "button";
      fullscreenButton.className = "cd-options-secondary";
      // ラベル/aria は syncFullscreen() で現在の全画面状態に同期する（初期反映も同メソッド）。
      fullscreenButton.addEventListener("click", () => {
        void toggleAppFullscreen();
      });
      fullscreenRow.appendChild(fullscreenButton);
      displaySection.appendChild(fullscreenRow);
    }

    // --- モードセクション ---
    const modeSection = document.createElement("section");
    modeSection.className = "cd-options-section";
    const modeTitle = document.createElement("h3");
    modeTitle.className = "cd-options-section-title";
    modeTitle.textContent = "モード";
    modeSection.appendChild(modeTitle);

    // モード切替（マウス操作 / 猫用動画）
    const modeRow = document.createElement("div");
    modeRow.className = "cd-options-row";
    const modeLabel = document.createElement("label");
    modeLabel.className = "cd-options-label";
    modeLabel.textContent = "モード";
    modeLabel.htmlFor = "cd-mode-select";
    const modeSelect = document.createElement("select");
    modeSelect.id = "cd-mode-select";
    modeSelect.className = "cd-options-select";
    const manualOption = document.createElement("option");
    manualOption.value = "manual";
    manualOption.textContent = "マウス操作";
    const autoOption = document.createElement("option");
    autoOption.value = "auto";
    autoOption.textContent = "猫用動画";
    modeSelect.append(manualOption, autoOption);
    modeSelect.addEventListener("change", () => {
      this.settings.setMode(modeSelect.value === "auto" ? "auto" : "manual");
    });
    modeRow.append(modeLabel, modeSelect);

    // 動きの速さ（manual/auto 両モードに効くため常時有効。出現間隔のように disabled にしない）。
    // change → settings.setSpeedScale。syncSpeed で現在値を最近傍プリセットへ復元する。
    const speedRow = document.createElement("div");
    speedRow.className = "cd-options-row";
    const speedLabel = document.createElement("label");
    speedLabel.className = "cd-options-label";
    speedLabel.textContent = "動きの速さ";
    speedLabel.htmlFor = "cd-speed-select";
    const speedSelect = document.createElement("select");
    speedSelect.id = "cd-speed-select";
    speedSelect.className = "cd-options-select";
    for (const opt of SPEED_SCALE_OPTIONS) {
      const option = document.createElement("option");
      option.value = String(opt.value);
      option.textContent = opt.label;
      speedSelect.appendChild(option);
    }
    speedSelect.addEventListener("change", () => {
      this.settings.setSpeedScale(Number(speedSelect.value));
    });
    speedRow.append(speedLabel, speedSelect);

    // 出現プリセット（auto モードのみ有効）。出現間隔＋出現する種類をワンタップで束ねて切り替える。
    // ボタン click → settings.applySpawnPreset。適用後は syncFromSettings 経由で interval スライダ表示・
    // 「出現する種類」チェックが新しい値へ自動追従する（applySpawnPreset の通知で syncFromSettings が走る）。
    const presetRow = document.createElement("div");
    presetRow.className = "cd-options-row";
    const presetLabel = document.createElement("span");
    presetLabel.className = "cd-options-label";
    presetLabel.textContent = "プリセット";
    const presetGroup = document.createElement("div");
    presetGroup.className = "cd-options-preset-group";
    for (const preset of SPAWN_PRESETS) {
      const presetButton = document.createElement("button");
      presetButton.type = "button";
      presetButton.className = "cd-options-secondary";
      presetButton.textContent = preset.label;
      presetButton.addEventListener("click", () => {
        this.settings.applySpawnPreset(preset);
      });
      presetGroup.appendChild(presetButton);
      this.presetButtons.push(presetButton);
    }
    presetRow.append(presetLabel, presetGroup);

    // 出現間隔（auto モードのみ有効）
    const intervalRow = document.createElement("div");
    intervalRow.className = "cd-options-row";
    const intervalLabel = document.createElement("label");
    intervalLabel.className = "cd-options-label";
    intervalLabel.textContent = "出現間隔";
    intervalLabel.htmlFor = "cd-interval-input";
    const intervalInput = document.createElement("input");
    intervalInput.type = "range";
    intervalInput.id = "cd-interval-input";
    intervalInput.min = String(MIN_AUTO_SPAWN_INTERVAL_MS);
    intervalInput.max = String(MAX_AUTO_SPAWN_INTERVAL_MS);
    intervalInput.step = "100";
    const intervalValue = document.createElement("span");
    intervalValue.className = "cd-volume-value";
    intervalInput.addEventListener("input", () => this.onIntervalInput());
    intervalRow.append(intervalLabel, intervalInput, intervalValue);

    // 遊びすぎ防止（auto モードのみ有効）。一定時間後に自動停止する上限(分)を選ぶ。0=なし。
    const playLimitRow = document.createElement("div");
    playLimitRow.className = "cd-options-row";
    const playLimitLabel = document.createElement("label");
    playLimitLabel.className = "cd-options-label";
    playLimitLabel.textContent = "遊びすぎ防止";
    playLimitLabel.htmlFor = "cd-playlimit-select";
    const playLimitSelect = document.createElement("select");
    playLimitSelect.id = "cd-playlimit-select";
    playLimitSelect.className = "cd-options-select";
    for (const minutes of AUTO_PLAY_LIMIT_OPTIONS_MINUTES) {
      const option = document.createElement("option");
      option.value = String(minutes);
      option.textContent = formatPlayLimitMinutes(minutes);
      playLimitSelect.appendChild(option);
    }
    playLimitSelect.addEventListener("change", () => {
      this.settings.setAutoPlayLimitMinutes(Number(playLimitSelect.value));
    });
    playLimitRow.append(playLimitLabel, playLimitSelect);

    modeSection.append(modeRow, speedRow, presetRow, intervalRow, playLimitRow);

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
    fileInput.accept = ACCEPTED_IMAGE_ACCEPT;
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

    // --- オブジェクトセクション（ユーザー任意画像クリッター・単一スロット） ---
    const critterSection = document.createElement("section");
    critterSection.className = "cd-options-section";
    const critterTitle = document.createElement("h3");
    critterTitle.className = "cd-options-section-title";
    critterTitle.textContent = "オブジェクト";
    critterSection.appendChild(critterTitle);

    // オブジェクト画像（1枚。label でボタン化し、実 input は視覚的に隠す）
    const critterImageRow = document.createElement("div");
    critterImageRow.className = "cd-options-row";
    const critterLabelText = document.createElement("span");
    critterLabelText.className = "cd-options-label";
    critterLabelText.textContent = "オブジェクト画像";
    const critterFileButton = document.createElement("label");
    critterFileButton.className = "cd-options-file-button";
    critterFileButton.textContent = "画像を選択";
    critterFileButton.htmlFor = "cd-critter-image-input";
    const critterFileInput = document.createElement("input");
    critterFileInput.type = "file";
    critterFileInput.id = "cd-critter-image-input";
    critterFileInput.accept = ACCEPTED_IMAGE_ACCEPT;
    critterFileInput.className = "cd-visually-hidden";
    critterFileInput.addEventListener("change", () => this.onCritterFileChange());
    critterFileButton.appendChild(critterFileInput);
    critterImageRow.append(critterLabelText, critterFileButton);

    // 削除（カスタム画像クリッターを消す）
    const critterResetRow = document.createElement("div");
    critterResetRow.className = "cd-options-row";
    const critterClearButton = document.createElement("button");
    critterClearButton.type = "button";
    critterClearButton.className = "cd-options-secondary";
    critterClearButton.textContent = "オブジェクト画像を削除";
    critterClearButton.addEventListener("click", () => {
      void this.settings.clearCustomCritterImage();
    });
    critterResetRow.appendChild(critterClearButton);

    critterSection.append(critterImageRow, critterResetRow);

    // --- 出現する種類セクション（auto モードの組み込み種別 ON/OFF） ---
    // 渡された種別ごとにチェックボックスを並べる。change で settings.setAutoTypeEnabled を呼び、
    // syncFromSettings で checked を autoDisabledTypes から復元する。種別が無ければ非表示。
    const autoTypes = options.autoTypes ?? [];
    const typesSection = document.createElement("section");
    typesSection.className = "cd-options-section";
    const typesTitle = document.createElement("h3");
    typesTitle.className = "cd-options-section-title";
    typesTitle.textContent = "出現する種類";
    typesSection.appendChild(typesTitle);
    for (const type of autoTypes) {
      const typeRow = document.createElement("div");
      typeRow.className = "cd-options-row";
      const typeLabel = document.createElement("label");
      typeLabel.className = "cd-options-label";
      typeLabel.textContent = type.name;
      typeLabel.htmlFor = `cd-auto-type-${type.id}`;
      const typeCheckbox = document.createElement("input");
      typeCheckbox.type = "checkbox";
      typeCheckbox.id = `cd-auto-type-${type.id}`;
      typeCheckbox.className = "cd-options-checkbox";
      typeCheckbox.addEventListener("change", () => {
        this.settings.setAutoTypeEnabled(type.id, typeCheckbox.checked);
      });
      typeRow.append(typeLabel, typeCheckbox);
      typesSection.appendChild(typeRow);
      this.autoTypeChecks.push({ id: type.id, input: typeCheckbox });
    }

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

    // ミュート（映像のみモード）。音量スライダとは独立した一括ミュート。ON でも音量値は保持する
    // （解除で元の音量に戻る）。「出現する種類」チェックボックスと同じ作り（cd-options-checkbox）。
    // スライダは意図的に disabled にしない: 解除後の音量を事前調整できるようにするため。
    const muteRow = document.createElement("div");
    muteRow.className = "cd-options-row";
    const muteLabel = document.createElement("label");
    muteLabel.className = "cd-options-label";
    muteLabel.textContent = "ミュート（映像のみ）";
    muteLabel.htmlFor = "cd-mute-input";
    const muteInput = document.createElement("input");
    muteInput.type = "checkbox";
    muteInput.id = "cd-mute-input";
    muteInput.className = "cd-options-checkbox";
    muteInput.addEventListener("change", () => {
      this.settings.setMuted(muteInput.checked);
    });
    muteRow.append(muteLabel, muteInput);

    volSection.append(volTitle, volRow, muteRow);

    card.appendChild(header);
    // 全画面対応環境でのみ「表示」セクションをヘッダ直後（モードセクションの前）へ差し込む。
    if (displaySection) {
      card.appendChild(displaySection);
    }
    card.append(modeSection, bgSection, critterSection);
    // 種別が渡された時だけ「出現する種類」を差し込む（空セクションを出さない）。
    if (this.autoTypeChecks.length > 0) {
      card.appendChild(typesSection);
    }
    card.appendChild(volSection);
    overlay.appendChild(card);

    this.element = overlay;
    this.closeButton = closeButton;
    this.fullscreenButton = fullscreenButton;
    this.modeSelect = modeSelect;
    this.speedSelect = speedSelect;
    this.presetRow = presetRow;
    this.intervalInput = intervalInput;
    this.intervalValue = intervalValue;
    this.intervalRow = intervalRow;
    this.playLimitSelect = playLimitSelect;
    this.playLimitRow = playLimitRow;
    this.colorInput = colorInput;
    this.fileInput = fileInput;
    this.critterFileInput = critterFileInput;
    this.volumeInput = volumeInput;
    this.volumeValue = volumeValue;
    this.muteInput = muteInput;

    // Esc で閉じる（入力中にフォーカスがどこにあっても効くよう document で購読）。
    document.addEventListener("keydown", this.onKeyDown);
    // Esc など Fullscreen API の外部解除にも追従してラベルを同期する（F11 のブラウザネイティブ
    // 全画面は fullscreenchange を発火せず document.fullscreenElement も立たないため対象外）。
    // destroy() で必ず外す。
    document.addEventListener("fullscreenchange", this.onFullscreenChange);

    // 現在値を反映しつつ外部変更にも追従。
    this.unsubscribe = this.settings.subscribe((next) => this.syncFromSettings(next));
    this.syncFromSettings(this.settings.settings);
    this.syncFullscreen();
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
    this.syncFullscreen();
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
    document.removeEventListener("fullscreenchange", this.onFullscreenChange);
    this.element.remove();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.open && event.key === "Escape") {
      this.close();
    }
  };

  /** Fullscreen API の状態変化（Esc での解除等）でボタンのラベル/aria を追従させる。 */
  private readonly onFullscreenChange = (): void => {
    this.syncFullscreen();
  };

  /** 全画面ボタンのラベル/aria を現在の全画面状態に同期する（未対応環境では何もしない）。 */
  private syncFullscreen(): void {
    if (!this.fullscreenButton) {
      return;
    }
    const active = isFullscreenActive();
    this.fullscreenButton.textContent = fullscreenButtonLabel(active);
    this.fullscreenButton.setAttribute("aria-label", fullscreenButtonAriaLabel(active));
  }

  private onFileChange(): void {
    const file = this.fileInput.files?.[0];
    // 同一ファイルの再選択でも change が発火するよう毎回クリアする。
    this.fileInput.value = "";
    if (!file) {
      return;
    }
    // MIME allowlist（png/jpeg/webp）で受理。SVG/GIF 等は非空 type を持つため弾く。
    // type 空は判定不能として通し、BackgroundController のデコード失敗フォールバックに委ねる。
    if (isRejectedImageType(file.type)) {
      console.warn("対応していない画像形式のため無視します。", file.type);
      return;
    }
    void this.settings.setBackgroundImage(file);
  }

  private onCritterFileChange(): void {
    const file = this.critterFileInput.files?.[0];
    // 同一ファイルの再選択でも change が発火するよう毎回クリアする。
    this.critterFileInput.value = "";
    if (!file) {
      return;
    }
    // MIME allowlist（png/jpeg/webp）で受理。SVG(intrinsic サイズ欠如)/GIF(先頭フレームのみ)等は
    // 非空 type を持つため弾く。type 空は判定不能として通し、ロード側のフォールバックに委ねる。
    if (isRejectedImageType(file.type)) {
      console.warn("対応していない画像形式のため無視します。", file.type);
      return;
    }
    // 過大ファイルのサイズ上限（~8MB）。デコード後の画素寸法は main.ts が上限内へダウンスケールする。
    if (file.size > MAX_CRITTER_IMAGE_BYTES) {
      console.warn("画像サイズが大きすぎるため無視します。", file.size);
      return;
    }
    void this.settings.setCustomCritterImage(file);
  }

  private onVolumeInput(): void {
    const volume = sliderToVolume(Number(this.volumeInput.value));
    this.volumeValue.textContent = String(volumeToSlider(volume));
    // 永続化 + AudioManager への適用は settings 経由（main.ts の購読で実配線）。
    this.settings.setMasterVolume(volume);
  }

  private onIntervalInput(): void {
    const ms = Number(this.intervalInput.value);
    this.intervalValue.textContent = formatIntervalMs(ms);
    this.settings.setAutoSpawnInterval(ms);
  }

  /** 現在の設定値をコントロールへ反映する（起動時・外部変更・開いた時に呼ぶ）。 */
  private syncFromSettings(settings: AppSettings): void {
    this.syncMode(settings.mode, settings.autoSpawnIntervalMs, settings.autoPlayLimitMinutes);
    this.syncSpeed(settings.speedScale);
    this.syncBackground(settings.background);
    this.syncAutoTypes(settings.autoDisabledTypes);
    this.syncVolume();
    this.syncMute(settings.muted);
  }

  /**
   * 動きの速さ select を現在値へ復元する。プリセット外の永続値でも壊れないよう、
   * SPEED_SCALE_OPTIONS の中から数値が最も近い選択肢を選ぶ（一致があればそれが最近傍）。
   */
  private syncSpeed(speedScale: number): void {
    let best = SPEED_SCALE_OPTIONS[0];
    let bestDist = Math.abs(best.value - speedScale);
    for (const opt of SPEED_SCALE_OPTIONS) {
      const dist = Math.abs(opt.value - speedScale);
      if (dist < bestDist) {
        best = opt;
        bestDist = dist;
      }
    }
    const text = String(best.value);
    if (this.speedSelect.value !== text) {
      this.speedSelect.value = text;
    }
  }

  /** ミュートチェックボックスを settings.muted から復元する（外部変更にも追従）。 */
  private syncMute(muted: boolean): void {
    if (this.muteInput.checked !== muted) {
      this.muteInput.checked = muted;
    }
  }

  /** 「出現する種類」チェックボックスを autoDisabledTypes から復元する（無効リストに無い＝ON）。 */
  private syncAutoTypes(disabledTypes: readonly string[]): void {
    for (const { id, input } of this.autoTypeChecks) {
      const checked = !disabledTypes.includes(id);
      if (input.checked !== checked) {
        input.checked = checked;
      }
    }
  }

  private syncMode(mode: AppMode, intervalMs: number, playLimitMinutes: number): void {
    if (this.modeSelect.value !== mode) {
      this.modeSelect.value = mode;
    }
    const text = String(intervalMs);
    if (this.intervalInput.value !== text) {
      this.intervalInput.value = text;
    }
    this.intervalValue.textContent = formatIntervalMs(intervalMs);
    // 出現間隔・出現プリセット・遊びすぎ防止は auto モードのみ有効。manual では無効化して意味を明確にする。
    const disabled = mode !== "auto";
    this.intervalInput.disabled = disabled;
    this.intervalRow.classList.toggle("cd-options-row-disabled", disabled);

    // 出現プリセットも auto 専用。行の淡色化に加え各ボタンを disabled にして誤操作を防ぐ。
    for (const button of this.presetButtons) {
      button.disabled = disabled;
    }
    this.presetRow.classList.toggle("cd-options-row-disabled", disabled);

    const playLimitText = String(playLimitMinutes);
    if (this.playLimitSelect.value !== playLimitText) {
      this.playLimitSelect.value = playLimitText;
    }
    this.playLimitSelect.disabled = disabled;
    this.playLimitRow.classList.toggle("cd-options-row-disabled", disabled);
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

/** 出現間隔(ms)を「x.x秒」表記にする（UI 表示用）。 */
function formatIntervalMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}秒`;
}

/** 遊びすぎ防止の上限(分)を表示ラベルにする（0＝なし）。 */
function formatPlayLimitMinutes(minutes: number): string {
  return minutes <= 0 ? "なし" : `${minutes}分`;
}
