import { describe, expect, it, vi } from "vitest";
import { FOXTAIL_TYPE_ID } from "../../src/critters/types/foxtail";
import { CUSTOM_CRITTER_TYPE_ID } from "../../src/critters/types/imageCritter";
import { MOUSE_TYPE_ID } from "../../src/critters/types/mouse";
import { TOYS_TYPE_ID } from "../../src/critters/types/toys";
import { DEFAULT_MANUAL_TYPE_ID } from "../../src/settings/manualTargets";
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

describe("SettingsStore.setHideCursor", () => {
  it("既定は false（オプトイン）", () => {
    const store = new SettingsStore("test:setHideCursor:default");
    expect(store.settings.hideCursor).toBe(false);
  });

  it("snapshot に反映し、購読者へ通知する", () => {
    const store = new SettingsStore("test:setHideCursor:reflect");
    const listener = vi.fn();
    store.subscribe(listener);
    store.setHideCursor(true);
    expect(store.settings.hideCursor).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ hideCursor: true }));
    // 解除でも反映される。
    store.setHideCursor(false);
    expect(store.settings.hideCursor).toBe(false);
  });

  it("非boolは normalizeHideCursor で false に正規化する（true 以外は false）", () => {
    const store = new SettingsStore("test:setHideCursor:normalize");
    // @ts-expect-error 敵対的入力（非boolでも壊れず false へ正規化されることを検証）。
    store.setHideCursor("yes");
    expect(store.settings.hideCursor).toBe(false);
  });
});

describe("SettingsStore.setManualTypeId", () => {
  it("既定は mouse（ネズミ）", () => {
    const store = new SettingsStore("test:setManualTypeId:default");
    expect(store.settings.manualTypeId).toBe(MOUSE_TYPE_ID);
  });

  it("選択可能な種別は snapshot に反映し、購読者へ通知する", () => {
    const store = new SettingsStore("test:setManualTypeId:reflect");
    const listener = vi.fn();
    store.subscribe(listener);
    store.setManualTypeId(FOXTAIL_TYPE_ID);
    expect(store.settings.manualTypeId).toBe(FOXTAIL_TYPE_ID);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ manualTypeId: FOXTAIL_TYPE_ID }),
    );
  });

  it("選択不能な id は既定(mouse)へ正規化する", () => {
    const store = new SettingsStore("test:setManualTypeId:normalize");
    // [UR3-10] custom は選択可能になったので、genuinely-invalid な id で正規化を確認する。
    store.setManualTypeId("bogus");
    expect(store.settings.manualTypeId).toBe(DEFAULT_MANUAL_TYPE_ID);
  });

  it("[UR3-10] custom(任意画像)は選択可能値として保持する", () => {
    const store = new SettingsStore("test:setManualTypeId:custom");
    store.setManualTypeId(CUSTOM_CRITTER_TYPE_ID);
    expect(store.settings.manualTypeId).toBe(CUSTOM_CRITTER_TYPE_ID);
  });
});

describe("SettingsStore.setInsectManualPattern", () => {
  it("既定は click（クリックで出現）", () => {
    const store = new SettingsStore("test:setInsectManualPattern:default");
    expect(store.settings.insectManualPattern).toBe("click");
  });

  it("follow を snapshot に反映し、購読者へ通知する", () => {
    const store = new SettingsStore("test:setInsectManualPattern:reflect");
    const listener = vi.fn();
    store.subscribe(listener);
    store.setInsectManualPattern("follow");
    expect(store.settings.insectManualPattern).toBe("follow");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ insectManualPattern: "follow" }),
    );
    // click へ戻すのも反映される。
    store.setInsectManualPattern("click");
    expect(store.settings.insectManualPattern).toBe("click");
  });

  it("許可集合外/異常型は既定 click へ正規化する（例外を投げない）", () => {
    const store = new SettingsStore("test:setInsectManualPattern:normalize");
    // @ts-expect-error 敵対的入力（許可集合外の文字列でも壊れず click へ正規化される）。
    store.setInsectManualPattern("weird");
    expect(store.settings.insectManualPattern).toBe("click");
    // @ts-expect-error 敵対的入力（異常型でも例外を投げず click へ落ちる）。
    expect(() => store.setInsectManualPattern(true)).not.toThrow();
    expect(store.settings.insectManualPattern).toBe("click");
  });
});

describe("SettingsStore.setManualObjectScale / setAutoObjectScale", () => {
  it("既定は manual/auto とも全キー 1.0", () => {
    const store = new SettingsStore("test:objectScale:default");
    expect(store.settings.manualObjectScales[MOUSE_TYPE_ID]).toBe(1.0);
    expect(store.settings.manualObjectScales[CUSTOM_CRITTER_TYPE_ID]).toBe(1.0);
    expect(store.settings.autoObjectScales[MOUSE_TYPE_ID]).toBe(1.0);
  });

  it("setManualObjectScale は該当キーのみ更新し、他キー/autoレコードは不変（commit/notify 1回）", () => {
    const store = new SettingsStore("test:objectScale:manual-only");
    const listener = vi.fn();
    store.subscribe(listener);
    store.setManualObjectScale(MOUSE_TYPE_ID, 1.6);
    const snap = store.settings;
    expect(snap.manualObjectScales[MOUSE_TYPE_ID]).toBe(1.6);
    // 他の manual キーは 1.0 のまま、auto レコードも触られない。
    expect(snap.manualObjectScales[FOXTAIL_TYPE_ID]).toBe(1.0);
    expect(snap.autoObjectScales[MOUSE_TYPE_ID]).toBe(1.0);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        manualObjectScales: expect.objectContaining({ [MOUSE_TYPE_ID]: 1.6 }),
      }),
    );
  });

  it("setAutoObjectScale は該当キーのみ更新し、manualレコードは不変", () => {
    const store = new SettingsStore("test:objectScale:auto-only");
    store.setAutoObjectScale(FOXTAIL_TYPE_ID, 0.6);
    const snap = store.settings;
    expect(snap.autoObjectScales[FOXTAIL_TYPE_ID]).toBe(0.6);
    expect(snap.autoObjectScales[MOUSE_TYPE_ID]).toBe(1.0);
    expect(snap.manualObjectScales[FOXTAIL_TYPE_ID]).toBe(1.0);
  });

  it("範囲外はクランプ、非有限/0以下は既定 1.0 へ正規化する（例外を投げない）", () => {
    const store = new SettingsStore("test:objectScale:normalize");
    store.setManualObjectScale(MOUSE_TYPE_ID, 99);
    expect(store.settings.manualObjectScales[MOUSE_TYPE_ID]).toBe(2.0); // MAX へクランプ
    store.setManualObjectScale(MOUSE_TYPE_ID, 0);
    expect(store.settings.manualObjectScales[MOUSE_TYPE_ID]).toBe(1.0); // 0以下→既定
    // @ts-expect-error 敵対的入力（異常型でも例外を投げず既定 1.0 へ）。
    expect(() => store.setAutoObjectScale(TOYS_TYPE_ID, true)).not.toThrow();
    expect(store.settings.autoObjectScales[TOYS_TYPE_ID]).toBe(1.0);
  });

  it("スナップショットのレコードは内部 state から切り離されている（直接改変が漏れない）", () => {
    const store = new SettingsStore("test:objectScale:snapshot-copy");
    store.setManualObjectScale(MOUSE_TYPE_ID, 1.6);
    const snap = store.settings;
    snap.manualObjectScales[MOUSE_TYPE_ID] = 0.5;
    // 次のスナップショットには漏れない（getter が浅コピーを返す）。
    expect(store.settings.manualObjectScales[MOUSE_TYPE_ID]).toBe(1.6);
  });
});
