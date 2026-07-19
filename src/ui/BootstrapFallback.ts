/**
 * 起動失敗時のユーザー向けフォールバック表示（DOM オーバーレイ）。
 *
 * bootstrap が失敗（reject/throw）したとき、画面が真っ白のままにならないよう、穏やかで
 * 猫向けアプリらしい日本語メッセージを画面中央に表示する。WebGL/WebGPU 非対応・初期化例外・
 * `#app` 不在など、原因を問わず「壊れた・固まった」ように見えるのを避けるのが目的。
 *
 * 方針（OptionsButton/PlayLimitOverlay の流儀に合わせる）:
 * - スタイルは専用 ensure 関数で一度だけ head へ注入（グローバル汚染しない）。
 * - 外部アセット/フォント/ネットワークは使わず自己完結（失敗時なので確実に描けること優先）。
 * - 背景色に依存せず可読なよう、やや不透明なバックドロップ＋自前背景のカードで表示する。
 * - 失敗時なので最前面寄りに置く（歯車/パネル/おやすみオーバーレイより前面）。ただし成功時は
 *   一切描画しない（呼ぶのは main.ts の catch 経路のみ）。
 *
 * テスト方針: 純関数（bootstrapFallbackTitle / bootstrapFallbackMessage）のみ node env の
 * Vitest 対象。DOM を生成する showBootstrapFailure は DOM 依存のため node テスト対象外
 * （jsdom を使わず、実描画は agent-browser で担保する）。
 */

/** 二重描画を避けるためのルート要素 id（既に在れば作り直さない）。 */
const ELEMENT_ID = "catdancer-bootstrap-fallback";

/** スタイル要素の id（未注入なら一度だけ head へ差し込む）。 */
const STYLE_ELEMENT_ID = "catdancer-bootstrap-fallback-styles";

/**
 * 失敗時なので最前面寄りに置く。既存の歯車ボタン(2147483001)/オプションパネル(2147483000)/
 * おやすみオーバーレイ(2147482000)いずれとも衝突しない、より大きな値にする。
 */
const OVERLAY_Z_INDEX = 2147483040;

/** フォールバックの見出し文言を返す純関数（技術的すぎない穏やかな日本語）。 */
export function bootstrapFallbackTitle(): string {
  return "うまく表示できませんでした";
}

/** フォールバックの本文文言を返す純関数（再読み込み/最新ブラウザを穏やかに案内する）。 */
export function bootstrapFallbackMessage(): string {
  return "お使いのブラウザが対応していないか、一時的な問題かもしれません。ページを再読み込みするか、最新のブラウザでお試しください。";
}

const CSS = `
.cd-bootstrap-fallback {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  /* 背景色/描画状態に依存せず可読にするため、やや不透明な暗幕で覆う。 */
  background: rgba(16, 18, 26, 0.72);
  z-index: ${OVERLAY_Z_INDEX};
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.cd-bootstrap-card {
  box-sizing: border-box;
  width: min(400px, calc(100vw - 48px));
  padding: 30px 28px 26px;
  border-radius: 18px;
  text-align: center;
  /* カード自体に背景を持たせ、どんな背景色でもコントラストを確保する。 */
  background: #1b1e26;
  color: #f4f4f6;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.cd-bootstrap-icon {
  margin: 0 0 12px;
  font-size: 30px;
  line-height: 1;
}
.cd-bootstrap-title {
  margin: 0 0 12px;
  font-size: 21px;
  font-weight: 600;
  line-height: 1.35;
}
.cd-bootstrap-message {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: #cfd2da;
}
`;

/** フォールバック用のスタイルを（未注入なら）head へ一度だけ差し込む。 */
function ensureBootstrapFallbackStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ELEMENT_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/**
 * 起動失敗のフォールバックメッセージを container（通常 `#app`、無ければ `document.body`）へ表示する。
 *
 * - 成功時は呼ばれない（main.ts の catch 経路からのみ呼ぶ想定）。
 * - 冪等: 既に表示済み（同 id の要素が在る）なら作り直さない。
 * - アクセシビリティ: ルートに role="alert" を付け、支援技術へ通知する。
 */
export function showBootstrapFailure(container: HTMLElement): void {
  if (typeof document === "undefined") {
    return;
  }
  // 二重描画しない（catch は 1 回想定だが、既存要素があれば作り直さない軽い冪等性）。
  if (document.getElementById(ELEMENT_ID)) {
    return;
  }
  ensureBootstrapFallbackStyles();

  const overlay = document.createElement("div");
  overlay.id = ELEMENT_ID;
  overlay.className = "cd-bootstrap-fallback";
  overlay.setAttribute("role", "alert");

  const card = document.createElement("div");
  card.className = "cd-bootstrap-card";

  // 控えめな肉球アイコン（装飾のため読み上げ対象外）。
  const icon = document.createElement("div");
  icon.className = "cd-bootstrap-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "🐾";

  const title = document.createElement("h1");
  title.className = "cd-bootstrap-title";
  title.textContent = bootstrapFallbackTitle();

  const message = document.createElement("p");
  message.className = "cd-bootstrap-message";
  message.textContent = bootstrapFallbackMessage();

  card.append(icon, title, message);
  overlay.appendChild(card);
  container.appendChild(overlay);
}
