# ADR-0004 — Dense integer positions, transactionally reindexed

Date: 2026-07-30 · Status: **Accepted**

## Context

Tasks are ordered within a column, columns within a board, boards within a project, subtasks within
a task. The brief requires an ordering strategy that "avoid[s] corrupt or duplicate positions after
repeated drag operations", chosen explicitly and tested.

## Decision

Every ordered relation uses a **dense `INTEGER` position starting at 0**, with a **unique index**
on `(parent_id, position)` — partial (`WHERE archived_at IS NULL`) where archiving removes rows
from the sequence. A move rewrites the affected sequences inside one transaction, in two phases:

```sql
BEGIN;
UPDATE tasks SET position = position + 1000000 WHERE column_id = ?1 AND archived_at IS NULL;
-- then write final 0..n-1 values
COMMIT;
```

The offset phase is **mandatory, not an optimisation**: SQLite checks unique indexes per statement
and does not support deferring them, so renumbering in place collides mid-statement.

## Evidence

- Researched fractional indexing (<https://github.com/rocicorp/fractional-indexing>,
  <https://www.npmjs.com/package/fractional-indexing-jittered>, accessed 2026-07-30). Its headline
  advantage is O(1) writes and collision-free concurrent inserts. Its documented cost: keys grow in
  length under repeated insertion into a narrow interval, so long-running systems *"need a
  rebalancing step that periodically rewrites the ordering keys"*, and jitter is recommended to
  avoid collisions **between concurrent writers**.
- This application has exactly **one writer**, on one machine, with no sync. The problem fractional
  indexing solves does not exist here; the maintenance burden it creates does.
- A dense sequence makes the correctness invariant checkable in one line — the multiset of live
  positions in a column equals `{0..n-1}` — and the unique index makes violating it *impossible*
  rather than merely unlikely. A string-key scheme has no comparable database-level guard.
- Cost: a move rewrites up to two columns. A column holds tens to low hundreds of tasks; a local
  SQLite transaction over a few hundred rows is sub-millisecond, against a 50 ms budget.

## Alternatives considered

**Fractional / lexicographic string keys.** Rejected above. Would be reconsidered if this app ever
gained sync or multi-device editing — at which point it becomes the right answer.

**Sparse integers with gaps (steps of 1024), reindexing only on exhaustion.** O(1) in the common
case. Rejected for v1: it needs *both* code paths and both must be tested, and the rare path is the
one that will be under-tested. Two mechanisms, one of which almost never runs, is how ordering bugs
survive to production.

**Linked list (`prev_id`/`next_id`).** O(1) moves, no renumbering. Rejected: reading a column in
order requires a recursive CTE, and a single broken link silently truncates a column with no
constraint able to detect it.

## Consequences

- Moves are O(n) in column size. **Switch threshold, stated in advance:** if the milestone-10
  benchmark shows a move exceeding 50 ms at a realistic column size, switch to sparse integers with
  reindex-on-exhaustion (the smallest change) before considering fractional keys.
- The two-phase update must never be "simplified" back to one phase. A comment at the call site
  says so, and a test moves a task in a 200-task column and asserts success.
- Required tests: 500 pseudo-random moves asserting the dense invariant after each; move to same
  position is a no-op with no `updated_at` change; move into an empty column; move first→last and
  last→first.
