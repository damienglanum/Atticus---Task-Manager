# ADR-0011 — State ownership: TanStack Query for persisted data, Zustand for UI only

Date: 2026-07-30 · Status: **Accepted**

## Context

The brief permits Zustand "only for transient client UI state" and TanStack Query "where it
genuinely improves asynchronous data synchronization". Both are easy to over-apply, and the result
is two competing copies of the truth.

## Decision

| State | Owner |
|---|---|
| Everything persisted (projects, boards, columns, tasks, labels, filters, preferences) | **TanStack Query** cache over the Tauri commands. SQLite is the source of truth; this is a cache |
| Dialog open/closed, command-palette open, drag overlay, filter draft being edited, toast queue, focused card id | **Zustand** |
| Counts, due-date state, WIP breach, filter matches | **Neither** — pure functions in `lib/`, computed at render |

Query keys are centralised in `lib/query/keys.ts`; each mutation declares which keys it
invalidates in `lib/query/invalidation.ts`, so the invalidation map is one reviewable table rather
than scattered `invalidateQueries` calls.

**Optimistic updates exist for exactly three interactions** — task move, subtask toggle, archive —
and each implements the full contract:

- `onMutate`: cancel in-flight queries for the key, snapshot the current data, apply the change,
  return the snapshot as context.
- `onError`: restore the snapshot **exactly**, then toast an error naming the action.
- `onSettled`: invalidate, so the backend's truth wins regardless of outcome.

No optimistic update may be added without all three. Everything else waits for the command.

## Evidence

- TanStack Query genuinely earns its place here even without a network: it provides request
  deduplication (the board and the palette both want the project list), a defined cache-invalidation
  model, and — decisively — the `onMutate`/`onError`/`onSettled` contract that makes ADR-0005's
  rollback requirement a structure rather than a promise.
- Putting persisted data in Zustand would create a second store that must be manually kept in sync
  with SQLite. That is the "one source of truth for persisted data" rule broken by construction.
- Restricting optimism to three interactions keeps the rollback surface small enough to test all of
  it. Latency here is local IPC — single-digit milliseconds — so optimism buys almost nothing
  outside of drag, where the visual snap-back would be jarring.

## Alternatives considered

**Zustand for everything.** Fewer concepts. Rejected: no invalidation model, and manual sync with
the database.

**TanStack Query for everything including UI state.** Rejected: dialog visibility is not
asynchronous server state, and modelling it as such is a category error that makes it harder to read.

**No client cache — call a command on every render path.** Rejected: it would violate the "no
database query per rendered card" performance target and cause visible refetch flicker.

## Consequences

- Two state libraries. The boundary is stated above and is easy to police in review: if it is in
  SQLite, it is a query; if it disappears on reload and nobody minds, it is Zustand.
- The invalidation map must be kept current when commands are added — enforced by a test that
  asserts every mutation in `ipc.ts` has an entry.
- Optimism is deliberately narrow. If a non-optimistic interaction ever feels slow, the fix is to
  measure first (product-spec §9), not to add optimism reflexively.
