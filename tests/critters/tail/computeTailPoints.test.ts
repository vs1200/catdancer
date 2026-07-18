import { describe, expect, it } from "vitest";
import { computeTailPoints, type TailParams } from "../../../src/critters/tail/computeTailPoints";

const baseParams: TailParams = {
  pointCount: 20,
  length: 200,
  baseSag: 20,
  amplitude: 24,
  amplitudeExponent: 1.6,
  waveCount: 1.1,
  speed: 6,
  phase: 0,
};

describe("computeTailPoints", () => {
  it("指定した点数を返す（pointCount<2 は 2 にクランプ）", () => {
    expect(computeTailPoints(baseParams, 0)).toHaveLength(20);
    expect(computeTailPoints({ ...baseParams, pointCount: 1 }, 0)).toHaveLength(2);
    expect(computeTailPoints({ ...baseParams, pointCount: 24 }, 1.3)).toHaveLength(24);
  });

  it("付け根(i=0)は時刻によらず常に原点(0,0)で固定", () => {
    for (const t of [0, 0.13, 1.7, 42, 12345.6]) {
      const p = computeTailPoints(baseParams, t)[0];
      expect(p.x).toBe(0);
      expect(p.y).toBe(0);
    }
  });

  it("x は付け根 0 から先端 -length まで単調減少で伸びる", () => {
    const pts = computeTailPoints(baseParams, 0.5);
    expect(pts[0].x).toBe(0);
    expect(pts[pts.length - 1].x).toBeCloseTo(-baseParams.length, 6);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].x).toBeLessThan(pts[i - 1].x);
    }
  });

  it("振幅は先端へ向かうほど大きい（付け根は 0）", () => {
    // 一周期にわたり時刻をサンプルし、各点の静止曲線からの最大ずれ=振幅包絡を測る。
    const period = (2 * Math.PI) / baseParams.speed;
    const samples = 400;
    const n = baseParams.pointCount;
    const restY = (i: number) => {
      const t = i / (n - 1);
      return baseParams.baseSag * t * t;
    };
    const envelope = new Array<number>(n).fill(0);
    for (let s = 0; s <= samples; s++) {
      const time = (period * s) / samples;
      const pts = computeTailPoints(baseParams, time);
      for (let i = 0; i < n; i++) {
        envelope[i] = Math.max(envelope[i], Math.abs(pts[i].y - restY(i)));
      }
    }
    // 付け根は揺れない。
    expect(envelope[0]).toBeCloseTo(0, 6);
    // 単調増大（先端ほど大きく揺れる）。
    for (let i = 1; i < n; i++) {
      expect(envelope[i]).toBeGreaterThan(envelope[i - 1]);
    }
    // 先端の包絡は設定振幅に一致する。
    expect(envelope[n - 1]).toBeCloseTo(baseParams.amplitude, 1);
  });

  it("時間で振動する（先端の y が時刻で変化する）", () => {
    const tip = baseParams.pointCount - 1;
    const quarter = (2 * Math.PI) / baseParams.speed / 4;
    const y0 = computeTailPoints(baseParams, 0)[tip].y;
    const y1 = computeTailPoints(baseParams, quarter)[tip].y;
    expect(y1).not.toBeCloseTo(y0, 3);
  });

  it("揺れ無し(amplitude=0)なら y は静止曲線 baseSag*t^2（時刻非依存）", () => {
    const rest = { ...baseParams, amplitude: 0 };
    const a = computeTailPoints(rest, 0);
    const b = computeTailPoints(rest, 99);
    const n = rest.pointCount;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      expect(a[i].y).toBeCloseTo(rest.baseSag * t * t, 9);
      expect(b[i].y).toBeCloseTo(a[i].y, 9); // 時刻非依存
    }
    // 静止曲線は単調に垂れ下がり、先端で baseSag。
    expect(a[n - 1].y).toBeCloseTo(rest.baseSag, 9);
    for (let i = 1; i < n; i++) {
      expect(a[i].y).toBeGreaterThanOrEqual(a[i - 1].y);
    }
  });

  it("長時間・各種パラメータでも NaN/Infinity を出さない", () => {
    const cases: TailParams[] = [
      baseParams,
      { ...baseParams, pointCount: 2 },
      { ...baseParams, waveCount: 3.7, speed: 12, amplitudeExponent: 2.5 },
      { ...baseParams, length: 0, baseSag: 0, amplitude: 0 },
    ];
    for (const params of cases) {
      for (const t of [0, 1, 1000, 1e6]) {
        for (const p of computeTailPoints(params, t)) {
          expect(Number.isFinite(p.x)).toBe(true);
          expect(Number.isFinite(p.y)).toBe(true);
        }
      }
    }
  });
});
