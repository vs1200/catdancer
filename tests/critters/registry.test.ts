import { beforeEach, describe, expect, it } from "vitest";
import { createWorldBounds } from "../../src/core/worldBounds";
import type { CritterType } from "../../src/critters/CritterType";
import {
  clearCritterTypes,
  createCritterStateFromType,
  getCritterType,
  hasCritterType,
  listCritterTypes,
  registerCritterType,
} from "../../src/critters/registry";
import { FOXTAIL_TYPE_ID, registerFoxtailType } from "../../src/critters/types/foxtail";
import { MOUSE_TYPE_ID, registerMouseType } from "../../src/critters/types/mouse";
import { registerToysType, TOYS_TYPE_ID } from "../../src/critters/types/toys";
import { CrossMovement } from "../../src/movement/CrossMovement";
import { DangleMovement } from "../../src/movement/DangleMovement";
import { DriftMovement } from "../../src/movement/DriftMovement";
import { MouseFollowMovement } from "../../src/movement/MouseFollowMovement";

// テスト用のダミー種別（PixiJS 非依存）。
function makeType(id: string, overrides: Partial<CritterType> = {}): CritterType {
  return {
    id,
    displayName: id,
    textureUrl: `${id}.webp`,
    baseSize: 120,
    defaultFacing: 1,
    createMovement: () => new DriftMovement(),
    sounds: {},
    hasTail: false,
    ...overrides,
  };
}

describe("registry", () => {
  beforeEach(() => {
    clearCritterTypes();
  });

  it("register / get / has / list", () => {
    const t = makeType("bird");
    registerCritterType(t);
    expect(hasCritterType("bird")).toBe(true);
    expect(getCritterType("bird")).toBe(t);
    expect(listCritterTypes()).toEqual([t]);
  });

  it("id 重複の登録はエラー", () => {
    registerCritterType(makeType("fish"));
    expect(() => registerCritterType(makeType("fish"))).toThrow();
  });

  it("未登録 id の取得はエラー", () => {
    expect(() => getCritterType("none")).toThrow();
  });

  it("createCritterStateFromType は種別既定値を使い、id と defaultFacing/baseSize を反映", () => {
    registerCritterType(makeType("cat", { defaultFacing: -1, baseSize: 200 }));
    const state = createCritterStateFromType("cat");
    expect(state.typeId).toBe("cat");
    expect(state.position).toEqual({ x: 0, y: 0 });
    expect(state.velocity).toEqual({ x: 0, y: 0 });
    expect(state.facing).toBe(-1);
    expect(state.size).toBe(200);
  });

  it("createCritterStateFromType は overrides を優先する", () => {
    registerCritterType(makeType("cat"));
    const state = createCritterStateFromType("cat", {
      position: { x: 5, y: 6 },
      velocity: { x: 1, y: 2 },
      facing: -1,
      size: 999,
    });
    expect(state.position).toEqual({ x: 5, y: 6 });
    expect(state.velocity).toEqual({ x: 1, y: 2 });
    expect(state.facing).toBe(-1);
    expect(state.size).toBe(999);
  });

  it("registerMouseType はネズミ種別を登録する（PixiJS 非依存の型検証）", () => {
    registerMouseType();
    const mouse = getCritterType(MOUSE_TYPE_ID);
    expect(mouse.id).toBe("mouse");
    expect(mouse.hasTail).toBe(true);
    expect(mouse.defaultFacing).toBe(1);
    expect(mouse.textureUrl).toContain("assets/critters/mouse-body.webp");
    // v1 マウス操作モードの既定 Movement は MouseFollowMovement（ポインタ慣性追従）。
    expect(mouse.createMovement()).toBeInstanceOf(MouseFollowMovement);
    // AutoMode 用は CrossMovement（横断）。
    const world = createWorldBounds({ width: 800, height: 600 }, 300);
    expect(mouse.createAutoSpawn?.(world, () => 0.5).movement).toBeInstanceOf(CrossMovement);
  });

  it("registerFoxtailType / registerToysType は dangle 系種別を登録する（尻尾なし・sway・反転なし）", () => {
    registerFoxtailType();
    registerToysType();
    const world = createWorldBounds({ width: 800, height: 600 }, 540);

    for (const id of [FOXTAIL_TYPE_ID, TOYS_TYPE_ID]) {
      const type = getCritterType(id);
      expect(type.hasTail).toBe(false);
      expect(type.flipWithFacing).toBe(false);
      expect(type.sway).toBeDefined();
      expect(type.textureUrl).toContain(`assets/critters/${id}.webp`);
      // dangle 系の AutoMode Movement は DangleMovement。
      const plan = type.createAutoSpawn?.(world, () => 0.5);
      expect(plan?.movement).toBeInstanceOf(DangleMovement);
      // 進入開始位置は world 内（初フレームで即 despawn しない）。
      expect(plan).toBeDefined();
    }

    const foxtail = getCritterType(FOXTAIL_TYPE_ID);
    expect(foxtail.sway?.pivot.x).toBeLessThan(0.5); // 茎の根元＝左寄り
    expect(foxtail.sway?.pivot.y).toBeGreaterThan(0.5); // 下寄り
    const toys = getCritterType(TOYS_TYPE_ID);
    expect(toys.sway?.pivot.x).toBeLessThan(0.2); // 柄の端＝左寄り
  });
});
