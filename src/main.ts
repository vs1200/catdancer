import { Assets, type Texture } from "pixi.js";
import { BackgroundController } from "./app/BackgroundController";
import { CaptureEffects } from "./app/CaptureEffects";
import { CatDancerApp } from "./app/CatDancerApp";
import { textureFromImageWithin } from "./app/imageTexture";
import { clientToWorld, PointerInput } from "./app/PointerInput";
import { DEFAULT_WORLD_MARGIN, Scene } from "./app/Scene";
import { AudioManager } from "./audio/AudioManager";
import {
  loadCritterSamples,
  MOUSE_SCURRY_ID,
  MOUSE_SQUEAK_ID,
  registerCritterSounds,
} from "./audio/sounds";
import {
  getCritterType,
  hasCritterType,
  listCritterTypes,
  registerCritterType,
  unregisterCritterType,
} from "./critters/registry";
import {
  FOXTAIL_HAND_TEXTURE_URL,
  FOXTAIL_TYPE_ID,
  registerFoxtailType,
} from "./critters/types/foxtail";
import { createImageCritterType } from "./critters/types/imageCritter";
import { INSECT_TYPE_ID, registerInsectType } from "./critters/types/insect";
import { MOUSE_TAIL_TEXTURE_URL, MOUSE_TYPE_ID, registerMouseType } from "./critters/types/mouse";
import { registerToysType, TOYS_TYPE_ID } from "./critters/types/toys";
import { computeWorldMargin } from "./critters/worldMargin";
import { AutoMode } from "./modes/AutoMode";
import { ManualMode } from "./modes/ManualMode";
import type { Mode } from "./modes/Mode";
import { FollowManualController } from "./modes/manual/FollowManualController";
import { FoxtailManualController } from "./modes/manual/FoxtailManualController";
import { InsectManualController } from "./modes/manual/InsectManualController";
import type { ManualControllerFactory } from "./modes/manual/ManualController";
import { PlayLimitTimer } from "./modes/PlayLimitTimer";
import { getCritterImage } from "./settings/imageStore";
import { DEFAULT_MANUAL_TYPE_ID } from "./settings/manualTargets";
import { SettingsStore } from "./settings/SettingsStore";
import type { AppMode } from "./settings/settingsData";
import { showBootstrapFailure } from "./ui/BootstrapFallback";
import { toggleAppFullscreen } from "./ui/fullscreen";
import { isEditableEventTarget, keyToShortcutAction } from "./ui/keyboardShortcuts";
import { OptionsButton } from "./ui/OptionsButton";
import { OptionsPanel } from "./ui/OptionsPanel";
import { PlayLimitOverlay } from "./ui/PlayLimitOverlay";

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
  const audio = new AudioManager({
    masterVolume: settings.settings.masterVolume,
    muted: settings.settings.muted,
  });
  registerCritterSounds(audio);
  audio.attachAutoResume(window);
  // [UR-3] ネズミの走行音/鳴き声をユーザー提供の実録サンプルへ差し替える（合成→サンプル）。
  // m2: ここでは fetch+decode(~281KB×6) を await せず開始だけして、直後の texture ロード(Promise.all)と
  // 重ねる（初回描画レイテンシ短縮）。走行ループ(createLoop)を張る switchTo の直前で await samplesReady して、
  // 「サンプル登録が createLoop より前に完了する」不変条件は維持する（最初からサンプル版で鳴る）。
  // 内部で例外を握りつぶす設計なので、ロード失敗でも起動失敗フォールバックには波及せず合成SEが残る。
  const samplesReady = loadCritterSamples(audio);

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

  // 捕獲成功の視覚演出（バースト）。scene.effects（critter より前面）へ短命リングを出す。
  // 捕獲SE と対になる視覚フィードバックで、狩りの報酬感を高める。
  const captureEffects = new CaptureEffects(scene.effects);

  // 共有テクスチャ: 各種別の本体と尻尾（mouse-tail.webp=本物）を 1 度だけロードする。
  // 全 critter で共有するため、AutoMode の多数 spawn でもテクスチャは増えない
  // （despawn 時は Sprite/MeshRope の geometry のみ破棄し、共有テクスチャは保持＝リークしない）。
  const mouseType = getCritterType(MOUSE_TYPE_ID);
  const foxtailType = getCritterType(FOXTAIL_TYPE_ID);
  const toysType = getCritterType(TOYS_TYPE_ID);
  const insectType = getCritterType(INSECT_TYPE_ID);
  // [UR-5b] foxtail-hand.webp は manual foxtail の新挙動専用（auto の foxtail.webp とは別物・共有はしない）。
  const [bodyTexture, foxtailTexture, foxtailHandTexture, toysTexture, insectTexture, tailTexture] =
    await Promise.all([
      Assets.load(mouseType.textureUrl),
      Assets.load(foxtailType.textureUrl),
      Assets.load(FOXTAIL_HAND_TEXTURE_URL),
      Assets.load(toysType.textureUrl),
      Assets.load(insectType.textureUrl),
      Assets.load(MOUSE_TAIL_TEXTURE_URL),
    ]);

  // ポインタ入力（ManualMode が attach/detach を占有管理する）。
  const pointerInput = new PointerInput(app.canvas, () => app.viewport);

  // モード実体。両モードとも同じ Scene / 共有テクスチャ / 種別 / SE を再利用する。
  // [UR-4] 操作対象 typeId → コントローラ factory マップ。UR-4 は全対象を FollowManualController
  // （カーソル追従＝プレースホルダ）へマップする。テクスチャは既ロード済みの共有物を種別ごとに渡す。
  // UR-5（ねこじゃらしのフリック）/ UR-6（虫のクリック出現）は、対応する typeId のエントリを専用
  // コントローラの factory に差し替えれば固有 manual 挙動へ置き換わる（他種別・ManualMode 本体は不変）。
  const makeFollowFactory =
    (typeId: string, body: Texture, tail?: Texture): ManualControllerFactory =>
    () =>
      new FollowManualController({
        typeId,
        bodyTexture: body,
        tailTexture: tail,
        audio,
        pointer: pointerInput,
        scene,
      });
  const manualFactories = new Map<string, ManualControllerFactory>([
    [MOUSE_TYPE_ID, makeFollowFactory(MOUSE_TYPE_ID, bodyTexture, tailTexture)],
    // [UR-5b] 猫じゃらしだけは固有挙動（端から差し込んで穂をふりふり）へ差し替える。
    // 他種別（ネズミ/おもちゃ/虫）は従来どおりカーソル追従(FollowManualController)のまま。
    [
      FOXTAIL_TYPE_ID,
      () =>
        new FoxtailManualController({
          handTexture: foxtailHandTexture,
          pointer: pointerInput,
          scene,
        }),
    ],
    [TOYS_TYPE_ID, makeFollowFactory(TOYS_TYPE_ID, toysTexture)],
    // [UR-6] 虫だけは固有挙動（クリックした位置に出現・複数同時・素早いダッシュで動き回り world 外へ退場）
    // へ差し替える。他種別（ネズミ/おもちゃ）は従来どおりカーソル追従(FollowManualController)のまま。
    [
      INSECT_TYPE_ID,
      () =>
        new InsectManualController({
          bodyTexture: insectTexture,
          audio,
          scene,
        }),
    ],
  ]);
  const manualMode = new ManualMode({
    factories: manualFactories,
    initialTypeId: settings.settings.manualTypeId,
    fallbackTypeId: DEFAULT_MANUAL_TYPE_ID,
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
  // 動きの速さ倍率を両モードへ初期反映（reload 復元）。既定 1.0 で現状と同一挙動。
  autoMode.setSpeedScale(settings.settings.speedScale);
  manualMode.setSpeedScale(settings.settings.speedScale);

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
  // タブ非表示（背景タブ）を第 2 の一時停止要因として持つ。panelOpen とは独立し、どちらかが真なら
  // 現行モードを一時停止する（合成pause）。背景タブで rAF は止まり描画は自然停止するが、Web Audio の
  // 環境音ループ（走行音/羽音）は鳴り続けてしまうため、hidden 時に明示的に無音化する。
  let tabHidden = false;
  // キーボードショートカット（Space）による一時停止トグルの現在値。合成pause の第 3 要因。
  // panelOpen/tabHidden とは独立で、Space トグル中にパネル開閉やタブ非表示を跨いでも論理和で
  // 自然に維持される（個別 setPaused にしないことで片方の解除時に誤再開しない）。
  let keyPaused = false;
  // マウスカーソル非表示設定の現在値（起動時に settings から復元。subscribe 差分で更新される）。
  let hideCursor = settings.settings.hideCursor;

  /**
   * 現行モードの一時停止を「パネル開(panelOpen)」「タブ非表示(tabHidden)」「キー一時停止(keyPaused)」
   * の論理和で統一する（合成pause）。各要因を個別に setPaused すると、1 つの解除時に他要因を上書き
   * （誤再開）してしまうため、常に全要因の OR を反映する。currentMode 未確定時は no-op。
   */
  const applyPause = (): void => {
    currentMode?.setPaused(panelOpen || tabHidden || keyPaused);
  };

  /**
   * プレイ領域（#app=mount）のマウスカーソル表示を hideCursor 設定とパネル開閉から決める。
   * hideCursor=ON かつ パネル閉のときだけ cursor:none にして、猫が物理カーソル（矢印）を追う
   * 誤作動を防ぐ。パネルを開いている間は常に通常表示（人間が設定を操作できるように）。
   * 歯車ボタンは #app の兄弟要素で自前の cursor:pointer を持つため、この none は波及しない
   * （＝歯車付近は通常表示）。位置取得やイベント配線には触れず、見た目のみ制御する。
   */
  const applyCursorVisibility = (): void => {
    mount.style.cursor = hideCursor && !panelOpen ? "none" : "";
  };

  const modeByName = (name: AppMode): Mode => (name === "auto" ? autoMode : manualMode);

  // --- 遊びすぎ防止タイマー（auto の active 再生時間で自動停止） ---
  // auto かつ非パネル・未停止のフレームだけ tick し、上限到達で auto を止めて（despawn＋無音）
  // 再開オーバーレイを出す。人間が「再開」を押すか、設定で上限を変えると再武装して復帰する。
  const playLimitTimer = new PlayLimitTimer(settings.settings.autoPlayLimitMinutes);
  let autoStoppedByTimer = false;
  const playLimitOverlay = new PlayLimitOverlay({ onResume: () => resumeFromPlayLimit() });
  playLimitOverlay.mount(document.body);

  /** タイマー上限到達での自動停止（despawn＋無音＋オーバーレイ表示）。ticker と DEV forceExpire で共用。 */
  const triggerAutoStop = (): void => {
    autoMode.stop();
    autoStoppedByTimer = true;
    playLimitOverlay.show();
  };

  /** 自動停止を解除して auto を再開する（オーバーレイ hide＋タイマー再武装。停止中のみ有効）。 */
  function resumeFromPlayLimit(): void {
    if (!autoStoppedByTimer) {
      return;
    }
    autoStoppedByTimer = false;
    // 「再開」は明示的な再生意思なので、オーバーレイ表示中に押された Space 一時停止(keyPaused)を
    // クリアしてから再開する。これをしないと直後の applyPause() が keyPaused を pause 要因として
    // 拾い、再開しても即 pause に戻って固まる（keyPaused の視覚表示も無いためデッドロックに見える）。
    keyPaused = false;
    playLimitOverlay.hide();
    playLimitTimer.reset();
    // 停止フラグは auto 専用（switchTo が離脱時に必ず解除する）。不変条件が将来崩れても
    // manual 中に autoMode を start して両モードの critter が混在する事故を防ぐため、
    // 解除は常に行いつつ、実際の再開は現行が auto の時だけにする（防御的ガード）。
    if (currentModeName === "auto") {
      autoMode.start();
      // パネル開/タブ非表示の一時停止を引き継ぐ（合成pause）。ここでは currentMode は autoMode。
      applyPause();
    }
  }

  /** 現行モードを止め、指定モードへ切り替える（前モードの critter を後始末してから開始）。 */
  const switchTo = (name: AppMode): void => {
    currentMode?.stop();
    currentModeName = name;
    // モード切替はタイマーも仕切り直す（auto へ入り直したら遊びすぎ防止も最初から）。
    autoStoppedByTimer = false;
    playLimitOverlay.hide();
    playLimitTimer.reset();
    currentMode = modeByName(name);
    currentMode.start();
    // 切替後もパネル開閉/タブ非表示を引き継ぐ（合成pause: どちらかが真なら新モードも一時停止）。
    applyPause();
  };

  // canvas のタップ/クリックのプレイ操作。パネル開/自動停止中は無視（オーバーレイ/backdrop が受ける）。
  // - manual: [UR-4] クリック(タップ)を現行操作対象コントローラへ委譲する（world 座標を渡す）。
  //   種別に voice(鳴き声)SEがあれば鳴る（[UR-3] mouse→squeak をコントローラ内へ移設）。voice を持たない
  //   種別は無音。pointerdown は信頼済みユーザージェスチャなので AudioContext の resume 契機にもなる。
  //   world 座標は UR-6 の虫クリック出現の受け皿。
  // - auto: 当たった動くオブジェクトを素早く逃がし（画面外へ→despawn）反応SEを鳴らす。空きスペースは無反応。
  app.canvas.addEventListener("pointerdown", (event) => {
    if (panelOpen || autoStoppedByTimer || keyPaused) {
      return;
    }
    if (currentModeName === "manual") {
      const world = clientToWorld(app.canvas, app.viewport, event.clientX, event.clientY);
      manualMode.onPointerDown(world.x, world.y);
      return;
    }
    const p = clientToWorld(app.canvas, app.viewport, event.clientX, event.clientY);
    // ヒット時のみ捕獲演出を出す（handleTap が true）。空きスペースのタップ（false）では出さない。
    if (autoMode.handleTap(p.x, p.y)) {
      captureEffects.burst(p.x, p.y);
    }
  });

  // 設定変更の反映（音量/背景 + モード/出現間隔 + カスタム画像クリッター）。前回値と比較して差分だけ反映する。
  let prevMode = settings.settings.mode;
  let prevManualTypeId = settings.settings.manualTypeId;
  let prevInterval = settings.settings.autoSpawnIntervalMs;
  let prevPlayLimit = settings.settings.autoPlayLimitMinutes;
  let prevCustomCritterId = settings.settings.customCritterImageId;
  let prevMuted = settings.settings.muted;
  let prevHideCursor = settings.settings.hideCursor;
  let prevSpeedScale = settings.settings.speedScale;
  // 無効化種別リストは配列なので join したキーで差分判定する（volume ドラッグ等の頻繁通知で無駄に再構築しない）。
  let prevAutoDisabledKey = settings.settings.autoDisabledTypes.join("\u0000");
  // 背景も他フィールドと同型の差分ガードで反映する。無条件 apply だと画像背景時に音量/出現間隔スライダの
  // 連続通知（ドラッグ中の40ms間隔）ごとに IndexedDB 取得＋再デコード＋GPU テクスチャ差し替えが走るため、
  // type/color/imageId のいずれかが変わった時だけ apply する（起動時の初期描画は bootstrap の初回 apply が担う）。
  let prevBgType = settings.settings.background.type;
  let prevBgColor = settings.settings.background.color;
  let prevBgImageId = settings.settings.background.imageId;
  settings.subscribe((next) => {
    audio.setMasterVolume(next.masterVolume);
    if (next.muted !== prevMuted) {
      prevMuted = next.muted;
      audio.setMuted(next.muted);
    }
    if (next.hideCursor !== prevHideCursor) {
      prevHideCursor = next.hideCursor;
      hideCursor = next.hideCursor;
      // パネル開閉状態は applyCursorVisibility 内で加味する（パネル開なら常に通常表示）。
      applyCursorVisibility();
    }
    const bg = next.background;
    if (bg.type !== prevBgType || bg.color !== prevBgColor || bg.imageId !== prevBgImageId) {
      prevBgType = bg.type;
      prevBgColor = bg.color;
      prevBgImageId = bg.imageId;
      void backgroundController.apply(next);
    }
    if (next.autoSpawnIntervalMs !== prevInterval) {
      prevInterval = next.autoSpawnIntervalMs;
      autoMode.setInterval(next.autoSpawnIntervalMs);
    }
    if (next.autoPlayLimitMinutes !== prevPlayLimit) {
      prevPlayLimit = next.autoPlayLimitMinutes;
      // 上限変更で再武装（elapsed/発火状態リセット）。停止中に変更されたら解除して auto を再開する
      // （設定変更で停止状態のまま固まらない）。
      playLimitTimer.setLimitMinutes(next.autoPlayLimitMinutes);
      if (autoStoppedByTimer) {
        resumeFromPlayLimit();
      }
    }
    const nextAutoDisabledKey = next.autoDisabledTypes.join("\u0000");
    if (nextAutoDisabledKey !== prevAutoDisabledKey) {
      prevAutoDisabledKey = nextAutoDisabledKey;
      autoMode.setDisabledTypes(next.autoDisabledTypes);
    }
    if (next.speedScale !== prevSpeedScale) {
      prevSpeedScale = next.speedScale;
      // 両モードへ即反映（現行がどちらでも保持され、モード切替後も持続する）。
      autoMode.setSpeedScale(next.speedScale);
      manualMode.setSpeedScale(next.speedScale);
    }
    if (next.mode !== prevMode) {
      prevMode = next.mode;
      switchTo(next.mode);
    }
    if (next.manualTypeId !== prevManualTypeId) {
      prevManualTypeId = next.manualTypeId;
      // [UR-4] 操作対象の切替を manual モードへ即反映（実行中なら旧 critter/pointer/audio を破棄→
      // 新種別で再構築）。現行が auto でも保持され、manual へ戻った時に反映される。
      manualMode.setManualType(next.manualTypeId);
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
  // ミュート状態も明示反映（options 経由で初期化済みでも冪等）。映像のみモードの reload 復元。
  audio.setMuted(settings.settings.muted);
  // マウスカーソル非表示設定の起動時復元（既定 false＝通常表示。ON なら #app 上で cursor:none）。
  applyCursorVisibility();
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
    // panelOpen 更新後に合成pause を反映（タブ非表示中ならパネルを閉じても一時停止のまま）。
    applyPause();
    // パネル表示中はカーソルを通常表示に戻し、閉じたら hideCursor 設定に従って再び隠す。
    applyCursorVisibility();
  });
  optionsPanel.mount(document.body);
  optionsButton.mount(document.body);

  // 復元した mode でモードを開始する。
  // m2: サンプルロード(loadCritterSamples)を texture ロードと重ねて開始していたので、走行ループ(createLoop)を
  // 張る直前でここで await する。これで「サンプル登録が createLoop より前に完了する」不変条件を満たしつつ、
  // 初回描画は samplesReady を待たずに進める（texture ロードと並行）。
  await samplesReady;
  switchTo(settings.settings.mode);

  // タブ非表示（背景タブ）で現行モードを一時停止し、環境音ループの背景再生（無駄鳴り）を止める。
  // hidden→visible で合成pause を更新（パネルが開いている限りは復帰しない）。ハンドラは安定参照にして
  // 将来の破棄フロー（removeEventListener）に備える。現状 bootstrap に破棄フローは無く、他リスナ同様 add のみ。
  const onVisibilityChange = (): void => {
    tabHidden = document.hidden;
    applyPause();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  // デスクトップ向けキーボードショートカット（global keydown を 1 つだけ張る）。
  // Space=一時停止トグル / f=全画面トグル / m=モード切替。無効化ガード（修飾キー付き・IME 変換中・
  // パネル開・入力欄フォーカス）は keyToShortcutAction が集約する。成立時のみ preventDefault して
  // Space の既定スクロール等を止め、非成立キーは何も奪わない。既存 Esc（OptionsPanel のパネル閉）や
  // AudioManager の resume 契機（keydown 購読）とは干渉しない（stopPropagation しない・Esc は写像外）。
  // ハンドラは安定参照にして将来の破棄フロー（removeEventListener）に備える。現状 bootstrap に破棄
  // フローは無く、他リスナ同様 add のみ。
  const onShortcutKeyDown = (event: KeyboardEvent): void => {
    const action = keyToShortcutAction(event.key, {
      hasModifier: event.ctrlKey || event.metaKey || event.altKey,
      isComposing: event.isComposing,
      panelOpen,
      editableTarget: isEditableEventTarget(event.target),
    });
    if (!action) {
      return;
    }
    event.preventDefault();
    switch (action) {
      case "toggle-pause":
        // 合成pause の第 3 要因をトグルして反映（panelOpen/tabHidden との論理和は applyPause が維持）。
        keyPaused = !keyPaused;
        applyPause();
        break;
      case "toggle-fullscreen":
        void toggleAppFullscreen();
        break;
      case "toggle-mode":
        // 現在と逆モードへ。settings.setMode 経由にして永続化し、購読(next.mode!==prevMode→switchTo)で
        // 実切替、設定パネルのモード select も syncMode で追従させる（クリック切替と同じ挙動＝表示ズレ/
        // reload 戻りを防ぐ）。
        settings.setMode(currentModeName === "auto" ? "manual" : "auto");
        break;
    }
  };
  document.addEventListener("keydown", onShortcutKeyDown);

  // 開発時のみ: critter 数/モード等を観測する DEV フックを露出する（本番ビルドでは tree-shake）。
  if (import.meta.env.DEV) {
    (window as unknown as { __catScene?: unknown }).__catScene = {
      critterCount: () => scene.critterCount,
      // 進行中の捕獲演出数（リーク検証: 捕獲後しばらくして 0 に戻ることを観測する）。
      effectsCount: () => captureEffects.activeCount,
      mode: () => currentModeName,
      // 現在の動きの速さ倍率（速度スケール検証の観測補助）。
      speedScale: () => settings.settings.speedScale,
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
      // [UR-4] 現在の manual 操作対象 typeId（種別切替の検証補助）。
      manualType: () => manualMode.currentType,
      // マウス追従の客観計測用: 操作対象の位置/速度・ポインタ(=追従目標)・距離を返す。
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
          // [UR-5b] 猫じゃらし固有（他種別では undefined）。distanceToPointer=バネラグ（ふりふり量）、
          // retract=しまう係数、base=飛び出し端の可変検証、headRender=しまう時に画面外へ抜けたか。
          retract: snap.retract,
          base: snap.base,
          headRender: snap.headRender,
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
      // 遊びすぎ防止タイマーの観測/検証補助。
      playLimit: {
        // 自動停止中か。
        stopped: () => autoStoppedByTimer,
        // 残り時間(ms)。無効(OFF)時は Infinity。
        remainingMs: () => playLimitTimer.remainingMs,
        // 再開（オーバーレイの「再開」相当）。
        resume: () => resumeFromPlayLimit(),
        // 検証補助: 今すぐ上限到達させて自動停止まで通す（要: auto モード＋上限設定済み・非パネル）。
        // 実時間を待たずに「停止→オーバーレイ→無音」までを配線ごと確認するための観測用フック。
        forceExpire: (): boolean => {
          if (currentModeName !== "auto" || panelOpen || autoStoppedByTimer) {
            return false;
          }
          if (playLimitTimer.tick(1e9)) {
            triggerAutoStop();
            return true;
          }
          return false;
        },
      },
      // タブ非表示（背景タブ）一時停止の検証補助。実ブラウザで document.hidden を偽装するのは
      // 難しいため、visibilitychange と同じ経路（tabHidden 更新 → applyPause）を叩く観測用フック。
      // 例: __catScene.setTabHidden(true) で無音化 → false で復帰（合成pause のため panelOpen 中は復帰しない）。
      setTabHidden: (v: boolean) => {
        tabHidden = v;
        applyPause();
      },
      // 現在の tabHidden 値（合成pause の観測用）。
      tabHidden: () => tabHidden,
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
      muted: () => audio.muted,
      squeak: () => audio.playOneShot(MOUSE_SQUEAK_ID),
      // [UR-3] サンプル差し替えの客観検証: 登録済みサンプルの id→duration[]（decode 成功と長さの確認）。
      sampleInfo: () => audio.sampleInfo(),
      // [UR-3] 直近に鳴らしたサンプル index（ランダム選択が複数種に散るかの確認: squeak=鳴き声 / scurry=走行）。
      lastSqueakIndex: () => audio.getLastSampleIndex(MOUSE_SQUEAK_ID),
      lastScurryIndex: () => audio.getLastSampleIndex(MOUSE_SCURRY_ID),
    };
  }

  // 毎フレーム現行モードを更新する。
  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000;
    currentMode?.update(dt);
    // 捕獲バースト演出を進める（進行中が無ければ実質 no-op）。終了分は内部で destroy される。
    captureEffects.update(dt);
    // 遊びすぎ防止: auto の active 再生（パネル閉・タブ表示・未停止）フレームだけ積算する。
    // 合成pause（panelOpen || tabHidden）と条件を揃え、一時停止中は加算しない。
    // tick は update の後（このフレームの描画整合を保つ）。上限到達で自動停止＝
    // despawn＋無音にして再開オーバーレイを出す。
    if (
      currentModeName === "auto" &&
      !panelOpen &&
      !tabHidden &&
      !keyPaused &&
      !autoStoppedByTimer &&
      playLimitTimer.tick(dt)
    ) {
      triggerAutoStop();
    }
  });
}

bootstrap().catch((error: unknown) => {
  console.error("catdancer の起動に失敗しました:", error);
  // 画面が真っ白のままにならないよう、穏やかなフォールバックメッセージを表示する。
  // #app が無い（マウント先未検出）ケースは document.body で拾う。フォールバック描画自体が
  // 失敗しても catch ハンドラが再 throw しないよう握りつぶす。
  try {
    const fallbackContainer = document.querySelector<HTMLElement>("#app") ?? document.body;
    showBootstrapFailure(fallbackContainer);
  } catch (fallbackError) {
    console.error("フォールバック表示にも失敗しました:", fallbackError);
  }
});
