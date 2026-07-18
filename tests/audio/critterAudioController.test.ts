import { describe, expect, it } from "vitest";
import type { AudioSink } from "../../src/audio/AudioManager";
import { CritterAudioController } from "../../src/audio/CritterAudioController";
import type { LoopVoice } from "../../src/audio/synth";

/** SE 呼び出しを記録するフェイク sink（Web Audio 非依存でグルーを検証する）。 */
function makeFakeSink() {
  const levels: number[] = [];
  const fired: string[] = [];
  let loopsCreated = 0;
  const sink: AudioSink = {
    playOneShot: (id) => {
      fired.push(id);
    },
    createLoop: (): LoopVoice => {
      loopsCreated++;
      return {
        setLevel: (l) => {
          levels.push(l);
        },
        stop: () => undefined,
      };
    },
  };
  return {
    sink,
    levels,
    fired,
    get loopsCreated() {
      return loopsCreated;
    },
  };
}

describe("CritterAudioController", () => {
  it("start で move ループを 1 本生成し、初期レベル 0 を設定する", () => {
    const f = makeFakeSink();
    const ctrl = new CritterAudioController(f.sink, { voice: "v", move: "m" });
    ctrl.start();
    expect(f.loopsCreated).toBe(1);
    expect(f.levels).toEqual([0]);
  });

  it("start は多重呼び出ししてもループを増やさない", () => {
    const f = makeFakeSink();
    const ctrl = new CritterAudioController(f.sink, { voice: "v", move: "m" });
    ctrl.start();
    ctrl.start();
    expect(f.loopsCreated).toBe(1);
  });

  it("update で速さに応じて走行音レベルを更新する（静止で 0、高速で 1）", () => {
    const f = makeFakeSink();
    const ctrl = new CritterAudioController(
      f.sink,
      { move: "m" },
      { scurry: { minSpeed: 20, maxSpeed: 120 } },
    );
    ctrl.start();

    ctrl.update(0, 1 / 60, true);
    expect(ctrl.scurryLevel).toBe(0);

    ctrl.update(70, 1 / 60, true);
    expect(ctrl.scurryLevel).toBeCloseTo(0.5, 6);

    ctrl.update(9999, 1 / 60, true);
    expect(ctrl.scurryLevel).toBe(1);

    // setLevel は start の 0 に続いて各 update ぶん呼ばれている。
    expect(f.levels.length).toBe(4);
    expect(f.levels.at(-1)).toBe(1);
  });

  it("スケジューラ発火時に voice ワンショットを鳴らす（速度非依存で待機中でも鳴る）", () => {
    const f = makeFakeSink();
    const ctrl = new CritterAudioController(
      f.sink,
      { voice: "squeak", move: "m" },
      { squeak: { minInterval: 1, maxInterval: 1, rng: () => 0 } },
    );
    ctrl.start();

    // 速度 0（静止）でも時間が来れば鳴る。
    ctrl.update(0, 0.5, true);
    expect(f.fired).toHaveLength(0);
    ctrl.update(0, 0.6, true); // 累積 1.1s > 1s → 発火
    expect(f.fired).toEqual(["squeak"]);
  });

  it("voice 未設定ならワンショットを鳴らさない", () => {
    const f = makeFakeSink();
    const ctrl = new CritterAudioController(
      f.sink,
      { move: "m" },
      { squeak: { minInterval: 0.1, maxInterval: 0.1, rng: () => 0 } },
    );
    ctrl.start();
    ctrl.update(0, 1, true);
    expect(f.fired).toHaveLength(0);
  });

  it("move 未設定ならループを生成しない（setLevel も呼ばない）", () => {
    const f = makeFakeSink();
    const ctrl = new CritterAudioController(f.sink, { voice: "v" });
    ctrl.start();
    ctrl.update(500, 1 / 60, true);
    expect(f.loopsCreated).toBe(0);
    expect(f.levels).toHaveLength(0);
    // レベル計算自体は行われる（デバッグ表示用）。
    expect(ctrl.scurryLevel).toBe(1);
  });

  it("present=false のとき move レベルを 0 にし voice を鳴らさない（在否ゲート）", () => {
    const f = makeFakeSink();
    const ctrl = new CritterAudioController(
      f.sink,
      { voice: "squeak", move: "m" },
      {
        scurry: { minSpeed: 20, maxSpeed: 120 },
        squeak: { minInterval: 0.1, maxInterval: 0.1, rng: () => 0 },
      },
    );
    ctrl.start();
    // 高速でも present=false なら走行音レベルは 0（＝この種別のSEは鳴らさない）。
    ctrl.update(9999, 1, false);
    expect(ctrl.scurryLevel).toBe(0);
    // start の 0 に続いて present=false でも 0 を設定する。
    expect(f.levels.at(-1)).toBe(0);
    // present=false の間は時間が経っても voice を鳴らさない。
    expect(f.fired).toHaveLength(0);

    // present=true に戻れば通常どおり駆動する（レベル上昇＋voice 発火）。
    ctrl.update(9999, 1, true);
    expect(ctrl.scurryLevel).toBe(1);
    expect(f.fired).toEqual(["squeak"]);
  });

  it("silence() で走行音レベルを 0 に落とす（pause 時ミュート、voice 非発火・冪等）", () => {
    const f = makeFakeSink();
    const ctrl = new CritterAudioController(
      f.sink,
      { voice: "squeak", move: "m" },
      {
        scurry: { minSpeed: 20, maxSpeed: 120 },
        squeak: { minInterval: 0.1, maxInterval: 0.1, rng: () => 0 },
      },
    );
    ctrl.start();
    // present=true で走行音レベルを上げておく（level>0 の状態を作る）。
    ctrl.update(9999, 1, true);
    expect(ctrl.scurryLevel).toBe(1);
    const firedBefore = f.fired.length;

    // silence でレベル 0、LoopVoice へ setLevel(0) が伝わる。voice は鳴らさない。
    ctrl.silence();
    expect(ctrl.scurryLevel).toBe(0);
    expect(f.levels.at(-1)).toBe(0);
    expect(f.fired.length).toBe(firedBefore);

    // 冪等: 二重 silence でも安全（例外なく 0 のまま）。
    ctrl.silence();
    expect(ctrl.scurryLevel).toBe(0);
  });

  it("start 前の silence() でもクラッシュしない（moveVoice 未生成でも安全）", () => {
    const f = makeFakeSink();
    const ctrl = new CritterAudioController(f.sink, { move: "m" });
    // start していないので moveVoice は null。optional chaining で no-op になる。
    expect(() => ctrl.silence()).not.toThrow();
    expect(ctrl.scurryLevel).toBe(0);
    expect(f.loopsCreated).toBe(0);
  });
});
