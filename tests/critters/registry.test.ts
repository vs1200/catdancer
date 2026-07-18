import { beforeEach, describe, expect, it } from "vitest";
import type { CritterType } from "../../src/critters/CritterType";
import {
  clearCritterTypes,
  createCritterStateFromType,
  getCritterType,
  hasCritterType,
  listCritterTypes,
  registerCritterType,
} from "../../src/critters/registry";
import { MOUSE_TYPE_ID, registerMouseType } from "../../src/critters/types/mouse";
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
  });
});
