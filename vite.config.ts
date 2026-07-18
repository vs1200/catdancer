/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  // 静的ホスティング（サブパス配信）でも動くよう相対パス基準にする。
  base: "./",
  test: {
    // 今回はロジック用途のため node 環境。描画テストが必要になれば jsdom を検討。
    environment: "node",
    include: ["src/**/*.{test,spec}.ts", "tests/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.workbench/**"],
  },
});
