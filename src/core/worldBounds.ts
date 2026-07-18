import type { Vec2 } from "./vec2";

export interface Viewport {
  width: number;
  height: number;
}

/**
 * 画面(viewport)に各辺 margin を足した論理領域(world)。
 * critter はこの拡張領域内を動けるため、画面外に完全に隠れられる。
 * 座標系は Scene の critters レイヤと一致し、画面可視域は [0,width]x[0,height]、
 * world は [minX,maxX]x[minY,maxY]（負の座標を含む）。
 */
export interface WorldBounds {
  readonly viewport: Viewport;
  readonly margin: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** 点の所在: 画面内 / 画面外(world内) / world外。 */
export type PointRegion = "inside" | "offscreen" | "outside";

export function createWorldBounds(viewport: Viewport, margin: number): WorldBounds {
  return {
    viewport,
    margin,
    minX: -margin,
    minY: -margin,
    maxX: viewport.width + margin,
    maxY: viewport.height + margin,
  };
}

/** 点が画面(viewport)内か。境界は内側扱い(inclusive)。 */
export function isInsideViewport(bounds: WorldBounds, p: Vec2): boolean {
  return p.x >= 0 && p.x <= bounds.viewport.width && p.y >= 0 && p.y <= bounds.viewport.height;
}

/** 点が world 領域内か。境界は内側扱い(inclusive)。 */
export function isInsideWorld(bounds: WorldBounds, p: Vec2): boolean {
  return p.x >= bounds.minX && p.x <= bounds.maxX && p.y >= bounds.minY && p.y <= bounds.maxY;
}

/**
 * 点が world 領域の外か（= 完全に画面外へ抜けた）。despawn 判定の述語（純関数）。
 * critter は中心座標で管理し margin は全パーツを隠せる幅なので、中心が world 外＝完全に不可視。
 */
export function isOutsideWorld(bounds: WorldBounds, p: Vec2): boolean {
  return !isInsideWorld(bounds, p);
}

/**
 * 点が「画面内 / 画面外(world内) / world外」のどれかを判定する。
 */
export function classifyPoint(bounds: WorldBounds, p: Vec2): PointRegion {
  if (!isInsideWorld(bounds, p)) {
    return "outside";
  }
  if (!isInsideViewport(bounds, p)) {
    return "offscreen";
  }
  return "inside";
}

/** 点を world 矩形内へクランプする。 */
export function clampToWorld(bounds: WorldBounds, p: Vec2): Vec2 {
  return {
    x: Math.min(Math.max(p.x, bounds.minX), bounds.maxX),
    y: Math.min(Math.max(p.y, bounds.minY), bounds.maxY),
  };
}
