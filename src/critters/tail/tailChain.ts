import type { Vec2 } from "../../core/vec2";

/**
 * ワールド空間の尻尾チェーン（物理トレイル）の純ロジック（PixiJS/DOM 非依存 = Vitest 可能）。
 *
 * 尻尾を「頭(point0)を本体後方 attach に固定した Verlet 質点ばね鎖」としてモデル化する。
 * - 頭は外部（本体）から与える kinematic 点。各自由点は前フレームの変位を慣性として持ち、
 *   damping で減衰しながら距離拘束（隣接点をセグメント長へ引き戻す）を満たすよう緩和する。
 * - これにより「頭が動くと後方へ遅れてトレイルし、頭が止まると数フレームで静止する」。
 *   常時揺れ（sin）は無い＝動きは頭の移動からのみ生まれる。
 * - 座標はワールド（画面）空間。本体の回転からは独立（頭だけが本体 attach に追従する）。
 *
 * update は 1 アニメーションフレームにつき 1 回呼ぶ前提（damping はフレーム基準）。dt は
 * 重力項と暴走防止のクランプにのみ使う。配列は in-place 更新でフレーム毎のアロケーションを避ける。
 */
export interface TailChain {
  /** 点数 N（>=2, point0=頭）。 */
  readonly n: number;
  /** 隣接点間の静止長(px)。 */
  readonly segmentLength: number;
  /** 各点の現在位置 x（ワールド px）。 */
  readonly x: number[];
  /** 各点の現在位置 y（ワールド px）。 */
  readonly y: number[];
  /** 各点の前フレーム位置 x（Verlet の暗黙速度 = x-px）。 */
  readonly px: number[];
  /** 各点の前フレーム位置 y。 */
  readonly py: number[];
}

/** {@link updateTailChain} の物理パラメータ。 */
export interface TailChainParams {
  /** 慣性の保持率(0..1)。大きいほど尾を長く引く（1 に近いほど収束が遅い）。 */
  readonly damping: number;
  /** 重力加速度(px/s^2, +y=画面下)。トップダウンのネズミは 0。 */
  readonly gravity: number;
  /** 距離拘束の緩和反復回数。大きいほど伸びにくく張った鎖になる。 */
  readonly constraintIterations: number;
  /** dt のクランプ上限(秒)。タブ復帰などの巨大 dt で暴走させない。 */
  readonly maxDt: number;
}

/** ゼロ割ガード用の微小値。 */
const EPS = 1e-6;

/**
 * 本体ローカルの attach オフセット (localX, localY) を、本体の view と同じ変換
 * （scale(scaleX, mirrorY?-1:1) → rotate(angle) → translate(pos)）でワールド座標へ写す純関数。
 *
 * faceMode='rotate' では angle=heading・scaleX=defaultFacing・mirrorY=左半分で true。
 * faceMode='flip' では angle=0・scaleX=facing*defaultFacing・mirrorY=false を渡す。
 */
export function computeTailAnchor(
  posX: number,
  posY: number,
  angle: number,
  mirrorY: boolean,
  scaleX: number,
  localX: number,
  localY: number,
): Vec2 {
  const ax = localX * scaleX;
  const ay = localY * (mirrorY ? -1 : 1);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: posX + ax * c - ay * s, y: posY + ax * s + ay * c };
}

/**
 * チェーンを生成し、頭から後方単位ベクトル (backX, backY) 方向へ真っ直ぐ並べて初期化する。
 * spawn 直後に「本体後方から真っ直ぐ伸びた尻尾」を即座に見せ、原点からの収束グリッチを避ける。
 */
export function createTailChain(
  pointCount: number,
  segmentLength: number,
  headX: number,
  headY: number,
  backX: number,
  backY: number,
): TailChain {
  const n = Math.max(2, Math.floor(pointCount));
  const x = new Array<number>(n);
  const y = new Array<number>(n);
  const px = new Array<number>(n);
  const py = new Array<number>(n);
  const chain: TailChain = { n, segmentLength, x, y, px, py };
  resetTailChain(chain, headX, headY, backX, backY);
  return chain;
}

/**
 * チェーンを頭から後方 (backX, backY) 方向へ真っ直ぐ並べ直し、速度を 0 にする（前位置=現在位置）。
 * spawn 初期化と、頭が全長を超えて瞬間移動した際（resize/タブ復帰）の暴走リセットに使う。
 */
export function resetTailChain(
  chain: TailChain,
  headX: number,
  headY: number,
  backX: number,
  backY: number,
): void {
  const { n, segmentLength, x, y, px, py } = chain;
  for (let i = 0; i < n; i++) {
    const cx = headX + backX * segmentLength * i;
    const cy = headY + backY * segmentLength * i;
    x[i] = cx;
    y[i] = cy;
    px[i] = cx;
    py[i] = cy;
  }
}

/**
 * チェーンを 1 ステップ進める（in-place）。
 * 1) 自由点(i>=1)を Verlet 積分（前変位 * damping を慣性として加算、重力を加える）。
 * 2) 頭(point0)を attach 位置へピン留め（速度 0 の kinematic 点）。
 * 3) 距離拘束を反復緩和し、各セグメント長を segmentLength へ引き戻す（頭は固定のまま）。
 *
 * dt<=0 は頭のピン留めだけ行って戻る（tab 復帰直後の 0/負値で NaN・暴走を出さない）。
 */
export function updateTailChain(
  chain: TailChain,
  headX: number,
  headY: number,
  dt: number,
  params: TailChainParams,
): void {
  const { n, segmentLength, x, y, px, py } = chain;

  // 非正 dt: 頭だけ固定して何もしない。
  if (!(dt > 0)) {
    x[0] = headX;
    y[0] = headY;
    px[0] = headX;
    py[0] = headY;
    return;
  }

  const h = dt > params.maxDt ? params.maxDt : dt;
  const damping = params.damping;
  const gy = params.gravity * h * h;

  // 1) Verlet 積分（頭 i=0 は外部固定なので i>=1）。
  for (let i = 1; i < n; i++) {
    const vx = (x[i] - px[i]) * damping;
    const vy = (y[i] - py[i]) * damping;
    px[i] = x[i];
    py[i] = y[i];
    x[i] += vx;
    y[i] += vy + gy;
  }

  // 2) 頭をピン留め（前位置も一致させ速度 0 の kinematic に）。
  x[0] = headX;
  y[0] = headY;
  px[0] = headX;
  py[0] = headY;

  // 3) 距離拘束の緩和。頭に近い側から解き、頭(セグメント 0)は子のみ動かして固定を保つ。
  const iters = params.constraintIterations;
  for (let k = 0; k < iters; k++) {
    for (let i = 0; i < n - 1; i++) {
      let dx = x[i + 1] - x[i];
      let dy = y[i + 1] - y[i];
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < EPS) {
        // 完全重なりは NaN を生むので後方へ僅かにずらして解く。
        dx = segmentLength;
        dy = 0;
        dist = segmentLength;
      }
      const diff = (dist - segmentLength) / dist;
      if (i === 0) {
        // 頭は固定。子(i+1)だけをセグメント長へ引き寄せる。
        x[i + 1] -= dx * diff;
        y[i + 1] -= dy * diff;
      } else {
        const hx = dx * 0.5 * diff;
        const hy = dy * 0.5 * diff;
        x[i] += hx;
        y[i] += hy;
        x[i + 1] -= hx;
        y[i + 1] -= hy;
      }
    }
  }
}
