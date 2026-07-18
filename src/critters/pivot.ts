import type { Vec2 } from "../core/vec2";

/**
 * 回転 sway の支点（振り子の軸）を、本体テクスチャ正規化座標(0..1, 左上原点)から
 * スプライト中心原点(anchor=0.5)基準のローカル px オフセットへ変換する純関数。
 *
 * Critter は sprite を anchor 0.5（＝中心が Container 原点）で置くため、正規化 (0.5,0.5)=中心が
 * オフセット (0,0) になる。回転はこの pivot 周りに掛けると「支点を持って振る」見え方になる
 * （foxtail=茎の根元＝左下寄り, toys=柄の端＝左寄り）。表示寸法に比例させサイズ変更へ追従する。
 *
 * 例: pivot=(0,1)（左下）, w=200,h=100 → (-100, 50)。pivot=(0.5,0.5) → (0,0)。
 */
export function pivotOffsetPx(
  pivot: { readonly x: number; readonly y: number },
  displayWidth: number,
  displayHeight: number,
): Vec2 {
  return {
    x: (pivot.x - 0.5) * displayWidth,
    y: (pivot.y - 0.5) * displayHeight,
  };
}
