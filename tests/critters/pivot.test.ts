import { describe, expect, it } from "vitest";
import { pivotOffsetPx } from "../../src/critters/pivot";

describe("pivotOffsetPx", () => {
  it("中心(0.5,0.5)はオフセット(0,0)", () => {
    expect(pivotOffsetPx({ x: 0.5, y: 0.5 }, 200, 100)).toEqual({ x: 0, y: 0 });
  });

  it("左下(0,1)は (-w/2, +h/2)", () => {
    expect(pivotOffsetPx({ x: 0, y: 1 }, 200, 100)).toEqual({ x: -100, y: 50 });
  });

  it("右上(1,0)は (+w/2, -h/2)", () => {
    expect(pivotOffsetPx({ x: 1, y: 0 }, 200, 100)).toEqual({ x: 100, y: -50 });
  });

  it("表示寸法に比例する（サイズ変更に追従）", () => {
    const a = pivotOffsetPx({ x: 0.14, y: 0.85 }, 360, 213);
    const b = pivotOffsetPx({ x: 0.14, y: 0.85 }, 720, 426);
    expect(b.x).toBeCloseTo(a.x * 2, 6);
    expect(b.y).toBeCloseTo(a.y * 2, 6);
  });
});
