import { describe, expect, it } from "vitest";
import { computeCoverFit } from "../../src/app/backgroundFit";

describe("computeCoverFit", () => {
  it("横長コンテンツを横長 viewport に覆う（高さ基準で拡大、左右はみ出し）", () => {
    // content 200x100 を viewport 400x400 へ。scale=max(2,4)=4
    const fit = computeCoverFit({ width: 200, height: 100 }, { width: 400, height: 400 });
    expect(fit.scale).toBe(4);
    expect(fit.width).toBe(800);
    expect(fit.height).toBe(400);
    // 中央寄せ: 左右にはみ出す（x<0）、上下ぴったり（y=0）
    expect(fit.x).toBe(-200);
    expect(fit.y).toBe(0);
  });

  it("縦長コンテンツを横長 viewport に覆う（幅基準で拡大、上下はみ出し）", () => {
    // content 100x200 を viewport 400x400 へ。scale=max(4,2)=4
    const fit = computeCoverFit({ width: 100, height: 200 }, { width: 400, height: 400 });
    expect(fit.scale).toBe(4);
    expect(fit.width).toBe(400);
    expect(fit.height).toBe(800);
    expect(fit.x).toBe(0);
    expect(fit.y).toBe(-200);
  });

  it("常に viewport 以上を覆い、アスペクト比を維持する（scale 均一）", () => {
    const cases = [
      { content: { width: 1000, height: 500 }, viewport: { width: 375, height: 812 } },
      { content: { width: 640, height: 480 }, viewport: { width: 1920, height: 1080 } },
      { content: { width: 33, height: 777 }, viewport: { width: 800, height: 600 } },
    ];
    for (const { content, viewport } of cases) {
      const fit = computeCoverFit(content, viewport);
      // 覆う（浮動小数誤差を許容）。
      expect(fit.width).toBeGreaterThanOrEqual(viewport.width - 1e-6);
      expect(fit.height).toBeGreaterThanOrEqual(viewport.height - 1e-6);
      // アスペクト維持: 拡縮後のアスペクトは元と一致。
      expect(fit.width / fit.height).toBeCloseTo(content.width / content.height, 9);
      // 少なくとも一辺はぴったり接する（過剰拡大でない）。
      const touchesW = Math.abs(fit.width - viewport.width) < 1e-6;
      const touchesH = Math.abs(fit.height - viewport.height) < 1e-6;
      expect(touchesW || touchesH).toBe(true);
    }
  });

  it("中央寄せ: 拡大後の中心が viewport 中心に一致する", () => {
    const viewport = { width: 800, height: 600 };
    const fit = computeCoverFit({ width: 300, height: 100 }, viewport);
    expect(fit.x + fit.width / 2).toBeCloseTo(viewport.width / 2, 9);
    expect(fit.y + fit.height / 2).toBeCloseTo(viewport.height / 2, 9);
  });

  it("同一アスペクトはぴったり収まる（はみ出し無し）", () => {
    const fit = computeCoverFit({ width: 400, height: 300 }, { width: 800, height: 600 });
    expect(fit.scale).toBe(2);
    expect(fit.x).toBe(0);
    expect(fit.y).toBe(0);
  });

  it("コンテンツ寸法が 0 以下ならゼロ除算せず安全な既定を返す", () => {
    const viewport = { width: 400, height: 400 };
    for (const content of [
      { width: 0, height: 100 },
      { width: 100, height: 0 },
      { width: -5, height: -5 },
    ]) {
      const fit = computeCoverFit(content, viewport);
      expect(Number.isFinite(fit.scale)).toBe(true);
      expect(Number.isFinite(fit.x)).toBe(true);
      expect(Number.isFinite(fit.y)).toBe(true);
    }
  });
});
