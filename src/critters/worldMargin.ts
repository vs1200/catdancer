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
  // 回転 sway 系（dangle）: pivot(端寄り)を支点に振れるため、本体は最大辺の箱を回した範囲へ
  // 広がる。pivot の中心オフセット(<=半対角) + pivot→最遠コーナー(<=対角) を安全側に概算する
  // （アスペクト未知＝baseSize は最大辺のみのため係数で見積もる。実測はスクショで確認）。
  if (type.sway) {
    return Math.max(bodyRadius, 1.5 * type.baseSize);
  }
  const tail = type.hasTail ? type.tail : undefined;
  if (!tail) {
    return bodyRadius;
  }
  const w = type.baseSize;
  // ワールド空間トレイル: 尻尾は attach からどの向きにも全長ぶん伸びうる。
  // 中心→attach の距離 + 尻尾全長 = 中心から尻尾先端までの最大到達距離（縦は w で安全側に見積る）。
  const attachDist = Math.hypot((tail.attach.x - 0.5) * w, (tail.attach.y - 0.5) * w);
  const tailRadius = attachDist + tail.lengthFactor * w;
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
