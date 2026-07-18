import { Assets } from "pixi.js";
import { BackgroundController } from "./app/BackgroundController";
import { CatDancerApp } from "./app/CatDancerApp";
import { PointerInput } from "./app/PointerInput";
import { DEFAULT_WORLD_MARGIN, Scene } from "./app/Scene";
import { AudioManager } from "./audio/AudioManager";
import { MOUSE_SQUEAK_ID, registerCritterSounds } from "./audio/sounds";
import { getCritterType, listCritterTypes } from "./critters/registry";
import { createTailTexture } from "./critters/tail/tailTexture";
import { MOUSE_TYPE_ID, registerMouseType } from "./critters/types/mouse";
import { computeWorldMargin } from "./critters/worldMargin";
import { AutoMode } from "./modes/AutoMode";
import { ManualMode } from "./modes/ManualMode";
import type { Mode } from "./modes/Mode";
import { SettingsStore } from "./settings/SettingsStore";
import type { AppMode } from "./settings/settingsData";
import { OptionsButton } from "./ui/OptionsButton";
import { OptionsPanel } from "./ui/OptionsPanel";

/**
 * catdancer エントリ（v2 土台: モード切替 + spawn/despawn 基盤）。
 * App 起動 → 種別登録 → world margin 算出 → Scene 構築 →
 * 共有テクスチャ（本体/尻尾）をロード/生成 → ManualMode/AutoMode を構築 →
 * 設定の mode に応じて start/stop を切り替え、毎フレーム現行モードを update する。
 *
 * ManualMode: ポインタへ慣性追従するネズミ 1 体（v1 の挙動）。
 * AutoMode: 一定間隔でネズミを画面外から spawn → 横切り → 画面外で despawn（猫用動画）。
 * mode / 出現間隔はオプション画面から変更・永続化し、reload で復元する。
 */
async function bootstrap(): Promise<void> {
  const mount = document.querySelector<HTMLDivElement>("#app");
  if (!mount) {
    throw new Error("マウント先 #app が見つかりません");
  }

  // 設定を localStorage から復元（壊れた JSON はデフォルトへフォールバック）。
  const settings = new SettingsStore();

  // 初期背景色を renderer 背景にも渡して初回描画のチラつき（既定色）を防ぐ。
  const app = await CatDancerApp.create(mount, {
    background: settings.settings.background.color,
  });

  // 音声基盤。合成SEを登録し、最初のユーザージェスチャで AudioContext を resume する導線を張る。
  const audio = new AudioManager({ masterVolume: settings.settings.masterVolume });
  registerCritterSounds(audio);
  audio.attachAutoResume(window);

  // 種別レジストリへネズミを登録し、その hideRadius から margin を決める（本体＋尻尾を隠せる幅）。
  registerMouseType();
  const margin = computeWorldMargin(listCritterTypes(), DEFAULT_WORLD_MARGIN);

  const scene = new Scene(app.viewport, margin);
  app.stage.addChild(scene.root);
  app.onResize((viewport) => scene.resize(viewport));

  // 背景設定 → 描画の橋渡し。
  const backgroundController = new BackgroundController(scene.backgroundLayer);

  // 共有テクスチャ: 本体はロード、尻尾は 1 度だけ手続き生成する。
  // 全 critter でこの 2 枚を共有するため、AutoMode の多数 spawn でもテクスチャは増えない
  // （despawn 時は Sprite/MeshRope の geometry のみ破棄し、共有テクスチャは保持＝リークしない）。
  const mouseType = getCritterType(MOUSE_TYPE_ID);
  const bodyTexture = await Assets.load(mouseType.textureUrl);
  const tailTexture = createTailTexture();

  // ポインタ入力（ManualMode が attach/detach を占有管理する）。
  const pointerInput = new PointerInput(app.canvas, () => app.viewport);

  // モード実体。両モードとも同じ Scene / 共有テクスチャ / 種別 / SE を再利用する。
  const manualMode = new ManualMode({
    scene,
    pointer: pointerInput,
    bodyTexture,
    tailTexture,
    audio,
    sounds: mouseType.sounds,
    typeId: MOUSE_TYPE_ID,
  });
  const autoMode = new AutoMode({
    scene,
    bodyTexture,
    tailTexture,
    audio,
    sounds: mouseType.sounds,
    typeId: MOUSE_TYPE_ID,
    intervalMs: settings.settings.autoSpawnIntervalMs,
  });

  // --- モード切替コントローラ ---
  let currentMode: Mode | null = null;
  let currentModeName: AppMode = settings.settings.mode;
  let panelOpen = false;

  const modeByName = (name: AppMode): Mode => (name === "auto" ? autoMode : manualMode);

  /** 現行モードを止め、指定モードへ切り替える（前モードの critter を後始末してから開始）。 */
  const switchTo = (name: AppMode): void => {
    currentMode?.stop();
    currentModeName = name;
    currentMode = modeByName(name);
    currentMode.start();
    // 切替後もパネル開閉状態を引き継ぐ（開いていれば新モードも一時停止）。
    currentMode.setPaused(panelOpen);
  };

  // 設定変更の反映（音量/背景 + モード/出現間隔）。前回値と比較して差分だけ反映する。
  let prevMode = settings.settings.mode;
  let prevInterval = settings.settings.autoSpawnIntervalMs;
  settings.subscribe((next) => {
    audio.setMasterVolume(next.masterVolume);
    void backgroundController.apply(next);
    if (next.autoSpawnIntervalMs !== prevInterval) {
      prevInterval = next.autoSpawnIntervalMs;
      autoMode.setInterval(next.autoSpawnIntervalMs);
    }
    if (next.mode !== prevMode) {
      prevMode = next.mode;
      switchTo(next.mode);
    }
  });

  // 起動時復元: 背景（色 or IDB 画像）と音量を適用。
  await backgroundController.apply(settings.settings);
  audio.setMasterVolume(settings.settings.masterVolume);

  // オプション画面（右下ボタン→設定パネル）。パネルは settings の公開 API を呼ぶ。
  // 開いている間は現行モードを一時停止（Manual は追従を止め、Auto は spawn を止める）。
  const optionsPanel = new OptionsPanel({ settings, audio });
  const optionsButton = new OptionsButton({ onClick: () => optionsPanel.toggle() });
  optionsPanel.setOnOpenChange((open) => {
    panelOpen = open;
    optionsButton.setExpanded(open);
    currentMode?.setPaused(open);
  });
  optionsPanel.mount(document.body);
  optionsButton.mount(document.body);

  // 復元した mode でモードを開始する。
  switchTo(settings.settings.mode);

  // 開発時のみ: critter 数/モード等を観測する DEV フックを露出する（本番ビルドでは tree-shake）。
  if (import.meta.env.DEV) {
    (window as unknown as { __catScene?: unknown }).__catScene = {
      critterCount: () => scene.critterCount,
      mode: () => currentModeName,
    };
    // 設定 API（オプション画面が呼ぶ形）を検証用に露出する。
    // 例: __catSettings.setMode('auto') / setAutoSpawnInterval(800)
    (window as unknown as { __catSettings?: unknown }).__catSettings = settings;
    // 背景描画の実状態。
    (window as unknown as { __catBg?: unknown }).__catBg = {
      info: () => scene.backgroundLayer.debugInfo(),
      settings: () => settings.settings,
    };
    // 音声の客観確認（ヘッドレスでも RMS/peak で音を確認する）。
    (window as unknown as { __catAudio?: unknown }).__catAudio = {
      state: () => audio.state,
      rms: () => audio.getRms(),
      peak: () => audio.getPeak(),
      master: () => audio.masterVolume,
      squeak: () => audio.playOneShot(MOUSE_SQUEAK_ID),
    };
  }

  // 毎フレーム現行モードを更新する。
  app.ticker.add((ticker) => {
    currentMode?.update(ticker.deltaMS / 1000);
  });
}

bootstrap().catch((error: unknown) => {
  console.error("catdancer の起動に失敗しました:", error);
});
