import { describe, expect, it, vi } from "vitest";
import { SettingsStore } from "../../src/settings/SettingsStore";
import { findSpawnPreset, SPAWN_PRESETS } from "../../src/settings/spawnPresets";

/**
 * SettingsStore.applySpawnPreset の単体テスト。
 * テスト環境は node（localStorage 無し）だが、SettingsStore は localStorage 未定義を
 * ガードして永続化のみ no-op になるため、状態更新と通知はそのまま検証できる。
 * ストレージキーはテストごとに変えて相互汚染を避ける（localStorage をポリフィルする環境でも独立）。
 */
describe("SettingsStore.applySpawnPreset", () => {
  it("intervalMs と disabledTypes の両方を snapshot に反映する", () => {
    const store = new SettingsStore("test:applySpawnPreset:reflect");
    const calm = findSpawnPreset("calm");
    if (!calm) {
      throw new Error("calm preset が見つかりません");
    }
    store.applySpawnPreset(calm);
    const snapshot = store.settings;
    expect(snapshot.autoSpawnIntervalMs).toBe(calm.intervalMs);
    expect(snapshot.autoDisabledTypes).toEqual([...calm.disabledTypes]);
  });

  it("通知は 1 回だけ（両フィールドを 1 パスで反映できる）", () => {
    const store = new SettingsStore("test:applySpawnPreset:notify");
    const listener = vi.fn();
    store.subscribe(listener);
    store.applySpawnPreset(SPAWN_PRESETS[0]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("別プリセットの再適用で intervalMs と disabledTypes が上書きされる", () => {
    const store = new SettingsStore("test:applySpawnPreset:overwrite");
    const calm = findSpawnPreset("calm");
    const lively = findSpawnPreset("lively");
    if (!calm || !lively) {
      throw new Error("preset が見つかりません");
    }
    store.applySpawnPreset(calm);
    store.applySpawnPreset(lively);
    const snapshot = store.settings;
    expect(snapshot.autoSpawnIntervalMs).toBe(lively.intervalMs);
    // lively は全種有効 = 無効化リストは空。calm で入った insect が除去されていること。
    expect(snapshot.autoDisabledTypes).toEqual([]);
  });

  it("プリセットの readonly 配列を共有せず、コピー＆正規化して保持する", () => {
    const store = new SettingsStore("test:applySpawnPreset:copy");
    const calm = findSpawnPreset("calm");
    if (!calm) {
      throw new Error("calm preset が見つかりません");
    }
    store.applySpawnPreset(calm);
    // snapshot 配列を破壊しても、次の snapshot には影響しない（内部 state は別インスタンスを保持）。
    const snapshot = store.settings;
    snapshot.autoDisabledTypes.push("mutation");
    expect(store.settings.autoDisabledTypes).toEqual([...calm.disabledTypes]);
  });
});
