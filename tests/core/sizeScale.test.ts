import { describe, expect, it } from "vitest";
import {
  computeSizeScale,
  MAX_SIZE_SCALE,
  MIN_SIZE_SCALE,
  REFERENCE_MIN_DIM,
} from "../../src/core/sizeScale";

describe("computeSizeScale", () => {
  it("基準短辺(1080)でちょうど 1.0（縦横どちらが短辺でも）", () => {
    expect(computeSizeScale({ width: 1920, height: REFERENCE_MIN_DIM })).toBe(1);
    expect(computeSizeScale({ width: REFERENCE_MIN_DIM, height: 1920 })).toBe(1);
    // 正方形 1080x1080 も短辺 1080 で 1.0。
    expect(computeSizeScale({ width: REFERENCE_MIN_DIM, height: REFERENCE_MIN_DIM })).toBe(1);
  });

  it("短辺基準（min(w,h)）＝横長と縦長で同じスケール（回転で不変）", () => {
    const landscape = computeSizeScale({ width: 1920, height: 1200 });
    const portrait = computeSizeScale({ width: 1200, height: 1920 });
    expect(landscape).toBeCloseTo(1200 / REFERENCE_MIN_DIM, 10);
    expect(portrait).toBe(landscape);
  });

  it("大画面（短辺 > 基準）は 1 より大きく、小画面（短辺 < 基準）は 1 より小さい", () => {
    expect(computeSizeScale({ width: 2560, height: 1440 })).toBeGreaterThan(1);
    expect(computeSizeScale({ width: 800, height: 600 })).toBeLessThan(1);
    // 具体値: 1440/1080=1.3333.../ 600/1080=0.5555...
    expect(computeSizeScale({ width: 2560, height: 1440 })).toBeCloseTo(1440 / 1080, 10);
    expect(computeSizeScale({ width: 800, height: 600 })).toBeCloseTo(600 / 1080, 10);
  });

  it("短辺の増加に対して単調非減少（clamp 域外を除き狭義単調）", () => {
    const shorts = [560, 700, 900, 1080, 1300, 1600, 2000];
    let prev = -Infinity;
    for (const s of shorts) {
      const v = computeSizeScale({ width: 4000, height: s });
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("上限 MAX でクランプ（アップスケール＝画質劣化を防ぐ）", () => {
    // 短辺 2400 → 2.22... だが MAX=2.0 で頭打ち。
    expect(computeSizeScale({ width: 4000, height: 2400 })).toBe(MAX_SIZE_SCALE);
    expect(computeSizeScale({ width: 100000, height: 100000 })).toBe(MAX_SIZE_SCALE);
  });

  it("下限 MIN でクランプ（極小画面で小さくなりすぎない）", () => {
    // 短辺 400 → 0.37 だが MIN=0.5 で下限。
    expect(computeSizeScale({ width: 400, height: 800 })).toBe(MIN_SIZE_SCALE);
    expect(computeSizeScale({ width: 1, height: 1 })).toBe(MIN_SIZE_SCALE);
  });

  it("異常入力は等倍 1.0 へフォールバック（暴発防止）", () => {
    expect(computeSizeScale(null)).toBe(1);
    expect(computeSizeScale(undefined)).toBe(1);
    expect(computeSizeScale({ width: Number.NaN, height: 1080 })).toBe(1);
    expect(computeSizeScale({ width: 1080, height: Number.POSITIVE_INFINITY })).toBe(1);
    expect(computeSizeScale({ width: 0, height: 0 })).toBe(1);
    expect(computeSizeScale({ width: -1920, height: -1080 })).toBe(1);
    // referenceDim が非正でも 1.0（0 除算/符号反転を避ける）。
    expect(computeSizeScale({ width: 1920, height: 1080 }, { referenceDim: 0 })).toBe(1);
    expect(computeSizeScale({ width: 1920, height: 1080 }, { referenceDim: -100 })).toBe(1);
  });

  it("options で referenceDim/min/max を差し替えできる", () => {
    // referenceDim=720 なら短辺 720 で 1.0、1440 で 2.0(=既定 max)。
    expect(computeSizeScale({ width: 1280, height: 720 }, { referenceDim: 720 })).toBe(1);
    expect(computeSizeScale({ width: 2560, height: 1440 }, { referenceDim: 720 })).toBe(2);
    // max を緩めれば頭打ちが上がる（720基準の短辺1440はちょうど 2.0 なので max=3 でも 2.0）。
    expect(computeSizeScale({ width: 2560, height: 1440 }, { referenceDim: 720, max: 3 })).toBe(2);
    // min を厳しくすれば下限が上がる。
    expect(computeSizeScale({ width: 800, height: 600 }, { min: 0.8 })).toBe(0.8);
  });

  it("min>max を渡しても壊れない（入れ替えてクランプ）", () => {
    const v = computeSizeScale({ width: 4000, height: 4000 }, { min: 2, max: 0.5 });
    // 実効域は [0.5, 2] とみなし、巨大短辺なので上限 2 に張り付く。
    expect(v).toBeGreaterThanOrEqual(0.5);
    expect(v).toBeLessThanOrEqual(2);
    expect(v).toBe(2);
  });
});
