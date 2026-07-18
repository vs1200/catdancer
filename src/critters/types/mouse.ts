import { DriftMovement } from "../../movement/DriftMovement";
import type { CritterType } from "../CritterType";
import { registerCritterType } from "../registry";

export const MOUSE_TYPE_ID = "mouse";

// Vite は base:"./" 環境。絶対 /assets ではなく BASE_URL 基点で解決する。
const MOUSE_TEXTURE_URL = `${import.meta.env.BASE_URL}assets/critters/mouse-body.webp`;

/**
 * ネズミ種別。元画像は右向き(defaultFacing=1)。
 * 尻尾は次タスクで MeshRope 実装予定（hasTail=true）。SE 識別子はプレースホルダ。
 */
export const mouseType: CritterType = {
  id: MOUSE_TYPE_ID,
  displayName: "ネズミ",
  textureUrl: MOUSE_TEXTURE_URL,
  baseSize: 160,
  defaultFacing: 1,
  createMovement: () => new DriftMovement(),
  sounds: { idle: "mouse-chuchu", move: "mouse-run" },
  hasTail: true,
};

/** ネズミ種別をレジストリへ登録する。 */
export function registerMouseType(): void {
  registerCritterType(mouseType);
}
