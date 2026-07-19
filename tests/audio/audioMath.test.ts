import { describe, expect, it } from "vitest";
import {
  clamp01,
  makeSqueakParams,
  pickRandomIndex,
  SCURRY_LEVEL_DEFAULTS,
  scurryLevelFromSpeed,
} from "../../src/audio/audioMath";

describe("clamp01", () => {
  it("[0,1] に収める", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(3)).toBe(1);
  });

  it("NaN は 0 に落とす（gain の NaN 汚染防止）", () => {
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe("scurryLevelFromSpeed", () => {
  const opts = { minSpeed: 20, maxSpeed: 120 };

  it("minSpeed 以下は 0（静止でほぼ無音）", () => {
    expect(scurryLevelFromSpeed(0, opts)).toBe(0);
    expect(scurryLevelFromSpeed(20, opts)).toBe(0);
    expect(scurryLevelFromSpeed(-50, opts)).toBe(0);
  });

  it("maxSpeed 以上は 1（フル）", () => {
    expect(scurryLevelFromSpeed(120, opts)).toBe(1);
    expect(scurryLevelFromSpeed(9999, opts)).toBe(1);
  });

  it("min..max の間は線形補間", () => {
    expect(scurryLevelFromSpeed(70, opts)).toBeCloseTo(0.5, 6);
    expect(scurryLevelFromSpeed(45, opts)).toBeCloseTo(0.25, 6);
  });

  it("速いほど大きい（単調増加）", () => {
    let prev = -1;
    for (const s of [0, 20, 40, 60, 80, 100, 120, 200]) {
      const level = scurryLevelFromSpeed(s, opts);
      expect(level).toBeGreaterThanOrEqual(prev);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
      prev = level;
    }
  });

  it("max<=min の異常設定でも 1（0除算しない）", () => {
    expect(scurryLevelFromSpeed(100, { minSpeed: 50, maxSpeed: 50 })).toBe(1);
    expect(scurryLevelFromSpeed(100, { minSpeed: 80, maxSpeed: 30 })).toBe(1);
    // min 以下ならこの場合も 0。
    expect(scurryLevelFromSpeed(40, { minSpeed: 50, maxSpeed: 50 })).toBe(0);
  });

  it("NaN 速度は 0", () => {
    expect(scurryLevelFromSpeed(Number.NaN, opts)).toBe(0);
  });

  it("既定オプションでも [0,1] に収まる", () => {
    for (const s of [0, 100, 480, 1000]) {
      const level = scurryLevelFromSpeed(s, SCURRY_LEVEL_DEFAULTS);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
    }
    expect(scurryLevelFromSpeed(0, SCURRY_LEVEL_DEFAULTS)).toBe(0);
    expect(scurryLevelFromSpeed(1000, SCURRY_LEVEL_DEFAULTS)).toBe(1);
  });
});

describe("makeSqueakParams", () => {
  it("rng を注入すると決定的で、全て有限・妥当な範囲", () => {
    const rng = () => 0.5; // ジッタ中央
    const p = makeSqueakParams(rng);
    for (const v of [p.startFreq, p.peakFreq, p.endFreq, p.duration, p.peakTime, p.gainPeak]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    // 上下チャープ: peak は start より高く、end は start より低い。
    expect(p.peakFreq).toBeGreaterThan(p.startFreq);
    expect(p.endFreq).toBeLessThan(p.startFreq);
    // 長さ・ピーク位置・gain は妥当な範囲。
    expect(p.duration).toBeGreaterThan(0);
    expect(p.peakTime).toBeGreaterThan(0);
    expect(p.peakTime).toBeLessThan(1);
    expect(p.gainPeak).toBeGreaterThan(0);
    expect(p.gainPeak).toBeLessThanOrEqual(1);
    expect(p.waveform).toBe("triangle");
  });

  it("さまざまな rng 値で常に安全（duration>0, gainPeak<=1, 上下チャープ維持）", () => {
    const values = [0, 0.0001, 0.25, 0.5, 0.75, 0.999999];
    for (const r of values) {
      const p = makeSqueakParams(() => r);
      expect(p.duration).toBeGreaterThanOrEqual(0.03);
      expect(p.startFreq).toBeGreaterThan(0);
      expect(p.peakFreq).toBeGreaterThan(p.startFreq);
      expect(p.endFreq).toBeLessThan(p.startFreq);
      expect(p.gainPeak).toBeGreaterThan(0);
      expect(p.gainPeak).toBeLessThanOrEqual(1);
    }
  });

  it("rng が両極でも音程/長さが揺らぎ、異なる値になる", () => {
    const low = makeSqueakParams(() => 0);
    const high = makeSqueakParams(() => 0.999999);
    expect(low.startFreq).not.toBeCloseTo(high.startFreq, 1);
    expect(low.duration).not.toBeCloseTo(high.duration, 3);
  });

  it("オプションで中心周波数/長さを差し替えできる", () => {
    const p = makeSqueakParams(() => 0.5, { baseFreq: 800, freqJitter: 0, baseDuration: 0.2 });
    expect(p.startFreq).toBeCloseTo(800, 6); // jitter=0 かつ rng=0.5 → 揺らぎ 0
    expect(p.duration).toBeGreaterThan(0);
  });
});

describe("pickRandomIndex", () => {
  it("rng を [0,1) 全域で振ると 0..length-1 を一様にカバーする", () => {
    const length = 3;
    // 各バケット中央付近を狙う rng で、想定 index に落ちることを確認（境界含む）。
    expect(pickRandomIndex(length, () => 0)).toBe(0);
    expect(pickRandomIndex(length, () => 0.2)).toBe(0);
    expect(pickRandomIndex(length, () => 0.34)).toBe(1);
    expect(pickRandomIndex(length, () => 0.5)).toBe(1);
    expect(pickRandomIndex(length, () => 0.67)).toBe(2);
    expect(pickRandomIndex(length, () => 0.999999)).toBe(2);
  });

  it("常に [0,length) の整数を返す（多数の rng 値で範囲外に出ない）", () => {
    const length = 3;
    for (const r of [0, 0.1, 0.333, 0.5, 0.9, 0.9999999]) {
      const idx = pickRandomIndex(length, () => r);
      expect(Number.isInteger(idx)).toBe(true);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(length);
    }
  });

  it("length<=1 は常に 0（唯一/空集合で安全）", () => {
    expect(pickRandomIndex(1, () => 0.9)).toBe(0);
    expect(pickRandomIndex(0, () => 0.9)).toBe(0);
    expect(pickRandomIndex(-3, () => 0.9)).toBe(0);
  });

  it("rng が範囲外/NaN でも範囲内に丸める（gain/index の暴走防止）", () => {
    const length = 3;
    // r>=1 は最終 index、r<0 は 0、NaN は 0 に落とす。
    expect(pickRandomIndex(length, () => 1)).toBe(length - 1);
    expect(pickRandomIndex(length, () => 1.5)).toBe(length - 1);
    expect(pickRandomIndex(length, () => -0.5)).toBe(0);
    expect(pickRandomIndex(length, () => Number.NaN)).toBe(0);
  });

  it("実 Math.random でも常に有効 index（統計: 3種すべて出現する）", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const idx = pickRandomIndex(3);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(3);
      seen.add(idx);
    }
    expect(seen.size).toBe(3);
  });
});
