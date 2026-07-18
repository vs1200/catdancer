import { describe, expect, it } from "vitest";
import { PlayLimitTimer } from "../../src/modes/PlayLimitTimer";

describe("PlayLimitTimer", () => {
  it("上限到達でちょうど1回 true を返し、以降 reset まで false", () => {
    const t = new PlayLimitTimer(1); // 1 分 = 60_000ms
    expect(t.tick(30)).toBe(false); // 30s
    expect(t.tick(29)).toBe(false); // 59s
    expect(t.tick(1)).toBe(true); // 60s ちょうど到達 → 1 回だけ true
    expect(t.tick(1)).toBe(false); // 以降は false
    expect(t.tick(100)).toBe(false);
    expect(t.hasFired).toBe(true);
  });

  it("reset で再武装する", () => {
    const t = new PlayLimitTimer(1);
    expect(t.tick(60)).toBe(true); // 発火
    expect(t.hasFired).toBe(true);
    t.reset();
    expect(t.hasFired).toBe(false);
    expect(t.tick(59)).toBe(false);
    expect(t.tick(1)).toBe(true); // 再武装後に再度発火
  });

  it("setLimitMinutes は elapsed をリセットして再武装する（短縮しても即発火しない）", () => {
    const t = new PlayLimitTimer(10); // 10 分
    expect(t.tick(60 * 5)).toBe(false); // 5 分経過（elapsed=300_000, まだ未達）
    // 上限を 1 分に短縮。elapsed がリセットされるため、その瞬間に即発火しない。
    t.setLimitMinutes(1);
    expect(t.hasFired).toBe(false);
    expect(t.tick(30)).toBe(false); // 30s
    expect(t.tick(30)).toBe(true); // 60s で発火
  });

  it("setLimitMinutes は発火済み状態も解除して再武装する", () => {
    const t = new PlayLimitTimer(1);
    expect(t.tick(60)).toBe(true); // 発火
    expect(t.hasFired).toBe(true);
    t.setLimitMinutes(2); // 上限延長＋再武装
    expect(t.hasFired).toBe(false);
    expect(t.tick(119)).toBe(false);
    expect(t.tick(1)).toBe(true); // 120s で発火
  });

  it("isDisabled は上限 0/負/非有限で true、tick は常に false", () => {
    for (const v of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const t = new PlayLimitTimer(v);
      expect(t.isDisabled).toBe(true);
      expect(t.tick(1e6)).toBe(false);
      expect(t.hasFired).toBe(false);
    }
  });

  it("有効な上限では isDisabled は false", () => {
    expect(new PlayLimitTimer(5).isDisabled).toBe(false);
  });

  it("非正の dt では累積しない（NaN/巻き戻しガード）", () => {
    const t = new PlayLimitTimer(1);
    expect(t.tick(0)).toBe(false);
    expect(t.tick(-10)).toBe(false);
    expect(t.tick(Number.NaN)).toBe(false);
    // 上記は一切累積しないため、その後 60s でちょうど初めて発火する。
    expect(t.tick(59)).toBe(false);
    expect(t.tick(1)).toBe(true);
  });

  it("remainingMs は経過に応じて減り、無効時は Infinity、発火後は 0", () => {
    const t = new PlayLimitTimer(1); // 60_000ms
    expect(t.remainingMs).toBe(60_000);
    t.tick(30); // 30s
    expect(t.remainingMs).toBe(30_000);
    t.tick(30); // 60s で発火
    expect(t.remainingMs).toBe(0);

    expect(new PlayLimitTimer(0).remainingMs).toBe(Number.POSITIVE_INFINITY);
  });

  it("大きな dt で一気に上限を超えても true は1回だけ（NaN を出さない）", () => {
    const t = new PlayLimitTimer(1);
    expect(t.tick(1e9)).toBe(true);
    expect(t.tick(1e9)).toBe(false);
    expect(Number.isFinite(t.remainingMs)).toBe(true);
    expect(t.remainingMs).toBe(0);
  });
});
