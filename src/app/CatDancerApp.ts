import type { Container, Ticker } from "pixi.js";
import { Application } from "pixi.js";
import type { Viewport } from "../core/worldBounds";

export type ResizeHandler = (viewport: Viewport) => void;

export interface CatDancerAppOptions {
  /** 背景色（単色）。当面のデモ用途。背景画像設定は後続タスク。 */
  background?: string;
}

/**
 * PixiJS v8 Application の async 初期化ラッパ。
 * ticker / stage / viewport を公開し、リサイズを購読者(Scene 等)へ通知する。
 */
export class CatDancerApp {
  private readonly app: Application;
  private readonly resizeHandlers = new Set<ResizeHandler>();

  private constructor(app: Application) {
    this.app = app;
  }

  static async create(mount: HTMLElement, options?: CatDancerAppOptions): Promise<CatDancerApp> {
    const app = new Application();
    await app.init({
      // ウィンドウサイズに追従（リサイズ対応込み）。
      resizeTo: window,
      background: options?.background ?? "#1099bb",
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    mount.appendChild(app.canvas);

    const instance = new CatDancerApp(app);
    // renderer は resize 完了時に "resize" を emit する（AbstractRenderer.resize 内）。
    app.renderer.on("resize", instance.handleRendererResize);
    return instance;
  }

  get ticker(): Ticker {
    return this.app.ticker;
  }

  get stage(): Container {
    return this.app.stage;
  }

  /** 現在の画面サイズ（CSS ピクセル）。 */
  get viewport(): Viewport {
    return { width: this.app.screen.width, height: this.app.screen.height };
  }

  onResize(handler: ResizeHandler): void {
    this.resizeHandlers.add(handler);
  }

  offResize(handler: ResizeHandler): void {
    this.resizeHandlers.delete(handler);
  }

  private readonly handleRendererResize = (): void => {
    const viewport = this.viewport;
    for (const handler of this.resizeHandlers) {
      handler(viewport);
    }
  };

  destroy(): void {
    this.app.renderer.off("resize", this.handleRendererResize);
    this.resizeHandlers.clear();
    this.app.destroy(true, { children: true });
  }
}
