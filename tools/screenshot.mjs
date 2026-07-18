// catdancer ヘッドレススクリーンショット検証ツール。
//
// pnpm build 済みの dist/ を簡易静的サーバ(ephemeral port)で配信し、
// Playwright(headless Chromium)で WebGL 描画を PNG 化する。
// この環境ではブラウザ画面を直接見られないため、人/メインの目視 QA に使う。
//
// 使い方:
//   pnpm build && pnpm shoot
//   撮影タイミング(ms)は環境変数 SHOOT_TIMES_MS で変更可能:
//     SHOOT_TIMES_MS=300,1000,2000 pnpm shoot
//
// 出力: .workbench/artifacts/shots/shot-01.png, shot-02.png, ...
//   固定名(非決定値を使わない)。.workbench/ は git-ignored。
//
// 備考: file:// は ESM/CORS の都合で不可のため必ず HTTP 配信する。
//   dist は base:"./" ビルドなのでルート配信で相対アセットが解決される。

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const DIST_DIR = join(REPO_ROOT, "dist");
const OUT_DIR = join(REPO_ROOT, ".workbench", "artifacts", "shots");

// 固定 viewport(CSS px)。deviceScaleFactor=1 で backing store も同寸になり決定的。
const VIEWPORT = { width: 1280, height: 800 };

// 撮影タイミング(ms)。アニメ確認のため複数フレームを撮る。環境変数で上書き可。
const CAPTURE_TIMES_MS = parseTimes(process.env.SHOOT_TIMES_MS, [500, 1500]);

// headless Chromium で WebGL(SwiftShader ソフトウェアレンダリング)を有効化する起動フラグ。
// 新しい Chromium は SwiftShader での WebGL を既定で拒否するため明示的に許可する。
const CHROMIUM_ARGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

function parseTimes(raw, fallback) {
  if (!raw) {
    return fallback;
  }
  const times = raw
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return times.length > 0 ? times : fallback;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** dist/ を配信する簡易静的サーバを ephemeral port で起動し、実 URL を返す。 */
async function startStaticServer() {
  const server = createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      res.writeHead(500).end("Internal Server Error");
    });
  });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return { server, url: `http://127.0.0.1:${port}/` };
}

async function handleRequest(req, res) {
  try {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const filePath = normalize(join(DIST_DIR, relative));
    // ディレクトリトラバーサル防止: dist の外は配信しない。
    if (!filePath.startsWith(DIST_DIR)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const body = await readFile(filePath);
    const mime = MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime }).end(body);
  } catch {
    res.writeHead(404).end("Not Found");
  }
}

async function main() {
  if (!existsSync(join(DIST_DIR, "index.html"))) {
    console.error("dist/index.html が見つかりません。先に `pnpm build` を実行してください。");
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });

  const { server, url } = await startStaticServer();
  const browser = await chromium.launch({
    // full Chromium ビルド + 新 headless。headless shell より WebGL の互換性が高い。
    channel: "chromium",
    headless: true,
    args: CHROMIUM_ARGS,
  });

  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        pageErrors.push(msg.text());
      }
    });

    console.log(`配信 URL: ${url}`);
    await page.goto(url, { waitUntil: "load" });
    await page.waitForSelector("#app canvas", { timeout: 15_000 });

    // 昇順に撮ることで累積待機で各タイミングに到達できる。
    const sorted = [...CAPTURE_TIMES_MS].sort((a, b) => a - b);
    let elapsed = 0;
    let index = 0;
    for (const t of sorted) {
      await page.waitForTimeout(Math.max(0, t - elapsed));
      elapsed = t;
      index += 1;
      const file = join(OUT_DIR, `shot-${pad2(index)}.png`);
      await page.screenshot({ path: file });
      console.log(`撮影: ${file} (t=${t}ms)`);
    }

    if (pageErrors.length > 0) {
      console.warn("ページ内でエラーを検知しました(参考):");
      for (const message of pageErrors) {
        console.warn(`  ${message}`);
      }
    }

    console.log(`完了: ${index} 枚を ${OUT_DIR} に保存しました。`);
  } finally {
    // preview/ブラウザを確実に停止し、残プロセスを残さない。
    await browser.close();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
}

main().catch((error) => {
  console.error("スクリーンショット取得に失敗しました:", error);
  process.exit(1);
});
