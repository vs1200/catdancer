import { describe, expect, it } from "vitest";
import { InertManualController } from "../../src/modes/manual/InertManualController";

/**
 * [UR3-10] InertManualController（任意画像を選択したが画像未ロードの待機状態）の単体テスト。
 *
 * critter を出さず・入力配線もせず・無音であることを、全メソッドが副作用なく（throw せず）
 * no-op として振る舞い、debugSnapshot が null（critter 未生成）を返すことで確認する。
 * Pixi 非依存の純クラスなので node(Vitest) で直接インスタンス化できる。
 */
describe("InertManualController", () => {
  it("全メソッドが no-op で throw せず、debugSnapshot は null（critter 未生成）", () => {
    const controller = new InertManualController();
    expect(() => {
      controller.start();
      controller.setSpeedScale(2.5);
      controller.setPaused(true);
      controller.setPaused(false);
      controller.update(0.016);
      controller.onPointerDown(10, 20);
      controller.stop();
    }).not.toThrow();
    expect(controller.debugSnapshot()).toBeNull();
  });

  it("start/stop/update の多重呼び出しも冪等で throw しない（critter を出さないまま）", () => {
    const controller = new InertManualController();
    expect(() => {
      controller.start();
      controller.start();
      controller.update(0.5);
      controller.stop();
      controller.stop();
      // stop 後の update/onPointerDown も安全。
      controller.update(0.5);
      controller.onPointerDown(1, 2);
    }).not.toThrow();
    expect(controller.debugSnapshot()).toBeNull();
  });
});
