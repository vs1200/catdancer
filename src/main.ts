import { Assets } from "pixi.js";
import { BackgroundController } from "./app/BackgroundController";
import { CatDancerApp } from "./app/CatDancerApp";
import { PointerInput } from "./app/PointerInput";
import { DEFAULT_WORLD_MARGIN, Scene } from "./app/Scene";
import { AudioManager } from "./audio/AudioManager";
import { CritterAudioController } from "./audio/CritterAudioController";
import { registerCritterSounds } from "./audio/sounds";
import { createCritter } from "./critters/Critter";
import { getCritterType, listCritterTypes } from "./critters/registry";
import { MOUSE_TYPE_ID, registerMouseType } from "./critters/types/mouse";
import { computeWorldMargin } from "./critters/worldMargin";
import type { MovementContext } from "./movement/Movement";
import { SettingsStore } from "./settings/SettingsStore";
import type { AppSettings } from "./settings/settingsData";

/**
 * catdancer エントリ（v1 マウス操作モード）。
 * App 起動 → 種別登録 → 種別から world margin(画面外バッファ)を動的算出 → Scene 構築 →
 * ネズミ 1 体を生成し、ポインタへ慣性追従(MouseFollowMovement)させる。
 * ポインタがウィンドウ外へ出れば画面外へ走り去って隠れ、戻れば再出現する。
 * さらに AudioManager でSEを合成し、走行音(速度連動)とチューチュー(断続)を鳴らす。
 */
async function bootstrap(): Promise<void> {
  const mount = document.querySelector<HTMLDivElement>("#app");
  if (!mount) {
    throw new Error("マウント先 #app が見つかりません");
  }

  // 設定を localStorage から復元（壊れた JSON はデフォルトへフォールバック）。
  // 背景色/音量は以降この設定を単一の真実源として適用する。
  const settings = new SettingsStore();

  // 初期背景色を renderer 背景にも渡して初回描画のチラつき（既定色）を防ぐ。
  const app = await CatDancerApp.create(mount, {
    background: settings.settings.background.color,
  });

  // 音声基盤。合成SEを登録し、最初のユーザージェスチャ(pointerdown/keydown/touchstart)で
  // AudioContext を resume する導線を張る（autoplay 制限対策。pointermove は gesture 無効）。
  // master 音量は復元した設定を初期値にする。
  const audio = new AudioManager({ masterVolume: settings.settings.masterVolume });
  registerCritterSounds(audio);
  audio.attachAutoResume(window);

  // 種別レジストリへネズミを登録し、その hideRadius から margin を決める（本体＋尻尾を隠せる幅）。
  registerMouseType();
  const margin = computeWorldMargin(listCritterTypes(), DEFAULT_WORLD_MARGIN);

  const scene = new Scene(app.viewport, margin);
  app.stage.addChild(scene.root);
  app.onResize((viewport) => scene.resize(viewport));

  // 背景設定 → 描画の橋渡し。設定変更/起動時復元の両方をこの apply 一本に集約する。
  const backgroundController = new BackgroundController(scene.backgroundLayer);
  // 設定変更を Scene（背景）と AudioManager（音量）へ反映する購読。
  const applySettings = (next: AppSettings): void => {
    audio.setMasterVolume(next.masterVolume);
    void backgroundController.apply(next);
  };
  settings.subscribe(applySettings);
  // 起動時復元: 現在の設定（色 or IDB からの画像 / 音量）を適用する。
  await backgroundController.apply(settings.settings);
  audio.setMasterVolume(settings.settings.masterVolume);

  // ポインタ入力を配線。起動時は viewport 中心を初期ポインタにしてネズミを画面内に出す。
  const pointerInput = new PointerInput(app.canvas, () => app.viewport);
  pointerInput.attach();
  pointerInput.centerToViewport();

  // テクスチャをロードしてネズミ 1 体を画面中央に生成（初速なし＝加速で追従開始）。
  const mouseType = getCritterType(MOUSE_TYPE_ID);
  const texture = await Assets.load(mouseType.textureUrl);
  const critter = createCritter(MOUSE_TYPE_ID, texture, {
    position: { x: app.viewport.width / 2, y: app.viewport.height / 2 },
  });
  scene.add(critter);

  // ネズミの SE 連動。走行音ループを開始（無音で待機）し、以降 update で速度連動＋チューチュー。
  const mouseAudio = new CritterAudioController(audio, mouseType.sounds);
  mouseAudio.start();

  // 開発時のみ: ヘッドレスでも音を客観確認できる debug フックを露出する（本番ビルドでは tree-shake）。
  if (import.meta.env.DEV) {
    (window as unknown as { __catAudio?: unknown }).__catAudio = {
      state: () => audio.state,
      rms: () => audio.getRms(),
      peak: () => audio.getPeak(),
      master: () => audio.masterVolume,
      scurry: () => mouseAudio.scurryLevel,
      speed: () => Math.hypot(critter.state.velocity.x, critter.state.velocity.y),
      // 任意タイミングで 1 発鳴らして RMS の跳ねを確認するための補助。
      squeak: () => audio.playOneShot(mouseType.sounds.voice ?? ""),
    };
    // 背景設定 API（オプション画面 #10 が呼ぶ形）を検証用に露出する。
    // 例: __catSettings.setBackgroundColor('#cc3344') / setBackgroundImage(blob)
    (window as unknown as { __catSettings?: unknown }).__catSettings = settings;
    // 背景描画の実状態（cover-fit / resize 追従を eval で客観確認する）。
    (window as unknown as { __catBg?: unknown }).__catBg = {
      info: () => scene.backgroundLayer.debugInfo(),
      settings: () => settings.settings,
    };
  }

  // 毎フレーム movement を適用して表示同期。world/pointer は都度最新を参照（resize 追従）。
  const ctx: MovementContext = { world: scene.worldBounds, pointer: pointerInput.pointer.value };
  app.ticker.add((ticker) => {
    const dtSeconds = ticker.deltaMS / 1000;
    ctx.world = scene.worldBounds;
    ctx.pointer = pointerInput.pointer.value;
    critter.update(dtSeconds, ctx);

    // 速度(尻尾 intensity と同じ参照)で走行音 gain を更新し、チューチューを断続発火。
    const speed = Math.hypot(critter.state.velocity.x, critter.state.velocity.y);
    mouseAudio.update(speed, dtSeconds);
  });
}

bootstrap().catch((error: unknown) => {
  console.error("catdancer の起動に失敗しました:", error);
});
