# ADR-0003 — Versioned, backed-up, transactional migrations

Date: 2026-07-30 · Status: **Accepted**

## Context

The schema will change after the user has real data in it. A migration failure on a personal task
database is a data-loss event, and "Database migration failure" is named as a required edge case.

## Decision

Migrations are an ordered, compiled-in list of `Migration { version: u32, description, sql }`.
`PRAGMA user_version` holds the applied version; `schema_migrations` mirrors it with descriptions
and timestamps for auditability. On open:

1. `db_version > code_version` → **refuse to start**, with a message naming both versions.
2. `db_version < code_version` → copy the file to `backups/pre-migration-<from>-<iso>.sqlite3`
   **before doing anything**, then apply each pending migration and the `user_version` bump inside
   **one transaction**.
3. On failure → roll back, and return `AppError::Migration { message, backup_path }`. The app
   renders a recovery screen naming the backup rather than a broken board.

Released migrations are immutable. A mistake is corrected by adding a new migration.

## Evidence

- SQLite's `PRAGMA user_version` is a durable per-file integer written inside the transaction that
  changes the schema, so version and schema cannot disagree.
- SQLite supports transactional DDL, so a multi-statement migration genuinely rolls back.
- The Tauri SQL plugin's documented approach ("each migration must have a unique version number",
  "all migrations are executed within a transaction") validates the shape; we adopt it and add the
  pre-migration backup and the newer-database refusal, which it does not provide.

## Alternatives considered

**Migrate in place with no backup.** Rejected outright — the failure mode is unrecoverable user
data.

**Best-effort forward migration ignoring version mismatch.** Rejected: opening a v5 database with
v3 code and writing to it silently destroys data the newer version added.

**Down-migrations.** Rejected for v1. They are rarely correct (they cannot restore dropped data)
and give false confidence. Restoring the pre-migration backup is the honest rollback, and it is a
tested path.

## Consequences

- A backup file is written on every schema upgrade, consuming disk proportional to database size.
  Retention (10 automatic) bounds this.
- Downgrading the app after a migration requires restoring a backup manually. Documented in
  `docs/data-and-backups.md` and in the refusal message itself.
- Requires a test that injects a deliberately failing migration and asserts the database is
  untouched and the backup exists — listed in `docs/testing.md`.
