import { Texture } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Viewport } from "../../src/core/worldBounds";
import { spawnCritter } from "../../src/critters/Critter";
import type { CritterType } from "../../src/critters/CritterType";
import { clearCritterTypes, registerCritterType } from "../../src/critters/registry";

/**
 * [UR4-2] spawnCritter の表示サイズ合成の不変条件（Pixi 非依存＝Texture.EMPTY で node 構築可）。
 *
 * size = baseSize × sizeScale(viewport) × sizeMultiplier を state.size で観測する。
 * state.size に載るので、表示スケールだけでなく当たり半径(hitRadius)・尻尾表示幅もこの値へ追従する
 * （当たり判定と見た目が一致）。sizeMultiplier 省略は 1（後方互換＝既存/テストの呼び出しは挙動不変）。
 */

const TEST_TYPE = "size-test";
const BASE = 200;

function makeType(): CritterType {
  return {
    id: TEST_TYPE,
    displayName: TEST_TYPE,
    textureUrl: "",
    baseSize: BASE,
    defaultFacing: 1,
    createMovement: () => ({ update: () => undefined }),
    sounds: {},
    hasTail: false,
  };
}

describe("spawnCritter サイズ合成 (UR4-2)", () => {
  beforeEach(() => {
    registerCritterType(makeType());
  });

  afterEach(() => {
    clearCritterTypes();
  });

  it("viewport 無し + multiplier で純倍率（size = baseSize × multiplier）", () => {
    const c = spawnCritter({ typeId: TEST_TYPE, bodyTexture: Texture.EMPTY, sizeMultiplier: 1.5 });
    expect(c.state.size).toBe(BASE * 1.5);
    c.destroy();
  });

  it("sizeMultiplier 省略は 1（後方互換＝従来 size のまま）", () => {
    const c = spawnCritter({ typeId: TEST_TYPE, bodyTexture: Texture.EMPTY });
    expect(c.state.size).toBe(BASE);
    c.destroy();
  });

  it("multiplier=1 は等倍（明示 1 でも従来と一致）", () => {
    const c = spawnCritter({ typeId: TEST_TYPE, bodyTexture: Texture.EMPTY, sizeMultiplier: 1 });
    expect(c.state.size).toBe(BASE);
    c.destroy();
  });

  it("viewport あり: size = baseSize × sizeScale(viewport) × multiplier の合成", () => {
    // 短辺 2160 → computeSizeScale = clamp(2160/1080=2.0) = 2.0（MAX）。
    const viewport: Viewport = { width: 2160, height: 2160 };
    const c = spawnCritter({
      typeId: TEST_TYPE,
      bodyTexture: Texture.EMPTY,
      viewport,
      sizeMultiplier: 0.6,
    });
    // 200 × 2.0 × 0.6 = 240。viewport sizeScale の上へユーザー倍率が乗る（二重掛けでなく積）。
    expect(c.state.size).toBeCloseTo(BASE * 2.0 * 0.6, 6);
    c.destroy();
  });

  it("spawn.size 明示指定にも multiplier が乗る（明示 baseSize × 倍率）", () => {
    const c = spawnCritter({
      typeId: TEST_TYPE,
      bodyTexture: Texture.EMPTY,
      spawn: { size: 100 },
      sizeMultiplier: 1.3,
    });
    expect(c.state.size).toBeCloseTo(100 * 1.3, 6);
    c.destroy();
  });
});
