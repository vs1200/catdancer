import { describe, expect, it, vi } from "vitest";
import { ManualMode } from "../../src/modes/ManualMode";
import type {
  ManualController,
  ManualControllerFactory,
  ManualControllerSnapshot,
} from "../../src/modes/manual/ManualController";

/**
 * ManualMode（マウス操作モードのコーディネータ）のライフサイクル/種別切替/継承/委譲の単体テスト。
 *
 * ManualMode は type-only import のみで Pixi 実体に触れないため node(Vitest) で直接インスタンス化できる。
 * 実挙動を担う {@link ManualController} は fake（呼び出し履歴を記録する軽量スタブ）を factory 経由で注入し、
 * コーディネータの「いつ・どの順で・どの引数で controller を start/stop/setPaused/setSpeedScale へ委譲し、
 * speedScale/paused を切替後の新 controller へ引き継ぐか」だけを Pixi 非依存で検証する
 * （AutoMode.test の fake scene スタイルに倣う）。
 */

/** vi.fn で各メソッドを spy した fake ManualController。 */
interface FakeController extends ManualController {
  start: ReturnType<typeof vi.fn<() => void>>;
  stop: ReturnType<typeof vi.fn<() => void>>;
  setPaused: ReturnType<typeof vi.fn<(paused: boolean) => void>>;
  setSpeedScale: ReturnType<typeof vi.fn<(scale: number) => void>>;
  update: ReturnType<typeof vi.fn<(dt: number) => void>>;
  onPointerDown: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;
  debugSnapshot: ReturnType<typeof vi.fn<() => ManualControllerSnapshot | null>>;
}

/** factory 呼び出し回数(spy) と、生成した controller を生成順に保持する tracked factory。 */
interface TrackedFactory {
  factory: ReturnType<typeof vi.fn<() => ManualController>>;
  instances: FakeController[];
}

/**
 * id タグ付きの tracked factory を作る。start/stop/create は共有 log に順序を記録するので、
 * 「旧 stop → 新 create → 新 start」といった切替の順序を跨コントローラで検証できる。
 */
function makeFactory(
  id: string,
  log: string[],
  snapshot: ManualControllerSnapshot | null = null,
): TrackedFactory {
  const instances: FakeController[] = [];
  const factory = vi.fn<() => ManualController>(() => {
    log.push(`${id}:create`);
    const controller: FakeController = {
      start: vi.fn<() => void>(() => {
        log.push(`${id}:start`);
      }),
      stop: vi.fn<() => void>(() => {
        log.push(`${id}:stop`);
      }),
      setPaused: vi.fn<(paused: boolean) => void>(),
      setSpeedScale: vi.fn<(scale: number) => void>(),
      update: vi.fn<(dt: number) => void>(),
      onPointerDown: vi.fn<(x: number, y: number) => void>(),
      debugSnapshot: vi.fn<() => ManualControllerSnapshot | null>(() => snapshot),
    };
    instances.push(controller);
    return controller;
  });
  return { factory, instances };
}

/** ManualMode を factories レコードから組み立てるヘルパ。 */
function makeMode(
  factories: Record<string, ManualControllerFactory>,
  opts: { initialTypeId: string; fallbackTypeId: string },
): ManualMode {
  return new ManualMode({
    factories: new Map(Object.entries(factories)),
    initialTypeId: opts.initialTypeId,
    fallbackTypeId: opts.fallbackTypeId,
  });
}

/** debugSnapshot 委譲テスト用の最小 ManualControllerSnapshot。 */
function makeSnapshot(): ManualControllerSnapshot {
  return {
    position: { x: 1, y: 2 },
    velocity: { x: 0, y: 0 },
    pointer: null,
    running: true,
    paused: false,
    heading: 0,
    viewRotation: 0,
    viewScaleY: 1,
    tailTip: null,
  };
}

describe("ManualMode: resolveTypeId / initialTypeId 正規化", () => {
  it("factories に在る initialTypeId はそのまま currentType になる", () => {
    const log: string[] = [];
    const mode = makeMode(
      { mouse: makeFactory("mouse", log).factory, foxtail: makeFactory("foxtail", log).factory },
      { initialTypeId: "foxtail", fallbackTypeId: "mouse" },
    );
    expect(mode.currentType).toBe("foxtail");
  });

  it("factories に無い initialTypeId は fallbackTypeId へ解決される", () => {
    const log: string[] = [];
    const mode = makeMode(
      { mouse: makeFactory("mouse", log).factory },
      { initialTypeId: "unknown", fallbackTypeId: "mouse" },
    );
    expect(mode.currentType).toBe("mouse");
  });
});

describe("ManualMode: start()", () => {
  it("running=false から start すると factory と controller.start が各1回呼ばれる", () => {
    const log: string[] = [];
    const mouse = makeFactory("mouse", log);
    const mode = makeMode(
      { mouse: mouse.factory },
      { initialTypeId: "mouse", fallbackTypeId: "mouse" },
    );
    mode.start();
    expect(mouse.factory).toHaveBeenCalledTimes(1);
    expect(mouse.instances).toHaveLength(1);
    expect(mouse.instances[0].start).toHaveBeenCalledTimes(1);
  });

  it("二重 start は冪等（factory も controller.start も追加で呼ばれない）", () => {
    const log: string[] = [];
    const mouse = makeFactory("mouse", log);
    const mode = makeMode(
      { mouse: mouse.factory },
      { initialTypeId: "mouse", fallbackTypeId: "mouse" },
    );
    mode.start();
    mode.start();
    expect(mouse.factory).toHaveBeenCalledTimes(1);
    expect(mouse.instances).toHaveLength(1);
    expect(mouse.instances[0].start).toHaveBeenCalledTimes(1);
  });

  it("start 時に paused が false にリセットされる（以後の切替で新 controller へ paused が再適用されない）", () => {
    const log: string[] = [];
    const mouse = makeFactory("mouse", log);
    const foxtail = makeFactory("foxtail", log);
    const mode = makeMode(
      { mouse: mouse.factory, foxtail: foxtail.factory },
      { initialTypeId: "mouse", fallbackTypeId: "mouse" },
    );
    // 未 running での setPaused(true) は保持のみ（controller 不在）。start がこれを false へ戻すはず。
    mode.setPaused(true);
    mode.start();
    // running かつ paused=false なので、切替後の新 controller に setPaused(true) は呼ばれない。
    mode.setManualType("foxtail");
    expect(foxtail.instances[0].setPaused).not.toHaveBeenCalled();
  });
});

describe("ManualMode: createController が保持中 speedScale を新 controller へ適用", () => {
  it("start 前に setSpeedScale した値が生成 controller へ反映される", () => {
    const log: string[] = [];
    const mouse = makeFactory("mouse", log);
    const mode = makeMode(
      { mouse: mouse.factory },
      { initialTypeId: "mouse", fallbackTypeId: "mouse" },
    );
    mode.setSpeedScale(2.5); // 未 running: 保持のみ。
    mode.start();
    expect(mouse.instances[0].setSpeedScale).toHaveBeenCalledTimes(1);
    expect(mouse.instances[0].setSpeedScale).toHaveBeenCalledWith(2.5);
  });
});

describe("ManualMode: stop()", () => {
  it("stop で controller.stop を呼び、以後 update/onPointerDown/debugSnapshot は no-op（controller=null）", () => {
    const log: string[] = [];
    const mouse = makeFactory("mouse", log);
    const mode = makeMode(
      { mouse: mouse.factory },
      { initialTypeId: "mouse", fallbackTypeId: "mouse" },
    );
    mode.start();
    const c = mouse.instances[0];
    mode.stop();
    expect(c.stop).toHaveBeenCalledTimes(1);
    // controller は null になり、以後の委譲は旧 controller に届かない。
    mode.update(0.5);
    mode.onPointerDown(3, 4);
    expect(c.update).not.toHaveBeenCalled();
    expect(c.onPointerDown).not.toHaveBeenCalled();
    expect(mode.debugSnapshot()).toBeNull();
  });

  it("未 running での stop は冪等（controller.stop は呼ばれず throw もしない）", () => {
    const log: string[] = [];
    const mouse = makeFactory("mouse", log);
    const mode = makeMode(
      { mouse: mouse.factory },
      { initialTypeId: "mouse", fallbackTypeId: "mouse" },
    );
    expect(() => mode.stop()).not.toThrow();
    expect(mouse.factory).not.toHaveBeenCalled();
  });

  it("stop 後に再 start すると controller を作り直す", () => {
    const log: string[] = [];
    const mouse = makeFactory("mouse", log);
    const mode = makeMode(
      { mouse: mouse.factory },
      { initialTypeId: "mouse", fallbackTypeId: "mouse" },
    );
    mode.start();
    mode.stop();
    mode.start();
    expect(mouse.factory).toHaveBeenCalledTimes(2);
    expect(mouse.instances[1].start).toHaveBeenCalledTimes(1);
  });
});

describe("ManualMode: setManualType()", () => {
  it("同一 typeId なら no-op（stop も factory も呼ばれない）", () => {
    const log: string[] = [];
    const mouse = makeFactory("mouse", log);
    const foxtail = makeFactory("foxtail", log);
    const mode = makeMode(
      { mouse: mouse.factory, foxtail: foxtail.factory },
      { initialTypeId: "mouse", fallbackTypeId: "mouse" },
    );
    mode.start();
    mode.setManualType("mouse");
    expect(mouse.factory).toHaveBeenCalledTimes(1);
    expect(mouse.instances[0].stop).not.toHaveBeenCalled();
    expect(foxtail.factory).not.toHaveBeenCalled();
  });

  it("未起動なら currentType だけ更新し controller は生成しない（次の start が新種別で立ち上げる）", () => {
    const log: string[] = [];
    const mouse = makeFactory("mouse", log);
    const foxtail = makeFactory("foxtail", log);
    const mode = makeMode(
      { mouse: mouse.factory, foxtail: foxtail.factory },
      { initialTypeId: "mouse", fallbackTypeId: "mouse" },
    );
    mode.setManualType("foxtail");
    expect(mode.currentType).toBe("foxtail");
    expect(mouse.factory).not.toHaveBeenCalled();
    expect(foxtail.factory).not.toHaveBeenCalled();
    // 次の start は更新後の種別（foxtail）で立ち上げる。
    mode.start();
    expect(foxtail.factory).toHaveBeenCalledTimes(1);
    expect(mouse.factory).not.toHaveBeenCalled();
  });

  it("実行中の切替は 旧stop → 新create → 新start の順で、常に1体だけ保持する", () => {
    const log: string[] = [];
    const mouse = makeFactory("mouse", log);
    const foxtail = makeFactory("foxtail", log);
    const mode = makeMode(
      { mouse: mouse.factory, foxtail: foxtail.factory },
      { initialTypeId: "mouse", fallbackTypeId: "mouse" },
    );
    mode.start();
    log.length = 0; // start ぶんのログを捨て、切替の順序だけを見る。
    mode.setManualType("foxtail");
    expect(log).toEqual(["mouse:stop", "foxtail:create", "foxtail:start"]);
    expect(mode.currentType).toBe("foxtail");
    // 以後の update は新 controller のみが受ける（旧は破棄され 1 体だけになる）。
    mode.update(0.1);
    expect(mouse.instances[0].update).not.toHaveBeenCalled();
    expect(foxtail.instances[0].update).toHaveBeenCalledWith(0.1);
  });

  it("paused=true 中の切替は新 controller へ setPaused(true) を再適用する", () => {
    const log: string[] = [];
    const mouse = makeFactory("mouse", log);
    const foxtail = makeFactory("foxtail", log);
    const mode = makeMode(
      { mouse: mouse.factory, foxtail: foxtail.factory },
      { initialTypeId: "mouse", fallbackTypeId: "mouse" },
    );
    mode.start();
    mode.setPaused(true);
    mode.setManualType("foxtail");
    expect(foxtail.instances[0].setPaused).toHaveBeenCalledWith(true);
  });

  it("paused=false 時の切替では新 controller へ setPaused が呼ばれない", () => {
    const log: string[] = [];
    const mouse = makeFactory("mouse", log);
    const foxtail = makeFactory("foxtail", log);
    const mode = makeMode(
      { mouse: mouse.factory, foxtail: foxtail.factory },
      { initialTypeId: "mouse", fallbackTypeId: "mouse" },
    );
    mode.start();
    mode.setManualType("foxtail");
    expect(foxtail.instances[0].setPaused).not.toHaveBeenCalled();
  });

  it("setSpeedScale 済みで切替すると新 controller へ speedScale が反映される", () => {
    const log: string[] = [];
    const mouse = makeFactory("mouse", log);
    const foxtail = makeFactory("foxtail", log);
    const mode = makeMode(
      { mouse: mouse.factory, foxtail: foxtail.factory },
      { initialTypeId: "mouse", fallbackTypeId: "mouse" },
    );
    mode.start();
    mode.setSpeedScale(3);
    mode.setManualType("foxtail");
    expect(foxtail.instances[0].setSpeedScale).toHaveBeenCalledWith(3);
  });

  it("factories に無い typeId は fallback に解決して切替する（fallback factory が使われる）", () => {
    const log: string[] = [];
    const mouse = makeFactory("mouse", log);
    const foxtail = makeFactory("foxtail", log);
    const mode = makeMode(
      { mouse: mouse.factory, foxtail: foxtail.factory },
      { initialTypeId: "foxtail", fallbackTypeId: "mouse" },
    );
    mode.start(); // foxtail で起動。
    mode.setManualType("unknown"); // → fallback "mouse" へ解決して切替。
    expect(mode.currentType).toBe("mouse");
    expect(mouse.factory).toHaveBeenCalledTimes(1);
    expect(mouse.instances[0].start).toHaveBeenCalledTimes(1);
  });
});

describe("ManualMode: rebuildCurrent()", () => {
  it("[UR3-5] 実行中は typeId を変えず 旧stop → 新create → 新start で作り直す", () => {
    const log: string[] = [];
    const mouse = makeFactory("mouse", log);
    const mode = makeMode(
      { mouse: mouse.factory },
      { initialTypeId: "mouse", fallbackTypeId: "mouse" },
    );
    mode.start();
    log.length = 0; // start ぶんのログを捨て、rebuild の順序だけを見る。
    mode.rebuildCurrent();
    expect(log).toEqual(["mouse:stop", "mouse:create", "mouse:start"]);
    expect(mode.currentType).toBe("mouse");
    // factory は start(1) + rebuild(1) で計 2 回。以後の update は新 instance のみが受ける（旧は破棄）。
    expect(mouse.factory).toHaveBeenCalledTimes(2);
    mode.update(0.1);
    expect(mouse.instances[0].update).not.toHaveBeenCalled();
    expect(mouse.instances[1].update).toHaveBeenCalledWith(0.1);
  });

  it("[UR3-5] 未起動なら no-op（factory も stop も呼ばれず throw もしない）", () => {
    const log: string[] = [];
    const mouse = makeFactory("mouse", log);
    const mode = makeMode(
      { mouse: mouse.factory },
      { initialTypeId: "mouse", fallbackTypeId: "mouse" },
    );
    expect(() => mode.rebuildCurrent()).not.toThrow();
    expect(mouse.factory).not.toHaveBeenCalled();
  });

  it("[UR3-5] paused=true 中の rebuild は新 controller へ setPaused(true) を再適用する", () => {
    const log: string[] = [];
    const mouse = makeFactory("mouse", log);
    const mode = makeMode(
      { mouse: mouse.factory },
      { initialTypeId: "mouse", fallbackTypeId: "mouse" },
    );
    mode.start();
    mode.setPaused(true);
    mode.rebuildCurrent();
    expect(mouse.instances[1].setPaused).toHaveBeenCalledWith(true);
  });

  it("[UR3-5] setSpeedScale 済みで rebuild すると新 controller へ speedScale が反映される", () => {
    const log: string[] = [];
    const mouse = makeFactory("mouse", log);
    const mode = makeMode(
      { mouse: mouse.factory },
      { initialTypeId: "mouse", fallbackTypeId: "mouse" },
    );
    mode.start();
    mode.setSpeedScale(2.5);
    mode.rebuildCurrent();
    expect(mouse.instances[1].setSpeedScale).toHaveBeenCalledWith(2.5);
  });
});

describe("ManualMode: createController の factory 欠落（異常系）", () => {
  it("currentType/fallback とも factories に無い場合、start で Error を throw する", () => {
    const mode = makeMode({}, { initialTypeId: "unknown", fallbackTypeId: "mouse" });
    // initialTypeId は fallback "mouse" に正規化されるが、その factory も存在しない。
    expect(mode.currentType).toBe("mouse");
    expect(() => mode.start()).toThrow("manual コントローラの factory がありません: mouse");
  });

  it("実行中に fallback へ解決される切替でも factory 欠落なら throw する", () => {
    const log: string[] = [];
    const foxtail = makeFactory("foxtail", log);
    const mode = makeMode(
      { foxtail: foxtail.factory },
      { initialTypeId: "foxtail", fallbackTypeId: "mouse" },
    );
    mode.start(); // foxtail で起動（fallback mouse の factory は無い）。
    expect(() => mode.setManualType("unknown")).toThrow(
      "manual コントローラの factory がありません: mouse",
    );
  });
});

describe("ManualMode: setSpeedScale / setPaused の委譲", () => {
  it("実行中の setSpeedScale は現行 controller へ即反映する", () => {
    const log: string[] = [];
    const mouse = makeFactory("mouse", log);
    const mode = makeMode(
      { mouse: mouse.factory },
      { initialTypeId: "mouse", fallbackTypeId: "mouse" },
    );
    mode.start();
    const c = mouse.instances[0];
    // 生成時に保持値 speedScale=1 で 1 回呼ばれている。
    expect(c.setSpeedScale).toHaveBeenCalledTimes(1);
    mode.setSpeedScale(4);
    expect(c.setSpeedScale).toHaveBeenCalledTimes(2);
    expect(c.setSpeedScale).toHaveBeenLastCalledWith(4);
  });

  it("実行中の setPaused は現行 controller へ即反映する", () => {
    const log: string[] = [];
    const mouse = makeFactory("mouse", log);
    const mode = makeMode(
      { mouse: mouse.factory },
      { initialTypeId: "mouse", fallbackTypeId: "mouse" },
    );
    mode.start();
    const c = mouse.instances[0];
    mode.setPaused(true);
    expect(c.setPaused).toHaveBeenCalledWith(true);
    mode.setPaused(false);
    expect(c.setPaused).toHaveBeenLastCalledWith(false);
  });

  it("未起動の setSpeedScale/setPaused は controller 不在でも throw しない（保持のみ）", () => {
    const log: string[] = [];
    const mouse = makeFactory("mouse", log);
    const mode = makeMode(
      { mouse: mouse.factory },
      { initialTypeId: "mouse", fallbackTypeId: "mouse" },
    );
    expect(() => {
      mode.setSpeedScale(2);
      mode.setPaused(true);
    }).not.toThrow();
    expect(mouse.factory).not.toHaveBeenCalled();
  });
});

describe("ManualMode: update / onPointerDown / debugSnapshot の委譲", () => {
  it("controller があれば update/onPointerDown/debugSnapshot を委譲する", () => {
    const log: string[] = [];
    const snap = makeSnapshot();
    const mouse = makeFactory("mouse", log, snap);
    const mode = makeMode(
      { mouse: mouse.factory },
      { initialTypeId: "mouse", fallbackTypeId: "mouse" },
    );
    mode.start();
    const c = mouse.instances[0];
    mode.update(0.016);
    expect(c.update).toHaveBeenCalledWith(0.016);
    mode.onPointerDown(12, 34);
    expect(c.onPointerDown).toHaveBeenCalledWith(12, 34);
    expect(mode.debugSnapshot()).toBe(snap);
  });

  it("未起動なら update/onPointerDown は no-op、debugSnapshot は null を返す", () => {
    const log: string[] = [];
    const mouse = makeFactory("mouse", log);
    const mode = makeMode(
      { mouse: mouse.factory },
      { initialTypeId: "mouse", fallbackTypeId: "mouse" },
    );
    expect(() => {
      mode.update(0.5);
      mode.onPointerDown(1, 2);
    }).not.toThrow();
    expect(mode.debugSnapshot()).toBeNull();
    expect(mouse.factory).not.toHaveBeenCalled();
  });
});
