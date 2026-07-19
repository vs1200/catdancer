import { describe, expect, it } from "vitest";
import type { Vec2 } from "../../src/core/vec2";
import {
  approach,
  approachAngle,
  computeBasePosition,
  computeHeadRender,
  computeRetract,
  distanceToNearestEdge,
  edgeDistances,
  edgeOutward,
  edgeOutwardAngle,
  foxtailLength,
  nearestEdge,
  shortestAngleDelta,
  springStep,
} from "../../src/modes/manual/foxtailGeometry";

const vp = { width: 800, height: 600 };

describe("edgeDistances / distanceToNearestEdge", () => {
  it("各辺までの距離を返す", () => {
    expect(edgeDistances(100, 200, vp)).toEqual({
      left: 100,
      right: 700,
      top: 200,
      bottom: 400,
    });
  });

  it("最寄り端の距離は 4 辺の最小", () => {
    expect(distanceToNearestEdge(100, 200, vp)).toBe(100); // left
    expect(distanceToNearestEdge(770, 300, vp)).toBe(30); // right
    expect(distanceToNearestEdge(400, 20, vp)).toBe(20); // top
  });

  it("端の外の点は負値になる（retract 側で 1 に飽和する想定）", () => {
    expect(distanceToNearestEdge(-10, 300, vp)).toBe(-10);
  });
});

describe("nearestEdge", () => {
  it("current=null は距離最小の端を返す", () => {
    expect(nearestEdge(50, 300, vp, null, 0)).toBe("left");
    expect(nearestEdge(760, 300, vp, null, 0)).toBe("right");
    expect(nearestEdge(400, 30, vp, null, 0)).toBe("top");
    expect(nearestEdge(400, 560, vp, null, 0)).toBe("bottom");
  });

  it("ヒステリシス: current より hysteresis 以上近い端が無ければ乗り換えない", () => {
    // 左まで 120、上まで 100（差 20 < hysteresis 80）→ current(left) 維持。
    expect(nearestEdge(120, 100, vp, "left", 80)).toBe("left");
  });

  it("ヒステリシス: 別の端が hysteresis 以上近ければ乗り換える", () => {
    // 左まで 200、上まで 100（差 100 > hysteresis 80）→ top へ。
    expect(nearestEdge(200, 100, vp, "left", 80)).toBe("top");
  });

  it("ヒステリシス 0 なら常に最小の端へ追従", () => {
    expect(nearestEdge(200, 100, vp, "left", 0)).toBe("top");
  });
});

describe("edgeOutward / edgeOutwardAngle", () => {
  it("外向き単位ベクトル", () => {
    expect(edgeOutward("left")).toEqual({ x: -1, y: 0 });
    expect(edgeOutward("right")).toEqual({ x: 1, y: 0 });
    expect(edgeOutward("top")).toEqual({ x: 0, y: -1 });
    expect(edgeOutward("bottom")).toEqual({ x: 0, y: 1 });
  });

  it("外向き角度(rad)", () => {
    expect(edgeOutwardAngle("right")).toBeCloseTo(0);
    expect(edgeOutwardAngle("left")).toBeCloseTo(Math.PI);
    expect(edgeOutwardAngle("bottom")).toBeCloseTo(Math.PI / 2);
    expect(edgeOutwardAngle("top")).toBeCloseTo(-Math.PI / 2);
  });

  it("基部→穂(inward=outward+π)が端から中央寄りを向く（各辺）", () => {
    // left 端: inward は +x（右=中央へ）。
    const inwardLeft = edgeOutwardAngle("left") + Math.PI;
    expect(Math.cos(inwardLeft)).toBeCloseTo(1);
    // top 端: inward は +y（下=中央へ、+y=画面下）。
    const inwardTop = edgeOutwardAngle("top") + Math.PI;
    expect(Math.sin(inwardTop)).toBeCloseTo(1);
  });
});

describe("computeRetract", () => {
  it("threshold 以上離れていれば 0（出ている）", () => {
    expect(computeRetract(200, 96)).toBe(0);
    expect(computeRetract(96, 96)).toBe(0);
  });

  it("距離 0 なら 1（しまう）", () => {
    expect(computeRetract(0, 96)).toBe(1);
  });

  it("端の外(負距離)でも 1 で飽和", () => {
    expect(computeRetract(-50, 96)).toBe(1);
  });

  it("中間は smoothstep で単調増加（距離が減ると retract が増える）", () => {
    const a = computeRetract(80, 96);
    const b = computeRetract(40, 96);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
    expect(b).toBeGreaterThan(a);
  });

  it("threshold<=0 は距離符号で 0/1（ゼロ割ガード）", () => {
    expect(computeRetract(10, 0)).toBe(0);
    expect(computeRetract(0, 0)).toBe(1);
  });
});

describe("foxtailLength", () => {
  it("min(幅,高さ)×frac", () => {
    expect(foxtailLength(vp, 0.5)).toBe(300); // min(800,600)=600 * 0.5
    expect(foxtailLength({ width: 400, height: 900 }, 0.5)).toBe(200);
  });
});

describe("computeBasePosition / computeHeadRender", () => {
  const head: Vec2 = { x: 400, y: 300 };

  it("基部は head から outward 方向へ (L + retractShift) 離れる（left 端）", () => {
    const base = computeBasePosition(head, edgeOutward("left"), 300, 0);
    expect(base).toEqual({ x: 100, y: 300 }); // 左へ 300
  });

  it("retractShift ぶん端の外へさらにスライドする", () => {
    const base = computeBasePosition(head, edgeOutward("left"), 300, 240);
    expect(base).toEqual({ x: -140, y: 300 });
  });

  it("描画上の穂先は head から retractShift だけ端の外へ", () => {
    expect(computeHeadRender(head, edgeOutward("left"), 0)).toEqual({ x: 400, y: 300 });
    expect(computeHeadRender(head, edgeOutward("left"), 240)).toEqual({ x: 160, y: 300 });
    // top 端では retract で穂先が上(=画面外)へ抜ける。
    expect(computeHeadRender(head, edgeOutward("top"), 320).y).toBe(-20);
  });
});

describe("shortestAngleDelta", () => {
  it("最短経路 [-π,π] に正規化", () => {
    expect(shortestAngleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    // 350° → 10° は +20° 側（-340° ではなく）。
    expect(shortestAngleDelta((350 * Math.PI) / 180, (10 * Math.PI) / 180)).toBeCloseTo(
      (20 * Math.PI) / 180,
    );
    // 逆回り。
    expect(shortestAngleDelta((10 * Math.PI) / 180, (350 * Math.PI) / 180)).toBeCloseTo(
      (-20 * Math.PI) / 180,
    );
  });
});

describe("approachAngle", () => {
  it("最短経路で目標角へ寄る（1 ステップで越えない・符号は詰める向き）", () => {
    const next = approachAngle(0, Math.PI / 2, 0.16, 1 / 60);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(Math.PI / 2);
  });

  it("反復で目標角へ収束する", () => {
    let a = Math.PI; // left
    const target = -Math.PI / 2; // top
    for (let i = 0; i < 240; i++) {
      a = approachAngle(a, target, 0.16, 1 / 60);
    }
    expect(Math.abs(shortestAngleDelta(a, target))).toBeLessThan(0.01);
  });

  it("dt<=0 は変化なし", () => {
    expect(approachAngle(1, 2, 0.16, 0)).toBe(1);
    expect(approachAngle(1, 2, 0.16, -1)).toBe(1);
  });
});

describe("approach", () => {
  it("目標へ単調に寄り、収束する", () => {
    let v = 0;
    for (let i = 0; i < 240; i++) {
      v = approach(v, 1, 0.1, 1 / 60);
    }
    expect(v).toBeGreaterThan(0.99);
    expect(v).toBeLessThanOrEqual(1);
  });

  it("dt<=0 は変化なし", () => {
    expect(approach(0.3, 1, 0.1, 0)).toBe(0.3);
  });
});

describe("springStep", () => {
  const run = (
    stiffness: number,
    damping: number,
    target: Vec2,
    steps: number,
    dt = 1 / 120,
  ): { pos: Vec2; vel: Vec2 } => {
    const pos: Vec2 = { x: 0, y: 0 };
    const vel: Vec2 = { x: 0, y: 0 };
    for (let i = 0; i < steps; i++) {
      springStep(pos, vel, target, stiffness, damping, dt);
    }
    return { pos, vel };
  };

  it("目標へ収束し velocity→0（NaN を出さない）", () => {
    const { pos, vel } = run(360, 17, { x: 100, y: 50 }, 600);
    expect(Math.hypot(100 - pos.x, 50 - pos.y)).toBeLessThan(1);
    expect(Math.hypot(vel.x, vel.y)).toBeLessThan(1);
    expect(Number.isFinite(pos.x) && Number.isFinite(vel.y)).toBe(true);
  });

  it("不足減衰(ζ<1)は一度オーバーシュートする（ふりふりの生気）", () => {
    // ζ = c/(2√k) = 17/(2*√360) ≈ 0.448 < 1。
    const target: Vec2 = { x: 100, y: 0 };
    const pos: Vec2 = { x: 0, y: 0 };
    const vel: Vec2 = { x: 0, y: 0 };
    let maxX = 0;
    for (let i = 0; i < 600; i++) {
      springStep(pos, vel, target, 360, 17, 1 / 120);
      maxX = Math.max(maxX, pos.x);
    }
    expect(maxX).toBeGreaterThan(100); // 目標を一度超える＝オーバーシュート
  });

  it("dt<=0 は状態を変えない", () => {
    const pos: Vec2 = { x: 5, y: 6 };
    const vel: Vec2 = { x: 1, y: 2 };
    springStep(pos, vel, { x: 100, y: 100 }, 360, 17, 0);
    expect(pos).toEqual({ x: 5, y: 6 });
    expect(vel).toEqual({ x: 1, y: 2 });
    springStep(pos, vel, { x: 100, y: 100 }, 360, 17, -1);
    expect(pos).toEqual({ x: 5, y: 6 });
  });

  it("最初は目標へ近づく（ラグはあるが追う）", () => {
    const { pos } = run(360, 17, { x: 100, y: 0 }, 6); // 0.05s 相当
    expect(pos.x).toBeGreaterThan(0);
    expect(pos.x).toBeLessThan(100); // ラグがあり即到達はしない
  });
});
