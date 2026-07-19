import type { Texture } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "../../src/app/Scene";
import type { AudioSink } from "../../src/audio/AudioManager";
import { CATCH_ID } from "../../src/audio/sounds";
import type { LoopVoice } from "../../src/audio/synth";
import { createWorldBounds } from "../../src/core/worldBounds";
import type { Critter, SpawnCritterParams } from "../../src/critters/Critter";
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

/** setLevel/setPan/stop を spy した fake LoopVoice。 */
interface FakeVoice extends LoopVoice {
  setLevel: ReturnType<typeof vi.fn<(level: number) => void>>;
  setPan: ReturnType<typeof vi.fn<(pan: number) => void>>;
  stop: ReturnType<typeof vi.fn<() => void>>;
}

/** createLoop/playOneShot を spy し、生成した LoopVoice を記録する fake AudioSink。 */
function makeFakeAudio() {
  const voices: FakeVoice[] = [];
  const createLoop = vi.fn<(id: string) => LoopVoice>((_id): LoopVoice => {
    const v: FakeVoice = {
      setLevel: vi.fn<(level: number) => void>(),
      setPan: vi.fn<(pan: number) => void>(),
      stop: vi.fn<() => void>(),
    };
    voices.push(v);
    return v;
  });
  // [UR4-4] playOneShot は (id, pan?) 受け。既存テストは id のみ検証（pan は optional で後方互換）。
  const playOneShot = vi.fn<(id: string, pan?: number) => void>();
  const sink: AudioSink = { playOneShot, createLoop };
  return { sink, createLoop, playOneShot, voices };
}

/**
 * worldBounds など AutoMode が実際に触れる面だけ持つ最小 fake Scene。
 * RF-S1a 後は spawn/despawn を {@link CritterPopulation} 経由で行うため、Scene 側に触れるのは
 * worldBounds / add / despawn の 3 面のみ（add=population.spawn、despawn=reap/despawnAll から）。
 * critterList は AutoMode からは参照されなくなったが、直接構築する一部テストの互換のため残す。
 */
function makeFakeScene(critterList: unknown[] = []): Scene {
  const fake = {
    worldBounds: createWorldBounds({ width: 800, height: 600 }, 200),
    critterList,
    add: vi.fn<(c: Critter) => void>(),
    despawn: vi.fn<(c: Critter) => void>(),
  };
  return fake as unknown as Scene;
}

/** add/despawn spy を露出した fake Scene（Population 委譲の観測用）。 */
function makeSpyScene() {
  const add = vi.fn<(c: Critter) => void>();
  const despawn = vi.fn<(c: Critter) => void>();
  const scene = {
    worldBounds: createWorldBounds({ width: 800, height: 600 }, 200),
    add,
    despawn,
  } as unknown as Scene;
  return { scene, add, despawn };
}

/** Population へ fake critter を載せるための spawn 台車種別（createAutoSpawn を持つ）。 */
const SPAWN_VEHICLE = "spawn-vehicle";

/**
 * createAutoSpawn を持つ最小種別。プラン内容は createCritter 差し替え時に dereference されないので
 * ダミーで足りる（spawnEntry の `!type.createAutoSpawn` early-return を越えて population.spawn へ通す）。
 */
function makeSpawnableType(id: string): CritterType {
  return {
    ...makeType(id, {}),
    createAutoSpawn: () => ({
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      facing: 1,
      movement: { update: () => undefined },
    }),
  };
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
 *
 * RF-S1a 後 handleTap は {@link CritterPopulation.hitTest}（AutoMode 内部 population）を叩くため、
 * fake critter は「Scene に注入」ではなく createCritter seam＋spawn 台車種別で Population へ load する。
 * start() が spawnOne() で 1 体（queue 先頭）を、続く spawnType(SPAWN_VEHICLE) が残りを順に load する。
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

/**
 * critters を Population へ load 済みの running な AutoMode を作る（handleTap テスト用）。
 * createCritter で注入 critter を spawn 順（queue 先頭から）に返し、start()＋spawnType で
 * ちょうど critters.length 体を Population に載せる（順序も配列どおり＝hitTest の最近傍/同点比較が一致）。
 */
function startedModeWith(audio: AudioSink, critters: FakeCritter[]): AutoMode {
  const queue = [...critters];
  const mode = new AutoMode({
    scene: makeFakeScene(),
    entries: [entry(SPAWN_VEHICLE)],
    audio,
    intervalMs: 1000,
    rng: () => 0,
    createCritter: () =>
      (queue.shift() ?? makeCritter(SPAWN_VEHICLE, 0, 0, 1)) as unknown as Critter,
  });
  mode.start(); // spawnOne() で critters[0] を load。
  for (let i = 1; i < critters.length; i++) {
    mode.spawnType(SPAWN_VEHICLE); // 残りを配列順に load。
  }
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
    // fake critter を Population へ載せる spawn 台車種別（createAutoSpawn を持つ）。
    registerCritterType(makeSpawnableType(SPAWN_VEHICLE));
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
    // [UR4-4] critter x=400 / viewport 幅 800 → pan=(400/800)*2-1=0（中央）で発火する。
    expect(audioVoice.playOneShot).toHaveBeenCalledWith(VOICE_ID, 0);
    modeVoice.stop();

    const audioPlain = makeFakeAudio();
    const cPlain = makeCritter(PLAIN_TYPE, 400, 300, 100);
    const modePlain = startedModeWith(audioPlain.sink, [cPlain]);
    expect(modePlain.handleTap(400, 300)).toBe(true);
    expect(audioPlain.playOneShot).toHaveBeenCalledTimes(1);
    expect(audioPlain.playOneShot).toHaveBeenCalledWith(CATCH_ID, 0);
    modePlain.stop();
  });

  it("[UR4-4] 捕獲SEは critter の x 位置で左右定位する（左=負 pan / 右=正 pan）", () => {
    // viewport 幅 800。左寄り critter(x=100)→pan=-0.75、右寄り critter(x=700)→pan=0.75。
    const audioLeft = makeFakeAudio();
    const cLeft = makeCritter(VOICE_TYPE, 100, 300, 100);
    const modeLeft = startedModeWith(audioLeft.sink, [cLeft]);
    expect(modeLeft.handleTap(100, 300)).toBe(true);
    expect(audioLeft.playOneShot).toHaveBeenCalledWith(VOICE_ID, expect.closeTo(-0.75, 6));
    modeLeft.stop();

    const audioRight = makeFakeAudio();
    const cRight = makeCritter(VOICE_TYPE, 700, 300, 100);
    const modeRight = startedModeWith(audioRight.sink, [cRight]);
    expect(modeRight.handleTap(700, 300)).toBe(true);
    expect(audioRight.playOneShot).toHaveBeenCalledWith(VOICE_ID, expect.closeTo(0.75, 6));
    modeRight.stop();
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

/**
 * [RF-S1a] AutoMode → CritterPopulation 委譲の不変条件（Pixi 非依存）。
 *
 * AutoMode が spawn/cap/update+reap/stop を Population 経由で行うことを、Scene 境界の add/despawn spy と
 * critter の update spy で観測する。ヒットロジック等の内部等価は critterPopulation.test / handleTap 側で
 * 既に固定しているため、ここでは「AutoMode が Population へ正しく配線されているか」に集中する。
 */

/** update/reap まで通る fuller fake critter（Pixi 非依存）。SE 集計用に typeId/velocity も持つ。 */
interface DelegFakeCritter {
  state: {
    position: { x: number; y: number };
    size: number;
    typeId: string;
    velocity: { x: number; y: number };
  };
  destroyed: boolean;
  hasExpired: boolean;
  update: ReturnType<typeof vi.fn<(dt: number, ctx: unknown) => void>>;
}

function makeDelegCritter(opts?: {
  x?: number;
  y?: number;
  hasExpired?: boolean;
}): DelegFakeCritter {
  return {
    state: {
      position: { x: opts?.x ?? 400, y: opts?.y ?? 300 },
      size: 100,
      typeId: SPAWN_VEHICLE,
      velocity: { x: 0, y: 0 },
    },
    destroyed: false,
    hasExpired: opts?.hasExpired ?? false,
    update: vi.fn<(dt: number, ctx: unknown) => void>(),
  };
}

/** SPAWN_VEHICLE のみ entries に持ち、queue の fake を spawn 順に load する AutoMode を作る。 */
function buildDelegMode(
  scene: Scene,
  queue: DelegFakeCritter[],
  opts?: { maxActive?: number },
): AutoMode {
  const remaining = [...queue];
  return new AutoMode({
    scene,
    entries: [entry(SPAWN_VEHICLE)],
    audio: makeFakeAudio().sink,
    // update() でスケジュール spawn が発火しない十分大きい間隔（reap/更新の観測を汚さない）。
    intervalMs: 100000,
    maxActive: opts?.maxActive,
    rng: () => 0,
    createCritter: () => (remaining.shift() ?? makeDelegCritter()) as unknown as Critter,
  });
}

describe("AutoMode: CritterPopulation 委譲の不変条件", () => {
  beforeEach(() => {
    registerCritterType(makeSpawnableType(SPAWN_VEHICLE));
  });

  afterEach(() => {
    clearCritterTypes();
  });

  it("spawn は Population 経由で scene.add に載る（createCritter seam）", () => {
    const { scene, add } = makeSpyScene();
    const c = makeDelegCritter();
    const mode = buildDelegMode(scene, [c]);

    mode.spawnType(SPAWN_VEHICLE); // start() 抜きで 1 体だけ確実に spawn。

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(c as unknown as Critter);
  });

  it("maxActive 到達で spawn を止める（cap は population.count で判定）", () => {
    const { scene, add } = makeSpyScene();
    const mode = buildDelegMode(
      scene,
      [makeDelegCritter(), makeDelegCritter(), makeDelegCritter()],
      { maxActive: 2 },
    );

    mode.spawnType(SPAWN_VEHICLE);
    mode.spawnType(SPAWN_VEHICLE);
    mode.spawnType(SPAWN_VEHICLE); // 3 回目は count(2) >= maxActive(2) で早期 return。

    expect(add).toHaveBeenCalledTimes(2);
  });

  it("update の reap で world 外/expired を despawn し内側は残す（update→reapExited 委譲）", () => {
    const { scene, despawn } = makeSpyScene();
    const inside = makeDelegCritter({ x: 400, y: 300 });
    const exited = makeDelegCritter({ x: 100000, y: 300 });
    const expired = makeDelegCritter({ x: 400, y: 300, hasExpired: true });
    const mode = buildDelegMode(scene, [inside, exited, expired]);
    mode.start(); // spawnOne() で inside を load。
    mode.spawnType(SPAWN_VEHICLE); // exited
    mode.spawnType(SPAWN_VEHICLE); // expired

    mode.update(0.1);

    expect(despawn).toHaveBeenCalledTimes(2);
    expect(despawn).toHaveBeenCalledWith(exited as unknown as Critter);
    expect(despawn).toHaveBeenCalledWith(expired as unknown as Critter);
    expect(despawn).not.toHaveBeenCalledWith(inside as unknown as Critter);
    // 生存個体は update される（reap 前に全個体を index 走査で更新）。
    expect(inside.update).toHaveBeenCalledTimes(1);
  });

  it("stop で全 critter を despawn（population.despawnAll = count 0 化）", () => {
    const { scene, despawn } = makeSpyScene();
    const mode = buildDelegMode(scene, [
      makeDelegCritter(),
      makeDelegCritter(),
      makeDelegCritter(),
    ]);
    mode.start(); // load 1（spawnOne）。
    mode.spawnType(SPAWN_VEHICLE); // load 2
    mode.spawnType(SPAWN_VEHICLE); // load 3

    mode.stop();

    // 3 体すべてが scene.despawn され Population が空になる（despawn 数＝spawn 数）。
    expect(despawn).toHaveBeenCalledTimes(3);
  });
});

/**
 * [UR4-2] AutoMode → spawnCritter への種別ごとのサイズ倍率配線（Pixi 非依存・createCritter seam）。
 *
 * setSizeMultipliers で保持したレコードから spawnEntry が `sizeMultipliers[typeId] ?? 1` を
 * spawn params の sizeMultiplier として渡すことを、createCritter seam で捕捉して観測する
 * （実サイズ合成 size=baseSize×viewportScale×multiplier は spawnCritterSize.test で固定済み）。
 */
describe("AutoMode: 種別サイズ倍率の配線 (UR4-2)", () => {
  beforeEach(() => {
    registerCritterType(makeSpawnableType(SPAWN_VEHICLE));
  });

  afterEach(() => {
    clearCritterTypes();
  });

  /** createCritter seam に渡る params を捕捉する running でない AutoMode を作る。 */
  function makeCapturingMode(captured: SpawnCritterParams[]): AutoMode {
    return new AutoMode({
      scene: makeFakeScene(),
      entries: [entry(SPAWN_VEHICLE)],
      audio: makeFakeAudio().sink,
      intervalMs: 100000,
      rng: () => 0,
      createCritter: (p) => {
        captured.push(p);
        return makeDelegCritter() as unknown as Critter;
      },
    });
  }

  it("setSizeMultipliers で指定した種別の sizeMultiplier が spawn へ渡る", () => {
    const captured: SpawnCritterParams[] = [];
    const mode = makeCapturingMode(captured);
    mode.setSizeMultipliers({ [SPAWN_VEHICLE]: 1.6 });
    mode.spawnType(SPAWN_VEHICLE);
    expect(captured).toHaveLength(1);
    expect(captured[0].sizeMultiplier).toBe(1.6);
  });

  it("未設定の種別は sizeMultiplier=1（後方互換）", () => {
    const captured: SpawnCritterParams[] = [];
    const mode = makeCapturingMode(captured);
    // setSizeMultipliers を呼ばない → レコード空 → 1 フォールバック。
    mode.spawnType(SPAWN_VEHICLE);
    expect(captured[0].sizeMultiplier).toBe(1);
  });

  it("setSizeMultipliers は live-apply（再設定で次の spawn から新倍率）", () => {
    const captured: SpawnCritterParams[] = [];
    const mode = makeCapturingMode(captured);
    mode.setSizeMultipliers({ [SPAWN_VEHICLE]: 0.6 });
    mode.spawnType(SPAWN_VEHICLE);
    mode.setSizeMultipliers({ [SPAWN_VEHICLE]: 2.0 });
    mode.spawnType(SPAWN_VEHICLE);
    expect(captured[0].sizeMultiplier).toBe(0.6);
    expect(captured[1].sizeMultiplier).toBe(2.0);
  });

  it("外部レコードを共有しない（浅コピー保持）", () => {
    const captured: SpawnCritterParams[] = [];
    const mode = makeCapturingMode(captured);
    const map = { [SPAWN_VEHICLE]: 1.3 };
    mode.setSizeMultipliers(map);
    // 呼び出し後に外部レコードを破壊しても、保持済みの値は変わらない。
    map[SPAWN_VEHICLE] = 0.5;
    mode.spawnType(SPAWN_VEHICLE);
    expect(captured[0].sizeMultiplier).toBe(1.3);
  });
});

/**
 * [UR4-3] AutoMode の種別SEオン/オフ present-gate（Pixi 非依存・createCritter/audio seam）。
 *
 * setSoundEnabled で false にした種別は、画面上で動いていても update の per-type 駆動が present=false になり
 * ループSE（走行音/羽音）が setLevel(0) のまま鳴らず、handleTap の捕獲 one-shot も抑制される（ループ＋one-shot
 * 両 gate）。他種別は影響を受けず駆動される。present=false→setLevel(0)/voice非発火 は CritterAudioController
 * の既存不変（critterAudioController.test で固定済み）を利用し、ここでは AutoMode の gate 合成に集中する。
 */

/** move sound を持ち createAutoSpawn も持つ spawnable 種別（gate 観測用に走行音ループを生成させる）。 */
function makeSpawnableTypeWithMove(id: string, moveId: string): CritterType {
  return {
    ...makeType(id, { move: moveId }),
    createAutoSpawn: () => ({
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      facing: 1,
      movement: { update: () => undefined },
    }),
  };
}

/** SE 集計（typeId/velocity/position.x）と handleTap（position/size/flee）と reap（destroyed/hasExpired/update）を満たす fake critter。 */
function makeSoundCritter(
  typeId: string,
  opts?: { vx?: number; x?: number },
): DelegFakeCritter & {
  flee: ReturnType<typeof vi.fn<(fromX: number, fromY: number) => void>>;
} {
  return {
    state: {
      position: { x: opts?.x ?? 400, y: 300 },
      size: 100,
      typeId,
      velocity: { x: opts?.vx ?? 1000, y: 0 },
    },
    destroyed: false,
    hasExpired: false,
    update: vi.fn<(dt: number, ctx: unknown) => void>(),
    flee: vi.fn<(fromX: number, fromY: number) => void>(),
  };
}

describe("AutoMode: 種別SEオン/オフの present-gate (UR4-3)", () => {
  const SND = "ur43-runner";
  const MOVE_ID = "ur43-move";

  beforeEach(() => {
    registerCritterType(makeSpawnableTypeWithMove(SND, MOVE_ID));
  });

  afterEach(() => {
    clearCritterTypes();
  });

  /** SND を 1 体 load 済みの running な AutoMode（createCritter seam で fake を注入）。 */
  function startedMovingMode(
    audio: AudioSink,
    critter: ReturnType<typeof makeSoundCritter>,
    soundEnabled?: Record<string, boolean>,
  ): AutoMode {
    let injected = false;
    const mode = new AutoMode({
      scene: makeFakeScene(),
      entries: [entry(SND)],
      audio,
      intervalMs: 100000, // update 中にスケジュール spawn が起きない十分大きい間隔。
      rng: () => 0,
      createCritter: () => {
        injected = true;
        return critter as unknown as Critter;
      },
    });
    if (soundEnabled) {
      mode.setSoundEnabled(soundEnabled);
    }
    mode.start(); // spawnOne → SND を 1 体 load。
    expect(injected).toBe(true);
    return mode;
  }

  it("SEオンの種別は present=true で走行音ループが駆動される（level>0）", () => {
    const audio = makeFakeAudio();
    const mode = startedMovingMode(audio.sink, makeSoundCritter(SND), { [SND]: true });
    const voice = audio.voices[0];
    voice.setLevel.mockClear();
    mode.update(1 / 60);
    // 動いている＋SEオン → present=true でスピード連動レベル(>0)が設定される。
    expect(voice.setLevel.mock.calls.some(([l]) => l > 0)).toBe(true);
    mode.stop();
  });

  it("SEオフの種別は動いていても present=false でループを無音化（setLevel(0) のまま）", () => {
    const audio = makeFakeAudio();
    const mode = startedMovingMode(audio.sink, makeSoundCritter(SND), { [SND]: false });
    const voice = audio.voices[0];
    voice.setLevel.mockClear();
    mode.update(1 / 60);
    // SEオフ → present=false 経路で setLevel(0) のみ、level>0 は一度も無い。
    expect(voice.setLevel.mock.calls.every(([l]) => l === 0)).toBe(true);
    mode.stop();
  });

  it("setSoundEnabled は live-apply（オン→オフ→オンでループ駆動が即切り替わる）", () => {
    const audio = makeFakeAudio();
    const mode = startedMovingMode(audio.sink, makeSoundCritter(SND), { [SND]: true });
    const voice = audio.voices[0];

    voice.setLevel.mockClear();
    mode.update(1 / 60);
    expect(voice.setLevel.mock.calls.some(([l]) => l > 0)).toBe(true);

    // ライブにオフ → 次の update で present=false になり無音化（respawn 不要）。
    mode.setSoundEnabled({ [SND]: false });
    voice.setLevel.mockClear();
    mode.update(1 / 60);
    expect(voice.setLevel.mock.calls.every(([l]) => l === 0)).toBe(true);

    // ライブにオンへ戻す → 復帰して再び level>0。
    mode.setSoundEnabled({ [SND]: true });
    voice.setLevel.mockClear();
    mode.update(1 / 60);
    expect(voice.setLevel.mock.calls.some(([l]) => l > 0)).toBe(true);
    mode.stop();
  });

  it("SEオフの種別は handleTap の捕獲 one-shot も抑制する（逃走＝true は維持）", () => {
    const audio = makeFakeAudio();
    const critter = makeSoundCritter(SND, { x: 400 });
    const mode = startedMovingMode(audio.sink, critter, { [SND]: false });
    // ヒットするタップ（中心 400,300・半径 60）。
    const hit = mode.handleTap(400, 300);
    expect(hit).toBe(true); // 視覚フィードバック（逃走）は維持。
    expect(critter.flee).toHaveBeenCalledTimes(1);
    // one-shot（CATCH_ID）は鳴らない。
    expect(audio.playOneShot).not.toHaveBeenCalled();
    mode.stop();
  });

  it("SEオンの種別は handleTap の捕獲 one-shot が鳴る（未設定キーも true フォールバック）", () => {
    const audio = makeFakeAudio();
    const critter = makeSoundCritter(SND, { x: 400 });
    // setSoundEnabled を渡さない → 未設定キーは true フォールバック。
    const mode = startedMovingMode(audio.sink, critter);
    const hit = mode.handleTap(400, 300);
    expect(hit).toBe(true);
    expect(critter.flee).toHaveBeenCalledTimes(1);
    // voice 無し種別なので CATCH_ID が鳴る。
    expect(audio.playOneShot).toHaveBeenCalledTimes(1);
    expect(audio.playOneShot).toHaveBeenCalledWith(CATCH_ID, expect.any(Number));
    mode.stop();
  });

  it("あるオブジェクトのSEをオフにしても、他種別のループは鳴り続ける", () => {
    const OTHER = "ur43-other";
    const OTHER_MOVE = "ur43-other-move";
    registerCritterType(makeSpawnableTypeWithMove(OTHER, OTHER_MOVE));
    const audio = makeFakeAudio();
    // SND=オフ / OTHER=オン。両種別を 1 体ずつ load して同時駆動する。
    const queue = [makeSoundCritter(SND), makeSoundCritter(OTHER)];
    const mode = new AutoMode({
      scene: makeFakeScene(),
      entries: [entry(SND), entry(OTHER)],
      audio: audio.sink,
      intervalMs: 100000,
      rng: () => 0, // 先頭(SND)を選ぶが、両方 spawnType で確実に load する。
      createCritter: () => (queue.shift() ?? makeSoundCritter(SND)) as unknown as Critter,
    });
    mode.setSoundEnabled({ [SND]: false, [OTHER]: true });
    mode.start(); // SND を load。
    mode.spawnType(OTHER); // OTHER を load。
    // controller は createLoop 順（SND, OTHER）で 2 本。move id で対応付ける。
    const sndVoiceIdx = audio.createLoop.mock.calls.findIndex(([id]) => id === MOVE_ID);
    const otherVoiceIdx = audio.createLoop.mock.calls.findIndex(([id]) => id === OTHER_MOVE);
    const sndVoice = audio.voices[sndVoiceIdx];
    const otherVoice = audio.voices[otherVoiceIdx];
    sndVoice.setLevel.mockClear();
    otherVoice.setLevel.mockClear();

    mode.update(1 / 60);

    // SND（オフ）は無音、OTHER（オン）は鳴り続ける。
    expect(sndVoice.setLevel.mock.calls.every(([l]) => l === 0)).toBe(true);
    expect(otherVoice.setLevel.mock.calls.some(([l]) => l > 0)).toBe(true);
    mode.stop();
  });
});
