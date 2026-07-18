import type { Vec2 } from "../core/vec2";
import type { CritterState, Facing } from "./CritterState";
import { createCritterState } from "./CritterState";
import type { CritterType } from "./CritterType";

const registry = new Map<string, CritterType>();

/** 種別を登録する。id 重複はエラー。 */
export function registerCritterType(type: CritterType): void {
  if (registry.has(type.id)) {
    throw new Error(`種別 id が重複しています: ${type.id}`);
  }
  registry.set(type.id, type);
}

/** 登録済み種別を取得する。未登録はエラー。 */
export function getCritterType(id: string): CritterType {
  const type = registry.get(id);
  if (!type) {
    throw new Error(`未登録の種別 id です: ${id}`);
  }
  return type;
}

export function hasCritterType(id: string): boolean {
  return registry.has(id);
}

export function listCritterTypes(): CritterType[] {
  return [...registry.values()];
}

/** 主にテスト用。登録済み種別を全消去する。 */
export function clearCritterTypes(): void {
  registry.clear();
}

export interface CritterSpawnOptions {
  position?: Vec2;
  velocity?: Vec2;
  facing?: Facing;
  size?: number;
}

/**
 * 登録済み種別の既定値から CritterState を生成する純ファクトリ（PixiJS 非依存 = 単体テスト可能）。
 * 表示付き Critter の生成は Critter.ts の createCritter（PixiJS 依存）が本関数を利用する。
 * ここに pixi.js を import しないこと（純ロジックを分離してテスト容易性を保つため）。
 */
export function createCritterStateFromType(
  id: string,
  options?: CritterSpawnOptions,
): CritterState {
  const type = getCritterType(id);
  return createCritterState({
    typeId: type.id,
    position: options?.position ?? { x: 0, y: 0 },
    velocity: options?.velocity,
    facing: options?.facing ?? type.defaultFacing,
    size: options?.size ?? type.baseSize,
  });
}
