import type { Vec2 } from "../core/vec2";
import type { WorldBounds } from "../core/worldBounds";
import type { Movement } from "../movement/Movement";
import type { Facing } from "./CritterState";

/**
 * オブジェクトに紐づく SE 識別子。値は AudioManager のバンクへ登録された SE id（audio/sounds.ts）。
 * v2 でオブジェクト別 SE（鳥のさえずり/魚の水音等）を足す際もこの 2 スロットで表現できる。
 */
export interface CritterSoundSet {
  /** 断続的に鳴らすワンショットSE識別子（鳴き声。例: ネズミのチューチュー）。 */
  voice?: string;
  /** 移動速度に連動して鳴らすループSE識別子（走行音/羽音など）。 */
  move?: string;
}

/**
 * 尻尾(MeshRope)の種別ごとの設定。
 * attach は本体テクスチャの正規化座標(0..1, 左上原点)。各 *Factor は表示幅に対する比率で、
 * サイズ変更に追従できるようにしている。実 px 変換と点列生成は tail/RopeTail が担う。
 */
export interface TailConfig {
  /** 付け根の付き位置（本体テクスチャ正規化座標, 0..1）。 */
  readonly attach: { readonly x: number; readonly y: number };
  /** 尻尾全長 = lengthFactor * 表示幅。 */
  readonly lengthFactor: number;
  /** 付け根の太さ = thicknessFactor * 表示幅。 */
  readonly thicknessFactor: number;
  /** 先端の揺れ振幅 = amplitudeFactor * 表示幅。 */
  readonly amplitudeFactor: number;
  /** 静止時の垂れ = sagFactor * 表示幅。 */
  readonly sagFactor: number;
  /** 点数 N（MeshRope 分割数, 2 以上）。 */
  readonly pointCount: number;
  /** 長さ方向の空間波数。 */
  readonly waveCount: number;
  /** 時間方向の角速度(rad/秒)。 */
  readonly speed: number;
  /** 振幅の先端方向への増大指数(>=1)。 */
  readonly amplitudeExponent: number;
}

/**
 * 回転 sway（振り子揺れ）の設定。dangle 系（猫じゃらし/おもちゃ）が使う。
 * pivot は本体テクスチャ正規化座標(0..1, 左上原点)＝振り子の支点。表示側(Critter)がこの点を
 * 軸に state.rotation を掛ける（foxtail=茎の根元＝左下寄り, toys=柄の端＝左寄り）。
 */
export interface SwayConfig {
  readonly pivot: { readonly x: number; readonly y: number };
}

/**
 * AutoMode が種別ごとに生成する spawn 計画（純データ）。位置/初速/向きと、割り当てる Movement を
 * 種別側で決める（mouse=CrossMovement, foxtail/toys=DangleMovement）。PixiJS 非依存。
 */
export interface AutoSpawnPlan {
  position: Vec2;
  velocity: Vec2;
  facing: Facing;
  movement: Movement;
}

/**
 * 向きの表現方式。
 * - 'flip': 進行方向(facing)で水平反転のみ（左右）。dangle 系・単純な種別の既定。
 * - 'rotate': 速度の heading へスプライトを360度回転し鼻先を進行方向へ向ける（上下含む全方位）。
 *   左半分(cos(heading)<0)は鏡像反転で上下を自然に保つ。右向きテクスチャ前提(defaultFacing=1)。
 *   ネズミが使う。将来 鳥/魚 も再利用可能。sway(dangle 系)とは併用しない。
 */
export type FaceMode = "flip" | "rotate";

/**
 * 種別定義。新オブジェクトは「この型を1つ定義 + アセット」で追加できる。
 */
export interface CritterType {
  /** 一意な種別 id（例: "mouse"）。 */
  readonly id: string;
  /** 人間向け表示名。 */
  readonly displayName: string;
  /** テクスチャ URL（BASE_URL 基点で解決済みの文字列）。 */
  readonly textureUrl: string;
  /** 表示時の最大辺(px)目安。 */
  readonly baseSize: number;
  /** 既定の向き（元画像の向き）。 */
  readonly defaultFacing: Facing;
  /** この種別の既定 Movement を生成する。critter ごとに独立インスタンスを持てるよう関数で渡す。 */
  readonly createMovement: () => Movement;
  /** SE セット（プレースホルダ）。 */
  readonly sounds: CritterSoundSet;
  /** 尻尾(MeshRope)など特殊描画が必要か。 */
  readonly hasTail: boolean;
  /** 尻尾設定。hasTail=true のとき参照する。 */
  readonly tail?: TailConfig;
  /**
   * 回転 sway 設定。あれば pivot 周りに state.rotation を掛ける（dangle 系）。
   * 無ければ回転しない（走る/追従系）。
   */
  readonly sway?: SwayConfig;
  /**
   * 進行方向で水平反転するか。省略/true=反転する、false=反転しない（dangle 系は
   * 回転 sway が主なので反転を強制しない）。faceMode='rotate' では参照されない。
   */
  readonly flipWithFacing?: boolean;
  /**
   * 向きの表現方式（省略時 'flip'）。走行系（ネズミ）は 'rotate'（進行方向へ360度回頭）。
   * 'rotate' は右向きテクスチャ前提で、sway(dangle 系)とは併用しない。
   */
  readonly faceMode?: FaceMode;
  /**
   * AutoMode 用の spawn 計画を生成する（種別ごとに位置/初速/Movement を決める）。
   * rng は [0,1) を返す関数（テスト差し替え可能）。未定義の種別は AutoMode の対象にしない。
   */
  readonly createAutoSpawn?: (world: WorldBounds, rng: () => number) => AutoSpawnPlan;
}
