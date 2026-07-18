import { describe, expect, it } from "vitest";
import {
  type CritterAudioState,
  driveForType,
  groupMaxSpeedByType,
} from "../../src/audio/perTypeLevels";

/** テスト用 critter 状態を作る（typeId と velocity のみ）。 */
function st(typeId: string, vx: number, vy: number): CritterAudioState {
  return { typeId, velocity: { x: vx, y: vy } };
}

describe("groupMaxSpeedByType", () => {
  it("空配列なら空 Map（どの種別も居ない）", () => {
    const m = groupMaxSpeedByType([]);
    expect(m.size).toBe(0);
  });

  it("単一種別・単一 critter は速さ(hypot)を返す", () => {
    const m = groupMaxSpeedByType([st("mouse", 3, 4)]);
    expect(m.size).toBe(1);
    expect(m.get("mouse")).toBeCloseTo(5, 6); // hypot(3,4)=5
  });

  it("同一種別が複数居れば最大速度を採る", () => {
    const m = groupMaxSpeedByType([st("mouse", 10, 0), st("mouse", 0, 30), st("mouse", 5, 5)]);
    expect(m.get("mouse")).toBeCloseTo(30, 6);
  });

  it("複数種別混在は種別ごとに独立集計する", () => {
    const m = groupMaxSpeedByType([
      st("mouse", 100, 0),
      st("insect", 20, 0),
      st("insect", 0, 200),
      st("mouse", 50, 0),
    ]);
    expect(m.size).toBe(2);
    expect(m.get("mouse")).toBeCloseTo(100, 6);
    expect(m.get("insect")).toBeCloseTo(200, 6);
  });

  it("速度 0（静止）の種別もキーは持つ（present 判定に使う）", () => {
    const m = groupMaxSpeedByType([st("foxtail", 0, 0)]);
    expect(m.has("foxtail")).toBe(true);
    expect(m.get("foxtail")).toBe(0);
  });
});

describe("driveForType", () => {
  it("出現種別は present=true＋その最大速度", () => {
    const m = groupMaxSpeedByType([st("insect", 0, 200)]);
    const d = driveForType(m, "insect");
    expect(d.present).toBe(true);
    expect(d.maxSpeed).toBeCloseTo(200, 6);
  });

  it("欠損種別は present=false, maxSpeed=0（その種別のSEは鳴らさない）", () => {
    const m = groupMaxSpeedByType([st("insect", 0, 200)]);
    const d = driveForType(m, "mouse");
    expect(d.present).toBe(false);
    expect(d.maxSpeed).toBe(0);
  });

  it("空集計ではどの種別も present=false", () => {
    const m = groupMaxSpeedByType([]);
    expect(driveForType(m, "mouse")).toEqual({ present: false, maxSpeed: 0 });
    expect(driveForType(m, "insect")).toEqual({ present: false, maxSpeed: 0 });
  });

  it("静止(速度0)でも出現していれば present=true（move レベルは 0 だが在否は真）", () => {
    const m = groupMaxSpeedByType([st("foxtail", 0, 0)]);
    const d = driveForType(m, "foxtail");
    expect(d.present).toBe(true);
    expect(d.maxSpeed).toBe(0);
  });
});
