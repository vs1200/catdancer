import type { AudioManager } from "../audio/AudioManager";
import { INSECT_TYPE_ID } from "../critters/types/insect";
import { MANUAL_TARGETS } from "../settings/manualTargets";
import type { SettingsStore } from "../settings/SettingsStore";
import type {
  AppMode,
  AppSettings,
  BackgroundSettings,
  InsectManualPattern,
  SpeedScaleOption,
} from "../settings/settingsData";
import {
  AUTO_PLAY_LIMIT_OPTIONS_MINUTES,
  AUTO_SPEED_SCALE_OPTIONS,
  INSECT_MANUAL_PATTERN_OPTIONS,
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
import { OPTIONS_TABS, tabKeyTarget } from "./optionsTabs";
import { sliderToVolume, volumeToSlider } from "./volumeScale";

/**
 * 設定パネル（DOM オーバーレイ）。右下ボタンから開閉し、中央寄せの大きめポップアップ
 * （モーダル）で表示する。設定は「共通 / マウスモード / 動画モード」の 3 タブに整理する。
 *
 * 責務:
 * - コントロール（select / range / color / file / reset / checkbox）→ SettingsStore の公開 API を呼ぶ。
 *   音量は settings.setMasterVolume、モードは setMode、出現間隔は setAutoSpawnInterval 経由で
 *   永続化され、main.ts の購読が AudioManager / モード切替へ実配線する。
 * - 現在値の反映と外部変更への追従: settings.subscribe でコントロールを同期する（syncFromSettings）。
 * - タブ切替: ヘッダ直下の 3 タブボタン（role="tab"）で対応 tabpanel のみ表示する。各タブの
 *   コントロールは常時編集可（モード別 disabled は撤廃。別モードの設定も事前調整できる）。
 * - 閉じる導線を 3 系統用意: ×ボタン / Esc / パネル外（バックドロップ）クリック。
 * - 開閉は onOpenChange で通知（main.ts が現行モードの一時停止等に使う）。
 *
 * イベント分離: バックドロップの外側 pointerdown で閉じる。カード上の pointerdown は
 * stopPropagation してバックドロップの外側クリック判定に漏らさない。
 */

/** カスタム画像クリッターの受理サイズ上限(bytes, ~8MB)。過大画像で IDB/描画を詰まらせない。 */
const MAX_CRITTER_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * 背景画像の受理サイズ上限(bytes, ~8MB)。クリッターと同値で対称化する。
 * 背景は全画面 cover-fit で拡大されるため、巨大画像の decode() でフル解像度ビットマップを
 * メモリ展開すると低スペック端末（タブレット常用）でタブがクラッシュしうる。事前に弾く。
 */
const MAX_BACKGROUND_IMAGE_BYTES = 8 * 1024 * 1024;

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

/** タイトル付きセクション（h3 見出し＋中身）を作る小ヘルパ。タブ内の小見出しに使う。 */
function createSection(title: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "cd-options-section";
  const heading = document.createElement("h3");
  heading.className = "cd-options-section-title";
  heading.textContent = title;
  section.appendChild(heading);
  return section;
}

/**
 * 共通タブ末尾に置く「操作方法」ヘルプ（純テキスト。リンク/操作なし）。
 * 初見の飼い主に、UI 上どこにも出ていないタップ捕獲・モード差・操作対象選択・キーボード
 * ショートカットを発見可能にする。用語→説明の対で dl/dt/dd に組み、既存の配色トークン
 * （見出し #e8e9ee・本文 #cfd2da）へ合わせて派手なスタイルを足さない。事実は README と
 * keyToShortcutAction（Space=一時停止/再開・f=全画面・m=モード切替）に忠実。
 */
function createHelpSection(): HTMLElement {
  const section = createSection("操作方法");
  const list = document.createElement("dl");
  list.className = "cd-options-help";
  const items: ReadonlyArray<readonly [string, string]> = [
    [
      "タップ / クリック",
      "動画モードで、動いているオブジェクトをタップ（クリック）すると捕まえられます（逃げて音が鳴ります）。",
    ],
    [
      "モード",
      "「マウス操作モード」は選んだオブジェクトがカーソル（タッチ）に反応し、「動画モード」は自動でオブジェクトが動き回ります。切替は「共通」タブのモード設定から。",
    ],
    [
      "操作するもの",
      "マウス操作モードでは「マウスモード」タブで対象（ネズミ／ねこじゃらし／おもちゃ／虫）を選べます。虫を選ぶと、動きパターン（クリックで出現／マウス追従）も選べます。",
    ],
    ["キーボード", "Space＝一時停止／再開、f＝全画面の切替、m＝モードの切替。"],
  ];
  for (const [term, desc] of items) {
    const item = document.createElement("div");
    item.className = "cd-options-help-item";
    const termEl = document.createElement("dt");
    termEl.className = "cd-options-help-term";
    termEl.textContent = term;
    const descEl = document.createElement("dd");
    descEl.className = "cd-options-help-desc";
    descEl.textContent = desc;
    item.append(termEl, descEl);
    list.appendChild(item);
  }
  section.appendChild(list);
  return section;
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
  /** 全画面トグルボタン。Fullscreen API 未対応ブラウザでは行を生成しないため null。 */
  private readonly fullscreenButton: HTMLButtonElement | null;
  /** マウスカーソル非表示モードのチェックボックス（共通タブ「表示」）。 */
  private readonly hideCursorInput: HTMLInputElement;
  private readonly modeSelect: HTMLSelectElement;
  /** [UR-4] 操作するもの select（マウスモードタブ。常時編集可）。 */
  private readonly manualTypeSelect: HTMLSelectElement;
  /** [UR3-5] 虫の動きパターン select（マウスモードタブ。操作対象=虫のときだけ表示）。 */
  private readonly insectPatternSelect: HTMLSelectElement;
  /** [UR3-5] 虫の動きパターン section（操作対象=虫のときだけ表示・他種別では hidden）。 */
  private readonly insectPatternSection: HTMLElement;
  /** [UR3-8] マウス操作モードの動きの速さ select（マウスモードタブ）。 */
  private readonly manualSpeedSelect: HTMLSelectElement;
  /** [UR3-8] 動画モード(auto)の動きの速さ select（動画モードタブ。底上げ済み選択肢）。 */
  private readonly autoSpeedSelect: HTMLSelectElement;
  private readonly intervalInput: HTMLInputElement;
  private readonly intervalValue: HTMLSpanElement;
  private readonly playLimitSelect: HTMLSelectElement;
  private readonly colorInput: HTMLInputElement;
  private readonly fileInput: HTMLInputElement;
  private readonly critterFileInput: HTMLInputElement;
  private readonly volumeInput: HTMLInputElement;
  private readonly volumeValue: HTMLSpanElement;
  private readonly muteInput: HTMLInputElement;
  /** 「出現する種類」チェックボックス（種別 id と input のペア）。 */
  private readonly autoTypeChecks: Array<{ id: string; input: HTMLInputElement }> = [];

  /** タブボタン群（OPTIONS_TABS と同順）。aria-selected / roving tabindex を切り替える。 */
  private readonly tabButtons: HTMLButtonElement[] = [];
  /** タブパネル群（OPTIONS_TABS と同順）。非選択は hidden にする。 */
  private readonly tabPanels: HTMLElement[] = [];
  /** 選択中タブのインデックス（初期 0＝共通）。 */
  private activeTabIndex = 0;

  private readonly unsubscribe: () => void;
  private open = false;

  constructor(options: OptionsPanelOptions) {
    ensureOptionsStyles();
    this.settings = options.settings;
    this.audio = options.audio;
    this.onOpenChange = options.onOpenChange;

    // --- バックドロップ（外側クリックで閉じる。モーダルの薄暗幕） ---
    const overlay = document.createElement("div");
    overlay.className = "cd-options-overlay";
    // 外側 pointerdown で閉じる（click でなく pointerdown: スライダのドラッグ終了が外側でも誤閉じしない）。
    overlay.addEventListener("pointerdown", () => this.close());

    // --- カード本体（中央寄せの大きめポップアップ） ---
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

    // =========================================================================
    // コントロール生成（配線は従来どおり。タブ割り当ては下部の「タブ組み立て」で行う）。
    // =========================================================================

    // --- モード切替（マウス操作 / 動画モード）。共通タブへ。 ---
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
    manualOption.textContent = "マウス操作モード";
    const autoOption = document.createElement("option");
    autoOption.value = "auto";
    autoOption.textContent = "動画モード";
    modeSelect.append(manualOption, autoOption);
    modeSelect.addEventListener("change", () => {
      this.settings.setMode(modeSelect.value === "auto" ? "auto" : "manual");
    });
    modeRow.append(modeLabel, modeSelect);

    // [UR3-8] 動きの速さは mode 別に設定する（マウス操作モード用・動画モード用を各モードタブへ）。
    // マウス操作モード用: SPEED_SCALE_OPTIONS（従来据置）。change → settings.setManualSpeedScale。
    const manualSpeedRow = document.createElement("div");
    manualSpeedRow.className = "cd-options-row";
    const manualSpeedLabel = document.createElement("label");
    manualSpeedLabel.className = "cd-options-label";
    manualSpeedLabel.textContent = "動きの速さ";
    manualSpeedLabel.htmlFor = "cd-manual-speed-select";
    const manualSpeedSelect = document.createElement("select");
    manualSpeedSelect.id = "cd-manual-speed-select";
    manualSpeedSelect.className = "cd-options-select";
    for (const opt of SPEED_SCALE_OPTIONS) {
      const option = document.createElement("option");
      option.value = String(opt.value);
      option.textContent = opt.label;
      manualSpeedSelect.appendChild(option);
    }
    manualSpeedSelect.addEventListener("change", () => {
      this.settings.setManualSpeedScale(Number(manualSpeedSelect.value));
    });
    manualSpeedRow.append(manualSpeedLabel, manualSpeedSelect);

    // 動画モード用: AUTO_SPEED_SCALE_OPTIONS（底上げ済み・標準=1.8）。change → settings.setAutoSpeedScale。
    const autoSpeedRow = document.createElement("div");
    autoSpeedRow.className = "cd-options-row";
    const autoSpeedLabel = document.createElement("label");
    autoSpeedLabel.className = "cd-options-label";
    autoSpeedLabel.textContent = "動きの速さ";
    autoSpeedLabel.htmlFor = "cd-auto-speed-select";
    const autoSpeedSelect = document.createElement("select");
    autoSpeedSelect.id = "cd-auto-speed-select";
    autoSpeedSelect.className = "cd-options-select";
    for (const opt of AUTO_SPEED_SCALE_OPTIONS) {
      const option = document.createElement("option");
      option.value = String(opt.value);
      option.textContent = opt.label;
      autoSpeedSelect.appendChild(option);
    }
    autoSpeedSelect.addEventListener("change", () => {
      this.settings.setAutoSpeedScale(Number(autoSpeedSelect.value));
    });
    autoSpeedRow.append(autoSpeedLabel, autoSpeedSelect);

    // [UR-4] 操作するもの（マウス操作モードで追従させる種別）。マウスモードタブへ。常時編集可。
    // change → settings.setManualTypeId（永続化＋購読で manualMode.setManualType へ実配線）。
    const manualTypeRow = document.createElement("div");
    manualTypeRow.className = "cd-options-row";
    const manualTypeLabel = document.createElement("label");
    manualTypeLabel.className = "cd-options-label";
    manualTypeLabel.textContent = "操作するもの";
    manualTypeLabel.htmlFor = "cd-manual-type-select";
    const manualTypeSelect = document.createElement("select");
    manualTypeSelect.id = "cd-manual-type-select";
    manualTypeSelect.className = "cd-options-select";
    for (const target of MANUAL_TARGETS) {
      const option = document.createElement("option");
      option.value = target.id;
      option.textContent = target.label;
      manualTypeSelect.appendChild(option);
    }
    manualTypeSelect.addEventListener("change", () => {
      this.settings.setManualTypeId(manualTypeSelect.value);
    });
    manualTypeRow.append(manualTypeLabel, manualTypeSelect);

    // [UR3-5] 虫の動きパターン（クリックで出現 / マウス追従）。操作対象=虫のときだけ表示する
    // （syncManualType が section.hidden をトグル）。change → settings.setInsectManualPattern（永続化＋
    // 購読で main が虫コントローラを作り直す）。値は modeSelect と同じく許可集合の ternary で確定させる。
    const insectPatternRow = document.createElement("div");
    insectPatternRow.className = "cd-options-row";
    const insectPatternLabel = document.createElement("label");
    insectPatternLabel.className = "cd-options-label";
    insectPatternLabel.textContent = "動きパターン";
    insectPatternLabel.htmlFor = "cd-insect-pattern-select";
    const insectPatternSelect = document.createElement("select");
    insectPatternSelect.id = "cd-insect-pattern-select";
    insectPatternSelect.className = "cd-options-select";
    for (const opt of INSECT_MANUAL_PATTERN_OPTIONS) {
      const option = document.createElement("option");
      option.value = opt.value;
      option.textContent = opt.label;
      insectPatternSelect.appendChild(option);
    }
    insectPatternSelect.addEventListener("change", () => {
      this.settings.setInsectManualPattern(
        insectPatternSelect.value === "follow" ? "follow" : "click",
      );
    });
    insectPatternRow.append(insectPatternLabel, insectPatternSelect);

    // 出現プリセット（動画モードタブ）。出現間隔＋出現する種類をワンタップで束ねて切り替える。
    // click → settings.applySpawnPreset。適用後は syncFromSettings 経由で interval スライダ表示・
    // 「出現する種類」チェックが新しい値へ自動追従する。
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
    }
    presetRow.append(presetLabel, presetGroup);

    // 出現間隔（動画モードタブ）
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

    // 遊びすぎ防止（動画モードタブ）。一定時間後に自動停止する上限(分)を選ぶ。0=なし。
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

    // マウスカーソルを隠す（共通タブ「表示」）。change → settings.setHideCursor（永続化＋購読で実配線）。
    const hideCursorRow = document.createElement("div");
    hideCursorRow.className = "cd-options-row";
    const hideCursorLabel = document.createElement("label");
    hideCursorLabel.className = "cd-options-label";
    hideCursorLabel.textContent = "マウスカーソルを隠す";
    hideCursorLabel.htmlFor = "cd-hide-cursor-input";
    const hideCursorInput = document.createElement("input");
    hideCursorInput.type = "checkbox";
    hideCursorInput.id = "cd-hide-cursor-input";
    hideCursorInput.className = "cd-options-checkbox";
    hideCursorInput.addEventListener("change", () => {
      this.settings.setHideCursor(hideCursorInput.checked);
    });
    hideCursorRow.append(hideCursorLabel, hideCursorInput);

    // 全画面トグル（Fullscreen API 未対応環境ではボタンを生成しない）。
    let fullscreenButton: HTMLButtonElement | null = null;
    let fullscreenRow: HTMLDivElement | null = null;
    if (isFullscreenSupported()) {
      fullscreenRow = document.createElement("div");
      fullscreenRow.className = "cd-options-row";
      fullscreenButton = document.createElement("button");
      fullscreenButton.type = "button";
      fullscreenButton.className = "cd-options-secondary";
      // ラベル/aria は syncFullscreen() で現在の全画面状態に同期する（初期反映も同メソッド）。
      fullscreenButton.addEventListener("click", () => {
        void toggleAppFullscreen();
      });
      fullscreenRow.appendChild(fullscreenButton);
    }

    // 背景色（共通タブ「背景」）
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

    // オブジェクト画像（共通タブ「オブジェクト」。1枚。label でボタン化し、実 input は視覚的に隠す）
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

    // 音量（共通タブ「音量」）
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

    // ミュート（映像のみモード）。音量スライダとは独立した一括ミュート。ON でも音量値は保持する。
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

    // 「出現する種類」チェックボックス（動画モードタブ。渡された組み込み種別ごとに 1 つ）。
    // change で settings.setAutoTypeEnabled を呼び、syncAutoTypes で checked を復元する。
    const autoTypes = options.autoTypes ?? [];
    const typeRows: HTMLDivElement[] = [];
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
      typeRows.push(typeRow);
      this.autoTypeChecks.push({ id: type.id, input: typeCheckbox });
    }

    // =========================================================================
    // タブ組み立て（3 タブ＝共通/マウスモード/動画モード）。各セクションを対応パネルへ。
    // =========================================================================

    // --- 共通タブ: 動作(モード)・表示・音量・背景・オブジェクト ---
    // [UR3-8] 動きの速さは mode 別になったため共通タブから外し、各モードタブへ配置する。
    const behaviorSection = createSection("動作");
    behaviorSection.append(modeRow);
    const displaySection = createSection("表示");
    displaySection.appendChild(hideCursorRow);
    if (fullscreenRow) {
      displaySection.appendChild(fullscreenRow);
    }
    const volSection = createSection("音量");
    volSection.append(volRow, muteRow);
    const bgSection = createSection("背景");
    bgSection.append(colorRow, imageRow, resetRow);
    const critterSection = createSection("オブジェクト");
    critterSection.append(critterImageRow, critterResetRow);
    // 初見の飼い主向けの操作導線（純テキスト）。共通タブ末尾に置く。
    const helpSection = createHelpSection();

    const commonPanel = this.createTabPanel(0);
    commonPanel.append(
      behaviorSection,
      displaySection,
      volSection,
      bgSection,
      critterSection,
      helpSection,
    );

    // --- マウスモードタブ: 操作するもの・(虫のみ)動きパターン・動き(速さ) ---
    const manualSection = createSection("操作対象");
    manualSection.appendChild(manualTypeRow);
    // [UR3-5] 虫の動きパターン section。操作対象=虫のときだけ表示する（syncManualType が hidden を制御）。
    const insectPatternSection = createSection("動きパターン");
    insectPatternSection.appendChild(insectPatternRow);
    // [UR3-8] マウス操作モードの動きの速さ（従来の選択肢を据置）。
    const manualMotionSection = createSection("動き");
    manualMotionSection.appendChild(manualSpeedRow);
    const manualPanel = this.createTabPanel(1);
    manualPanel.append(manualSection, insectPatternSection, manualMotionSection);

    // --- 動画モードタブ: 動き(速さ)・出現(プリセット/出現間隔)・出現する種類・遊びすぎ防止 ---
    // [UR3-8] 動画モードの動きの速さ（底上げ済み）。要望「動画モードが全体的に遅い」への主対応のため
    // タブ先頭に置いて発見しやすくする。
    const autoMotionSection = createSection("動き");
    autoMotionSection.appendChild(autoSpeedRow);
    const spawnSection = createSection("出現");
    spawnSection.append(presetRow, intervalRow);
    const autoPanel = this.createTabPanel(2);
    autoPanel.append(autoMotionSection, spawnSection);
    // 種別が渡された時だけ「出現する種類」を差し込む（空セクションを出さない）。
    if (typeRows.length > 0) {
      const typesSection = createSection("出現する種類");
      for (const row of typeRows) {
        typesSection.appendChild(row);
      }
      autoPanel.appendChild(typesSection);
    }
    const playLimitSection = createSection("遊びすぎ防止");
    playLimitSection.appendChild(playLimitRow);
    autoPanel.appendChild(playLimitSection);

    // タブリスト（ヘッダ直下）＋タブパネルをカードへ。
    const tablist = document.createElement("div");
    tablist.className = "cd-options-tablist";
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-label", "設定カテゴリ");
    tablist.addEventListener("keydown", this.onTabKeyDown);
    for (const button of this.tabButtons) {
      tablist.appendChild(button);
    }

    card.append(header, tablist, commonPanel, manualPanel, autoPanel);
    overlay.appendChild(card);

    this.element = overlay;
    this.closeButton = closeButton;
    this.fullscreenButton = fullscreenButton;
    this.hideCursorInput = hideCursorInput;
    this.modeSelect = modeSelect;
    this.manualTypeSelect = manualTypeSelect;
    this.insectPatternSelect = insectPatternSelect;
    this.insectPatternSection = insectPatternSection;
    this.manualSpeedSelect = manualSpeedSelect;
    this.autoSpeedSelect = autoSpeedSelect;
    this.intervalInput = intervalInput;
    this.intervalValue = intervalValue;
    this.playLimitSelect = playLimitSelect;
    this.colorInput = colorInput;
    this.fileInput = fileInput;
    this.critterFileInput = critterFileInput;
    this.volumeInput = volumeInput;
    this.volumeValue = volumeValue;
    this.muteInput = muteInput;

    // 初期選択（共通タブ）を反映する。
    this.selectTab(0);

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

  /**
   * タブボタンと対応 tabpanel を 1 組作り、this.tabButtons / this.tabPanels に登録して panel を返す。
   * 呼び出し側はこの panel へセクションを append する。ボタンの click / roving tabindex / aria も配線する。
   */
  private createTabPanel(index: number): HTMLElement {
    const tab = OPTIONS_TABS[index];
    const selected = index === 0;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "cd-options-tab";
    button.setAttribute("role", "tab");
    button.id = `cd-options-tab-${tab.id}`;
    button.setAttribute("aria-controls", `cd-options-tabpanel-${tab.id}`);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    button.textContent = tab.label;
    button.addEventListener("click", () => this.selectTab(index));
    this.tabButtons.push(button);

    const panel = document.createElement("div");
    panel.className = "cd-options-tabpanel";
    panel.id = `cd-options-tabpanel-${tab.id}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", button.id);
    panel.hidden = !selected;
    this.tabPanels.push(panel);

    return panel;
  }

  /** 指定タブを選択（対応 tabpanel のみ表示・他は hidden。aria/roving tabindex も更新）。 */
  private selectTab(index: number): void {
    if (index < 0 || index >= this.tabButtons.length) {
      return;
    }
    this.activeTabIndex = index;
    for (let i = 0; i < this.tabButtons.length; i++) {
      const isSelected = i === index;
      const button = this.tabButtons[i];
      button.setAttribute("aria-selected", String(isSelected));
      button.tabIndex = isSelected ? 0 : -1;
      this.tabPanels[i].hidden = !isSelected;
    }
  }

  /** タブリスト上の矢印/Home/End で選択とフォーカスを移す（自動アクティベーション）。 */
  private readonly onTabKeyDown = (event: KeyboardEvent): void => {
    const target = tabKeyTarget(this.activeTabIndex, event.key, this.tabButtons.length);
    if (target < 0) {
      return;
    }
    event.preventDefault();
    this.selectTab(target);
    this.tabButtons[target].focus();
  };

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
    // 過大ファイルのサイズ上限（~8MB）。背景は全画面 cover-fit で拡大され decode() の
    // VRAM リスクが大きいため、クリッターと対称にバイトサイズで事前に弾く。
    if (file.size > MAX_BACKGROUND_IMAGE_BYTES) {
      console.warn("画像サイズが大きすぎるため無視します。", file.size);
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
    this.syncManualType(settings.manualTypeId);
    this.syncInsectPattern(settings.insectManualPattern);
    this.syncSpeed(this.manualSpeedSelect, SPEED_SCALE_OPTIONS, settings.manualSpeedScale);
    this.syncSpeed(this.autoSpeedSelect, AUTO_SPEED_SCALE_OPTIONS, settings.autoSpeedScale);
    this.syncBackground(settings.background);
    this.syncAutoTypes(settings.autoDisabledTypes);
    this.syncVolume();
    this.syncMute(settings.muted);
    this.syncHideCursor(settings.hideCursor);
  }

  /**
   * [UR3-8] 動きの速さ select を現在値へ復元する（manual/auto 共通ヘルパ）。プリセット外の永続値でも
   * 壊れないよう、渡した選択肢群の中から数値が最も近いものを選ぶ（一致があればそれが最近傍）。
   * manual は SPEED_SCALE_OPTIONS・auto は AUTO_SPEED_SCALE_OPTIONS を渡す。
   */
  private syncSpeed(
    select: HTMLSelectElement,
    options: readonly SpeedScaleOption[],
    speedScale: number,
  ): void {
    let best = options[0];
    let bestDist = Math.abs(best.value - speedScale);
    for (const opt of options) {
      const dist = Math.abs(opt.value - speedScale);
      if (dist < bestDist) {
        best = opt;
        bestDist = dist;
      }
    }
    const text = String(best.value);
    if (select.value !== text) {
      select.value = text;
    }
  }

  /**
   * [UR-4] 操作するもの select を settings.manualTypeId から復元する。
   * タブでモード別に分けたため disabled 制御は撤廃（常時編集可）。配線・復元は維持する。
   */
  private syncManualType(manualTypeId: string): void {
    if (this.manualTypeSelect.value !== manualTypeId) {
      this.manualTypeSelect.value = manualTypeId;
    }
    // [UR3-5] 虫の動きパターン UI は操作対象=虫のときだけ表示する（他種別選択で隠す）。
    this.insectPatternSection.hidden = manualTypeId !== INSECT_TYPE_ID;
  }

  /**
   * [UR3-5] 虫の動きパターン select を settings.insectManualPattern から復元する（外部変更にも追従）。
   * 表示/非表示は syncManualType が操作対象に応じて切替える（本メソッドは値のみ同期）。
   */
  private syncInsectPattern(pattern: InsectManualPattern): void {
    if (this.insectPatternSelect.value !== pattern) {
      this.insectPatternSelect.value = pattern;
    }
  }

  /** ミュートチェックボックスを settings.muted から復元する（外部変更にも追従）。 */
  private syncMute(muted: boolean): void {
    if (this.muteInput.checked !== muted) {
      this.muteInput.checked = muted;
    }
  }

  /** カーソル非表示チェックボックスを settings.hideCursor から復元する（外部変更にも追従）。 */
  private syncHideCursor(hideCursor: boolean): void {
    if (this.hideCursorInput.checked !== hideCursor) {
      this.hideCursorInput.checked = hideCursor;
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

  /**
   * モード select・出現間隔スライダ・遊びすぎ防止 select を現在値へ復元する。
   * タブでモード別に分けたため disabled 制御は撤廃（各コントロールは常時編集可）。
   */
  private syncMode(mode: AppMode, intervalMs: number, playLimitMinutes: number): void {
    if (this.modeSelect.value !== mode) {
      this.modeSelect.value = mode;
    }
    const text = String(intervalMs);
    if (this.intervalInput.value !== text) {
      this.intervalInput.value = text;
    }
    this.intervalValue.textContent = formatIntervalMs(intervalMs);

    const playLimitText = String(playLimitMinutes);
    if (this.playLimitSelect.value !== playLimitText) {
      this.playLimitSelect.value = playLimitText;
    }
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
