import type { Texture } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "../../src/app/Scene";
import type { AudioSink } from "../../src/audio/AudioManager";
import { CATCH_ID } from "../../src/audio/sounds";
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

/**
 * worldBounds など AutoMode が実際に触れる面だけ持つ最小 fake Scene。
 * handleTap のテスト用に critterList を差し込めるようにする（既定は空＝従来どおり）。
 */
function makeFakeScene(critterList: unknown[] = []): Scene {
  const fake = {
    worldBounds: createWorldBounds({ width: 800, height: 600 }, 200),
    critterCount: 0,
    critterList,
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

/**
 * handleTap（捕獲フィードバック）の単体テスト（Pixi 非依存）。
 *
 * handleTap が触れるのは各 critter の state.position.{x,y} / state.size / state.typeId と flee のみ
 * なので、fake critter は `{ state: {...}, flee: vi.fn() }` で足りる（Pixi Sprite 不要）。
 * typeId は getCritterType で解決されるため beforeEach で登録済みの型を使う（voice 有無の両方）。
 * mode は entries なしで start() して running にする（spawnOne は weightedIndex(-1) で no-op）。
 */

/** handleTap が触れる面だけ持つ fake critter（Pixi 不要）。flee は spy。 */
interface FakeCritter {
  state: { position: { x: number; y: number }; size: number; typeId: string };
  flee: ReturnType<typeof vi.fn<(fromX: number, fromY: number) => void>>;
}

function makeCritter(typeId: string, x: number, y: number, size: number): FakeCritter {
  return {
    state: { position: { x, y }, size, typeId },
    flee: vi.fn<(fromX: number, fromY: number) => void>(),
  };
}

/** critterList を注入した running な AutoMode を作る（handleTap テスト用）。 */
function startedModeWith(audio: AudioSink, critters: FakeCritter[]): AutoMode {
  const mode = new AutoMode({
    scene: makeFakeScene(critters),
    entries: [], // handleTap は entries を使わない。start() は空 entries でも安全（spawnOne が no-op）。
    audio,
    intervalMs: 1000,
    rng: () => 0,
  });
  mode.start();
  return mode;
}

describe("AutoMode.handleTap 捕獲フィードバック", () => {
  const VOICE_TYPE = "tap-voice";
  const VOICE_ID = "tap-squeak";
  const PLAIN_TYPE = "tap-plain";

  beforeEach(() => {
    // voice を持つ種別と、voice を持たない種別（→ CATCH_ID フォールバック）の両方を用意する。
    registerCritterType(makeType(VOICE_TYPE, { voice: VOICE_ID }));
    registerCritterType(makeType(PLAIN_TYPE, {}));
  });

  afterEach(() => {
    clearCritterTypes();
  });

  it("(1) 当たり半径内の critter をタップ → true を返し、その critter を tap 座標で flee させる", () => {
    const audio = makeFakeAudio();
    // size 100 → hitRadius = max(60, 28) = 60。中心(400,300)からタップ(410,300)は距離10でヒット。
    const c = makeCritter(VOICE_TYPE, 400, 300, 100);
    const mode = startedModeWith(audio.sink, [c]);

    const hit = mode.handleTap(410, 300);

    expect(hit).toBe(true);
    expect(c.flee).toHaveBeenCalledTimes(1);
    expect(c.flee).toHaveBeenCalledWith(410, 300);
    mode.stop();
  });

  it("(2) 空きスペースのタップ → false、flee も playOneShot も呼ばれない（誤 despawn しない）", () => {
    const audio = makeFakeAudio();
    const c = makeCritter(VOICE_TYPE, 400, 300, 100); // 半径 60。
    const mode = startedModeWith(audio.sink, [c]);

    const hit = mode.handleTap(400, 400); // 距離 100 > 60 でミス。

    expect(hit).toBe(false);
    expect(c.flee).not.toHaveBeenCalled();
    expect(audio.playOneShot).not.toHaveBeenCalled();
    mode.stop();
  });

  it("(3) 複数が当たり半径内なら最も近い 1 体だけ flee する", () => {
    const audio = makeFakeAudio();
    const near = makeCritter(VOICE_TYPE, 400, 300, 100); // 半径 60。
    const far = makeCritter(VOICE_TYPE, 420, 300, 100); // 半径 60。
    const mode = startedModeWith(audio.sink, [near, far]);

    // タップ(405,300): near まで距離 5、far まで距離 15。どちらも半径 60 内 → 近い near のみ。
    const hit = mode.handleTap(405, 300);

    expect(hit).toBe(true);
    expect(near.flee).toHaveBeenCalledTimes(1);
    expect(near.flee).toHaveBeenCalledWith(405, 300);
    expect(far.flee).not.toHaveBeenCalled();
    mode.stop();
  });

  it("(4a) 小さい critter は下限半径 28px: 距離 27 ヒット / 距離 29 ミス", () => {
    // size 10 → hitRadius = max(6, 28) = 28（下限が効く）。
    const audioHit = makeFakeAudio();
    const cHit = makeCritter(VOICE_TYPE, 400, 300, 10);
    const modeHit = startedModeWith(audioHit.sink, [cHit]);
    expect(modeHit.handleTap(427, 300)).toBe(true); // 距離 27 ≤ 28。
    expect(cHit.flee).toHaveBeenCalledTimes(1);
    modeHit.stop();

    const audioMiss = makeFakeAudio();
    const cMiss = makeCritter(VOICE_TYPE, 400, 300, 10);
    const modeMiss = startedModeWith(audioMiss.sink, [cMiss]);
    expect(modeMiss.handleTap(429, 300)).toBe(false); // 距離 29 > 28。
    expect(cMiss.flee).not.toHaveBeenCalled();
    modeMiss.stop();
  });

  it("(4b) 大きい critter は size ベース半径 60px: 距離 50 ヒット / 距離 70 ミス", () => {
    // size 100 → hitRadius = max(60, 28) = 60（size ベースが効く）。
    const audioHit = makeFakeAudio();
    const cHit = makeCritter(VOICE_TYPE, 400, 300, 100);
    const modeHit = startedModeWith(audioHit.sink, [cHit]);
    expect(modeHit.handleTap(450, 300)).toBe(true); // 距離 50 ≤ 60。
    expect(cHit.flee).toHaveBeenCalledTimes(1);
    modeHit.stop();

    const audioMiss = makeFakeAudio();
    const cMiss = makeCritter(VOICE_TYPE, 400, 300, 100);
    const modeMiss = startedModeWith(audioMiss.sink, [cMiss]);
    expect(modeMiss.handleTap(470, 300)).toBe(false); // 距離 70 > 60。
    expect(cMiss.flee).not.toHaveBeenCalled();
    modeMiss.stop();
  });

  it("(5) voice を持つ種別は playOneShot(voice)、持たない種別は playOneShot(CATCH_ID)", () => {
    const audioVoice = makeFakeAudio();
    const cVoice = makeCritter(VOICE_TYPE, 400, 300, 100);
    const modeVoice = startedModeWith(audioVoice.sink, [cVoice]);
    expect(modeVoice.handleTap(400, 300)).toBe(true);
    expect(audioVoice.playOneShot).toHaveBeenCalledTimes(1);
    expect(audioVoice.playOneShot).toHaveBeenCalledWith(VOICE_ID);
    modeVoice.stop();

    const audioPlain = makeFakeAudio();
    const cPlain = makeCritter(PLAIN_TYPE, 400, 300, 100);
    const modePlain = startedModeWith(audioPlain.sink, [cPlain]);
    expect(modePlain.handleTap(400, 300)).toBe(true);
    expect(audioPlain.playOneShot).toHaveBeenCalledTimes(1);
    expect(audioPlain.playOneShot).toHaveBeenCalledWith(CATCH_ID);
    modePlain.stop();
  });

  it("(6a) not running（start 前）は false かつ副作用なし", () => {
    const audio = makeFakeAudio();
    const c = makeCritter(VOICE_TYPE, 400, 300, 100);
    // start() を呼ばずに構築（running=false）。
    const mode = new AutoMode({
      scene: makeFakeScene([c]),
      entries: [],
      audio: audio.sink,
      intervalMs: 1000,
      rng: () => 0,
    });
    expect(mode.handleTap(400, 300)).toBe(false);
    expect(c.flee).not.toHaveBeenCalled();
    expect(audio.playOneShot).not.toHaveBeenCalled();
  });

  it("(6b) stop 後は false かつ副作用なし", () => {
    const audio = makeFakeAudio();
    const c = makeCritter(VOICE_TYPE, 400, 300, 100);
    const mode = startedModeWith(audio.sink, [c]);
    mode.stop();
    expect(mode.handleTap(400, 300)).toBe(false);
    expect(c.flee).not.toHaveBeenCalled();
    expect(audio.playOneShot).not.toHaveBeenCalled();
  });

  it("(6c) paused 中は false かつ副作用なし", () => {
    const audio = makeFakeAudio();
    const c = makeCritter(VOICE_TYPE, 400, 300, 100);
    const mode = startedModeWith(audio.sink, [c]);
    mode.setPaused(true);
    expect(mode.handleTap(400, 300)).toBe(false);
    expect(c.flee).not.toHaveBeenCalled();
    expect(audio.playOneShot).not.toHaveBeenCalled();
    mode.stop();
  });
});
