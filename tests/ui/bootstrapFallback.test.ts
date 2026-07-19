import { describe, expect, it } from "vitest";
import { bootstrapFallbackMessage, bootstrapFallbackTitle } from "../../src/ui/BootstrapFallback";

// DOM 生成関数（showBootstrapFailure）は DOM 依存のため node env の Vitest では検証せず、
// 純関数の文言生成のみを検証する（実描画は agent-browser で担保）。

describe("bootstrapFallbackTitle", () => {
  it("穏やかな見出し文言を返す", () => {
    expect(bootstrapFallbackTitle()).toBe("うまく表示できませんでした");
  });
});

describe("bootstrapFallbackMessage", () => {
  it("再読み込み/最新ブラウザを案内する本文を返す", () => {
    const message = bootstrapFallbackMessage();
    expect(message).toContain("再読み込み");
    expect(message).toContain("ブラウザ");
    expect(message.length).toBeGreaterThan(0);
  });
});
