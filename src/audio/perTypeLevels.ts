/**
 * 種別別SE ルーティングの中核となる純ロジック（PixiJS/Web Audio 非依存 = Vitest で単体テスト可能）。
 * 画面上の critter 群を typeId ごとにまとめ、「その種別が居るか(present)」「その種別の最大速度」を
 * 集計する。AutoMode はこの集計を種別ごとの CritterAudioController の駆動に使う。
 */

/** critter が SE 集計に必要とする最小状態（typeId と velocity のみ）。CritterState はこれに構造適合する。 */
export interface CritterAudioState {
  typeId: string;
  velocity: { x: number; y: number };
}

/** 1 種別ぶんの SE 駆動値。present=false のとき move レベル0・voice 非発火にする。 */
export interface TypeAudioDrive {
  /** その種別の critter が 1 体以上居るか。 */
  present: boolean;
  /** その種別の最大速度(px/秒)。present=false のとき 0。 */
  maxSpeed: number;
}

/**
 * critter 群を typeId でグループ化し、種別ごとの最大速度(px/秒)を返す純関数。
 * 出現している種別のみを Map に含める（未出現種別はキーを持たない）。
 */
export function groupMaxSpeedByType(states: readonly CritterAudioState[]): Map<string, number> {
  const maxByType = new Map<string, number>();
  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    const speed = Math.hypot(s.velocity.x, s.velocity.y);
    const prev = maxByType.get(s.typeId);
    if (prev === undefined || speed > prev) {
      maxByType.set(s.typeId, speed);
    }
  }
  return maxByType;
}

/**
 * グループ集計から特定 typeId の駆動値を得る。
 * 出現していない種別は present=false, maxSpeed=0（＝その種別のSEは鳴らさない）。
 */
export function driveForType(
  maxByType: ReadonlyMap<string, number>,
  typeId: string,
): TypeAudioDrive {
  const maxSpeed = maxByType.get(typeId);
  if (maxSpeed === undefined) {
    return { present: false, maxSpeed: 0 };
  }
  return { present: true, maxSpeed };
}
