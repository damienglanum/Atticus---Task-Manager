# ADR-0005 — How a drag becomes a durable, atomic write

Date: 2026-07-30 · Status: **Accepted**

## Context

A drag produces a stream of events and one final drop. The board must never show an order the
database does not hold, and a burst of rapid drags must not interleave into a corrupt state.

## Decision

- **Nothing is persisted during a drag.** `onDragOver` updates only local presentation state. The
  single write happens on `onDragEnd`, as one `task_move(id, to_column_id, to_index)` command.
- `task_move` is one transaction (ADR-0004). It is **idempotent for a no-op**: moving a task to the
  position it already holds writes nothing and does not touch `updated_at`.
- The frontend serialises moves through a **single-flight queue**. A move dispatched while another
  is in flight waits; it is not merged, dropped, or raced.
- The command's return value (`MoveResult`, carrying the authoritative post-move ordering of both
  affected columns) is applied to the cache on success. On failure the optimistic update is rolled
  back from the `onMutate` snapshot and an error toast names the task that failed to move.
- A cancelled drag (`onDragCancel`, Escape) issues no command at all.

## Evidence

- dnd-kit's `KeyboardSensor` and pointer sensors both terminate in `onDragEnd`/`onDragCancel`
  (<https://dndkit.com/guides/accessibility>, accessed 2026-07-30), so pointer drag, keyboard drag,
  and the explicit "Move to…" command can all funnel into the same single command. One code path,
  three entry points — which is also why keyboard movement cannot rot: it is not a parallel
  implementation.
- Writing per drag-over event would produce dozens of transactions per drag and make an interrupted
  drag leave a partial reorder.

## Alternatives considered

**Persist continuously during the drag.** Rejected: transaction storm, and an interrupted drag
leaves the board in an intermediate state the user never intended to commit.

**Send the whole new column order instead of `(task, column, index)`.** Rejected: it makes the
frontend the authority on ordering, so a stale cache would overwrite good data. Sending the
*intent* lets the backend compute the order from the truth it already holds.

**No optimistic update — wait for the round trip.** Rejected: a local IPC round trip is a few
milliseconds, but the card visibly snapping back and forth is worse than an optimistic update with
a real rollback. The rollback path is mandatory (ADR-0011).

## Consequences

- A move can fail *after* the card has visually moved. The rollback must be visually clear, and is
  tested by forcing a command error and asserting the card returns to its original position.
- The single-flight queue is a small piece of machinery that needs its own test: dispatch 50 moves
  synchronously, assert 50 sequential commands and a final state matching the last move.
