import type { Announcements, ScreenReaderInstructions } from "@dnd-kit/core";

import type { BoardSnapshot } from "@/lib/bindings/BoardSnapshot";

import { tasksInColumn } from "./reorder";

/**
 * What a screen reader says during a drag.
 *
 * dnd-kit's defaults talk about "sortable item" and array indexes. Someone
 * moving work around a board needs the board's own words — which task, which
 * column, and *position 2 of 5* rather than *index 1*, as the dnd-kit
 * accessibility guide recommends.
 */
export const screenReaderInstructions: ScreenReaderInstructions = {
  draggable: `
    To pick up a task, press space or enter.
    While holding it, use the arrow keys to move it between positions and columns.
    Press space or enter again to drop it, or escape to cancel and leave it where it was.
    Every task can also be moved from its actions menu, without dragging at all.
  `,
};

/** Human position ("2 of 5") for a task, or null if it is not on the board. */
function describePlace(
  snapshot: BoardSnapshot | undefined,
  taskId: string | undefined,
): { title: string; column: string; place: string } | null {
  if (snapshot === undefined || taskId === undefined) return null;

  const task = snapshot.tasks.find((each) => each.id === taskId);
  if (task === undefined) return null;

  const column = snapshot.columns.find((each) => each.id === task.columnId);
  const siblings = tasksInColumn(snapshot, task.columnId);
  const index = siblings.findIndex((each) => each.id === task.id);

  return {
    title: task.title,
    column: column?.name ?? "a column",
    place: `position ${String(index + 1)} of ${String(siblings.length)}`,
  };
}

/** The name of whatever is currently under the dragged task. */
function describeTarget(snapshot: BoardSnapshot | undefined, overId: string | undefined): string {
  if (snapshot === undefined || overId === undefined) return "nowhere";

  const column = snapshot.columns.find((each) => each.id === overId);
  if (column !== undefined) {
    const count = tasksInColumn(snapshot, column.id).length;
    return count === 0 ? `${column.name}, which is empty` : `the end of ${column.name}`;
  }

  const place = describePlace(snapshot, overId);
  return place === null ? "nowhere" : `${place.place} in ${place.column}`;
}

/**
 * Announcements built against the board as it currently stands.
 *
 * Takes a getter rather than a snapshot: a drag outlives any single render, and
 * capturing the board at the moment the handlers were built would announce
 * positions from before the drag started.
 */
export function boardAnnouncements(getSnapshot: () => BoardSnapshot | undefined): Announcements {
  return {
    onDragStart({ active }) {
      const place = describePlace(getSnapshot(), String(active.id));
      if (place === null) return undefined;
      return `Picked up ${place.title}, ${place.place} in ${place.column}.`;
    },

    onDragOver({ active, over }) {
      const place = describePlace(getSnapshot(), String(active.id));
      if (place === null) return undefined;
      if (over === null) return `${place.title} is not over a column.`;
      return `${place.title} is over ${describeTarget(getSnapshot(), String(over.id))}.`;
    },

    onDragEnd({ active, over }) {
      const place = describePlace(getSnapshot(), String(active.id));
      if (place === null) return undefined;
      if (over === null) return `${place.title} was dropped outside the board and did not move.`;
      return `Dropped ${place.title} at ${describeTarget(getSnapshot(), String(over.id))}.`;
    },

    onDragCancel({ active }) {
      const place = describePlace(getSnapshot(), String(active.id));
      if (place === null) return undefined;
      return `Cancelled. ${place.title} stayed at ${place.place} in ${place.column}.`;
    },
  };
}
