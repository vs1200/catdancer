import { describe, expect, it } from "vitest";
import { OPTIONS_TABS, tabKeyTarget } from "../../src/ui/optionsTabs";

describe("OPTIONS_TABS", () => {
  it("共通/マウスモード/動画モードの 3 タブをこの順で持つ", () => {
    expect(OPTIONS_TABS.map((t) => t.id)).toEqual(["common", "manual", "auto"]);
    expect(OPTIONS_TABS.map((t) => t.label)).toEqual(["共通", "マウスモード", "動画モード"]);
  });

  it("初期選択は先頭（共通）", () => {
    expect(OPTIONS_TABS[0].id).toBe("common");
  });
});

describe("tabKeyTarget", () => {
  const count = OPTIONS_TABS.length;

  it("ArrowRight/ArrowDown は次へ進み、末尾は先頭へラップする", () => {
    expect(tabKeyTarget(0, "ArrowRight", count)).toBe(1);
    expect(tabKeyTarget(1, "ArrowDown", count)).toBe(2);
    expect(tabKeyTarget(2, "ArrowRight", count)).toBe(0);
  });

  it("ArrowLeft/ArrowUp は前へ戻り、先頭は末尾へラップする", () => {
    expect(tabKeyTarget(2, "ArrowLeft", count)).toBe(1);
    expect(tabKeyTarget(1, "ArrowUp", count)).toBe(0);
    expect(tabKeyTarget(0, "ArrowLeft", count)).toBe(2);
  });

  it("Home は先頭、End は末尾を返す", () => {
    expect(tabKeyTarget(2, "Home", count)).toBe(0);
    expect(tabKeyTarget(0, "End", count)).toBe(count - 1);
  });

  it("対象外キーは -1（移動しない）", () => {
    expect(tabKeyTarget(1, "Enter", count)).toBe(-1);
    expect(tabKeyTarget(1, " ", count)).toBe(-1);
    expect(tabKeyTarget(1, "a", count)).toBe(-1);
  });

  it("タブ 0 個のときは常に -1", () => {
    expect(tabKeyTarget(0, "ArrowRight", 0)).toBe(-1);
    expect(tabKeyTarget(0, "Home", 0)).toBe(-1);
  });
});
