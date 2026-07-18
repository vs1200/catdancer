import { Assets, type Texture } from "pixi.js";
import { BackgroundController } from "./app/BackgroundController";
import { CatDancerApp } from "./app/CatDancerApp";
import { textureFromImageWithin } from "./app/imageTexture";
import { clientToWorld, PointerInput } from "./app/PointerInput";
import { DEFAULT_WORLD_MARGIN, Scene } from "./app/Scene";
import { AudioManager } from "./audio/AudioManager";
import { MOUSE_SQUEAK_ID, registerCritterSounds } from "./audio/sounds";
import {
  getCritterType,
  hasCritterType,
  listCritterTypes,
  registerCritterType,
  unregisterCritterType,
} from "./critters/registry";
import { FOXTAIL_TYPE_ID, registerFoxtailType } from "./critters/types/foxtail";
import { createImageCritterType } from "./critters/types/imageCritter";
import { INSECT_TYPE_ID, registerInsectType } from "./critters/types/insect";
import { MOUSE_TAIL_TEXTURE_URL, MOUSE_TYPE_ID, registerMouseType } from "./critters/types/mouse";
import { registerToysType, TOYS_TYPE_ID } from "./critters/types/toys";
import { computeWorldMargin } from "./critters/worldMargin";
import { AutoMode } from "./modes/AutoMode";
import { ManualMode } from "./modes/ManualMode";
import type { Mode } from "./modes/Mode";
import { getCritterImage } from "./settings/imageStore";
import { SettingsStore } from "./settings/SettingsStore";
import type { AppMode } from "./settings/settingsData";
import { OptionsButton } from "./ui/OptionsButton";
import { OptionsPanel } from "./ui/OptionsPanel";

/** ユーザー任意画像クリッターの固定種別 id（単一スロット。imageId は設定 customCritterImageId に持つ）。 */
const CUSTOM_CRITTER_TYPE_ID = "custom";
/** ユーザー任意画像クリッターの出現重み（他種別と混ざって程よく出る）。 */
const CUSTOM_CRITTER_WEIGHT = 1.5;

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
  registerInsectType();
  const margin = computeWorldMargin(listCritterTypes(), DEFAULT_WORLD_MARGIN);

  const scene = new Scene(app.viewport, margin);
  app.stage.addChild(scene.root);
  app.onResize((viewport) => scene.resize(viewport));

  // 背景設定 → 描画の橋渡し。
  const backgroundController = new BackgroundController(scene.backgroundLayer);

  // 共有テクスチャ: 各種別の本体と尻尾（mouse-tail.webp=本物）を 1 度だけロードする。
  // 全 critter で共有するため、AutoMode の多数 spawn でもテクスチャは増えない
  // （despawn 時は Sprite/MeshRope の geometry のみ破棄し、共有テクスチャは保持＝リークしない）。
  const mouseType = getCritterType(MOUSE_TYPE_ID);
  const foxtailType = getCritterType(FOXTAIL_TYPE_ID);
  const toysType = getCritterType(TOYS_TYPE_ID);
  const insectType = getCritterType(INSECT_TYPE_ID);
  const [bodyTexture, foxtailTexture, toysTexture, insectTexture, tailTexture] = await Promise.all([
    Assets.load(mouseType.textureUrl),
    Assets.load(foxtailType.textureUrl),
    Assets.load(toysType.textureUrl),
    Assets.load(insectType.textureUrl),
    Assets.load(MOUSE_TAIL_TEXTURE_URL),
  ]);

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
  // mouse=横断、foxtail/toys=揺れて誘い縁へ退場、insect=不規則ダッシュ。重みで出現頻度を調整する。
  const autoMode = new AutoMode({
    scene,
    entries: [
      { typeId: MOUSE_TYPE_ID, bodyTexture, tailTexture, weight: 2 },
      { typeId: FOXTAIL_TYPE_ID, bodyTexture: foxtailTexture, weight: 1.5 },
      { typeId: TOYS_TYPE_ID, bodyTexture: toysTexture, weight: 1.5 },
      { typeId: INSECT_TYPE_ID, bodyTexture: insectTexture, weight: 2 },
    ],
    audio,
    intervalMs: settings.settings.autoSpawnIntervalMs,
  });
  // auto 出現の無効化種別を初期反映（reload 復元）。オプションの「出現する種類」ON/OFFに対応。
  autoMode.setDisabledTypes(settings.settings.autoDisabledTypes);

  // --- ユーザー任意画像クリッター（単一スロット）の動的ロード/破棄 ---
  // 設定 customCritterImageId → IDB(critterImages) の Blob → objectURL → Assets.load →
  // createImageCritterType 登録 → AutoMode.addEntry。差し替え/削除では必ず objectURL を revoke する。
  // token で最新要求以外の結果を破棄し、連続変更時に旧画像が後から登録される/リークするのを防ぐ。
  let customCritterUrl: string | null = null;
  let customCritterTexture: Texture | null = null;
  let customCritterToken = 0;

  /** 現在のカスタム型/エントリ/テクスチャ/objectURL を解放する（in-flight ロードも token 進行で無効化）。 */
  const teardownCustomCritter = (): void => {
    customCritterToken++;
    autoMode.removeEntry(CUSTOM_CRITTER_TYPE_ID);
    // 画面上の当該種別 critter を先に despawn し、旧テクスチャを参照する Sprite を破棄する。
    // （これを飛ばして texture.destroy すると、飛行中の critter の表示が壊れる。）
    scene.despawnWhere((c) => c.state.typeId === CUSTOM_CRITTER_TYPE_ID);
    if (hasCritterType(CUSTOM_CRITTER_TYPE_ID)) {
      unregisterCritterType(CUSTOM_CRITTER_TYPE_ID);
    }
    // 参照が切れた後にテクスチャを破棄する（destroy(true) で TextureSource ごと解放＝リーク防止）。
    customCritterTexture?.destroy(true);
    customCritterTexture = null;
    if (customCritterUrl) {
      URL.revokeObjectURL(customCritterUrl);
      customCritterUrl = null;
    }
  };

  /** imageId のカスタム画像をロードして種別登録＋AutoMode エントリ追加する（失敗時は安全に無視）。 */
  const loadCustomCritter = async (imageId: string): Promise<void> => {
    // token は「呼ばれた時点の最新値」を捕捉するだけ（進めない）。差し替え時は subscribe が
    // 先に teardownCustomCritter() で token を進めて in-flight を無効化する（＝二重加算を避ける）。
    // 起動時復元は teardown を挟まず直接呼ばれるが、その時点では in-flight が無いので捕捉のみで足りる。
    const token = customCritterToken;
    let blob: Blob | null = null;
    try {
      blob = await getCritterImage(imageId);
    } catch {
      blob = null;
    }
    if (token !== customCritterToken) {
      return; // 後続要求に追い越された。
    }
    if (!blob) {
      return; // IDB に無い（削除済み/未対応）。
    }
    // blob objectURL は拡張子が無く Assets.load の loader 推定が効かないため、背景画像と同じく
    // Image.decode → Texture でテクスチャ化する（拡張子非依存で確実）。
    // 画素寸法が上限超なら textureFromImageWithin が等比縮小してから Texture 化する（VRAM 保護）。
    const url = URL.createObjectURL(blob);
    let texture: Texture;
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      texture = textureFromImageWithin(image);
    } catch {
      URL.revokeObjectURL(url);
      return;
    }
    if (token !== customCritterToken) {
      // ロード中に追い越された → 生成物を破棄（リーク防止）。
      texture.destroy(true);
      URL.revokeObjectURL(url);
      return;
    }
    // 念のため既存カスタム型が残っていれば外してから再登録する（id 重複エラーを避ける）。
    if (hasCritterType(CUSTOM_CRITTER_TYPE_ID)) {
      unregisterCritterType(CUSTOM_CRITTER_TYPE_ID);
    }
    registerCritterType(createImageCritterType(CUSTOM_CRITTER_TYPE_ID));
    autoMode.addEntry({
      typeId: CUSTOM_CRITTER_TYPE_ID,
      bodyTexture: texture,
      weight: CUSTOM_CRITTER_WEIGHT,
    });
    customCritterUrl = url;
    customCritterTexture = texture;
  };

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

  // 捕獲フィードバック（auto 専用）: canvas のタップ/クリックで、当たった動くオブジェクトを
  // 素早く逃がし（画面外へ→despawn）反応SEを鳴らす。auto かつパネルが閉じている時のみ有効
  // （manual はネズミがカーソル追従なので対象外／パネル開時は backdrop が捕らえるが二重の保険）。
  app.canvas.addEventListener("pointerdown", (event) => {
    if (currentModeName !== "auto" || panelOpen) {
      return;
    }
    const p = clientToWorld(app.canvas, app.viewport, event.clientX, event.clientY);
    autoMode.handleTap(p.x, p.y);
  });

  // 設定変更の反映（音量/背景 + モード/出現間隔 + カスタム画像クリッター）。前回値と比較して差分だけ反映する。
  let prevMode = settings.settings.mode;
  let prevInterval = settings.settings.autoSpawnIntervalMs;
  let prevCustomCritterId = settings.settings.customCritterImageId;
  // 無効化種別リストは配列なので join したキーで差分判定する（volume ドラッグ等の頻繁通知で無駄に再構築しない）。
  let prevAutoDisabledKey = settings.settings.autoDisabledTypes.join(" ");
  settings.subscribe((next) => {
    audio.setMasterVolume(next.masterVolume);
    void backgroundController.apply(next);
    if (next.autoSpawnIntervalMs !== prevInterval) {
      prevInterval = next.autoSpawnIntervalMs;
      autoMode.setInterval(next.autoSpawnIntervalMs);
    }
    const nextAutoDisabledKey = next.autoDisabledTypes.join(" ");
    if (nextAutoDisabledKey !== prevAutoDisabledKey) {
      prevAutoDisabledKey = nextAutoDisabledKey;
      autoMode.setDisabledTypes(next.autoDisabledTypes);
    }
    if (next.mode !== prevMode) {
      prevMode = next.mode;
      switchTo(next.mode);
    }
    if (next.customCritterImageId !== prevCustomCritterId) {
      prevCustomCritterId = next.customCritterImageId;
      // 設定時/クリア時いずれも、まず現行カスタムを破棄（objectURL revoke 込み）してから、
      // 設定時は新規ロード（登録＋addEntry）する。
      teardownCustomCritter();
      if (next.customCritterImageId) {
        void loadCustomCritter(next.customCritterImageId);
      }
    }
  });

  // 起動時復元: 背景（色 or IDB 画像）と音量を適用。
  await backgroundController.apply(settings.settings);
  audio.setMasterVolume(settings.settings.masterVolume);
  // 起動時復元: カスタム画像クリッター（あれば IDB からロードして AutoMode に追加）。
  if (settings.settings.customCritterImageId) {
    await loadCustomCritter(settings.settings.customCritterImageId);
  }

  // オプション画面（右下ボタン→設定パネル）。パネルは settings の公開 API を呼ぶ。
  // 開いている間は現行モードを一時停止（Manual は追従を止め、Auto は spawn を止める）。
  // 「出現する種類」トグル対象（組み込み4種）の id と表示名。カスタム画像クリッターは対象外。
  const autoTypeOptions = [MOUSE_TYPE_ID, FOXTAIL_TYPE_ID, TOYS_TYPE_ID, INSECT_TYPE_ID].map(
    (id) => ({ id, name: getCritterType(id).displayName }),
  );
  const optionsPanel = new OptionsPanel({ settings, audio, autoTypes: autoTypeOptions });
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
      // 画面上の全 critter の中心/サイズ/種別（捕獲タップの客観検証用: tap 位置決めと前後比較）。
      positions: () =>
        scene.critterList.map((c) => ({
          typeId: c.state.typeId,
          x: c.state.position.x,
          y: c.state.position.y,
          size: c.state.size,
          speed: Math.hypot(c.state.velocity.x, c.state.velocity.y),
        })),
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
      // 捕獲タップの検証補助: canvas に実 pointerdown を dispatch し、配線ごと（guard 込み）で
      // handleTap を通す（client 座標）。auto かつパネル閉のとき当たれば逃走＋反応SEが出る。
      tap: (clientX: number, clientY: number) => {
        app.canvas.dispatchEvent(
          new PointerEvent("pointerdown", { clientX, clientY, bubbles: true }),
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
