import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { PointerInput } from "../../src/app/PointerInput";
import type { Scene } from "../../src/app/Scene";
import type { AudioSink } from "../../src/audio/AudioManager";
import { MOUSE_SQUEAK_ID } from "../../src/audio/sounds";
import type { LoopVoice } from "../../src/audio/synth";
import { createWorldBounds, type Viewport } from "../../src/core/worldBounds";
import type { CritterType } from "../../src/critters/CritterType";
import {
  hasCritterType,
  registerCritterType,
  unregisterCritterType,
} from "../../src/critters/registry";
import { createImageCritterType } from "../../src/critters/types/imageCritter";
import { insectType } from "../../src/critters/types/insect";
import { mouseType, registerMouseType } from "../../src/critters/types/mouse";
import { toysType } from "../../src/critters/types/toys";
import { FollowManualController } from "../../src/modes/manual/FollowManualController";
import { MouseFollowMovement } from "../../src/movement/MouseFollowMovement";

/**
 * [UR4-5] マウス操作モードのネズミを「自動で鳴かず、クリックでのみ鳴く」にした不変条件テスト。
 *
 * データ面: `manualFollowMuteAutoSound` が mouse だけ true で、他の追従対象種別は falsy であること。
 * 挙動面: FollowManualController が本フラグ真の種別では追従中に自動SE(走行音 move ループ＋自動チュー
 * voice スケジューラ)を一切駆動せず（fake AudioSink の走行音レベルが常に 0・自動 voice 非発火）、
 * onPointerDown のクリック鳴きだけは維持されること。フラグ無し種別は従来どおり追従速度で走行音を鳴らす。
 *
 * FollowManualController は spawnCritter 経由で PixiJS の Container/Sprite を作るが、これは WebGL 非依存で
 * node(Vitest) でも構築できる（Texture.EMPTY を渡す）。Scene/PointerInput は本コントローラが使う最小面
 * （worldBounds / add / despawn / pointer.value / attach 系）だけを持つ軽量 fake で差し替える。
 */

/** SE 呼び出しを記録する fake sink（Web Audio 非依存でグルーを検証する。critterAudioController.test と同形）。 */
function makeFakeSink() {
  const levels: number[] = [];
  const pans: number[] = [];
  const fired: string[] = [];
  // [UR4-4] クリック鳴きに渡った pan の記録（発火位置の左右定位検証）。
  const firedPans: number[] = [];
  let loopsCreated = 0;
  const sink: AudioSink = {
    playOneShot: (id, pan) => {
      fired.push(id);
      firedPans.push(pan ?? 0);
    },
    createLoop: (): LoopVoice => {
      loopsCreated++;
      return {
        setLevel: (l) => {
          levels.push(l);
        },
        setPan: (p) => {
          pans.push(p);
        },
        stop: () => undefined,
      };
    },
  };
  return {
    sink,
    levels,
    pans,
    fired,
    firedPans,
    get loopsCreated() {
      return loopsCreated;
    },
  };
}

const VIEWPORT: Viewport = { width: 1000, height: 800 };

/** FollowManualController が触る最小面だけを持つ fake Scene（実 WorldBounds を載せる）。 */
function makeFakeScene(): Scene {
  return {
    worldBounds: createWorldBounds(VIEWPORT, 200),
    add: () => undefined,
    despawn: () => undefined,
  } as unknown as Scene;
}

/** ポインタ位置を外部から差し替えられる fake PointerInput（attach 系は no-op）。 */
function makeFakePointer() {
  const state: { value: { x: number; y: number } | null } = {
    value: { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 },
  };
  const pointer = {
    pointer: state,
    attach: () => undefined,
    detach: () => undefined,
    centerToViewport: () => {
      state.value = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    },
  } as unknown as PointerInput;
  return { pointer, state };
}

function buildController(typeId: string, isSoundEnabled?: () => boolean) {
  const sink = makeFakeSink();
  const { pointer, state } = makeFakePointer();
  const controller = new FollowManualController({
    typeId,
    bodyTexture: Texture.EMPTY,
    tailTexture: Texture.EMPTY,
    audio: sink.sink,
    pointer,
    scene: makeFakeScene(),
    isSoundEnabled,
  });
  return { controller, sink, pointerState: state };
}

describe("manualFollowMuteAutoSound フラグ（データ不変条件）", () => {
  it("mouse 種別だけ true（他の追従対象種別は未設定＝falsy）", () => {
    expect(mouseType.manualFollowMuteAutoSound).toBe(true);
    // FollowManualController が担う他種別（虫follow/おもちゃ/任意画像）は自動音を維持する。
    expect(insectType.manualFollowMuteAutoSound ?? false).toBe(false);
    expect(toysType.manualFollowMuteAutoSound ?? false).toBe(false);
    expect(createImageCritterType("ur45-custom").manualFollowMuteAutoSound ?? false).toBe(false);
  });
});

describe("FollowManualController の自動SE抑制（UR4-5）", () => {
  it("mouse: 追従中は自動SE(走行音/自動チュー)を駆動せず、クリック時のみ鳴き声が鳴る", () => {
    registerMouseType();
    const { controller, sink, pointerState } = buildController("mouse");
    controller.start();
    // ポインタを画面外遠方へ置いて高速追従させる（速度は minSpeed を大きく超える）。
    pointerState.value = { x: VIEWPORT.width * 8, y: VIEWPORT.height * 8 };
    for (let i = 0; i < 120; i++) {
      controller.update(1 / 60);
    }
    // 走行音ループ自体は生成されるが、gain は start の 0 から一度も上がらない（＝自動走行音は無音）。
    expect(sink.loopsCreated).toBe(1);
    expect(sink.levels.length).toBeGreaterThan(0);
    expect(sink.levels.every((l) => l === 0)).toBe(true);
    // 自動チュー(voice スケジューラ)も発火しない（present=false で scheduler を進めないため）。
    expect(sink.fired).toHaveLength(0);
    // クリックで鳴き声(squeak)が 1 発鳴る（onPointerDown→playOneShot(voice) は維持）。
    // [UR4-4] このとき pan は現在の critter の x 由来。右へ追従してきたので x>中央 → pan>0（右定位）。
    controller.onPointerDown(10, 20);
    expect(sink.fired).toEqual([MOUSE_SQUEAK_ID]);
    expect(sink.firedPans).toHaveLength(1);
    expect(sink.firedPans[0]).toBeGreaterThan(0);
    controller.stop();
  });

  it("[UR4-4] クリック鳴きの pan は追従位置で反転する（左追従→負 / 右追従→正）", () => {
    // mouse は先行テストで登録済みのことがある（このファイルは unregister しない）。二重登録を避ける。
    if (!hasCritterType("mouse")) {
      registerMouseType();
    }
    // 左追従: ポインタ左外 → critter が左へ → クリック鳴きの pan が負。
    const left = buildController("mouse");
    left.controller.start();
    left.pointerState.value = { x: -VIEWPORT.width * 8, y: VIEWPORT.height / 2 };
    for (let i = 0; i < 60; i++) {
      left.controller.update(1 / 60);
    }
    left.controller.onPointerDown(0, 0);
    expect(left.sink.firedPans.at(-1)).toBeLessThan(0);
    left.controller.stop();

    // 右追従: ポインタ右外 → critter が右へ → クリック鳴きの pan が正。
    const right = buildController("mouse");
    right.controller.start();
    right.pointerState.value = { x: VIEWPORT.width * 8, y: VIEWPORT.height / 2 };
    for (let i = 0; i < 60; i++) {
      right.controller.update(1 / 60);
    }
    right.controller.onPointerDown(0, 0);
    expect(right.sink.firedPans.at(-1)).toBeGreaterThan(0);
    right.controller.stop();
  });

  it("フラグ無し種別: 追従速度に連動して走行音(move ループSE)を駆動する（抑制は mouse 限定）", () => {
    const CONTROL_ID = "ur45-control-runner";
    const controlType: CritterType = {
      id: CONTROL_ID,
      displayName: "テスト走者",
      textureUrl: "",
      baseSize: 100,
      defaultFacing: 1,
      faceMode: "flip",
      // start() で MouseFollowMovement へ override されるが型上必須。
      createMovement: () => new MouseFollowMovement(),
      sounds: { move: "ur45-control-move" },
      hasTail: false,
    };
    registerCritterType(controlType);
    try {
      const { controller, sink, pointerState } = buildController(CONTROL_ID);
      controller.start();
      pointerState.value = { x: VIEWPORT.width * 8, y: VIEWPORT.height * 8 };
      for (let i = 0; i < 20; i++) {
        controller.update(1 / 60);
      }
      // フラグ無しは present=true で駆動され、追従速度に応じて走行音レベルが 0 超になる。
      expect(sink.loopsCreated).toBe(1);
      expect(sink.levels.some((l) => l > 0)).toBe(true);
      controller.stop();
    } finally {
      unregisterCritterType(CONTROL_ID);
    }
  });
});

describe("FollowManualController の走行音 左右定位（UR4-4）", () => {
  const RUNNER_ID = "ur44-runner";
  const runnerType: CritterType = {
    id: RUNNER_ID,
    displayName: "定位テスト走者",
    textureUrl: "",
    baseSize: 100,
    defaultFacing: 1,
    faceMode: "flip",
    createMovement: () => new MouseFollowMovement(),
    // move ループSE を持ち、自動音抑制フラグ無し＝present=true で駆動され pan が伝わる。
    sounds: { move: "ur44-runner-move" },
    hasTail: false,
  };

  it("ポインタを右へ置くと critter の x が増え pan が右(>0)へ、左へ置くと左(<0)へ寄る（反転）", () => {
    registerCritterType(runnerType);
    try {
      // 右追従: ポインタを画面右外へ → critter が右へ動き、走行音 pan が正になる。
      const right = buildController(RUNNER_ID);
      right.controller.start();
      right.pointerState.value = { x: VIEWPORT.width * 8, y: VIEWPORT.height / 2 };
      for (let i = 0; i < 40; i++) {
        right.controller.update(1 / 60);
      }
      expect(right.sink.pans.some((p) => p > 0)).toBe(true);
      // 右追従の間、pan が負（左）になることはない（＝右で確かに右定位）。
      expect(right.sink.pans.some((p) => p < 0)).toBe(false);
      right.controller.stop();

      // 左追従: ポインタを画面左外へ → critter が左へ動き、走行音 pan が負になる（定位が反転する）。
      const left = buildController(RUNNER_ID);
      left.controller.start();
      left.pointerState.value = { x: -VIEWPORT.width * 8, y: VIEWPORT.height / 2 };
      for (let i = 0; i < 40; i++) {
        left.controller.update(1 / 60);
      }
      expect(left.sink.pans.some((p) => p < 0)).toBe(true);
      expect(left.sink.pans.some((p) => p > 0)).toBe(false);
      left.controller.stop();
    } finally {
      unregisterCritterType(RUNNER_ID);
    }
  });
});

/**
 * [UR4-3] FollowManualController の効果音オン/オフ（ライブ closure gate）。
 *
 * isSoundEnabled closure が false を返す間は、追従中の自動SE（走行音 move ループ）も onPointerDown の
 * クリック鳴き（voice one-shot）も駆動しない（ループ＋one-shot 両 gate）。closure をライブに読むため、
 * respawn せず値の変化が次フレームの update / 次のクリックへ即反映される。mouse は UR4-5 で元々自動音を
 * 抑制するが、SEオフにすると **クリック鳴き squeak も止まる**（UR4-5 と整合＝mouse ミュートで完全無音）。
 */
describe("FollowManualController の効果音オン/オフ (UR4-3)", () => {
  it("mouse: SEオフだとクリック鳴き(squeak)も鳴らない（UR4-5 と整合＝mouse ミュートで完全無音）", () => {
    if (!hasCritterType("mouse")) {
      registerMouseType();
    }
    let enabled = true;
    const { controller, sink, pointerState } = buildController("mouse", () => enabled);
    controller.start();
    pointerState.value = { x: VIEWPORT.width * 8, y: VIEWPORT.height / 2 };
    for (let i = 0; i < 30; i++) {
      controller.update(1 / 60);
    }
    // SEオンの間はクリックで squeak が鳴る（UR4-5 でも onPointerDown のクリック鳴きは維持）。
    controller.onPointerDown(10, 20);
    expect(sink.fired).toEqual([MOUSE_SQUEAK_ID]);

    // ライブにSEオフ → クリックしても鳴らない（respawn 不要で即反映）。走行音ループも 0 のまま。
    enabled = false;
    sink.fired.length = 0;
    for (let i = 0; i < 5; i++) {
      controller.update(1 / 60);
    }
    controller.onPointerDown(10, 20);
    expect(sink.fired).toHaveLength(0);
    expect(sink.levels.every((l) => l === 0)).toBe(true);

    // 再びオンでクリック鳴きが復帰する。
    enabled = true;
    controller.onPointerDown(10, 20);
    expect(sink.fired).toEqual([MOUSE_SQUEAK_ID]);
    controller.stop();
  });

  it("フラグ無し種別: SEオフだと追従中の走行音(move ループ)も駆動しない（ライブに復帰）", () => {
    const RUNNER_ID = "ur43-follow-runner";
    const runnerType: CritterType = {
      id: RUNNER_ID,
      displayName: "SEトグルテスト走者",
      textureUrl: "",
      baseSize: 100,
      defaultFacing: 1,
      faceMode: "flip",
      createMovement: () => new MouseFollowMovement(),
      sounds: { move: "ur43-follow-move" },
      hasTail: false,
    };
    registerCritterType(runnerType);
    try {
      let enabled = false;
      const { controller, sink, pointerState } = buildController(RUNNER_ID, () => enabled);
      controller.start();
      // SEオフの間は、追従で動いていても走行音レベルが 0 のまま（present=false 相当）。
      pointerState.value = { x: VIEWPORT.width * 8, y: VIEWPORT.height / 2 };
      for (let i = 0; i < 10; i++) {
        controller.update(1 / 60);
      }
      expect(sink.levels.every((l) => l === 0)).toBe(true);

      // ライブにオン → 反対側の遠方へポインタを移して再加速させ、走行音レベルが 0 超になる（respawn 不要）。
      enabled = true;
      pointerState.value = { x: -VIEWPORT.width * 8, y: VIEWPORT.height / 2 };
      for (let i = 0; i < 10; i++) {
        controller.update(1 / 60);
      }
      expect(sink.levels.some((l) => l > 0)).toBe(true);
      controller.stop();
    } finally {
      unregisterCritterType(RUNNER_ID);
    }
  });

  it("isSoundEnabled 未指定は常に有効（従来挙動＝後方互換）", () => {
    const RUNNER_ID = "ur43-default-runner";
    const runnerType: CritterType = {
      id: RUNNER_ID,
      displayName: "既定走者",
      textureUrl: "",
      baseSize: 100,
      defaultFacing: 1,
      faceMode: "flip",
      createMovement: () => new MouseFollowMovement(),
      sounds: { move: "ur43-default-move" },
      hasTail: false,
    };
    registerCritterType(runnerType);
    try {
      // isSoundEnabled を渡さない → 常に有効。
      const { controller, sink, pointerState } = buildController(RUNNER_ID);
      controller.start();
      pointerState.value = { x: VIEWPORT.width * 8, y: VIEWPORT.height * 8 };
      for (let i = 0; i < 20; i++) {
        controller.update(1 / 60);
      }
      expect(sink.levels.some((l) => l > 0)).toBe(true);
      controller.stop();
    } finally {
      unregisterCritterType(RUNNER_ID);
    }
  });
});
