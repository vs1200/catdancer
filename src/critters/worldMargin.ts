import type { CritterType } from "./CritterType";

/**
 * 1 種別を「本体＋尻尾先端まで」完全に画面外へ隠すのに必要な、中心からの最大到達距離(px)。
 *
 * critter は中心アンカーで管理され、world 境界まで進める中心座標は各辺 margin ぶん。
 * よって「中心が world 端にあるとき全パーツが画面外」＝「margin >= この半径」であれば隠れる。
 *
 * 尻尾(MeshRope)は付け根から後方(-x)へ length 伸びる。表示幅は baseSize(=最大辺) を基準にする
 * （幅=最大辺の素材で displayWidth=baseSize。縦長素材では実 displayWidth<baseSize となり
 *  本推定は安全側=やや大きめになる）。attach は本体正規化座標(0.5=中心)。
 */
export function critterHideRadius(type: CritterType): number {
  // 本体は最大辺=baseSize、中心アンカーなので半径は baseSize/2。
  const bodyRadius = type.baseSize / 2;
  const tail = type.hasTail ? type.tail : undefined;
  if (!tail) {
    return bodyRadius;
  }
  const w = type.baseSize;
  // 中心→付け根(後方) + 尻尾全長 = 中心から尻尾先端までの水平距離。
  const reachX = (0.5 - tail.attach.x + tail.lengthFactor) * w;
  // 付け根の縦オフセット + 静止たるみ + 揺れ振幅 = 縦方向の到達。
  const reachY = (Math.abs(tail.attach.y - 0.5) + tail.sagFactor + tail.amplitudeFactor) * w;
  const tailRadius = Math.hypot(reachX, reachY);
  return Math.max(bodyRadius, tailRadius);
}

/**
 * 登録種別群を完全に隠すのに必要な world margin(px)。表示中の最大 hideRadius を採用する。
 * 種別が無い/半径 0 のときは fallback を用いる。過大にならないよう ceil のみ（余分な係数なし）。
 */
export function computeWorldMargin(types: readonly CritterType[], fallback: number): number {
  let max = 0;
  for (const type of types) {
    const r = critterHideRadius(type);
    if (r > max) {
      max = r;
    }
  }
  return Math.ceil(max > 0 ? max : fallback);
}
