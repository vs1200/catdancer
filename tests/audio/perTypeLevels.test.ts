import { describe, expect, it } from "vitest";
import {
  type CritterAudioState,
  driveForType,
  groupMaxSpeedByType,
} from "../../src/audio/perTypeLevels";

/** テスト用 critter 状態を作る（typeId / velocity / position.x）。x 既定 0。 */
function st(typeId: string, vx: number, vy: number, x = 0): CritterAudioState {
  return { typeId, velocity: { x: vx, y: vy }, position: { x } };
}

describe("groupMaxSpeedByType", () => {
  it("空配列なら空 Map（どの種別も居ない）", () => {
    const m = groupMaxSpeedByType([]);
    expect(m.size).toBe(0);
  });

  it("単一種別・単一 critter は速さ(hypot)とその x を返す", () => {
    const m = groupMaxSpeedByType([st("mouse", 3, 4, 123)]);
    expect(m.size).toBe(1);
    expect(m.get("mouse")?.maxSpeed).toBeCloseTo(5, 6); // hypot(3,4)=5
    expect(m.get("mouse")?.x).toBe(123);
  });

  it("同一種別が複数居れば最大速度を採り、代表 x はその最速個体の x", () => {
    // 最速は velocity(0,30)=30 の個体（x=777）。他の遅い個体の x は採らない。
    const m = groupMaxSpeedByType([
      st("mouse", 10, 0, 111),
      st("mouse", 0, 30, 777),
      st("mouse", 5, 5, 222),
    ]);
    expect(m.get("mouse")?.maxSpeed).toBeCloseTo(30, 6);
    expect(m.get("mouse")?.x).toBe(777);
  });

  it("複数種別混在は種別ごとに独立集計する（速度も代表 x も）", () => {
    const m = groupMaxSpeedByType([
      st("mouse", 100, 0, 10),
      st("insect", 20, 0, 20),
      st("insect", 0, 200, 950),
      st("mouse", 50, 0, 30),
    ]);
    expect(m.size).toBe(2);
    expect(m.get("mouse")?.maxSpeed).toBeCloseTo(100, 6);
    expect(m.get("mouse")?.x).toBe(10); // mouse の最速は velocity(100,0) の個体（x=10）。
    expect(m.get("insect")?.maxSpeed).toBeCloseTo(200, 6);
    expect(m.get("insect")?.x).toBe(950); // insect の最速は velocity(0,200) の個体（x=950）。
  });

  it("速度 0（静止）の種別もキーは持つ（present 判定に使う）", () => {
    const m = groupMaxSpeedByType([st("foxtail", 0, 0, 400)]);
    expect(m.has("foxtail")).toBe(true);
    expect(m.get("foxtail")?.maxSpeed).toBe(0);
    expect(m.get("foxtail")?.x).toBe(400);
  });
});

describe("driveForType", () => {
  it("出現種別は present=true＋その最大速度＋代表 x", () => {
    const m = groupMaxSpeedByType([st("insect", 0, 200, 640)]);
    const d = driveForType(m, "insect");
    expect(d.present).toBe(true);
    expect(d.maxSpeed).toBeCloseTo(200, 6);
    expect(d.x).toBe(640);
  });

  it("欠損種別は present=false, maxSpeed=0, x=0（その種別のSEは鳴らさない・pan 中央）", () => {
    const m = groupMaxSpeedByType([st("insect", 0, 200, 640)]);
    const d = driveForType(m, "mouse");
    expect(d.present).toBe(false);
    expect(d.maxSpeed).toBe(0);
    expect(d.x).toBe(0);
  });

  it("空集計ではどの種別も present=false, x=0", () => {
    const m = groupMaxSpeedByType([]);
    expect(driveForType(m, "mouse")).toEqual({ present: false, maxSpeed: 0, x: 0 });
    expect(driveForType(m, "insect")).toEqual({ present: false, maxSpeed: 0, x: 0 });
  });

  it("静止(速度0)でも出現していれば present=true＋代表 x（move レベルは 0 だが在否は真）", () => {
    const m = groupMaxSpeedByType([st("foxtail", 0, 0, 250)]);
    const d = driveForType(m, "foxtail");
    expect(d.present).toBe(true);
    expect(d.maxSpeed).toBe(0);
    expect(d.x).toBe(250);
  });
});
