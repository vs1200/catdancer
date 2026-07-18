import { Assets } from "pixi.js";
import { CatDancerApp } from "./app/CatDancerApp";
import { Scene } from "./app/Scene";
import { createCritter } from "./critters/Critter";
import { getCritterType } from "./critters/registry";
import { MOUSE_TYPE_ID, registerMouseType } from "./critters/types/mouse";
import type { MovementContext } from "./movement/Movement";

/**
 * catdancer エントリ。App 起動 → Scene 構築 → ネズミ種別を登録 →
 * ネズミ 1 体を生成し DriftMovement で緩やかに動かす通し smoke。
 * 本命のマウス追従・尻尾・SE・背景設定は後続タスクで追加する。
 */
async function bootstrap(): Promise<void> {
  const mount = document.querySelector<HTMLDivElement>("#app");
  if (!mount) {
    throw new Error("マウント先 #app が見つかりません");
  }

  const app = await CatDancerApp.create(mount);

  const scene = new Scene(app.viewport);
  app.stage.addChild(scene.root);
  app.onResize((viewport) => scene.resize(viewport));

  // 種別レジストリへネズミを登録し、テクスチャをロードして 1 体生成する。
  registerMouseType();
  const mouseType = getCritterType(MOUSE_TYPE_ID);
  const texture = await Assets.load(mouseType.textureUrl);

  const critter = createCritter(MOUSE_TYPE_ID, texture, {
    position: { x: app.viewport.width / 2, y: app.viewport.height / 2 },
  });
  scene.add(critter);

  // 毎フレーム movement を適用して表示同期。world は resize で作り直されるため都度参照。
  const ctx: MovementContext = { world: scene.worldBounds, pointer: null };
  app.ticker.add((ticker) => {
    ctx.world = scene.worldBounds;
    critter.update(ticker.deltaMS / 1000, ctx);
  });
}

bootstrap().catch((error: unknown) => {
  console.error("catdancer の起動に失敗しました:", error);
});
