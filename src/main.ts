import { Application } from "pixi.js";

/**
 * hello-canvas: PixiJS v8 の Application を async 初期化し、
 * フルスクリーン（resizeTo: window）で背景色付きの空 canvas を #app に描画する。
 * v8 では `new Application()` 後に `await app.init({...})` する点に注意。
 */
async function bootstrap(): Promise<void> {
  const mount = document.querySelector<HTMLDivElement>("#app");
  if (!mount) {
    throw new Error("マウント先 #app が見つかりません");
  }

  const app = new Application();

  await app.init({
    // ウィンドウサイズに追従（リサイズ対応込み）。
    resizeTo: window,
    background: "#1099bb",
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  });

  mount.appendChild(app.canvas);
}

bootstrap().catch((error: unknown) => {
  console.error("catdancer の起動に失敗しました:", error);
});
