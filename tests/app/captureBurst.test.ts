import { describe, expect, it } from "vitest";
import {
  CAPTURE_BURST_END_SCALE,
  CAPTURE_BURST_START_SCALE,
  captureBurstVisual,
} from "../../src/app/captureBurst";

describe("captureBurstVisual", () => {
  it("progress=0 で始点（最小 scale・alpha=1）", () => {
    const v = captureBurstVisual(0);
    expect(v.scale).toBeCloseTo(CAPTURE_BURST_START_SCALE, 9);
    expect(v.alpha).toBe(1);
  });

  it("progress=1 で終点（最大 scale・alpha=0）", () => {
    const v = captureBurstVisual(1);
    expect(v.scale).toBeCloseTo(CAPTURE_BURST_END_SCALE, 9);
    expect(v.alpha).toBe(0);
  });

  it("progress=0.5 は始点と終点の間（範囲内）", () => {
    const v = captureBurstVisual(0.5);
    expect(v.scale).toBeGreaterThan(CAPTURE_BURST_START_SCALE);
    expect(v.scale).toBeLessThan(CAPTURE_BURST_END_SCALE);
    expect(v.alpha).toBeGreaterThan(0);
    expect(v.alpha).toBeLessThan(1);
  });

  it("progress に対し scale は単調増加・alpha は単調減少", () => {
    const steps = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
    let prev = captureBurstVisual(steps[0]);
    for (let i = 1; i < steps.length; i++) {
      const cur = captureBurstVisual(steps[i]);
      expect(cur.scale).toBeGreaterThanOrEqual(prev.scale);
      expect(cur.alpha).toBeLessThanOrEqual(prev.alpha);
      prev = cur;
    }
  });

  it("範囲外（負値）は 0 相当にクランプされる", () => {
    const at0 = captureBurstVisual(0);
    const neg = captureBurstVisual(-1);
    expect(neg.scale).toBeCloseTo(at0.scale, 9);
    expect(neg.alpha).toBe(at0.alpha);
    const negBig = captureBurstVisual(-1000);
    expect(negBig.scale).toBeCloseTo(at0.scale, 9);
    expect(negBig.alpha).toBe(at0.alpha);
  });

  it("範囲外（1超）は 1 相当にクランプされる", () => {
    const at1 = captureBurstVisual(1);
    const over = captureBurstVisual(2);
    expect(over.scale).toBeCloseTo(at1.scale, 9);
    expect(over.alpha).toBe(at1.alpha);
    const overBig = captureBurstVisual(1000);
    expect(overBig.scale).toBeCloseTo(at1.scale, 9);
    expect(overBig.alpha).toBe(at1.alpha);
  });

  it("全範囲（範囲外/NaN 含む）で scale/alpha は有限・範囲内で NaN を出さない", () => {
    const inputs = [
      Number.NEGATIVE_INFINITY,
      -5,
      -0.001,
      0,
      0.3,
      0.5,
      0.999,
      1,
      1.001,
      42,
      Number.POSITIVE_INFINITY,
      Number.NaN,
    ];
    for (const p of inputs) {
      const v = captureBurstVisual(p);
      expect(Number.isFinite(v.scale)).toBe(true);
      expect(Number.isFinite(v.alpha)).toBe(true);
      expect(v.scale).toBeGreaterThanOrEqual(CAPTURE_BURST_START_SCALE);
      expect(v.scale).toBeLessThanOrEqual(CAPTURE_BURST_END_SCALE);
      expect(v.alpha).toBeGreaterThanOrEqual(0);
      expect(v.alpha).toBeLessThanOrEqual(1);
    }
  });
});
