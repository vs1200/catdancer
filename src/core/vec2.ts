/**
 * 2D ベクトルの純ロジック（PixiJS 非依存）。
 * すべて非破壊（新しい {@link Vec2} を返す）で、Vitest で単体テストしやすい形にする。
 */
export interface Vec2 {
  x: number;
  y: number;
}

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function clone(v: Vec2): Vec2 {
  return { x: v.x, y: v.y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function lengthSquared(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 単位ベクトル化。ゼロベクトルは NaN を避けて {x:0,y:0} を返す。
 */
export function normalize(v: Vec2): Vec2 {
  const len = length(v);
  if (len === 0) {
    return { x: 0, y: 0 };
  }
  return { x: v.x / len, y: v.y / len };
}

/**
 * 線形補間。t=0 で a、t=1 で b。範囲外の t もそのまま外挿する。
 */
export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
