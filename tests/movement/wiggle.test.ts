import { describe, expect, it } from "vitest";
import type { WiggleConfig } from "../../src/movement/wiggle";
import { wiggleAngleAt } from "../../src/movement/wiggle";

/**
 * [UR3-6] クリックのフリフリ（一時的な回転 sway）の純ロジック wiggleAngleAt の単体テスト。
 * 角度は時刻の純関数なので、開始前/終了後は 0・振幅内・時間減衰・NaN 無しの不変条件を固定する。
 */
describe("wiggleAngleAt", () => {
  const cfg: WiggleConfig = { amp: 1, freq: Math.PI, durationSec: 2 };

  it("開始前(t<=0)は 0", () => {
    expect(wiggleAngleAt(cfg, 0)).toBe(0);
    expect(wiggleAngleAt(cfg, -1)).toBe(0);
  });

  it("終了時/以降(t>=durationSec)は 0", () => {
    expect(wiggleAngleAt(cfg, cfg.durationSec)).toBe(0);
    expect(wiggleAngleAt(cfg, cfg.durationSec + 0.5)).toBe(0);
  });

  it("包絡×amp×sin の閉形式に一致する（減衰込み）", () => {
    // freq=π なので sin(π*t): t=0.5→sin(π/2)=1, t=1.0→sin(π)=0, t=1.5→sin(3π/2)=-1。
    // env=1-t/2: t=0.5→0.75, t=1.0→0.5, t=1.5→0.25。
    expect(wiggleAngleAt(cfg, 0.5)).toBeCloseTo(0.75, 12); // 0.75*1*1
    expect(wiggleAngleAt(cfg, 1.0)).toBeCloseTo(0, 12); // 0.5*1*0
    expect(wiggleAngleAt(cfg, 1.5)).toBeCloseTo(-0.25, 12); // 0.25*1*(-1)
  });

  it("時間経過で振幅が減衰する（前半の山 > 後半の谷の大きさ）", () => {
    // 同じ |sin|=1 の時刻で比較（t=0.5 と t=1.5）。包絡が単調減少するため前半が大きい。
    expect(Math.abs(wiggleAngleAt(cfg, 0.5))).toBeGreaterThan(Math.abs(wiggleAngleAt(cfg, 1.5)));
  });

  it("常に |angle| <= amp（包絡∈[0,1]）・NaN 無し", () => {
    const c: WiggleConfig = { amp: 0.7, freq: 6.25, durationSec: 0.8, phase: 1.3 };
    for (let t = -0.2; t <= 1.0; t += 0.01) {
      const a = wiggleAngleAt(c, t);
      expect(Number.isNaN(a)).toBe(false);
      expect(Math.abs(a)).toBeLessThanOrEqual(c.amp + 1e-12);
    }
  });

  it("phase を反映する（t→0+ の立ち上がりが sin(phase) 方向）", () => {
    const c: WiggleConfig = { amp: 1, freq: 1, durationSec: 2, phase: Math.PI / 2 };
    // 微小 t では env≈1, sin(freq*t+π/2)≈cos(0)=1 なので正側へ立ち上がる。
    expect(wiggleAngleAt(c, 1e-4)).toBeGreaterThan(0.99);
  });
});
