import { describe, expect, it } from "vitest";
import { weightedIndex } from "../../src/modes/weightedChoice";

describe("weightedIndex", () => {
  it("累積重みで r を index に写す（[1,1,2]）", () => {
    // total=4。境界: [0,0.25)→0, [0.25,0.5)→1, [0.5,1)→2。
    expect(weightedIndex([1, 1, 2], 0)).toBe(0);
    expect(weightedIndex([1, 1, 2], 0.24)).toBe(0);
    expect(weightedIndex([1, 1, 2], 0.25)).toBe(1);
    expect(weightedIndex([1, 1, 2], 0.49)).toBe(1);
    expect(weightedIndex([1, 1, 2], 0.5)).toBe(2);
    expect(weightedIndex([1, 1, 2], 0.99)).toBe(2);
  });

  it("r は [0,1) にクランプ（範囲外でも末尾を超えない）", () => {
    expect(weightedIndex([1, 1, 2], -1)).toBe(0);
    expect(weightedIndex([1, 1, 2], 1)).toBe(2);
    expect(weightedIndex([1, 1, 2], 5)).toBe(2);
  });

  it("重み0/負/非有限は無視される", () => {
    expect(weightedIndex([0, 1], 0)).toBe(1);
    expect(weightedIndex([0, 1], 0.99)).toBe(1);
    expect(weightedIndex([2, 0, 1], 0)).toBe(0);
    expect(weightedIndex([2, 0, 1], 0.99)).toBe(2);
    expect(weightedIndex([Number.NaN, 1], 0.5)).toBe(1);
    expect(weightedIndex([-3, 1], 0.5)).toBe(1);
  });

  it("空配列/全ゼロは -1（呼び出し側でガード）", () => {
    expect(weightedIndex([], 0.5)).toBe(-1);
    expect(weightedIndex([0, 0], 0.5)).toBe(-1);
  });

  it("一様 r をサンプルすると重みに概ね比例する", () => {
    const weights = [2, 1, 1]; // 期待比 0.5 / 0.25 / 0.25
    const counts = [0, 0, 0];
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const idx = weightedIndex(weights, (i + 0.5) / N);
      counts[idx]++;
    }
    expect(counts[0] / N).toBeCloseTo(0.5, 1);
    expect(counts[1] / N).toBeCloseTo(0.25, 1);
    expect(counts[2] / N).toBeCloseTo(0.25, 1);
  });
});
