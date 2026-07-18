import { describe, expect, it } from "vitest";
import { fullscreenButtonAriaLabel, fullscreenButtonLabel } from "../../src/ui/fullscreen";

// document 依存関数（isFullscreenSupported / requestAppFullscreen 等）は DOM 依存のため
// node env の Vitest では検証せず、純関数の文言生成のみを検証する。

describe("fullscreenButtonLabel", () => {
  it("active=true で「全画面を解除」を返す", () => {
    expect(fullscreenButtonLabel(true)).toBe("全画面を解除");
  });

  it("active=false で「全画面表示」を返す", () => {
    expect(fullscreenButtonLabel(false)).toBe("全画面表示");
  });
});

describe("fullscreenButtonAriaLabel", () => {
  it("active=true で「全画面表示を解除」を返す", () => {
    expect(fullscreenButtonAriaLabel(true)).toBe("全画面表示を解除");
  });

  it("active=false で「全画面表示にする」を返す", () => {
    expect(fullscreenButtonAriaLabel(false)).toBe("全画面表示にする");
  });
});
