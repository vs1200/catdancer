import { describe, expect, it } from "vitest";
import {
  computeTailAnchor,
  createTailChain,
  resetTailChain,
  type TailChain,
  type TailChainParams,
  updateTailChain,
} from "../../../src/critters/tail/tailChain";

const params: TailChainParams = {
  damping: 0.82,
  gravity: 0,
  constraintIterations: 16,
  maxDt: 1 / 30,
};

/** セグメント長の配列（隣接点間の距離）。 */
function segmentLengths(chain: TailChain): number[] {
  const out: number[] = [];
  for (let i = 0; i < chain.n - 1; i++) {
    out.push(Math.hypot(chain.x[i + 1] - chain.x[i], chain.y[i + 1] - chain.y[i]));
  }
  return out;
}

/** 全点の 1 フレーム暗黙速度 |x-px| の最大値（静止収束の指標）。 */
function maxSpeed(chain: TailChain): number {
  let m = 0;
  for (let i = 0; i < chain.n; i++) {
    m = Math.max(m, Math.hypot(chain.x[i] - chain.px[i], chain.y[i] - chain.py[i]));
  }
  return m;
}

function allFinite(chain: TailChain): boolean {
  for (let i = 0; i < chain.n; i++) {
    if (!Number.isFinite(chain.x[i]) || !Number.isFinite(chain.y[i])) return false;
    if (!Number.isFinite(chain.px[i]) || !Number.isFinite(chain.py[i])) return false;
  }
  return true;
}

describe("computeTailAnchor", () => {
  it("angle=0・mirror なし・scaleX=1 は pos + local", () => {
    const a = computeTailAnchor(100, 50, 0, false, 1, -30, 20);
    expect(a.x).toBeCloseTo(70, 9);
    expect(a.y).toBeCloseTo(70, 9);
  });

  it("angle=π/2 は local を 90°回転する（(lx,ly)→(-ly,lx)）", () => {
    const a = computeTailAnchor(0, 0, Math.PI / 2, false, 1, -30, 20);
    expect(a.x).toBeCloseTo(-20, 9);
    expect(a.y).toBeCloseTo(-30, 9);
  });

  it("mirrorY は local.y の符号を反転する（belly を下に保つ用途）", () => {
    const a = computeTailAnchor(0, 0, 0, true, 1, -30, 20);
    expect(a.x).toBeCloseTo(-30, 9);
    expect(a.y).toBeCloseTo(-20, 9);
  });

  it("scaleX<0（左向き flip）は local.x の符号を反転する", () => {
    const a = computeTailAnchor(0, 0, 0, false, -1, -30, 20);
    expect(a.x).toBeCloseTo(30, 9);
    expect(a.y).toBeCloseTo(20, 9);
  });
});

describe("createTailChain / resetTailChain", () => {
  it("点数を返し（<2 は 2 にクランプ）頭は head、以降は後方へ segLen 間隔で並ぶ", () => {
    const chain = createTailChain(5, 10, 100, 200, -1, 0);
    expect(chain.n).toBe(5);
    expect(chain.x[0]).toBe(100);
    expect(chain.y[0]).toBe(200);
    // back=(-1,0) なので x が segLen 刻みで減る。
    for (let i = 0; i < chain.n; i++) {
      expect(chain.x[i]).toBeCloseTo(100 - 10 * i, 9);
      expect(chain.y[i]).toBeCloseTo(200, 9);
    }
    expect(createTailChain(1, 10, 0, 0, -1, 0).n).toBe(2);
  });

  it("初期セグメント長は全て segLen、速度は 0（px==x）", () => {
    const chain = createTailChain(6, 12, 0, 0, 0, -1);
    for (const len of segmentLengths(chain)) {
      expect(len).toBeCloseTo(12, 9);
    }
    expect(maxSpeed(chain)).toBe(0);
  });

  it("resetTailChain は任意向きへ並べ直し速度を 0 にする", () => {
    const chain = createTailChain(4, 10, 0, 0, -1, 0);
    // 動かして速度を持たせる。
    updateTailChain(chain, 50, 0, 1 / 60, params);
    expect(maxSpeed(chain)).toBeGreaterThan(0);
    resetTailChain(chain, 5, 5, 0, 1);
    expect(chain.x[0]).toBe(5);
    expect(chain.y[0]).toBe(5);
    expect(chain.y[1]).toBeCloseTo(5 + 10, 9);
    expect(maxSpeed(chain)).toBe(0);
  });
});

describe("updateTailChain", () => {
  it("頭(point0)は毎フレーム head へ厳密にピン留めされる", () => {
    const chain = createTailChain(10, 10, 0, 0, -1, 0);
    for (let f = 0; f < 30; f++) {
      const hx = f * 3;
      const hy = Math.sin(f * 0.3) * 20;
      updateTailChain(chain, hx, hy, 1 / 60, params);
      expect(chain.x[0]).toBe(hx);
      expect(chain.y[0]).toBe(hy);
    }
  });

  it("dt<=0 は頭だけ固定し他点は不変・NaN を出さない", () => {
    const chain = createTailChain(6, 10, 0, 0, -1, 0);
    const beforeX = [...chain.x];
    updateTailChain(chain, 30, 40, 0, params);
    expect(chain.x[0]).toBe(30);
    expect(chain.y[0]).toBe(40);
    for (let i = 1; i < chain.n; i++) {
      expect(chain.x[i]).toBe(beforeX[i]);
    }
    updateTailChain(chain, 30, 40, -1, params);
    expect(allFinite(chain)).toBe(true);
  });

  it("頭を +x へ動かすと尻尾は後方(-x)へ遅れてトレイルする", () => {
    const chain = createTailChain(12, 10, 0, 0, -1, 0);
    for (let f = 0; f < 30; f++) {
      updateTailChain(chain, f * 6, 0, 1 / 60, params);
    }
    const head = { x: chain.x[0], y: chain.y[0] };
    const tip = { x: chain.x[chain.n - 1], y: chain.y[chain.n - 1] };
    // 先端は頭より後方（x が小さい）。
    expect(tip.x).toBeLessThan(head.x);
    // 点列は概ね頭→後方で x が単調減少（トレイル形状）。
    for (let i = 1; i < chain.n; i++) {
      expect(chain.x[i]).toBeLessThanOrEqual(chain.x[i - 1] + 1e-6);
    }
  });

  it("頭を +y へ動かすと尻尾は -y 側へトレイルする（進行方向の逆）", () => {
    const chain = createTailChain(12, 10, 0, 0, 0, -1);
    for (let f = 0; f < 30; f++) {
      updateTailChain(chain, 0, f * 6, 1 / 60, params);
    }
    expect(chain.y[chain.n - 1]).toBeLessThan(chain.y[0]);
  });

  it("頭を止めると数十フレームで静止し、セグメント長は保たれる", () => {
    const chain = createTailChain(14, 11, 0, 0, -1, 0);
    // まず動かして揺らす。
    for (let f = 0; f < 30; f++) {
      updateTailChain(chain, f * 8, Math.sin(f * 0.5) * 30, 1 / 60, params);
    }
    const headX = chain.x[0];
    const headY = chain.y[0];
    // 頭を固定して静止させる。
    for (let f = 0; f < 90; f++) {
      updateTailChain(chain, headX, headY, 1 / 60, params);
    }
    // 残留速度は微小。
    expect(maxSpeed(chain)).toBeLessThan(0.05);
    // セグメント長はほぼ静止長。
    for (const len of segmentLengths(chain)) {
      expect(len).toBeCloseTo(11, 1);
    }
    // さらに 1 フレームでもほとんど動かない（静止時は静止）。
    const snapX = [...chain.x];
    updateTailChain(chain, headX, headY, 1 / 60, params);
    let moved = 0;
    for (let i = 0; i < chain.n; i++) moved = Math.max(moved, Math.abs(chain.x[i] - snapX[i]));
    expect(moved).toBeLessThan(0.05);
  });

  it("重力ありでも静止（ぶら下がり平衡）へ収束する", () => {
    const g: TailChainParams = { ...params, gravity: 900 };
    const chain = createTailChain(12, 12, 0, 0, -1, 0);
    for (let f = 0; f < 300; f++) {
      updateTailChain(chain, 0, 0, 1 / 60, g);
    }
    expect(allFinite(chain)).toBe(true);
    expect(maxSpeed(chain)).toBeLessThan(0.2);
    // 重力で先端は頭より下（+y）に垂れる。
    expect(chain.y[chain.n - 1]).toBeGreaterThan(chain.y[0]);
  });

  it("長時間・各種 dt・重なり初期でも NaN/Infinity を出さない", () => {
    const chain = createTailChain(16, 10, 0, 0, -1, 0);
    // 全点を頭に重ねて退避ロジックを踏ませる。
    for (let i = 0; i < chain.n; i++) {
      chain.x[i] = 0;
      chain.y[i] = 0;
      chain.px[i] = 0;
      chain.py[i] = 0;
    }
    const dts = [1 / 60, 1 / 30, 0.5, 5, 1 / 240];
    for (let f = 0; f < 2000; f++) {
      const dt = dts[f % dts.length];
      updateTailChain(chain, Math.sin(f) * 500, Math.cos(f * 0.7) * 500, dt, params);
      expect(allFinite(chain)).toBe(true);
    }
  });
});
