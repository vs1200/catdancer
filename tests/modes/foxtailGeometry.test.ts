import { describe, expect, it } from "vitest";
import type { Vec2 } from "../../src/core/vec2";
import {
  approach,
  approachAngle,
  approachArc,
  computeBasePosition,
  computeFoxtailRig,
  computeHeadRender,
  computeRetract,
  distanceToNearestEdge,
  edgeDistances,
  edgeOutward,
  edgeOutwardAngle,
  foxtailLength,
  nearestEdge,
  perimeterEdge,
  perimeterLength,
  perimeterPoint,
  projectToPerimeter,
  shortestAngleDelta,
  shortestArcDelta,
  springStep,
  wrapArc,
} from "../../src/modes/manual/foxtailGeometry";

const vp = { width: 800, height: 600 };
// 周長パラメトライズの基準（W=800,H=600）: P=2800、辺境界 top[0,800) right[800,1400) bottom[1400,2200) left[2200,2800)。
const P = 2 * (800 + 600); // 2800

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

// --- [UR3-2/3] 根元の周長追従モデル ---------------------------------------------------------

describe("perimeterLength / wrapArc", () => {
  it("周長 P = 2(W+H)", () => {
    expect(perimeterLength(vp)).toBe(2800);
    expect(perimeterLength({ width: 400, height: 100 })).toBe(1000);
  });

  it("弧長を [0,P) へ wrap（負値・周回）", () => {
    expect(wrapArc(0, P)).toBe(0);
    expect(wrapArc(P, P)).toBe(0); // 周回で始点へ
    expect(wrapArc(P + 100, P)).toBe(100);
    expect(wrapArc(-100, P)).toBe(P - 100);
    expect(wrapArc(3 * P + 50, P)).toBeCloseTo(50);
  });

  it("perimeter<=0 / 非有限は 0（ガード）", () => {
    expect(wrapArc(500, 0)).toBe(0);
    expect(wrapArc(Number.NaN, P)).toBe(0);
  });
});

describe("shortestArcDelta", () => {
  it("最短の弧方向 [-P/2, P/2] へ正規化", () => {
    expect(shortestArcDelta(100, 300, P)).toBeCloseTo(200); // 素直に +200
    // 100 → 2700 は wrap して -200（+2600 ではない）。
    expect(shortestArcDelta(100, 2700, P)).toBeCloseTo(-200);
    // 対角(半周 P/2=1400)は境界。
    expect(Math.abs(shortestArcDelta(0, 1400, P))).toBeCloseTo(1400);
  });
});

describe("perimeterPoint", () => {
  it("4 辺を弧長順に被覆する（time回り, +y=下）", () => {
    expect(perimeterPoint(vp, 0)).toEqual({ x: 0, y: 0 }); // top 始点(隅)
    expect(perimeterPoint(vp, 400)).toEqual({ x: 400, y: 0 }); // top 中央
    expect(perimeterPoint(vp, 800)).toEqual({ x: 800, y: 0 }); // right 始点(隅)
    expect(perimeterPoint(vp, 1100)).toEqual({ x: 800, y: 300 }); // right 中央
    expect(perimeterPoint(vp, 1400)).toEqual({ x: 800, y: 600 }); // bottom 始点(隅)
    expect(perimeterPoint(vp, 1800)).toEqual({ x: 400, y: 600 }); // bottom 中央
    expect(perimeterPoint(vp, 2200)).toEqual({ x: 0, y: 600 }); // left 始点(隅)
    expect(perimeterPoint(vp, 2500)).toEqual({ x: 0, y: 300 }); // left 中央
  });

  it("wrap: s と s+P は同じ点", () => {
    expect(perimeterPoint(vp, 1800 + P)).toEqual(perimeterPoint(vp, 1800));
    expect(perimeterPoint(vp, -1000)).toEqual(perimeterPoint(vp, P - 1000));
  });

  it("不変条件: 任意の s で点は必ず viewport 境界上（内部を突っ切らない）", () => {
    for (let s = 0; s < P; s += 37) {
      const q = perimeterPoint(vp, s);
      const onBoundary =
        Math.abs(q.x) < 1e-9 ||
        Math.abs(q.x - vp.width) < 1e-9 ||
        Math.abs(q.y) < 1e-9 ||
        Math.abs(q.y - vp.height) < 1e-9;
      expect(onBoundary).toBe(true);
    }
  });
});

describe("perimeterEdge", () => {
  it("弧長が属する辺", () => {
    expect(perimeterEdge(vp, 400)).toBe("top");
    expect(perimeterEdge(vp, 1100)).toBe("right");
    expect(perimeterEdge(vp, 1800)).toBe("bottom");
    expect(perimeterEdge(vp, 2500)).toBe("left");
  });
});

describe("projectToPerimeter", () => {
  it("内部点は最寄り辺の垂線の足へ投影される", () => {
    // (400,50): 最寄り=top(50) → top 中央の弧長 400。
    expect(projectToPerimeter(400, 50, vp)).toBeCloseTo(400);
    // (400,550): 最寄り=bottom(50) → bottom 中央の弧長 1800。
    expect(projectToPerimeter(400, 550, vp)).toBeCloseTo(1800);
    // (50,300): 最寄り=left(50) → left 中央の弧長 2500。
    expect(projectToPerimeter(50, 300, vp)).toBeCloseTo(2500);
    // (750,300): 最寄り=right(50) → right 中央の弧長 1100。
    expect(projectToPerimeter(750, 300, vp)).toBeCloseTo(1100);
  });

  it("周上点への投影は往復して同じ弧長（roundtrip・4 辺）", () => {
    for (const s of [200, 900, 1000, 1600, 2000, 2400, 2700]) {
      const q = perimeterPoint(vp, s);
      expect(projectToPerimeter(q.x, q.y, vp)).toBeCloseTo(s, 6);
    }
  });

  it("画面外/隅の点はクランプで最寄り隅へ寄る", () => {
    // 左上外の点は隅(0,0)=弧長 0 付近へ。
    expect(perimeterPoint(vp, projectToPerimeter(-50, -50, vp))).toEqual({ x: 0, y: 0 });
  });
});

describe("approachArc", () => {
  it("最短の弧方向へ寄る（1 ステップで越えない・符号は詰める向き）", () => {
    // 100 → 500（+方向が最短）。
    const a = approachArc(100, 500, 1.0, 1 / 60, P);
    expect(a).toBeGreaterThan(100);
    expect(a).toBeLessThan(500);
    // 100 → 2700（-方向=wrap が最短）→ 100 未満(0側)へ動く。
    const b = approachArc(100, 2700, 1.0, 1 / 60, P);
    expect(shortestArcDelta(100, b, P)).toBeLessThan(0);
  });

  it("反復で target へ収束する（wrap 跨ぎ）", () => {
    let s = 100;
    const target = 2700; // 最短は -方向（wrap）
    for (let i = 0; i < 2000; i++) {
      s = approachArc(s, target, 1.0, 1 / 60, P);
    }
    expect(Math.abs(shortestArcDelta(s, target, P))).toBeLessThan(0.5);
  });

  it("dt<=0 / perimeter<=0 は現在値(wrap 済)を保つ", () => {
    expect(approachArc(1800, 400, 1.0, 0, P)).toBeCloseTo(1800);
    expect(approachArc(1800, 400, 1.0, 1 / 60, 0)).toBeCloseTo(1800);
  });

  it("不変条件: 直行(下→上)では base 弧長が数フレーム下領域(y>H/2)に留まる（瞬間移動しない）", () => {
    // ポインタが下部→上部へ直行: base の target が bottom(1800)→top(400) の対角(半周)へ飛ぶが、
    // 遅い積分では周長を突っ切れないので base は数フレーム下辺付近に留まる。
    let s = projectToPerimeter(400, 590, vp); // 下辺中央付近から開始
    const targetTop = projectToPerimeter(400, 10, vp); // 上辺中央
    for (let i = 0; i < 12; i++) {
      // 12 フレーム ≈ 0.2s
      s = approachArc(s, targetTop, 1.1, 1 / 60, P);
      expect(perimeterPoint(vp, s).y).toBeGreaterThan(vp.height / 2);
    }
  });

  it("不変条件: |Δbase|/frame が有界（高速掃引/テレポートしない）", () => {
    // どの端/象限越え(=任意の current→target 組)でも 1 フレームの base 変位は上限以下。
    const smoothTime = 0.8; // 想定域の下限（最も速い）
    const dt = 1 / 30; // 想定域の上限 dt（低フレームレート）
    const maxStep = (P / 2) * (1 - Math.exp(-dt / smoothTime)); // 理論上限（弧長）
    let maxObserved = 0;
    for (const cur of [0, 400, 1100, 1800, 2500, 2799]) {
      for (const tgt of [0, 700, 1400, 2100, 2799]) {
        const next = approachArc(cur, tgt, smoothTime, dt, P);
        const before = perimeterPoint(vp, cur);
        const after = perimeterPoint(vp, next);
        maxObserved = Math.max(maxObserved, Math.hypot(after.x - before.x, after.y - before.y));
      }
    }
    // 2D 変位は弧長変位以下（perimeterPoint は 1-Lipschitz）。上限に少しの余裕を足して固定。
    expect(maxObserved).toBeLessThanOrEqual(maxStep + 1e-6);
    // かつ半周(=旧モデルの L 掃引級のテレポート)より十分小さいことを確認。
    expect(maxObserved).toBeLessThan(P / 4);
  });

  it("不変条件: 端に垂直な直行移動では base がほぼ動かない／端に沿う移動では base が動く（UR3-3a の弁別）", () => {
    // 同じ 2D 距離(100px)だけポインタを動かす 2 パターンで base の実弧長変位を比較する。
    // 弁別の要は「ポインタ→最寄り周上点の投影(足)」がどれだけ動くか＝base target がどれだけ動くか。
    const tau = 1.1;
    const dt = 1 / 60;
    const frames = 20;

    // (A) 直行: 端に垂直（下辺へ近づく方向）に 100px 動かす。投影の足(bottom 中央)は変わらないので
    //     base の target 弧長は不変 → base は動かない。
    const orthoStart = projectToPerimeter(400, 550, vp); // 下辺付近
    const orthoTargetArc = projectToPerimeter(400, 450, vp); // 100px 上へ（端に垂直）
    let sOrtho = orthoStart;
    for (let i = 0; i < frames; i++) {
      sOrtho = approachArc(sOrtho, orthoTargetArc, tau, dt, P);
    }
    const orthoDisp = Math.abs(shortestArcDelta(orthoStart, sOrtho, P));

    // (B) 端に沿う: 同じ 100px を端と平行（下辺沿い右方向）に動かす。足が周上を 100 だけ移動するので
    //     base の target 弧長が動き、base も追従して前進する。
    const alongStart = projectToPerimeter(400, 550, vp);
    const alongTargetArc = projectToPerimeter(500, 550, vp); // 100px 右へ（端に平行）
    let sAlong = alongStart;
    for (let i = 0; i < frames; i++) {
      sAlong = approachArc(sAlong, alongTargetArc, tau, dt, P);
    }
    const alongDisp = Math.abs(shortestArcDelta(alongStart, sAlong, P));

    // 直行(垂直)は足＝target が動かないので base 変位はほぼ 0。
    expect(orthoDisp).toBeLessThan(1e-6);
    // 端沿いは足が動くので base が実際に前進し、直行より明確に大きい（弁別が成立）。
    expect(alongDisp).toBeGreaterThan(10);
    expect(alongDisp).toBeGreaterThan(orthoDisp);
  });
});

// --- [M-1] retract(しまう)の rig 幾何（穂先 tip = base + L·unit(head−base)）------------------

describe("computeFoxtailRig", () => {
  const FRAC = 0.52;
  const MARGIN = 24; // 実装は L + spriteHalfHeight + RETRACT_MARGIN_PX。ここは幾何 tip 用に L+余白で検証。
  const AIM_MIN = 1;

  // 各辺の中央周上点と外向き角（axis-aligned な定常 retract 状態）。
  const edges = (W: number, H: number) => [
    { name: "top", pt: { x: W / 2, y: 0 }, outward: -Math.PI / 2 },
    { name: "right", pt: { x: W, y: H / 2 }, outward: 0 },
    { name: "bottom", pt: { x: W / 2, y: H }, outward: Math.PI / 2 },
    { name: "left", pt: { x: 0, y: H / 2 }, outward: Math.PI },
  ];

  const isOutside = (p: Vec2, W: number, H: number): boolean =>
    p.x < -1e-9 || p.x > W + 1e-9 || p.y < -1e-9 || p.y > H + 1e-9;

  it("retract=0 では base が周上点そのもの（通常追従の弧・360度回転は不変）", () => {
    const W = 800;
    const H = 600;
    const L = foxtailLength({ width: W, height: H }, FRAC);
    for (const e of edges(W, H)) {
      // head を 8 方向に置いても base は周上点固定・tip は base から距離 L（弧を描く）。
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * 2 * Math.PI;
        const head: Vec2 = { x: W / 2 + Math.cos(ang) * 100, y: H / 2 + Math.sin(ang) * 100 };
        const rig = computeFoxtailRig(e.pt, e.outward, 0, head, L, 0, AIM_MIN);
        expect(rig.base.x).toBeCloseTo(e.pt.x);
        expect(rig.base.y).toBeCloseTo(e.pt.y);
        expect(Math.hypot(rig.tip.x - rig.base.x, rig.tip.y - rig.base.y)).toBeCloseTo(L);
      }
    }
  });

  // 完了条件: retract=1（retractShift = L + 余白）で、head が viewport 内のどこにあっても
  // base pivot と 穂先 tip の両方が viewport 外になる（穂先が画面内へ貫入しない）。
  const viewports = [
    { W: 800, H: 600 },
    { W: 1280, H: 720 },
    { W: 1920, H: 1080 },
  ];
  for (const { W, H } of viewports) {
    it(`retract=1 では base と tip が両方 viewport 外（${W}x${H}・全辺・任意 head）`, () => {
      const L = foxtailLength({ width: W, height: H }, FRAC);
      const retractShift = L + MARGIN;
      // 端付近から対角の隅まで、viewport 内の多様な head 位置を網羅する。
      const heads: Vec2[] = [
        { x: W / 2, y: H / 2 },
        { x: 1, y: 1 },
        { x: W - 1, y: 1 },
        { x: 1, y: H - 1 },
        { x: W - 1, y: H - 1 },
        { x: W / 2, y: 1 },
        { x: W / 2, y: H - 1 },
        { x: 1, y: H / 2 },
        { x: W - 1, y: H / 2 },
      ];
      for (const e of edges(W, H)) {
        for (const head of heads) {
          const rig = computeFoxtailRig(e.pt, e.outward, retractShift, head, L, 0, AIM_MIN);
          expect(isOutside(rig.base, W, H)).toBe(true);
          expect(isOutside(rig.tip, W, H)).toBe(true);
        }
      }
    });
  }

  it("retract=1 の穂先は外向き軸で必ず余白ぶん端の外（内向き貫入なし・上下辺で確認）", () => {
    const W = 1920;
    const H = 1080;
    const L = foxtailLength({ width: W, height: H }, FRAC);
    const retractShift = L + MARGIN;
    // top 端: head を最内(y≈H)に置いても tip.y ≤ -MARGIN（画面上外）。
    const topRig = computeFoxtailRig(
      { x: W / 2, y: 0 },
      -Math.PI / 2,
      retractShift,
      { x: W / 2, y: H - 1 },
      L,
      0,
      1,
    );
    expect(topRig.tip.y).toBeLessThanOrEqual(-MARGIN + 1e-6);
    // bottom 端: tip.y ≥ H + MARGIN（画面下外）。
    const botRig = computeFoxtailRig(
      { x: W / 2, y: H },
      Math.PI / 2,
      retractShift,
      { x: W / 2, y: 1 },
      L,
      0,
      1,
    );
    expect(botRig.tip.y).toBeGreaterThanOrEqual(H + MARGIN - 1e-6);
  });
});
