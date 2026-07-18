import { describe, expect, it } from "vitest";

// 品質ゲート（pnpm test）が緑になることを確認するための最小 sanity test。
describe("sanity", () => {
  it("1 + 1 === 2", () => {
    expect(1 + 1).toBe(2);
  });
});
