import { describe, expect, it } from "vitest";
import {
  approachAngle,
  isMirroredHeading,
  normalizeAngle,
  shortestAngleDelta,
  updateHeading,
} from "../../src/critters/heading";

const HALF_PI = Math.PI / 2;
const { PI } = Math;

describe("normalizeAngle", () => {
  it("(-π, π] の範囲へ畳み込む", () => {
    expect(normalizeAngle(0)).toBeCloseTo(0);
    expect(normalizeAngle(PI)).toBeCloseTo(PI); // 上限は含む
    expect(normalizeAngle(-PI)).toBeCloseTo(PI); // 下限は反対側へ
    expect(normalizeAngle(1.5 * PI)).toBeCloseTo(-HALF_PI);
    expect(normalizeAngle(-1.5 * PI)).toBeCloseTo(HALF_PI);
    expect(normalizeAngle(2 * PI)).toBeCloseTo(0);
    expect(normalizeAngle(3 * PI)).toBeCloseTo(PI);
  });
});

describe("shortestAngleDelta", () => {
  it("±180°境界を最短側に回る（170°→-170° は +20°）", () => {
    const from = (170 * PI) / 180;
    const to = (-170 * PI) / 180;
    expect((shortestAngleDelta(from, to) * 180) / PI).toBeCloseTo(20);
  });

  it("同角は 0、逆向き差は最短経路の符号を持つ", () => {
    expect(shortestAngleDelta(1, 1)).toBeCloseTo(0);
    // -170°→170° は -20°（逆回り）
    const from = (-170 * PI) / 180;
    const to = (170 * PI) / 180;
    expect((shortestAngleDelta(from, to) * 180) / PI).toBeCloseTo(-20);
  });
});

describe("approachAngle", () => {
  it("目標へ最短経路で一部だけ進む（0<k<1）", () => {
    const next = approachAngle(0, HALF_PI, 1 / 60, 0.06);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(HALF_PI);
  });

  it("繰り返すと目標へ収束する（オーバーシュートしない）", () => {
    let a = 0;
    for (let i = 0; i < 120; i++) {
      a = approachAngle(a, HALF_PI, 1 / 60, 0.06);
    }
    expect(a).toBeCloseTo(HALF_PI, 3);
    expect(a).toBeLessThanOrEqual(HALF_PI + 1e-6); // 越えない
  });

  it("±180°付近では最短側（境界を越える向き）へ回る", () => {
    const from = (170 * PI) / 180;
    const to = (-170 * PI) / 180;
    const next = approachAngle(from, to, 1 / 60, 0.06);
    // +側（180°境界を越えて -170° 側）へ進む → 正規化後 +170°より大きいか折り返す
    const delta = shortestAngleDelta(from, next);
    expect(delta).toBeGreaterThan(0); // 短い方向（+）へ動いた
  });

  it("dt<=0 では現在角（正規化）を返す", () => {
    expect(approachAngle(0.3, HALF_PI, 0, 0.06)).toBeCloseTo(0.3);
    expect(approachAngle(0.3, HALF_PI, -1, 0.06)).toBeCloseTo(0.3);
  });
});

describe("isMirroredHeading", () => {
  it("右半分(cos>0)は反転なし", () => {
    expect(isMirroredHeading(0)).toBe(false); // 右
    expect(isMirroredHeading(HALF_PI - 0.01)).toBe(false); // ほぼ下
    expect(isMirroredHeading(-HALF_PI + 0.01)).toBe(false); // ほぼ上
    expect(isMirroredHeading(PI / 4)).toBe(false); // 右下
    expect(isMirroredHeading(-PI / 4)).toBe(false); // 右上
  });

  it("左半分(cos<0)は反転する", () => {
    expect(isMirroredHeading(PI)).toBe(true); // 左
    expect(isMirroredHeading((3 * PI) / 4)).toBe(true); // 左下
    expect(isMirroredHeading((-3 * PI) / 4)).toBe(true); // 左上
    expect(isMirroredHeading(HALF_PI + 0.01)).toBe(true); // 下やや左
  });

  it("真上/真下(cos≈0)は反転なし側に含める", () => {
    expect(isMirroredHeading(HALF_PI)).toBe(false); // 真下
    expect(isMirroredHeading(-HALF_PI)).toBe(false); // 真上
  });
});

describe("updateHeading", () => {
  const opts = { holdMinSpeed: 6, smoothTime: 0.06 };

  it("静止（速さ<=holdMinSpeed）では現在角を保持する（くるくる回らない）", () => {
    expect(updateHeading(0.7, 0, 0, 1 / 60, opts)).toBeCloseTo(0.7);
    expect(updateHeading(0.7, 3, 3, 1 / 60, opts)).toBeCloseTo(0.7); // 速さ~4.2<6
  });

  it("十分な速度で目標 atan2(vy,vx) へ回頭する（各方位）", () => {
    // 右へ: 目標0。0近傍から始めればほぼ0のまま
    expect(updateHeading(0, 100, 0, 1 / 60, opts)).toBeCloseTo(0, 1);
    // 収束させて方位を確認
    const converge = (vx: number, vy: number, start = 0): number => {
      let a = start;
      for (let i = 0; i < 200; i++) a = updateHeading(a, vx, vy, 1 / 60, opts);
      return a;
    };
    expect(converge(0, 100)).toBeCloseTo(HALF_PI, 3); // 真下
    expect(converge(0, -100)).toBeCloseTo(-HALF_PI, 3); // 真上
    expect(converge(-100, 0)).toBeCloseTo(PI, 3); // 真左
    expect(converge(-100, 100)).toBeCloseTo((3 * PI) / 4, 3); // 左下
    expect(converge(100, -100)).toBeCloseTo(-PI / 4, 3); // 右上
  });

  it("方向転換では最短側へ回る（右→左は上下どちらかへ180°、暴発しない）", () => {
    // 右向き(0)から真左(vx<0, vy=+微小)へ: 目標≈π。1ステップで一部だけ進み π を越えない
    const next = updateHeading(0, -100, 1, 1 / 60, opts);
    expect(Math.abs(next)).toBeGreaterThan(0);
    expect(Math.abs(next)).toBeLessThanOrEqual(PI);
  });

  it("NaN を出さない（極小速度/ゼロ）", () => {
    expect(Number.isFinite(updateHeading(0.5, 0, 0, 1 / 60, opts))).toBe(true);
    expect(Number.isFinite(updateHeading(0.5, 1e-9, 1e-9, 1 / 60, opts))).toBe(true);
  });
});
