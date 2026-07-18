import { Assets } from "pixi.js";
import { BackgroundController } from "./app/BackgroundController";
import { CatDancerApp } from "./app/CatDancerApp";
import { PointerInput } from "./app/PointerInput";
import { DEFAULT_WORLD_MARGIN, Scene } from "./app/Scene";
import { AudioManager } from "./audio/AudioManager";
import { MOUSE_SQUEAK_ID, registerCritterSounds } from "./audio/sounds";
import { getCritterType, listCritterTypes } from "./critters/registry";
import { createTailTexture } from "./critters/tail/tailTexture";
import { FOXTAIL_TYPE_ID, registerFoxtailType } from "./critters/types/foxtail";
import { MOUSE_TYPE_ID, registerMouseType } from "./critters/types/mouse";
import { registerToysType, TOYS_TYPE_ID } from "./critters/types/toys";
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
 * AutoMode: 一定間隔で mouse/foxtail/toys を重み付きでミックス spawn（ネズミ=横断、猫じゃらし/
 *   おもちゃ=揺れて誘い縁へ退場）→ 画面外で despawn（猫用動画）。
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

  // 種別レジストリへ登録（ネズミ＋dangle系: 猫じゃらし/おもちゃ）。
  // 登録済み全種別の hideRadius から margin を決める（本体＋尻尾/揺れを隠せる幅）。
  registerMouseType();
  registerFoxtailType();
  registerToysType();
  const margin = computeWorldMargin(listCritterTypes(), DEFAULT_WORLD_MARGIN);

  const scene = new Scene(app.viewport, margin);
  app.stage.addChild(scene.root);
  app.onResize((viewport) => scene.resize(viewport));

  // 背景設定 → 描画の橋渡し。
  const backgroundController = new BackgroundController(scene.backgroundLayer);

  // 共有テクスチャ: 各種別の本体をロード、尻尾は 1 度だけ手続き生成する。
  // 全 critter で共有するため、AutoMode の多数 spawn でもテクスチャは増えない
  // （despawn 時は Sprite/MeshRope の geometry のみ破棄し、共有テクスチャは保持＝リークしない）。
  const mouseType = getCritterType(MOUSE_TYPE_ID);
  const foxtailType = getCritterType(FOXTAIL_TYPE_ID);
  const toysType = getCritterType(TOYS_TYPE_ID);
  const [bodyTexture, foxtailTexture, toysTexture] = await Promise.all([
    Assets.load(mouseType.textureUrl),
    Assets.load(foxtailType.textureUrl),
    Assets.load(toysType.textureUrl),
  ]);
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
  // AutoMode は登録済みの auto 対象種別を重み付きでミックス出現させる。
  // mouse=横断、foxtail/toys=揺れて誘い縁へ退場。重みで出現頻度を調整する。
  const autoMode = new AutoMode({
    scene,
    entries: [
      { typeId: MOUSE_TYPE_ID, bodyTexture, tailTexture, weight: 2 },
      { typeId: FOXTAIL_TYPE_ID, bodyTexture: foxtailTexture, weight: 1.5 },
      { typeId: TOYS_TYPE_ID, bodyTexture: toysTexture, weight: 1.5 },
    ],
    audio,
    sounds: mouseType.sounds,
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
      // モード切替（例: __catScene.setMode('auto')）。settings 経由で switchTo が走る。
      setMode: (name: AppMode) => settings.setMode(name),
      // 特定種別を強制 spawn（sway/pivot/出入りの確認用）。auto モードでないと更新されないため
      // 自動で auto へ切替えてから注入する（例: __catScene.spawnType('foxtail')）。
      spawnType: (typeId: string) => {
        if (currentModeName !== "auto") {
          settings.setMode("auto");
        }
        autoMode.spawnType(typeId);
      },
      // 画面上の critter を全消去（isolated スクショ用）。
      clear: () => scene.despawnAll(),
      // マウス追従の客観計測用: ネズミ位置/速度・ポインタ(=追従目標)・距離を返す。
      manual: () => {
        const snap = manualMode.debugSnapshot();
        if (!snap) {
          return null;
        }
        const dist = snap.pointer
          ? Math.hypot(snap.pointer.x - snap.position.x, snap.pointer.y - snap.position.y)
          : null;
        return {
          ...snap,
          speed: Math.hypot(snap.velocity.x, snap.velocity.y),
          distanceToPointer: dist,
          // 回転検証の人間可読補助: heading を度数化、鏡像(左半分)かどうか。
          headingDeg: (snap.heading * 180) / Math.PI,
          mirrored: snap.viewScaleY < 0,
        };
      },
      // canvas に pointermove を dispatch する検証補助（client 座標）。
      dispatchPointer: (clientX: number, clientY: number) => {
        app.canvas.dispatchEvent(
          new PointerEvent("pointermove", { clientX, clientY, bubbles: true }),
        );
      },
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
