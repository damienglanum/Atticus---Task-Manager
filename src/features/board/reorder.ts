import type { BoardSnapshot } from "@/lib/bindings/BoardSnapshot";
import type { BoardTask } from "@/lib/bindings/BoardTask";
import type { ColumnOrder } from "@/lib/bindings/ColumnOrder";

/**
 * Board reordering, as pure functions over the snapshot.
 *
 * Separated from the components because this is where the off-by-one lives. A
 * drop index is computed from what the user sees, and it has to agree exactly
 * with what the backend does with it — which is far easier to establish with a
 * table of cases than by dragging things around by hand.
 */

/** The live tasks of one column, already in order. */
export function tasksInColumn(snapshot: BoardSnapshot, columnId: string): BoardTask[] {
  return snapshot.tasks
    .filter((task) => task.columnId === columnId)
    .sort((left, right) => left.position - right.position);
}

/**
 * The snapshot as it will look once a move lands.
 *
 * Used for the optimistic update, so the card is under the cursor before the
 * round trip finishes. The backend remains the authority: its `MoveResult` is
 * applied on success, and this is rolled back on failure.
 */
export function applyMove(
  snapshot: BoardSnapshot,
  taskId: string,
  toColumnId: string,
  toIndex: number,
): BoardSnapshot {
  const moving = snapshot.tasks.find((task) => task.id === taskId);
  if (moving === undefined) return snapshot;

  const fromColumnId = moving.columnId;
  const source = tasksInColumn(snapshot, fromColumnId).filter((task) => task.id !== taskId);
  const destination = fromColumnId === toColumnId ? source : tasksInColumn(snapshot, toColumnId);

  const clamped = Math.max(0, Math.min(toIndex, destination.length));
  destination.splice(clamped, 0, { ...moving, columnId: toColumnId });

  const renumbered = new Map<string, BoardTask>();
  for (const [index, task] of destination.entries()) {
    renumbered.set(task.id, { ...task, columnId: toColumnId, position: index });
  }
  if (fromColumnId !== toColumnId) {
    for (const [index, task] of source.entries()) {
      renumbered.set(task.id, { ...task, position: index });
    }
  }

  return {
    ...snapshot,
    tasks: snapshot.tasks.map((task) => renumbered.get(task.id) ?? task),
  };
}

/**
 * The snapshot rewritten to match the orders the backend reported.
 *
 * Applied on success instead of merely invalidating: the backend has just told
 * us the authoritative order of every column it touched, so refetching it would
 * be a second round trip to learn something we already know — and a visible
 * flicker while we waited.
 */
export function applyColumnOrders(snapshot: BoardSnapshot, orders: ColumnOrder[]): BoardSnapshot {
  const positions = new Map<string, { columnId: string; position: number }>();
  for (const order of orders) {
    for (const [index, taskId] of order.taskIds.entries()) {
      positions.set(taskId, { columnId: order.columnId, position: index });
    }
  }

  return {
    ...snapshot,
    tasks: snapshot.tasks.map((task) => {
      const placement = positions.get(task.id);
      return placement === undefined ? task : { ...task, ...placement };
    }),
  };
}

/**
 * Where a task should land, given the item it was dropped on.
 *
 * dnd-kit reports what is under the pointer, which is either another task or a
 * column. Turning that into an index is the whole of the off-by-one: dropping
 * onto a task below the one being dragged has to account for the dragged task
 * having vacated its own slot first.
 */
export function dropTarget(
  snapshot: BoardSnapshot,
  activeId: string,
  overId: string,
): { columnId: string; index: number } | null {
  const active = snapshot.tasks.find((task) => task.id === activeId);
  if (active === undefined) return null;

  const overColumn = snapshot.columns.find((column) => column.id === overId);
  if (overColumn !== undefined) {
    // Dropped on the column itself — its empty area, or an empty column.
    const existing = tasksInColumn(snapshot, overColumn.id);
    const alreadyThere = active.columnId === overColumn.id;
    return { columnId: overColumn.id, index: alreadyThere ? existing.length - 1 : existing.length };
  }

  const over = snapshot.tasks.find((task) => task.id === overId);
  if (over === undefined) return null;

  const destination = tasksInColumn(snapshot, over.columnId);
  const overIndex = destination.findIndex((task) => task.id === over.id);
  if (overIndex === -1) return null;

  if (active.columnId !== over.columnId) {
    return { columnId: over.columnId, index: overIndex };
  }

  return { columnId: over.columnId, index: overIndex };
}
