import { closestCorners, pointerWithin, type CollisionDetection } from "@dnd-kit/core";

/**
 * Pick the card beneath the pointer instead of the card beneath the dragged
 * rectangle. The two can disagree because a drag keeps the cursor's original
 * offset within the card, which made a drop appear to land one card away.
 *
 * Keyboard dragging has no pointer coordinates, so it keeps dnd-kit's
 * geometry-based collision detection.
 */
export const boardCollisionDetection: CollisionDetection = (args) =>
  args.pointerCoordinates === null ? closestCorners(args) : pointerWithin(args);
