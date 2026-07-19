import { describe, expect, it } from "vitest";
import { keyToShortcutAction, type ShortcutContext } from "../../src/ui/keyboardShortcuts";

// isEditableEventTarget は DOM（HTMLElement）依存のため node env の Vitest では検証せず、
// キー写像の純関数（keyToShortcutAction）のみを検証する（配線は agent-browser 担保）。

/** ガード全て非該当（＝ショートカットが有効になる）文脈。 */
const active: ShortcutContext = {
  hasModifier: false,
  isComposing: false,
  panelOpen: false,
  editableTarget: false,
};

describe("keyToShortcutAction（キー割り当て）", () => {
  it("Space（半角スペース）は toggle-pause", () => {
    expect(keyToShortcutAction(" ", active)).toBe("toggle-pause");
  });

  it("旧仕様の Spacebar も toggle-pause", () => {
    expect(keyToShortcutAction("Spacebar", active)).toBe("toggle-pause");
  });

  it("f / F は toggle-fullscreen（大小どちらも）", () => {
    expect(keyToShortcutAction("f", active)).toBe("toggle-fullscreen");
    expect(keyToShortcutAction("F", active)).toBe("toggle-fullscreen");
  });

  it("m / M は toggle-mode（大小どちらも）", () => {
    expect(keyToShortcutAction("m", active)).toBe("toggle-mode");
    expect(keyToShortcutAction("M", active)).toBe("toggle-mode");
  });

  it("割り当て外のキーは null（既定動作を邪魔しない）", () => {
    expect(keyToShortcutAction("Escape", active)).toBeNull();
    expect(keyToShortcutAction("a", active)).toBeNull();
    expect(keyToShortcutAction("Enter", active)).toBeNull();
    expect(keyToShortcutAction("ArrowLeft", active)).toBeNull();
  });
});

describe("keyToShortcutAction（無効化ガード）", () => {
  it("修飾キー付き（Ctrl/Meta/Alt）は無視される", () => {
    expect(keyToShortcutAction(" ", { ...active, hasModifier: true })).toBeNull();
    expect(keyToShortcutAction("f", { ...active, hasModifier: true })).toBeNull();
    expect(keyToShortcutAction("m", { ...active, hasModifier: true })).toBeNull();
  });

  it("IME 変換中（isComposing）は無視される", () => {
    expect(keyToShortcutAction(" ", { ...active, isComposing: true })).toBeNull();
    expect(keyToShortcutAction("m", { ...active, isComposing: true })).toBeNull();
  });

  it("設定パネルが開いている間は無視される（Esc は OptionsPanel が処理）", () => {
    expect(keyToShortcutAction(" ", { ...active, panelOpen: true })).toBeNull();
    expect(keyToShortcutAction("f", { ...active, panelOpen: true })).toBeNull();
  });

  it("入力欄フォーカス中（editableTarget）は無視される", () => {
    expect(keyToShortcutAction(" ", { ...active, editableTarget: true })).toBeNull();
    expect(keyToShortcutAction("m", { ...active, editableTarget: true })).toBeNull();
  });

  it("複数ガードが同時に該当しても null", () => {
    expect(
      keyToShortcutAction(" ", {
        hasModifier: true,
        isComposing: true,
        panelOpen: true,
        editableTarget: true,
      }),
    ).toBeNull();
  });
});
