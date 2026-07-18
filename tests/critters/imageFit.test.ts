import { describe, expect, it } from "vitest";
import { fitWithinMax, MAX_IMAGE_TEXTURE_SIDE } from "../../src/critters/imageFit";

describe("fitWithinMax", () => {
  it("長辺が上限以下ならそのまま（scaled=false）", () => {
    const fit = fitWithinMax(800, 600, 2048);
    expect(fit).toEqual({ width: 800, height: 600, scaled: false });
  });

  it("長辺がちょうど上限なら縮小しない（境界は含む）", () => {
    const fit = fitWithinMax(2048, 1000, 2048);
    expect(fit).toEqual({ width: 2048, height: 1000, scaled: false });
  });

  it("横長で幅が上限超なら幅=上限に等比縮小する", () => {
    // 6000x4000 → scale=2048/6000, width=2048, height=round(4000*2048/6000)=1365
    const fit = fitWithinMax(6000, 4000, 2048);
    expect(fit.scaled).toBe(true);
    expect(fit.width).toBe(2048);
    expect(fit.height).toBe(1365);
    // アスペクト比を（丸め誤差の範囲で）維持する。
    expect(fit.width / fit.height).toBeCloseTo(6000 / 4000, 2);
  });

  it("縦長で高さが上限超なら高さ=上限に等比縮小する", () => {
    // 3000x9000 → scale=2048/9000, height=2048, width=round(3000*2048/9000)=683
    const fit = fitWithinMax(3000, 9000, 2048);
    expect(fit.scaled).toBe(true);
    expect(fit.height).toBe(2048);
    expect(fit.width).toBe(683);
  });

  it("正方形で辺が上限超なら両辺=上限に縮小する", () => {
    const fit = fitWithinMax(4096, 4096, 2048);
    expect(fit).toEqual({ width: 2048, height: 2048, scaled: true });
  });

  it("縮小後は最低 1px を保証する（極端なアスペクト比でも 0 にしない）", () => {
    // 10000x1 → 高さは round(1*2048/10000)=0 になるが 1px にクランプ。
    const fit = fitWithinMax(10000, 1, 2048);
    expect(fit.scaled).toBe(true);
    expect(fit.width).toBe(2048);
    expect(fit.height).toBe(1);
  });

  it("maxSide 既定値は MAX_IMAGE_TEXTURE_SIDE(2048)", () => {
    expect(MAX_IMAGE_TEXTURE_SIDE).toBe(2048);
    const withDefault = fitWithinMax(6000, 4000);
    const explicit = fitWithinMax(6000, 4000, 2048);
    expect(withDefault).toEqual(explicit);
  });

  it("0/NaN/負値/非有限は縮小せず scaled=false で素通しさせる", () => {
    for (const [w, h] of [
      [0, 100],
      [100, 0],
      [-5, 100],
      [100, -5],
      [Number.NaN, 100],
      [100, Number.NaN],
      [Number.POSITIVE_INFINITY, 100],
    ] as const) {
      expect(fitWithinMax(w, h, 2048).scaled).toBe(false);
    }
    // maxSide が不正でも素通し（ゼロ除算・負スケールを避ける）。
    expect(fitWithinMax(6000, 4000, 0).scaled).toBe(false);
    expect(fitWithinMax(6000, 4000, -100).scaled).toBe(false);
    expect(fitWithinMax(6000, 4000, Number.NaN).scaled).toBe(false);
  });
});
