import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { PointerInput } from "../../src/app/PointerInput";
import type { Scene } from "../../src/app/Scene";
import type { AudioSink } from "../../src/audio/AudioManager";
import { MOUSE_SQUEAK_ID } from "../../src/audio/sounds";
import type { LoopVoice } from "../../src/audio/synth";
import { createWorldBounds, type Viewport } from "../../src/core/worldBounds";
import type { CritterType } from "../../src/critters/CritterType";
import { registerCritterType, unregisterCritterType } from "../../src/critters/registry";
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
  const fired: string[] = [];
  let loopsCreated = 0;
  const sink: AudioSink = {
    playOneShot: (id) => {
      fired.push(id);
    },
    createLoop: (): LoopVoice => {
      loopsCreated++;
      return {
        setLevel: (l) => {
          levels.push(l);
        },
        stop: () => undefined,
      };
    },
  };
  return {
    sink,
    levels,
    fired,
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

function buildController(typeId: string) {
  const sink = makeFakeSink();
  const { pointer, state } = makeFakePointer();
  const controller = new FollowManualController({
    typeId,
    bodyTexture: Texture.EMPTY,
    tailTexture: Texture.EMPTY,
    audio: sink.sink,
    pointer,
    scene: makeFakeScene(),
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
    controller.onPointerDown(10, 20);
    expect(sink.fired).toEqual([MOUSE_SQUEAK_ID]);
    controller.stop();
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
