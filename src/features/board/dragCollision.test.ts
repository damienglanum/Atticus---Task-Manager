import type { CollisionDetection } from "@dnd-kit/core";
import { describe, expect, it } from "vitest";

import { boardCollisionDetection } from "./dragCollision";

type CollisionArgs = Parameters<CollisionDetection>[0];

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function args(pointerCoordinates: { x: number; y: number } | null): CollisionArgs {
  const first = rect(10, 10, 280, 90);
  const second = rect(10, 120, 280, 90);
  const column = rect(0, 0, 300, 500);

  // Collision algorithms only read these fields. Keeping the rest out of this
  // fixture makes the geometry behind the regression visible in the test.
  return {
    active: { id: "moving" },
    collisionRect: first,
    droppableRects: new Map([
      ["first", first],
      ["second", second],
      ["column", column],
    ]),
    droppableContainers: [{ id: "first" }, { id: "second" }, { id: "column" }],
    pointerCoordinates,
  } as unknown as CollisionArgs;
}

describe("boardCollisionDetection", () => {
  it("uses the card directly beneath the pointer", () => {
    const collisions = boardCollisionDetection(args({ x: 150, y: 160 }));

    // The dragged rectangle is still nearest to `first`; the pointer is on
    // `second`, which is the card the user expects to receive the drop.
    expect(collisions[0]?.id).toBe("second");
  });

  it("keeps closest-corner targeting for keyboard dragging", () => {
    const collisions = boardCollisionDetection(args(null));
    expect(collisions[0]?.id).toBe("first");
  });

  it("does not register a pointer drop outside the board", () => {
    expect(boardCollisionDetection(args({ x: 900, y: 900 }))).toEqual([]);
  });
});
