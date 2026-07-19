/**
 * 種別別SE ルーティングの中核となる純ロジック（PixiJS/Web Audio 非依存 = Vitest で単体テスト可能）。
 * 画面上の critter 群を typeId ごとにまとめ、「その種別が居るか(present)」「その種別の最大速度」を
 * 集計する。AutoMode はこの集計を種別ごとの CritterAudioController の駆動に使う。
 */

/**
 * critter が SE 集計に必要とする最小状態（typeId / velocity / position.x）。CritterState はこれに構造適合する。
 * [UR4-4] position.x は代表 pan（左右定位）算出のために最速個体の x を追う用途で読む。
 */
export interface CritterAudioState {
  typeId: string;
  velocity: { x: number; y: number };
  position: { x: number };
}

/** 1 種別ぶんのグループ集計値（最大速度＋その最速個体の代表 x）。 */
export interface TypeAudioGroup {
  /** その種別の最大速度(px/秒)。 */
  maxSpeed: number;
  /** [UR4-4] その最速個体の x(px)。代表 pan の算出に使う。 */
  x: number;
}

/** 1 種別ぶんの SE 駆動値。present=false のとき move レベル0・voice 非発火にする。 */
export interface TypeAudioDrive {
  /** その種別の critter が 1 体以上居るか。 */
  present: boolean;
  /** その種別の最大速度(px/秒)。present=false のとき 0。 */
  maxSpeed: number;
  /**
   * [UR4-4] 代表 x(px)＝最速個体の x。present=false のときは 0 を置くが、この値は使われない
   * （呼び出し側は present=false なら pan を無視して無音化するため、x=0 の pan 定位は起きない）。
   */
  x: number;
}

/**
 * critter 群を typeId でグループ化し、種別ごとの「最大速度(px/秒)＋その最速個体の代表 x(px)」を返す純関数。
 * [UR4-4] x は最大速度を更新した個体のものを併走記録する（最も活発に鳴っている個体の位置で左右定位するため）。
 * 出現している種別のみを Map に含める（未出現種別はキーを持たない）。
 */
export function groupMaxSpeedByType(
  states: readonly CritterAudioState[],
): Map<string, TypeAudioGroup> {
  const maxByType = new Map<string, TypeAudioGroup>();
  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    const speed = Math.hypot(s.velocity.x, s.velocity.y);
    const prev = maxByType.get(s.typeId);
    if (prev === undefined || speed > prev.maxSpeed) {
      maxByType.set(s.typeId, { maxSpeed: speed, x: s.position.x });
    }
  }
  return maxByType;
}

/**
 * グループ集計から特定 typeId の駆動値を得る。
 * 出現していない種別は present=false, maxSpeed=0, x=0（＝その種別のSEは鳴らさない）。
 * present=false のとき x は使われない（呼び出し側が pan を無視して無音化するため値は無意味）。
 */
export function driveForType(
  maxByType: ReadonlyMap<string, TypeAudioGroup>,
  typeId: string,
): TypeAudioDrive {
  const group = maxByType.get(typeId);
  if (group === undefined) {
    return { present: false, maxSpeed: 0, x: 0 };
  }
  return { present: true, maxSpeed: group.maxSpeed, x: group.x };
}
