import { Assets } from "pixi.js";
import { CatDancerApp } from "./app/CatDancerApp";
import { PointerInput } from "./app/PointerInput";
import { DEFAULT_WORLD_MARGIN, Scene } from "./app/Scene";
import { createCritter } from "./critters/Critter";
import { getCritterType, listCritterTypes } from "./critters/registry";
import { MOUSE_TYPE_ID, registerMouseType } from "./critters/types/mouse";
import { computeWorldMargin } from "./critters/worldMargin";
import type { MovementContext } from "./movement/Movement";

/**
 * catdancer エントリ（v1 マウス操作モード）。
 * App 起動 → 種別登録 → 種別から world margin(画面外バッファ)を動的算出 → Scene 構築 →
 * ネズミ 1 体を生成し、ポインタへ慣性追従(MouseFollowMovement)させる。
 * ポインタがウィンドウ外へ出れば画面外へ走り去って隠れ、戻れば再出現する。
 */
async function bootstrap(): Promise<void> {
  const mount = document.querySelector<HTMLDivElement>("#app");
  if (!mount) {
    throw new Error("マウント先 #app が見つかりません");
  }

  const app = await CatDancerApp.create(mount);

  // 種別レジストリへネズミを登録し、その hideRadius から margin を決める（本体＋尻尾を隠せる幅）。
  registerMouseType();
  const margin = computeWorldMargin(listCritterTypes(), DEFAULT_WORLD_MARGIN);

  const scene = new Scene(app.viewport, margin);
  app.stage.addChild(scene.root);
  app.onResize((viewport) => scene.resize(viewport));

  // ポインタ入力を配線。起動時は viewport 中心を初期ポインタにしてネズミを画面内に出す。
  const pointerInput = new PointerInput(app.canvas, () => app.viewport);
  pointerInput.attach();
  pointerInput.centerToViewport();

  // テクスチャをロードしてネズミ 1 体を画面中央に生成（初速なし＝加速で追従開始）。
  const mouseType = getCritterType(MOUSE_TYPE_ID);
  const texture = await Assets.load(mouseType.textureUrl);
  const critter = createCritter(MOUSE_TYPE_ID, texture, {
    position: { x: app.viewport.width / 2, y: app.viewport.height / 2 },
  });
  scene.add(critter);

  // 毎フレーム movement を適用して表示同期。world/pointer は都度最新を参照（resize 追従）。
  const ctx: MovementContext = { world: scene.worldBounds, pointer: pointerInput.pointer.value };
  app.ticker.add((ticker) => {
    ctx.world = scene.worldBounds;
    ctx.pointer = pointerInput.pointer.value;
    critter.update(ticker.deltaMS / 1000, ctx);
  });
}

bootstrap().catch((error: unknown) => {
  console.error("catdancer の起動に失敗しました:", error);
});
