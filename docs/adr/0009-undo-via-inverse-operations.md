# ADR-0009 — Undo as backend inverse operations

Date: 2026-07-30 · Status: **Accepted**

## Context

The brief asks for "undo for common reversible actions where practical" and separately forbids
optimistic updates without a rollback strategy. Undo done badly is worse than no undo: it appears
to restore data and does not.

## Decision

Undo is implemented **in the backend as an explicit inverse operation**, not as a frontend state
snapshot.

- Every undoable command returns an `UndoToken` — a serialisable description of the inverse,
  containing the full data needed to reverse it (for a deleted task: the task row, its subtasks,
  its label links, its file refs, and its original column and position).
- `undo_apply(token)` executes that inverse inside **one transaction**.
- Tokens live in a bounded in-memory stack (20 entries) for the session, surfaced as an Undo action
  on the toast and via `⌘Z`. They are **not** persisted; undo history does not survive a restart,
  and the UI does not pretend otherwise.
- A token whose target no longer exists fails with `AppError::NotFound` and a clear message.

**Undoable:** move task, archive/restore task, delete task, delete column (both dispositions),
delete label, reorder columns.
**Not undoable:** delete project, replace-mode import. Both require typed confirmation, both take
an automatic backup first, and **both dialogs say plainly that they cannot be undone.**

## Evidence

- A frontend snapshot can only restore what the frontend happened to have cached. Deleting a task
  whose subtasks were never loaded would "undo" into a task with its subtasks silently gone. The
  backend has the whole row and its children, so its inverse is complete by construction.
- Executing the inverse in a transaction means undo has the same atomicity guarantee as the
  original operation. A half-applied undo is the worst possible outcome and is made impossible.
- Bounding the stack at 20 avoids unbounded memory growth from tokens carrying full task subtrees.

## Alternatives considered

**Full command-log undo/redo across restarts.** Powerful. Rejected for v1: it requires every
mutation to be a replayable, versioned event, which is a substantially different architecture, and
a persisted log that disagrees with the database is a new class of data-loss bug.

**Frontend cache snapshot undo.** Cheap. Rejected — incomplete by construction, as above.

**SQLite `SAVEPOINT` held open across the toast timeout.** Rejected: holding a transaction open
while waiting on a human blocks the single writer and risks an indefinitely open transaction.

## Consequences

- Undo history is lost on quit. Stated in `docs/shortcuts.md` and discoverable from the fact that
  the stack visibly empties. Not disguised.
- Each undoable command must construct and test its inverse; there is no generic mechanism. That is
  more code, and it is why each inverse is actually correct.
- Redo is **not** implemented in v1. Half-implemented redo is worse than none, and no acceptance
  criterion asks for it.
