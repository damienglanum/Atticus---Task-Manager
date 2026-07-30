# ADR-0002 — SQLite through typed Rust commands, not the official SQL plugin

Date: 2026-07-30 · Status: **Accepted**

## Context

Data must persist in a real local SQLite database. Tauri ships an official SQL plugin
(<https://v2.tauri.app/plugin/sql/>) which exposes `load` / `execute` / `select` to the frontend.

## Decision

Use **`rusqlite` 0.40.1** (MIT, verified from crates.io on 2026-07-30) inside the Rust core, behind
purpose-named Tauri commands. **Do not** use `tauri-plugin-sql`. SQL text never exists in the
frontend bundle.

## Evidence

- The plugin's API surface is `execute(sql, params)` called *from the webview*. Granting that
  permission means any script running in the webview can issue arbitrary SQL. The brief requires
  Tauri commands that "validate input" and "return typed errors" — an `execute(sql)` command can do
  neither meaningfully.
- The plugin documentation describes migrations wrapped in transactions but documents **no explicit
  transaction-control API**. `task_move` and `column_delete` need `BEGIN`/`COMMIT` around
  multi-statement work (architecture §8); without it, an interrupted move corrupts ordering.
- With commands, the SQL, the validation, and the transaction live in the same function, so the
  atomicity guarantee is local and reviewable.

## Alternatives considered

**`tauri-plugin-sql`.** Less Rust to write, official, maintained. Rejected for the two reasons
above. Its *migration design* — monotonically versioned migrations each applied in a transaction —
is genuinely good and is adopted (reimplemented) in ADR-0003.

**`sqlx` with compile-time-checked queries.** Attractive query verification. Rejected: it is async
and built for connection pools against servers; for one embedded single-writer SQLite file it adds
a runtime and a build-time database requirement for no benefit we need.

**`diesel`.** Full ORM with a migration system. Rejected: our schema is small and our queries are
few and hand-tuned (the 3-query `board_load` is deliberate). An ORM would obscure exactly the
queries whose shape we care about most.

## Consequences

- ~40 command functions to write and keep in sync with TypeScript — mitigated by ADR-0010.
- The frontend cannot run an ad-hoc query, including for debugging. Accepted: a `database_info`
  command plus the documented file path covers real needs, and `sqlite3` on the CLI covers the rest.
- Every new read shape needs a new command rather than a new query string. This is the point: the
  command list *is* the API surface, and it is greppable.
