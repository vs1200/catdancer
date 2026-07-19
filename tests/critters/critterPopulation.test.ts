import type { Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import type { Scene } from "../../src/app/Scene";
import { createWorldBounds } from "../../src/core/worldBounds";
import type { Critter, SpawnCritterParams } from "../../src/critters/Critter";
import { CritterPopulation } from "../../src/critters/CritterPopulation";

/**
 * CritterPopulation（active list 管理・自己修復 prune・world 退出/expired despawn・hit-test の Facade）の
 * 単体テスト（Pixi 非依存）。
 *
 * Pixi 制約の回避（AutoMode.test の fake scene 流儀）:
 * - Population が触れる Scene 面は add/despawn/worldBounds のみ。最小 fake Scene で足りる。
 * - critter 生成は createCritter を注入して差し替える（既定 spawnCritter=Pixi 生成をテストで回避）。
 *   fake critter は Population が読む state.position/state.size と destroyed/hasExpired/update だけ持つ。
 */

/** Population が触れる面（state.position/size, destroyed, hasExpired, update）だけ持つ fake critter。 */
interface FakeCritter {
  state: { position: { x: number; y: number }; size: number };
  destroyed: boolean;
  hasExpired: boolean;
  update: ReturnType<typeof vi.fn<(dt: number, ctx: unknown) => void>>;
}

function makeCritter(opts?: {
  x?: number;
  y?: number;
  size?: number;
  destroyed?: boolean;
  hasExpired?: boolean;
}): FakeCritter {
  return {
    state: {
      position: { x: opts?.x ?? 0, y: opts?.y ?? 0 },
      size: opts?.size ?? 100,
    },
    destroyed: opts?.destroyed ?? false,
    hasExpired: opts?.hasExpired ?? false,
    update: vi.fn<(dt: number, ctx: unknown) => void>(),
  };
}

/** add/despawn を spy し worldBounds を持つ最小 fake Scene。 */
function makeFakeScene() {
  const add = vi.fn<(c: Critter) => void>();
  const despawn = vi.fn<(c: Critter) => void>();
  const scene = {
    worldBounds: createWorldBounds({ width: 800, height: 600 }, 200),
    add,
    despawn,
  } as unknown as Scene;
  return { scene, add, despawn };
}

/** ダミーテクスチャ（createCritter を差し替えるので dereference されない）。 */
const DUMMY_TEXTURE = {} as unknown as Texture;
const SPAWN_PARAMS: SpawnCritterParams = { typeId: "insect", bodyTexture: DUMMY_TEXTURE };

/**
 * createCritter を fake で差し替えた Population を作る。queue の fake を spawn 順に返す
 * （尽きたら都度新規 fake を作る）。ctx は update 委譲の引数一致確認に使う。
 */
function makePopulation(queue: FakeCritter[] = []) {
  const { scene, add, despawn } = makeFakeScene();
  const remaining = [...queue];
  const createCritter = vi.fn<(params: SpawnCritterParams) => Critter>(
    () => (remaining.shift() ?? makeCritter()) as unknown as Critter,
  );
  const pop = new CritterPopulation({ scene, createCritter });
  return { pop, scene, add, despawn, createCritter };
}

const CTX = { world: createWorldBounds({ width: 800, height: 600 }, 200), pointer: null };

describe("CritterPopulation: spawn / list / count", () => {
  it("spawn は createCritter で生成し scene.add と内部 list に載せ、生成物を返す", () => {
    const c0 = makeCritter();
    const c1 = makeCritter();
    const { pop, add, createCritter } = makePopulation([c0, c1]);

    const r0 = pop.spawn(SPAWN_PARAMS);
    expect(r0).toBe(c0 as unknown as Critter);
    expect(createCritter).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(c0 as unknown as Critter);
    expect(pop.count).toBe(1);
    expect(pop.list).toEqual([c0]);

    pop.spawn(SPAWN_PARAMS);
    expect(pop.count).toBe(2);
    // list は生成順（cap/evict の最古参照が先頭になる）。
    expect(pop.list).toEqual([c0, c1]);
  });

  it("list は空初期状態では length 0、count も 0", () => {
    const { pop } = makePopulation();
    expect(pop.count).toBe(0);
    expect(pop.list).toHaveLength(0);
  });
});

describe("CritterPopulation: update（自己修復 prune＋更新）", () => {
  it("destroyed の critter を list から除去し（二重 despawn しない）、残りだけ update する", () => {
    const c0 = makeCritter();
    const c1 = makeCritter({ destroyed: true });
    const c2 = makeCritter();
    const { pop, despawn } = makePopulation([c0, c1, c2]);
    pop.spawn(SPAWN_PARAMS);
    pop.spawn(SPAWN_PARAMS);
    pop.spawn(SPAWN_PARAMS);

    pop.update(0.1, CTX);

    // 破棄済み c1 は list から落ち、残りは c0/c2。
    expect(pop.list).toEqual([c0, c2]);
    expect(pop.count).toBe(2);
    // 破棄済みは既に destroy 済みなので scene.despawn は呼ばない（二重破棄回避）。
    expect(despawn).not.toHaveBeenCalled();
    // prune で落ちた c1 は update されない。残り 2 体は (dt, ctx) で更新される。
    expect(c1.update).not.toHaveBeenCalled();
    expect(c0.update).toHaveBeenCalledWith(0.1, CTX);
    expect(c2.update).toHaveBeenCalledWith(0.1, CTX);
  });
});

describe("CritterPopulation: reapExited（world 退出/expired despawn）", () => {
  it("hasExitedWorld または hasExpired の critter を despawn し list から除去、内側/非expired は残す", () => {
    const world = createWorldBounds({ width: 800, height: 600 }, 200);
    // 内側(400,300)・非expired → 残る / world 外(x=100000) → 退出 despawn / 内側だが expired → despawn。
    const inside = makeCritter({ x: 400, y: 300 });
    const exited = makeCritter({ x: 100000, y: 300 });
    const expired = makeCritter({ x: 400, y: 300, hasExpired: true });
    const { pop, despawn } = makePopulation([inside, exited, expired]);
    pop.spawn(SPAWN_PARAMS);
    pop.spawn(SPAWN_PARAMS);
    pop.spawn(SPAWN_PARAMS);

    pop.reapExited(world);

    expect(despawn).toHaveBeenCalledTimes(2);
    expect(despawn).toHaveBeenCalledWith(exited as unknown as Critter);
    expect(despawn).toHaveBeenCalledWith(expired as unknown as Critter);
    expect(pop.list).toEqual([inside]);
    expect(pop.count).toBe(1);
  });

  it("該当なしなら despawn を呼ばず全員残す", () => {
    const world = createWorldBounds({ width: 800, height: 600 }, 200);
    const a = makeCritter({ x: 100, y: 100 });
    const b = makeCritter({ x: 700, y: 500 });
    const { pop, despawn } = makePopulation([a, b]);
    pop.spawn(SPAWN_PARAMS);
    pop.spawn(SPAWN_PARAMS);

    pop.reapExited(world);

    expect(despawn).not.toHaveBeenCalled();
    expect(pop.count).toBe(2);
  });
});

describe("CritterPopulation: despawn（単体）/ despawnAll", () => {
  it("despawn は指定 critter を scene.despawn し list から除去する（cap/evict の最古退場用）", () => {
    const c0 = makeCritter();
    const c1 = makeCritter();
    const { pop, despawn } = makePopulation([c0, c1]);
    pop.spawn(SPAWN_PARAMS);
    pop.spawn(SPAWN_PARAMS);

    // 最古(先頭)を退場させる。
    pop.despawn(pop.list[0]);

    expect(despawn).toHaveBeenCalledTimes(1);
    expect(despawn).toHaveBeenCalledWith(c0 as unknown as Critter);
    expect(pop.list).toEqual([c1]);
    expect(pop.count).toBe(1);
  });

  it("despawnAll は全 critter を scene.despawn し list を空にする", () => {
    const { pop, despawn } = makePopulation([makeCritter(), makeCritter(), makeCritter()]);
    pop.spawn(SPAWN_PARAMS);
    pop.spawn(SPAWN_PARAMS);
    pop.spawn(SPAWN_PARAMS);

    pop.despawnAll();

    expect(despawn).toHaveBeenCalledTimes(3);
    expect(pop.count).toBe(0);
    expect(pop.list).toHaveLength(0);
  });
});

describe("CritterPopulation: hitTest", () => {
  it("当たり半径(size100→60)内なら最も近い 1 体を返す", () => {
    const near = makeCritter({ x: 400, y: 300, size: 100 });
    const far = makeCritter({ x: 420, y: 300, size: 100 });
    const { pop } = makePopulation([near, far]);
    pop.spawn(SPAWN_PARAMS);
    pop.spawn(SPAWN_PARAMS);

    // タップ(405,300): near まで距離 5、far まで距離 15。どちらも半径 60 内 → 近い near。
    expect(pop.hitTest(405, 300)).toBe(near as unknown as Critter);
  });

  it("当たり半径外なら null を返す", () => {
    const c = makeCritter({ x: 400, y: 300, size: 100 }); // 半径 60。
    const { pop } = makePopulation([c]);
    pop.spawn(SPAWN_PARAMS);

    expect(pop.hitTest(400, 400)).toBeNull(); // 距離 100 > 60。
  });

  it("小さい critter でも最小半径 28px が効く（距離 27 ヒット / 距離 29 ミス）", () => {
    const c = makeCritter({ x: 400, y: 300, size: 10 }); // size*0.6=6 < 28 → 28。
    const { pop } = makePopulation([c]);
    pop.spawn(SPAWN_PARAMS);

    expect(pop.hitTest(427, 300)).toBe(c as unknown as Critter); // 距離 27 ≤ 28。
    expect(pop.hitTest(429, 300)).toBeNull(); // 距離 29 > 28。
  });

  it("空なら null", () => {
    const { pop } = makePopulation();
    expect(pop.hitTest(0, 0)).toBeNull();
  });
});
