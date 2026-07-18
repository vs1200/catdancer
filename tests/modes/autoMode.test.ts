import type { Texture } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "../../src/app/Scene";
import type { AudioSink } from "../../src/audio/AudioManager";
import type { LoopVoice } from "../../src/audio/synth";
import { createWorldBounds } from "../../src/core/worldBounds";
import type { CritterSoundSet, CritterType } from "../../src/critters/CritterType";
import { clearCritterTypes, registerCritterType } from "../../src/critters/registry";
import { AutoMode, type AutoModeEntry } from "../../src/modes/AutoMode";

/**
 * AutoMode の SE コントローラ Map（audioCtrls）ライフサイクル統合テスト（Pixi 非依存）。
 *
 * Pixi 制約の回避:
 * - AutoMode 構築は deps.scene.worldBounds のみ参照するため、最小 fake Scene で足りる。
 * - start() は内部で spawnOne()→spawnEntry() を呼ぶが、テスト種別が createAutoSpawn を
 *   持たないため spawnEntry は `if (!type.createAutoSpawn) return;` で Pixi Sprite 生成前に
 *   early-return する。よって start() を呼んでも node(Vitest) で Sprite を作らず安全に、
 *   controller の生成/開始（createLoop）を fake AudioSink で観測できる。
 * - update() の SE 駆動（present ゲート/速度連動）は純ロジック側（perTypeLevels /
 *   CritterAudioController）で既にテスト済みのため本ファイルでは Map 配線に集中する。
 */

/** setLevel/stop を spy した fake LoopVoice。 */
interface FakeVoice extends LoopVoice {
  setLevel: ReturnType<typeof vi.fn<(level: number) => void>>;
  stop: ReturnType<typeof vi.fn<() => void>>;
}

/** createLoop/playOneShot を spy し、生成した LoopVoice を記録する fake AudioSink。 */
function makeFakeAudio() {
  const voices: FakeVoice[] = [];
  const createLoop = vi.fn<(id: string) => LoopVoice>((_id): LoopVoice => {
    const v: FakeVoice = {
      setLevel: vi.fn<(level: number) => void>(),
      stop: vi.fn<() => void>(),
    };
    voices.push(v);
    return v;
  });
  const playOneShot = vi.fn<(id: string) => void>();
  const sink: AudioSink = { playOneShot, createLoop };
  return { sink, createLoop, playOneShot, voices };
}

/** worldBounds など AutoMode が実際に触れる面だけ持つ最小 fake Scene。 */
function makeFakeScene(): Scene {
  const fake = {
    worldBounds: createWorldBounds({ width: 800, height: 600 }, 200),
    critterCount: 0,
    critterList: [],
    despawnAll: vi.fn(),
    despawnWhere: vi.fn(),
    updateAll: vi.fn(),
  };
  return fake as unknown as Scene;
}

/**
 * テスト用の最小 CritterType。createAutoSpawn を意図的に持たせないことで start() の
 * spawn 経路を Pixi 生成前に止める（上部コメント参照）。
 */
function makeType(id: string, sounds: CritterSoundSet): CritterType {
  return {
    id,
    displayName: id,
    textureUrl: "",
    baseSize: 100,
    defaultFacing: 1,
    createMovement: () => ({ update: () => undefined }),
    sounds,
    hasTail: false,
  };
}

/** ダミーテクスチャ（spawn しないので dereference されない）。 */
const DUMMY_TEXTURE = {} as unknown as Texture;

function entry(typeId: string, weight = 1): AutoModeEntry {
  return { typeId, bodyTexture: DUMMY_TEXTURE, weight };
}

function makeMode(audio: AudioSink, entries: AutoModeEntry[]): AutoMode {
  return new AutoMode({
    scene: makeFakeScene(),
    entries,
    audio,
    intervalMs: 1000,
    // 常に先頭を選ぶ決定的乱数（spawnOne は createAutoSpawn 無しで early-return する）。
    rng: () => 0,
  });
}

describe("AutoMode SE コントローラ Map ライフサイクル", () => {
  beforeEach(() => {
    // move sound 有り 2 種 + voice sound 有り 1 種 + 無音 1 種を登録する。
    registerCritterType(makeType("with-move", { move: "m" }));
    registerCritterType(makeType("with-move-2", { move: "m2" }));
    registerCritterType(makeType("with-voice", { voice: "v" }));
    registerCritterType(makeType("silent", {}));
  });

  afterEach(() => {
    // 他テストへ影響させないため登録種別を全消去する。
    clearCritterTypes();
  });

  it("(a) 構築+start で sounds を持つ種別だけ controller を作る（無音種別は作らない）", () => {
    const audio = makeFakeAudio();
    const mode = makeMode(audio.sink, [entry("with-move"), entry("silent")]);
    mode.start();
    // with-move のみ createLoop が呼ばれる（silent は controller 自体を生成しない）。
    expect(audio.createLoop).toHaveBeenCalledTimes(1);
    expect(audio.createLoop).toHaveBeenCalledWith("m");
    mode.stop();
  });

  it("(a') voice のみ持つ種別も controller を作る（move 無しなので createLoop は呼ばれない）", () => {
    const audio = makeFakeAudio();
    const mode = makeMode(audio.sink, [entry("with-voice"), entry("silent")]);
    mode.start();
    // voice のみ→ controller は在るが move ループは無いので createLoop 0。
    // silent は controller を作らないので stop 時にも stop() が呼ばれる voice は無い。
    expect(audio.createLoop).toHaveBeenCalledTimes(0);
    mode.stop();
  });

  it("(b) running 中 addEntry で controller を生成、removeEntry で LoopVoice.stop して除去する", () => {
    const audio = makeFakeAudio();
    const mode = makeMode(audio.sink, [entry("with-move")]);
    mode.start();
    expect(audio.createLoop).toHaveBeenCalledTimes(1);

    // running 中の addEntry は即 start され createLoop がもう 1 本走る。
    mode.addEntry(entry("with-move-2"));
    expect(audio.createLoop).toHaveBeenCalledTimes(2);
    const voice2 = audio.voices[1];

    // removeEntry で対応 controller の LoopVoice.stop が呼ばれる。
    mode.removeEntry("with-move-2");
    expect(voice2.stop).toHaveBeenCalledTimes(1);

    // Map から除去された証左: 再 addEntry で controller が作り直される（createLoop 増）。
    mode.addEntry(entry("with-move-2"));
    expect(audio.createLoop).toHaveBeenCalledTimes(3);
    mode.stop();
  });

  it("(c) 同一 typeId の重複 addEntry で controller を二重生成しない（ensureController 冪等）", () => {
    const audio = makeFakeAudio();
    const mode = makeMode(audio.sink, [entry("with-move")]);
    mode.start();
    expect(audio.createLoop).toHaveBeenCalledTimes(1);

    // 同じ typeId を weight 差し替えで再追加しても controller は使い回す。
    mode.addEntry(entry("with-move", 5));
    expect(audio.createLoop).toHaveBeenCalledTimes(1);
    mode.stop();
  });

  it("(c') 構築時に同一 typeId が重複しても controller は 1 本だけ（ensureController 冪等）", () => {
    const audio = makeFakeAudio();
    const mode = makeMode(audio.sink, [entry("with-move"), entry("with-move")]);
    mode.start();
    expect(audio.createLoop).toHaveBeenCalledTimes(1);
    mode.stop();
  });

  it("(d) setPaused(true) で全 controller の move レベルが 0 に落ちる（pause 時ミュート）", () => {
    const audio = makeFakeAudio();
    const mode = makeMode(audio.sink, [entry("with-move"), entry("with-move-2")]);
    mode.start();
    expect(audio.voices).toHaveLength(2);
    // start 時の初期 setLevel(0) を除外して pause の効果だけを見る。
    for (const v of audio.voices) {
      v.setLevel.mockClear();
    }

    mode.setPaused(true);
    for (const v of audio.voices) {
      expect(v.setLevel).toHaveBeenCalledWith(0);
      expect(v.setLevel).toHaveBeenLastCalledWith(0);
    }

    // 冪等: 二重 pause でも安全に 0 のまま。
    mode.setPaused(true);
    for (const v of audio.voices) {
      expect(v.setLevel).toHaveBeenLastCalledWith(0);
    }
    mode.stop();
  });

  it("(e) setDisabledTypes は controller を破棄しない（無効でも保持、SEは在否ゲートで制御）", () => {
    const audio = makeFakeAudio();
    const mode = makeMode(audio.sink, [entry("with-move")]);
    mode.start();
    const voice = audio.voices[0];

    mode.setDisabledTypes(["with-move"]);
    // controller は残る＝この時点で LoopVoice.stop は呼ばれない。
    expect(voice.stop).not.toHaveBeenCalled();

    // stop() で初めて解放される（controller が保持されていた証左）。
    mode.stop();
    expect(voice.stop).toHaveBeenCalledTimes(1);
  });
});
