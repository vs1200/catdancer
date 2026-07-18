import { describe, expect, it } from "vitest";
import {
  clampToWorld,
  classifyPoint,
  createWorldBounds,
  isInsideViewport,
  isInsideWorld,
} from "../../src/core/worldBounds";

const viewport = { width: 800, height: 600 };
const margin = 100;
const bounds = createWorldBounds(viewport, margin);

describe("worldBounds", () => {
  it("createWorldBounds は各辺に margin を足した矩形を作る", () => {
    expect(bounds.minX).toBe(-100);
    expect(bounds.minY).toBe(-100);
    expect(bounds.maxX).toBe(900);
    expect(bounds.maxY).toBe(700);
  });

  it("isInsideViewport は画面矩形（境界含む）を判定する", () => {
    expect(isInsideViewport(bounds, { x: 400, y: 300 })).toBe(true);
    expect(isInsideViewport(bounds, { x: 0, y: 0 })).toBe(true);
    expect(isInsideViewport(bounds, { x: 800, y: 600 })).toBe(true);
    expect(isInsideViewport(bounds, { x: -1, y: 300 })).toBe(false);
    expect(isInsideViewport(bounds, { x: 400, y: 601 })).toBe(false);
  });

  it("isInsideWorld は world 矩形（境界含む）を判定する", () => {
    expect(isInsideWorld(bounds, { x: -100, y: -100 })).toBe(true);
    expect(isInsideWorld(bounds, { x: 900, y: 700 })).toBe(true);
    expect(isInsideWorld(bounds, { x: -101, y: 0 })).toBe(false);
    expect(isInsideWorld(bounds, { x: 0, y: 701 })).toBe(false);
  });

  it("classifyPoint は inside / offscreen / outside を返す", () => {
    // 画面内
    expect(classifyPoint(bounds, { x: 400, y: 300 })).toBe("inside");
    // 画面外だが world 内（margin 帯）
    expect(classifyPoint(bounds, { x: -50, y: 300 })).toBe("offscreen");
    expect(classifyPoint(bounds, { x: 850, y: 300 })).toBe("offscreen");
    // world の外
    expect(classifyPoint(bounds, { x: -200, y: 300 })).toBe("outside");
    expect(classifyPoint(bounds, { x: 400, y: 800 })).toBe("outside");
  });

  it("classifyPoint 境界値: 画面端は inside、world 端は offscreen、その外は outside", () => {
    expect(classifyPoint(bounds, { x: 800, y: 600 })).toBe("inside");
    expect(classifyPoint(bounds, { x: 900, y: 300 })).toBe("offscreen");
    expect(classifyPoint(bounds, { x: 901, y: 300 })).toBe("outside");
  });

  it("clampToWorld は world 矩形内へ丸める", () => {
    expect(clampToWorld(bounds, { x: -500, y: 2000 })).toEqual({ x: -100, y: 700 });
    expect(clampToWorld(bounds, { x: 400, y: 300 })).toEqual({ x: 400, y: 300 });
  });
});
