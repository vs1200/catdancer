import { describe, expect, it } from "vitest";
import {
  add,
  clone,
  distance,
  dot,
  length,
  lengthSquared,
  lerp,
  normalize,
  scale,
  sub,
  vec2,
} from "../../src/core/vec2";

describe("vec2", () => {
  it("vec2/clone は独立したオブジェクトを作る", () => {
    const v = vec2(3, 4);
    const c = clone(v);
    expect(c).toEqual({ x: 3, y: 4 });
    expect(c).not.toBe(v);
  });

  it("add/sub は成分ごとに計算する（負方向含む）", () => {
    expect(add(vec2(1, 2), vec2(3, -5))).toEqual({ x: 4, y: -3 });
    expect(sub(vec2(1, 2), vec2(3, -5))).toEqual({ x: -2, y: 7 });
  });

  it("scale は負・ゼロ倍も扱える", () => {
    expect(scale(vec2(2, -3), 2)).toEqual({ x: 4, y: -6 });
    expect(scale(vec2(2, -3), 0)).toEqual({ x: 0, y: -0 });
  });

  it("length / lengthSquared / distance", () => {
    expect(length(vec2(3, 4))).toBe(5);
    expect(lengthSquared(vec2(3, 4))).toBe(25);
    expect(distance(vec2(0, 0), vec2(3, 4))).toBe(5);
  });

  it("dot 内積", () => {
    expect(dot(vec2(1, 2), vec2(3, 4))).toBe(11);
  });

  it("normalize は単位ベクトルを返し、ゼロベクトルは (0,0) で NaN を避ける", () => {
    expect(normalize(vec2(0, 5))).toEqual({ x: 0, y: 1 });
    expect(normalize(vec2(-3, -4))).toEqual({ x: -0.6, y: -0.8 });
    expect(normalize(vec2(0, 0))).toEqual({ x: 0, y: 0 });
  });

  it("lerp は端点と外挿を扱う", () => {
    const a = vec2(0, 0);
    const b = vec2(10, -20);
    expect(lerp(a, b, 0)).toEqual({ x: 0, y: 0 });
    expect(lerp(a, b, 1)).toEqual({ x: 10, y: -20 });
    expect(lerp(a, b, 0.5)).toEqual({ x: 5, y: -10 });
    expect(lerp(a, b, 2)).toEqual({ x: 20, y: -40 });
  });
});
