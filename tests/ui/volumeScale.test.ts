import { describe, expect, it } from "vitest";
import { sliderToVolume, volumeToSlider } from "../../src/ui/volumeScale";

describe("sliderToVolume", () => {
  it("0..100 を 0..1 に線形写像する", () => {
    expect(sliderToVolume(0)).toBe(0);
    expect(sliderToVolume(50)).toBe(0.5);
    expect(sliderToVolume(100)).toBe(1);
    expect(sliderToVolume(25)).toBe(0.25);
  });

  it("範囲外は [0,1] にクランプする", () => {
    expect(sliderToVolume(150)).toBe(1);
    expect(sliderToVolume(-10)).toBe(0);
  });

  it("非有限は 0 に落とす", () => {
    expect(sliderToVolume(Number.NaN)).toBe(0);
    expect(sliderToVolume(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("volumeToSlider", () => {
  it("0..1 を 0..100 の整数に写像する", () => {
    expect(volumeToSlider(0)).toBe(0);
    expect(volumeToSlider(0.5)).toBe(50);
    expect(volumeToSlider(1)).toBe(100);
    expect(volumeToSlider(0.25)).toBe(25);
  });

  it("整数へ丸める", () => {
    expect(volumeToSlider(0.535)).toBe(54);
    expect(volumeToSlider(0.334)).toBe(33);
  });

  it("範囲外は [0,100] にクランプする", () => {
    expect(volumeToSlider(1.5)).toBe(100);
    expect(volumeToSlider(-0.2)).toBe(0);
  });

  it("非有限は 0 に落とす", () => {
    expect(volumeToSlider(Number.NaN)).toBe(0);
    expect(volumeToSlider(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("往復変換", () => {
  it("0..100 の整数スライダ値は往復で保存される", () => {
    for (let s = 0; s <= 100; s++) {
      expect(volumeToSlider(sliderToVolume(s))).toBe(s);
    }
  });
});
