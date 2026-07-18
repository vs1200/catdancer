import { describe, expect, it } from "vitest";
import { SpawnScheduler } from "../../src/modes/spawnScheduler";

describe("SpawnScheduler", () => {
  it("間隔に達するまで 0、達したら 1 を返す", () => {
    const s = new SpawnScheduler({ intervalMs: 1000 });
    expect(s.update(0.5)).toBe(0); // 500ms
    expect(s.update(0.4)).toBe(0); // 900ms
    expect(s.update(0.1)).toBe(1); // 1000ms → 発火
    expect(s.update(0.5)).toBe(0); // 余り 0 + 500ms
  });

  it("大きな dt で複数回分溜まればまとめて返す（フレームスキップ）", () => {
    const s = new SpawnScheduler({ intervalMs: 1000 });
    // 2500ms → floor(2500/1000)=2、余り 500ms 持ち越し。
    expect(s.update(2.5)).toBe(2);
    expect(s.update(0.5)).toBe(1); // 500+500=1000 → 1
  });

  it("maxPerUpdate で 1 フレームの発火数を上限（極小間隔の暴走ガード）", () => {
    const s = new SpawnScheduler({ intervalMs: 10, maxPerUpdate: 4 });
    // 1000ms / 10ms = 100 回相当だが 4 で頭打ち、溜まりは破棄。
    expect(s.update(1)).toBe(4);
    // 破棄されているので次フレームは間隔ぶんだけ。
    expect(s.update(0.005)).toBe(0);
    expect(s.update(0.005)).toBe(1);
  });

  it("非正の dt では 0（NaN・巻き戻しガード）", () => {
    const s = new SpawnScheduler({ intervalMs: 1000 });
    expect(s.update(0)).toBe(0);
    expect(s.update(-1)).toBe(0);
    expect(s.update(Number.NaN)).toBe(0);
  });

  it("setInterval で間隔を変更できる", () => {
    const s = new SpawnScheduler({ intervalMs: 1000 });
    s.setInterval(200);
    expect(s.update(0.2)).toBe(1);
  });

  it("reset で積算をクリアする", () => {
    const s = new SpawnScheduler({ intervalMs: 1000 });
    s.update(0.9);
    s.reset();
    expect(s.update(0.2)).toBe(0); // 積算 0 からやり直し
  });

  it("間隔 1 未満は 1ms に丸める（0 割・無限発火を防ぐ）", () => {
    const s = new SpawnScheduler({ intervalMs: 0, maxPerUpdate: 3 });
    // 有限回に収まる（NaN/Infinity を返さない）。
    const n = s.update(0.001);
    expect(Number.isFinite(n)).toBe(true);
    expect(n).toBeLessThanOrEqual(3);
  });
});
