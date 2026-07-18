/**
 * オプション画面（右下ボタン＋設定パネル）の CSS を一度だけ注入する。
 *
 * 方針:
 * - canvas の上に重なる DOM オーバーレイ。z-index を極大にして PixiJS canvas より前面へ。
 * - パネルは「任意の背景色/画像の上でも読める」よう半透明の濃色カード＋明色テキスト。
 * - 右下ボタンは低主張（低 opacity・小サイズ）。hover/focus で前面化。
 * - クラス名は `cd-` prefix で衝突を避ける。
 */

const STYLE_ELEMENT_ID = "catdancer-options-styles";

/** canvas より前面に出すための z-index。ボタンはオーバーレイより更に前面（開いていてもトグル可能）。 */
const OVERLAY_Z_INDEX = 2147483000;
const BUTTON_Z_INDEX = OVERLAY_Z_INDEX + 1;

const CSS = `
.cd-options-button {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(20, 22, 28, 0.55);
  color: #f4f4f6;
  font-size: 22px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0.5;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
  transition: opacity 0.15s ease, background 0.15s ease;
  z-index: ${BUTTON_Z_INDEX};
}
.cd-options-button:hover,
.cd-options-button:focus-visible {
  opacity: 1;
  background: rgba(20, 22, 28, 0.82);
}
.cd-options-button:focus-visible {
  outline: 2px solid #7cc4ff;
  outline-offset: 2px;
}

.cd-options-overlay {
  position: fixed;
  inset: 0;
  display: none;
  /* 透明な背面クリックキャッチャ。背後のアニメ/猫の視界は遮らない。 */
  background: transparent;
  z-index: ${OVERLAY_Z_INDEX};
}
.cd-options-overlay.cd-open {
  display: block;
}

.cd-options-panel {
  position: fixed;
  right: 16px;
  bottom: 72px;
  box-sizing: border-box;
  width: min(320px, calc(100vw - 32px));
  max-height: calc(100vh - 96px);
  overflow-y: auto;
  padding: 16px 18px 18px;
  border-radius: 14px;
  /* 半透明の濃色カード＋明色テキストで任意背景でも可読。 */
  background: rgba(24, 26, 32, 0.92);
  color: #f4f4f6;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.5;
}

.cd-options-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.cd-options-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.cd-options-close {
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #cfd2da;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
.cd-options-close:hover,
.cd-options-close:focus-visible {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.cd-options-section {
  margin-top: 14px;
}
.cd-options-section:first-of-type {
  margin-top: 0;
}
.cd-options-section-title {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #a7abb6;
}

.cd-options-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.cd-options-row:last-child {
  margin-bottom: 0;
}
.cd-options-label {
  color: #e8e9ee;
  flex: 0 0 auto;
}

.cd-options-select {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 180px;
  padding: 6px 8px;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: #e8e9ee;
  font-size: 13px;
  cursor: pointer;
}
.cd-options-select:focus-visible {
  outline: 2px solid #7cc4ff;
  outline-offset: 1px;
}

/* 無効化した行（例: manual モード時の出現間隔）は淡色＋操作不可にする。 */
.cd-options-row-disabled {
  opacity: 0.45;
}
.cd-options-row-disabled input[type="range"] {
  cursor: not-allowed;
}

.cd-options-panel input[type="color"] {
  width: 46px;
  height: 30px;
  padding: 2px;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}
.cd-options-panel input[type="range"] {
  flex: 1 1 auto;
  min-width: 0;
  cursor: pointer;
  accent-color: #7cc4ff;
}
.cd-volume-value {
  flex: 0 0 auto;
  min-width: 34px;
  text-align: right;
  color: #cfd2da;
  font-variant-numeric: tabular-nums;
}

/* 「出現する種類」チェックボックス（種別 ON/OFF）。 */
.cd-options-checkbox {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #7cc4ff;
}

.cd-options-file-button,
.cd-options-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 7px 12px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: #e8e9ee;
  font-size: 13px;
  cursor: pointer;
}
.cd-options-file-button:hover,
.cd-options-file-button:focus-within,
.cd-options-secondary:hover,
.cd-options-secondary:focus-visible {
  background: rgba(255, 255, 255, 0.14);
}
.cd-options-secondary {
  width: 100%;
}

/* 出現プリセットのボタン群（横並び・均等幅。cd-options-secondary の width:100% を上書きして 3 分割する）。 */
.cd-options-preset-group {
  display: flex;
  flex: 1 1 auto;
  gap: 8px;
  min-width: 0;
}
.cd-options-preset-group .cd-options-secondary {
  flex: 1 1 0;
  width: auto;
  padding: 7px 8px;
}
/* 無効化行（manual モード）のプリセットボタンは操作不可を明示する（range と同じ流儀）。 */
.cd-options-row-disabled .cd-options-secondary {
  cursor: not-allowed;
}

/* file input は視覚的に隠すが DOM 上には残す（自動化アップロード対象になれるように）。 */
.cd-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  overflow: hidden;
  white-space: nowrap;
}
`;

/** オプション UI 用のスタイルを（未注入なら）head へ一度だけ差し込む。 */
export function ensureOptionsStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ELEMENT_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
