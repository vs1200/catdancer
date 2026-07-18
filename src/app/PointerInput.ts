import type { Vec2 } from "../core/vec2";
import type { Viewport } from "../core/worldBounds";

/** 参照共有される可変ポインタ状態。value=null はウィンドウ外（画面外へ逃がす合図）。 */
export interface PointerState {
  value: Vec2 | null;
}

/**
 * canvas 上のポインタ（マウス/タッチ）を world 座標へ変換し {@link PointerState} を更新する配線。
 *
 * - `pointermove` / `pointerdown`（＝タッチのタップ/ドラッグ含む）→ 画面座標を world 座標へ変換して更新。
 * - `pointerleave` / `pointerout`（canvas＝ウィンドウ外へ出た）→ value を null にし「外へ逃がす」。
 *
 * canvas は画面全体を覆う（index.html: #app/canvas とも 100vw/100vh）ため、canvas を離れる
 * ＝ウィンドウを離れる。座標変換は getBoundingClientRect と現在の viewport から毎回算出するので
 * devicePixelRatio(autoDensity で吸収済み) と resize に追従する（rect.width と viewport の比で拡縮補正）。
 */
export class PointerInput {
  readonly pointer: PointerState = { value: null };
  private readonly canvas: HTMLCanvasElement;
  private readonly getViewport: () => Viewport;
  private attached = false;

  constructor(canvas: HTMLCanvasElement, getViewport: () => Viewport) {
    this.canvas = canvas;
    this.getViewport = getViewport;
  }

  attach(): void {
    if (this.attached) {
      return;
    }
    this.attached = true;
    this.canvas.addEventListener("pointermove", this.onMove);
    this.canvas.addEventListener("pointerdown", this.onMove);
    this.canvas.addEventListener("pointerleave", this.onLeave);
    this.canvas.addEventListener("pointerout", this.onLeave);
  }

  detach(): void {
    if (!this.attached) {
      return;
    }
    this.attached = false;
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerdown", this.onMove);
    this.canvas.removeEventListener("pointerleave", this.onLeave);
    this.canvas.removeEventListener("pointerout", this.onLeave);
  }

  /** 現在の viewport 中心を初期ポインタにする（起動時にネズミが画面内に居るように）。 */
  centerToViewport(): void {
    const vp = this.getViewport();
    this.pointer.value = { x: vp.width / 2, y: vp.height / 2 };
  }

  private readonly onMove = (event: PointerEvent): void => {
    this.pointer.value = this.toWorld(event.clientX, event.clientY);
  };

  private readonly onLeave = (): void => {
    this.pointer.value = null;
  };

  /** 画面(client CSS px)座標 → world 座標。rect と viewport の比で CSS 拡縮も補正する。 */
  private toWorld(clientX: number, clientY: number): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    const vp = this.getViewport();
    const sx = rect.width > 0 ? vp.width / rect.width : 1;
    const sy = rect.height > 0 ? vp.height / rect.height : 1;
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  }
}
