import { describe, expect, it } from "vitest";
import { SqueakScheduler } from "../../src/audio/SqueakScheduler";

describe("SqueakScheduler", () => {
  it("rng=0 なら間隔=minInterval で発火する", () => {
    const s = new SqueakScheduler({ minInterval: 2, maxInterval: 5, rng: () => 0 });
    // 2 秒未満では発火しない。
    expect(s.update(1.9)).toBe(false);
    // 累積が 2 秒を越えたら発火。
    expect(s.update(0.2)).toBe(true);
  });

  it("rng=1 なら間隔=maxInterval で発火する", () => {
    const s = new SqueakScheduler({ minInterval: 2, maxInterval: 5, rng: () => 1 });
    expect(s.update(4.9)).toBe(false);
    expect(s.update(0.2)).toBe(true);
  });

  it("発火後は次の間隔へリセットされ、連続 tick で連打しない", () => {
    const s = new SqueakScheduler({ minInterval: 1, maxInterval: 1, rng: () => 0.5 });
    // 間隔は常に 1 秒（min=max=1）。
    expect(s.update(1.0)).toBe(true);
    // 直後の小さな tick では発火しない（リセット済み）。
    expect(s.update(0.1)).toBe(false);
    expect(s.update(0.8)).toBe(false);
    // 再び 1 秒に到達したら発火。
    expect(s.update(0.2)).toBe(true);
  });

  it("大きな dt でも 1 tick では 1 回だけ発火（連打しない）", () => {
    const s = new SqueakScheduler({ minInterval: 1, maxInterval: 1, rng: () => 0.5 });
    expect(s.update(100)).toBe(true);
    // オーバーシュートは捨てられ、次はまた 1 秒必要。
    expect(s.update(0.5)).toBe(false);
    expect(s.update(0.6)).toBe(true);
  });

  it("dt<=0 は発火せず状態も進めない", () => {
    const s = new SqueakScheduler({ minInterval: 1, maxInterval: 1, rng: () => 0.5 });
    const before = s.remaining;
    expect(s.update(0)).toBe(false);
    expect(s.update(-5)).toBe(false);
    expect(s.remaining).toBe(before);
  });

  it("remaining は初期に min..max の範囲内", () => {
    const s = new SqueakScheduler({ minInterval: 2, maxInterval: 6, rng: () => 0.5 });
    expect(s.remaining).toBeGreaterThanOrEqual(2);
    expect(s.remaining).toBeLessThanOrEqual(6);
    expect(s.remaining).toBeCloseTo(4, 6); // 2 + 0.5*(6-2)
  });

  it("既定(rng 未指定)でも例外を出さず動作する", () => {
    const s = new SqueakScheduler();
    // 十分長い dt で必ず発火する（既定 max=5.5s）。
    expect(s.update(10)).toBe(true);
  });
});
