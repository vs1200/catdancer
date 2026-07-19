import type { Container as PixiContainer, Texture } from "pixi.js";
import { Container, Sprite } from "pixi.js";
import { computeSizeScale } from "../core/sizeScale";
import type { Viewport } from "../core/worldBounds";
import { FLEE_DEFAULT_SPEED, FleeMovement } from "../movement/FleeMovement";
import type { Movement, MovementContext } from "../movement/Movement";
import type { CritterState, Facing } from "./CritterState";
import type { FaceMode, SwayConfig, TailConfig } from "./CritterType";
import { type HeadingUpdateOptions, isMirroredHeading, updateHeading } from "./heading";
import { pivotOffsetPx } from "./pivot";
import type { CritterSpawnOptions } from "./registry";
import { createCritterStateFromType, getCritterType } from "./registry";
import type { RopeTail } from "./tail/RopeTail";
import { createRopeTail } from "./tail/RopeTail";
import { computeTailAnchor } from "./tail/tailChain";

/**
 * faceMode='rotate' の回頭パラメータ。
 * holdMinSpeed: これ以下の速さでは回頭せず向きを保つ（静止で回らない）。
 * smoothTime: 回頭の時定数。生き物らしく素早いが滑らかに旋回する値。
 */
const HEADING_UPDATE_OPTS: HeadingUpdateOptions = { holdMinSpeed: 6, smoothTime: 0.06 };

/** 尻尾の頭ワールド座標と後方単位ベクトル（トレイル方向）。 */
interface TailHead {
  headX: number;
  headY: number;
  backX: number;
  backY: number;
}

export interface CritterViewOptions {
  /** 素材の既定向き。反転式 scale.x = facing * defaultFacing に用いる。 */
  defaultFacing?: Facing;
  /** 尻尾設定。あれば MeshRope 尻尾をワールド空間で本体後方にトレイルさせる。 */
  tail?: TailConfig;
  /**
   * 尻尾テクスチャ（省略時は白フォールバック）。多数 spawn する AutoMode でもテクスチャを共有し、
   * 尻尾の都度生成/リークを避ける（共有テクスチャは despawn で破棄しない）。
   */
  tailTexture?: Texture;
  /** 回転 sway 設定。あれば pivot 周りに state.rotation を反映する（dangle 系）。 */
  sway?: SwayConfig;
  /** 進行方向で水平反転するか（省略/true=反転。dangle 系は false）。 */
  flipWithFacing?: boolean;
  /**
   * 向きの表現方式（省略時 'flip'）。'rotate' は速度の heading へ全方位回転する（ネズミ）。
   * 右向きテクスチャ前提で、sway とは併用しない。
   */
  faceMode?: FaceMode;
}

/**
 * CritterState(純) と PixiJS 表示(Container + Sprite + optional 尻尾)を結ぶ実体。
 * update() で Movement を適用し、state を表示へ同期する（位置・左右反転/回転・尻尾トレイル）。
 *
 * 反転/回転は Container(view) に集約する（sway など内側要素のため）:
 *   flip: view.scale.x = facing * defaultFacing
 *   rotate: view.rotation = heading, view.scale.y = 鏡像なら -1
 *
 * 尻尾（MeshRope）は本体 view の子ではなく、Scene の critters レイヤ（ワールド空間）へ別途置く。
 * 頭(point0)だけを本体後方 attach のワールド座標に固定し、鎖はワールドでトレイルさせるため、
 * 本体が回転しても尻尾は一緒に回らず「進行方向の逆へ遅れて流れる」自然な動きになる。
 */
export class Critter {
  readonly state: CritterState;
  readonly view: Container;
  private readonly sprite: Sprite;
  /** 現在の動き。捕獲フィードバック（{@link flee}）で FleeMovement へ差し替えられる。 */
  private movement: Movement;
  /** テクスチャ実寸から baseSize(最大辺) に合わせる基準スケール。 */
  private readonly baseScale: number;
  /** 素材の既定向き（反転式で使用）。 */
  private readonly defaultFacing: Facing;
  /** 進行方向で水平反転するか（dangle 系は false）。faceMode='rotate' では未使用。 */
  private readonly flipWithFacing: boolean;
  /** 向きの表現方式（'flip'=水平反転 / 'rotate'=全方位回転）。 */
  private readonly faceMode: FaceMode;
  /** 尻尾（無ければ null）。mesh はワールド空間（critters レイヤ）に置く。 */
  private readonly tail: RopeTail | null;
  /** 尻尾 attach の本体ローカルオフセット(px, 変換前)。頭ワールド座標の算出に使う。 */
  private readonly tailLocalX: number = 0;
  private readonly tailLocalY: number = 0;
  /** 回転 sway 用の内側 Container（pivot を支点に回す。無ければ null）。 */
  private readonly swayContainer: Container | null;

  constructor(
    state: CritterState,
    texture: Texture,
    movement: Movement,
    options?: CritterViewOptions,
  ) {
    this.state = state;
    this.movement = movement;
    this.defaultFacing = options?.defaultFacing ?? 1;
    this.flipWithFacing = options?.flipWithFacing ?? true;
    this.faceMode = options?.faceMode ?? "flip";

    this.view = new Container();
    this.sprite = new Sprite(texture);
    this.sprite.anchor.set(0.5);

    const maxSide = Math.max(texture.width, texture.height) || 1;
    this.baseScale = state.size / maxSide;
    this.sprite.scale.set(this.baseScale);
    const displayWidth = texture.width * this.baseScale;
    const displayHeight = texture.height * this.baseScale;

    // 尻尾: attach のローカルオフセットを控え、初期の頭ワールド座標で物理チェーンを起こす。
    // mesh は view には足さない（Scene がワールド空間の critters レイヤへ本体の背面として置く）。
    if (options?.tail) {
      this.tailLocalX = (options.tail.attach.x - 0.5) * displayWidth;
      this.tailLocalY = (options.tail.attach.y - 0.5) * displayHeight;
      this.tail = createRopeTail(
        options.tail,
        displayWidth,
        this.computeTailHead(),
        options.tailTexture,
      );
    } else {
      this.tail = null;
    }

    // 回転 sway があれば、pivot を支点に回すため sprite を内側 Container で包む。
    // Container.pivot=position=pivotOffset とすると、その点は親座標で固定され、rotation は
    // その点周りに掛かる（＝支点を持って振る見え方）。sway 無しなら sprite を直接載せる。
    if (options?.sway) {
      const off = pivotOffsetPx(options.sway.pivot, displayWidth, displayHeight);
      this.swayContainer = new Container();
      this.swayContainer.pivot.set(off.x, off.y);
      this.swayContainer.position.set(off.x, off.y);
      this.swayContainer.addChild(this.sprite);
      this.view.addChild(this.swayContainer);
    } else {
      this.swayContainer = null;
      this.view.addChild(this.sprite);
    }

    this.syncView();
  }

  /** 尻尾 MeshRope（ワールド空間・本体背面に置く）。無ければ null。Scene が add/remove する。 */
  get tailMesh(): PixiContainer | null {
    return this.tail?.mesh ?? null;
  }

  /** 尻尾先端のワールド座標（静止検証・DEV フック用）。尻尾が無ければ null。 */
  get tailTip(): { x: number; y: number } | null {
    return this.tail?.tip ?? null;
  }

  /** 表示 Container が破棄済みか（外部 despawn 後の自己修復判定に使う）。 */
  get destroyed(): boolean {
    return this.view.destroyed;
  }

  /** 現行 movement が退場アニメを完了したか（movement 非対応なら false）。despawn 判定の OR 項。 */
  get hasExpired(): boolean {
    return this.movement.hasExpired?.() ?? false;
  }

  update(dtSeconds: number, ctx: MovementContext): void {
    // ctx.speedScale で critter 全体を 1 つのスケール時計で動かす（movement/回頭/尻尾すべてに
    // 同じ scaledDt を渡す＝視覚的に一貫）。未指定は 1 として扱い、scale=1 なら scaledDt===dtSeconds
    // なので既存挙動は完全に不変（後方互換）。非正 dt でも scale 乗算で符号は保たれるため、
    // movement 側の非正 dt ガードはそのまま効く。
    // 割り切り: state.velocity は movement が設定した値のまま（等速 movement では velocity 自体は
    // スケールされず、実移動量 velocity*scaledDt にのみ倍率が乗る）。視覚速度を主眼とし、
    // 走行音レベルの完全連動までは求めない。
    const scale = ctx.speedScale ?? 1;
    const scaledDt = dtSeconds * scale;
    this.movement.update(this.state, scaledDt, ctx);

    // rotate 系は速度ベクトルから heading を平滑更新（静止時は保持＝くるくる回らない）。
    if (this.faceMode === "rotate") {
      this.state.heading = updateHeading(
        this.state.heading,
        this.state.velocity.x,
        this.state.velocity.y,
        scaledDt,
        HEADING_UPDATE_OPTS,
      );
    }

    // 尻尾は最新の本体位置/向きから頭ワールド座標を求め、ワールド空間でトレイルさせる。
    if (this.tail) {
      const head = this.computeTailHead();
      this.tail.update(head.headX, head.headY, head.backX, head.backY, scaledDt);
    }

    this.syncView();
  }

  /**
   * 捕獲フィードバック: 動きを FleeMovement へ差し替え、指定点(from)から離れる向きへ高速で逃げる。
   * 逃走方向は「critter 中心 - from」＝タップ点の逆方向。from が中心とほぼ一致する場合は
   * FleeMovement が +x へフォールバックする（任意方向）。以降 update は FleeMovement が駆動し、
   * world 外へ抜けて既存 despawn 経路で消える。
   */
  flee(fromWorldX: number, fromWorldY: number, speed: number = FLEE_DEFAULT_SPEED): void {
    this.movement = new FleeMovement({
      dirX: this.state.position.x - fromWorldX,
      dirY: this.state.position.y - fromWorldY,
      speed,
    });
  }

  /**
   * 尻尾の頭（本体後方 attach）のワールド座標と後方トレイル方向を、本体 view と同じ変換で求める。
   * - rotate: angle=heading・scaleX=defaultFacing・mirrorY=左半分。後方 = -heading 方向。
   * - flip  : angle=0・scaleX=facing*defaultFacing（反転式）。後方 = -scaleX 方向（±x）。
   */
  private computeTailHead(): TailHead {
    const { position } = this.state;
    const rotate = this.faceMode === "rotate";
    const angle = rotate ? this.state.heading : 0;
    const mirrorY = rotate ? isMirroredHeading(angle) : false;
    const scaleX = rotate
      ? this.defaultFacing
      : this.flipWithFacing
        ? this.state.facing * this.defaultFacing
        : this.defaultFacing;
    const anchor = computeTailAnchor(
      position.x,
      position.y,
      angle,
      mirrorY,
      scaleX,
      this.tailLocalX,
      this.tailLocalY,
    );
    const backX = rotate ? -Math.cos(angle) : -scaleX;
    const backY = rotate ? -Math.sin(angle) : 0;
    return { headX: anchor.x, headY: anchor.y, backX, backY };
  }

  /**
   * state → 表示同期。位置反映と向きの反映を行う（尻尾はワールド空間で別途更新済み）。
   * - faceMode='rotate': view を heading へ回転し、左半分は鏡像反転(scale.y=-1)で上下を自然に保つ。
   *   右向きテクスチャ前提のため scale.x は反転せず defaultFacing(=1) のまま（heading が全方位を表現）。
   * - faceMode='flip'（既定）: 回転せず facing*defaultFacing で水平反転のみ。sway があれば
   *   pivot 周りの回転(state.rotation)を内側 Container に反映する。
   */
  private syncView(): void {
    this.view.position.set(this.state.position.x, this.state.position.y);
    if (this.faceMode === "rotate") {
      this.view.rotation = this.state.heading;
      this.view.scale.set(this.defaultFacing, isMirroredHeading(this.state.heading) ? -1 : 1);
    } else {
      this.view.rotation = 0;
      this.view.scale.set(
        this.flipWithFacing ? this.state.facing * this.defaultFacing : this.defaultFacing,
        1,
      );
    }
    if (this.swayContainer) {
      this.swayContainer.rotation = this.state.rotation;
    }
  }

  /**
   * Critter を完全破棄する（リークなく解放）。
   * - view.destroy({children:true}) で Sprite を破棄する。
   * - 尻尾 mesh は view の子ではなくワールド空間に置くため、別途 tail.destroy() で MeshRope
   *   （geometry/shader）を破棄する。共有テクスチャは破棄しない（mesh.destroy 既定 texture=false）。
   */
  destroy(): void {
    this.view.destroy({ children: true });
    this.tail?.destroy();
  }
}

/** {@link spawnCritter} のパラメータ。 */
export interface SpawnCritterParams {
  /** 種別 id（レジストリ登録済み）。 */
  typeId: string;
  /** 本体テクスチャ（呼び出し側が Assets.load 済みのものを渡す。複数体で共有する）。 */
  bodyTexture: Texture;
  /** 尻尾テクスチャ（省略時は白フォールバック）。多数 spawn では共有テクスチャを渡す。 */
  tailTexture?: Texture;
  /** Movement を差し替える（省略時は種別の既定 createMovement()）。 */
  movement?: Movement;
  /** 初期 state（位置/速度/向き/サイズ）。 */
  spawn?: CritterSpawnOptions;
  /**
   * [UR4-1] 現在の viewport（CSS px）。渡すと baseSize（または spawn.size）へ解像度非依存の
   * sizeScale（{@link computeSizeScale}）を乗じ、画面に占める割合を解像度に対して一定化する。
   * 省略時は等倍（後方互換＝既存/テストの spawnCritter 呼び出しは挙動不変）。
   */
  viewport?: Viewport;
  /**
   * [UR4-2] ユーザー指定の表示サイズ倍率（種別×モード個別）。UR4-1 の viewport sizeScale の上へ
   * さらに乗せる純増倍率で、size = baseSize × sizeScale(viewport) × sizeMultiplier になる。
   * 省略/undefined は 1（後方互換＝既存/テストの spawnCritter 呼び出しは挙動不変）。state.size に
   * 載るので表示スケールだけでなく当たり半径(hitRadius)・尻尾表示幅もこの倍率へ追従する。
   */
  sizeMultiplier?: number;
}

/**
 * 種別 id から表示付き Critter を生成するファクトリ（PixiJS 依存）。
 *
 * Movement を差し替え可能にしてあるため、同じ種別を ManualMode（追従）と AutoMode（横断）で
 * 使い回せる。将来オブジェクト種別を足す際は typeId を変えるだけでよい（拡張点）。
 * defaultFacing・尻尾設定は種別定義から表示層へ橋渡しする。
 */
export function spawnCritter(params: SpawnCritterParams): Critter {
  const type = getCritterType(params.typeId);
  // [UR4-1] 解像度非依存化はここ 1 点に集約する。viewport が渡されたら baseSize（明示 spawn.size が
  // あればそれ）に sizeScale を乗じて state.size を決める。size を state に載せるので、表示スケールだけで
  // なく当たり半径(hitRadius)・尻尾表示幅・world margin 算出もサイズへ追従する（当たり判定と見た目が一致）。
  // viewport 未指定なら scale=1 で従来どおり（テスト/既存呼び出しは不変）。manual foxtail は本経路を通らず
  // 自前で viewport 相対に描くため、ここで係数を掛けても二重スケールにならない。
  const scale = params.viewport ? computeSizeScale(params.viewport) : 1;
  const baseSize = params.spawn?.size ?? type.baseSize;
  // [UR4-2] ユーザー指定倍率を viewport sizeScale の上へ乗せる（省略時 1＝後方互換）。
  const state = createCritterStateFromType(params.typeId, {
    ...params.spawn,
    size: baseSize * scale * (params.sizeMultiplier ?? 1),
  });
  const movement = params.movement ?? type.createMovement();
  return new Critter(state, params.bodyTexture, movement, {
    defaultFacing: type.defaultFacing,
    tail: type.hasTail ? type.tail : undefined,
    tailTexture: params.tailTexture,
    sway: type.sway,
    flipWithFacing: type.flipWithFacing,
    faceMode: type.faceMode,
  });
}
