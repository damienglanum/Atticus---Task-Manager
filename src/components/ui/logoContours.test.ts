import { describe, expect, it } from "vitest";

import { markGeometry } from "./logoContours";

function renderedStroke(pixels: number): number {
  const geometry = markGeometry(pixels);
  const side = Number(geometry.viewBox.split(" ")[2]);
  return (geometry.strokeWidth * pixels) / side;
}

describe("markGeometry", () => {
  it("keeps compact marks legible instead of packing in every contour", () => {
    expect(markGeometry(16).rings).toBe(2);
    expect(markGeometry(28).rings).toBe(3);
    expect(markGeometry(36).rings).toBe(3);
    expect(markGeometry(48).rings).toBe(4);
    expect(markGeometry(72).rings).toBe(5);
    expect(markGeometry(96).rings).toBe(8);
  });

  it("holds a solid compact line weight in screen pixels", () => {
    expect(renderedStroke(16)).toBeCloseTo(1.15);
    expect(renderedStroke(28)).toBeCloseTo(1.15);
    expect(renderedStroke(48)).toBeCloseTo(1.25);
  });

  it("optically lifts the asymmetric compact mark without moving large artwork", () => {
    const compact = markGeometry(28);
    const large = markGeometry(160);

    expect(compact.offsetX).toBeLessThan(0);
    expect(compact.offsetY).toBeLessThan(compact.offsetX);
    expect(large.offsetX).toBe(0);
    expect(large.offsetY).toBe(0);
  });
});
