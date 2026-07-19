import { Texture } from "pixi.js";
import { afterEach, describe, expect, it } from "vitest";
import type { Scene } from "../../src/app/Scene";
import type { AudioSink } from "../../src/audio/AudioManager";
import type { LoopVoice } from "../../src/audio/synth";
import { createWorldBounds, type Viewport } from "../../src/core/worldBounds";
import { clearCritterTypes, registerCritterType } from "../../src/critters/registry";
import { insectType } from "../../src/critters/types/insect";
import { InsectManualController } from "../../src/modes/manual/InsectManualController";

/**
 * [UR4-3] InsectManualController の効果音（羽音）オン/オフ（ライブ closure gate）。
 *
 * 虫は voice/捕獲 one-shot 経路が無く SE はループ（羽音 buzz）1 本のみ。isSoundEnabled closure が false を
 * 返す間は、虫が飛んでいても present=false 相当で羽音レベルを 0 に保つ（1 本の gate で虫のSEを完全に止める）。
 * closure をライブに読むため respawn せず値の変化が次フレームへ即反映される。present=false→setLevel(0) は
 * CritterAudioController の既存不変を利用し、ここでは gate の合成（count>0 && isSoundEnabled）に集中する。
 *
 * InsectManualController は spawnCritter 経由で PixiJS Container/Sprite を作るが WebGL 非依存で node でも
 * 構築できる（Texture.EMPTY）。Scene は本コントローラが使う最小面（worldBounds/add/despawn）だけの fake。
 */

/** setLevel を記録する fake sink（走行/羽音ループの gain を観測する）。 */
function makeFakeSink() {
  const levels: number[] = [];
  const fired: string[] = [];
  const sink: AudioSink = {
    playOneShot: (id) => {
      fired.push(id);
    },
    createLoop: (): LoopVoice => ({
      setLevel: (l) => {
        levels.push(l);
      },
      setPan: () => undefined,
      stop: () => undefined,
    }),
  };
  return { sink, levels, fired };
}

const VIEWPORT: Viewport = { width: 1000, height: 800 };

/** InsectManualController が触る最小面だけを持つ fake Scene（実 WorldBounds を載せる）。 */
function makeFakeScene(): Scene {
  return {
    worldBounds: createWorldBounds(VIEWPORT, 200),
    add: () => undefined,
    despawn: () => undefined,
  } as unknown as Scene;
}

function buildController(isSoundEnabled?: () => boolean) {
  const sink = makeFakeSink();
  const controller = new InsectManualController({
    bodyTexture: Texture.EMPTY,
    audio: sink.sink,
    scene: makeFakeScene(),
    // 決定的乱数（spawn 計画を安定させる）。
    rng: () => 0.5,
    isSoundEnabled,
  });
  return { controller, sink };
}

describe("InsectManualController の効果音オン/オフ (UR4-3)", () => {
  afterEach(() => {
    clearCritterTypes();
  });

  it("SEオンだと虫が飛んでいる間は羽音(buzz ループ)が駆動される（level>0）", () => {
    registerCritterType(insectType);
    const { controller, sink } = buildController(() => true);
    controller.start(); // 初期フィードバックの虫を 1 体 spawn。
    for (let i = 0; i < 10; i++) {
      controller.update(1 / 60);
    }
    // 虫が居て飛んでいる＋SEオン → present=true で羽音レベルが 0 超になる。
    expect(sink.levels.some((l) => l > 0)).toBe(true);
    controller.stop();
  });

  it("SEオフだと虫が飛んでいても羽音を無音化（setLevel(0) のまま）", () => {
    registerCritterType(insectType);
    const { controller, sink } = buildController(() => false);
    controller.start();
    for (let i = 0; i < 10; i++) {
      controller.update(1 / 60);
    }
    // SEオフ → present=false 経路で level は常に 0（羽音が鳴らない）。
    expect(sink.levels.every((l) => l === 0)).toBe(true);
    controller.stop();
  });

  it("isSoundEnabled は live-apply（オフ→オンで羽音駆動が respawn なしで復帰）", () => {
    registerCritterType(insectType);
    let enabled = false;
    const { controller, sink } = buildController(() => enabled);
    controller.start();
    for (let i = 0; i < 10; i++) {
      controller.update(1 / 60);
    }
    expect(sink.levels.every((l) => l === 0)).toBe(true);

    // ライブにオン → 次フレームから present=true で羽音が復帰する（respawn 不要）。
    enabled = true;
    sink.levels.length = 0;
    for (let i = 0; i < 10; i++) {
      controller.update(1 / 60);
    }
    expect(sink.levels.some((l) => l > 0)).toBe(true);
    controller.stop();
  });

  it("isSoundEnabled 未指定は常に有効（従来挙動＝後方互換）", () => {
    registerCritterType(insectType);
    const { controller, sink } = buildController();
    controller.start();
    for (let i = 0; i < 10; i++) {
      controller.update(1 / 60);
    }
    expect(sink.levels.some((l) => l > 0)).toBe(true);
    controller.stop();
  });
});
