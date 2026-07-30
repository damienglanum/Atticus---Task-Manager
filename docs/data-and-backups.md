# Data and backups

Where your data is, what protects it, and how to get it back.

Status: the backup and migration machinery described here is **implemented and tested** as of
milestone 2. Export/import (§6) is specified but arrives in milestone 9, and is marked as such.

---

## 1. Where the data lives

```
~/Library/Application Support/nl.synaptica.takenkanban/
  takenkanban.sqlite3        the database
  takenkanban.sqlite3-wal    write-ahead log
  takenkanban.sqlite3-shm    shared-memory index
  backups/                   snapshots
```

The exact path is shown inside the application under **Your data**, with the size, the schema
version, and how many backups exist. You should never have to guess where your own data is.

It is an ordinary SQLite file. `sqlite3`, DB Browser for SQLite, or any other tool can open it
while the application is closed.

> The `-wal` and `-shm` files are part of the database, not scratch files. If you ever copy the
> database by hand, copy all three — or better, use the backup feature, which avoids the problem
> entirely (§3).

## 2. What protects the data

| Mechanism | What it prevents | Verified by |
|---|---|---|
| `PRAGMA journal_mode = WAL` | Corruption from a crash or power loss mid-write | `db::tests::durability_pragmas_are_set` |
| `PRAGMA synchronous = FULL` | Losing a committed transaction to an OS crash | same test |
| `PRAGMA foreign_keys = ON` on every connection | Orphaned boards, columns, tasks | `db::tests::foreign_keys_are_actually_on`, `foreign_key_violations_are_rejected` |
| `ON DELETE CASCADE` throughout | Half-deleted projects leaving unreachable rows | `deleting_a_project_cascades_to_everything_beneath_it` |
| Partial unique index on `(column_id, position)` | Duplicate or missing task positions | `two_live_tasks_cannot_share_a_position`, `archived_tasks_leave_the_position_sequence` |
| Migrations inside one transaction | A half-applied schema change | `a_failing_migration_leaves_the_database_untouched` |
| Automatic pre-migration backup | Losing data to a failed upgrade | `a_failing_upgrade_preserves_the_data_and_names_the_backup` |
| Refusing a newer database | An old build overwriting what a newer one wrote | `a_database_from_a_newer_build_is_refused_rather_than_opened` |

Foreign keys deserve a note: SQLite disables them **by default**, per connection, for backwards
compatibility. Setting the pragma once by hand is not enough, and a database with foreign keys
silently off behaves perfectly right up until it does not. So the setting is applied on every open
and asserted by a test that reads it back.

## 3. Backups

Backups use SQLite's `VACUUM INTO`, which writes a **consistent single-file copy** while the
connection stays open. Copying the three files by hand means copying them at three different
instants, which is how subtly-corrupt backups happen.

A snapshot is a complete, standalone database. You can open it directly with `sqlite3`.

### When a backup is taken

| Trigger | Label | Status |
|---|---|---|
| You click **Back up now** | `manual-<timestamp>.sqlite3` | Implemented |
| An existing database is about to be migrated | `pre-migration-<from>-<timestamp>.sqlite3` | Implemented |
| Before a replace-mode import | `pre-import-<timestamp>.sqlite3` | Milestone 9 |
| Before deleting a project | `pre-delete-<timestamp>.sqlite3` | Milestone 9 |

A brand-new database at version 0 is **not** backed up before its first migration — there is
nothing to lose. Tested by `a_fresh_database_is_not_backed_up_before_its_first_migration`.

Snapshot filenames carry a millisecond timestamp and sort chronologically. If two land inside the
same millisecond, the second gets a numeric suffix rather than overwriting the first.

### Retention

Automatic backups are pruned to the 10 most recent. **Manual backups are never pruned
automatically** — if you asked for it, only you delete it. (Pruning lands in milestone 9; until
then, nothing is deleted at all.)

## 4. If a migration fails

This is the moment the machinery exists for, so it is worth stating exactly what happens:

1. Before touching anything, the database is copied to `backups/pre-migration-<version>-<time>.sqlite3`.
2. All pending migrations run inside **one** transaction.
3. If any statement fails, the transaction rolls back. The schema version does not advance, and
   partial work from the failed migration does not survive.
4. The application **still opens**, and shows a recovery screen naming the backup path in full,
   selectable, untruncated.

Your original database is left exactly as it was. The backup is a second copy, not a replacement.

## 5. If the app refuses to open your database

You will see: *"This database was written by a newer version of Takenkanban (schema N); this build
understands schema M."*

That is deliberate. Writing to a database created by a newer build would destroy whatever that
build added. Either update the application, or restore a backup taken before the upgrade.

Refusing to open writes **nothing** — not even a backup. Tested.

## 6. Export and import — milestone 9

Specified in [`product-spec.md`](product-spec.md) §7 and
[ADR-0006](adr/0006-import-export-versioning.md). Summary of the contract:

- JSON with an `exportVersion` independent of the schema version and the app version.
- Import validates the **whole document before any write**; a malformed file writes nothing.
- Older versions are upgraded through unit-tested pure functions; newer versions are refused.
- Merge mode allocates fresh ids and overwrites nothing. Replace mode requires typed confirmation
  and takes a backup first.
- File references export as **paths, not contents**. Restoring on a different machine will show
  "missing file" states, which is honest rather than surprising.

## 7. Restoring by hand

Until the in-app restore lands in milestone 9:

1. Quit Takenkanban.
2. Move the current `takenkanban.sqlite3`, `-wal`, and `-shm` files somewhere safe.
3. Copy your chosen snapshot from `backups/` to `takenkanban.sqlite3`.
4. Start the application. Any pending migrations run on open, taking their own backup first.

Do not do this while the application is running.
