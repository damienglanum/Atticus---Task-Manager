# Architecture — Atticus

Status: approved for implementation (2026-07-30). Decisions with lasting consequences are recorded
as ADRs in [`docs/adr/`](adr/) and referenced from here.

---

## 1. System boundaries

```
┌─────────────────────────────────────────────────────────────┐
│ WebView (WKWebView on macOS) — untrusted-by-design          │
│                                                             │
│  React 19 + TypeScript (strict)                             │
│   • presentation, keyboard handling, drag interaction       │
│   • TanStack Query cache of persisted data (read model)     │
│   • Zustand store of transient UI state only                │
│   • Zod schemas — fast feedback, NOT the security boundary  │
│                                                             │
│  NO filesystem access. NO SQL. NO network.                  │
└───────────────────────────┬─────────────────────────────────┘
                            │  Tauri IPC — typed commands only
┌───────────────────────────┴─────────────────────────────────┐
│ Rust core — the trust boundary                              │
│                                                             │
│  commands/  thin: deserialise → validate → call domain      │
│  domain/    ordering, archiving, import/export, undo        │
│  db/        rusqlite, migrations, transactions              │
│  fs/        backups, file-reference verification            │
│                                                             │
│  Authoritative validation. All SQL. All file I/O.           │
└───────────────────────────┬─────────────────────────────────┘
                            │
                   ~/Library/Application Support/
                     nl.synaptica.takenkanban/
                       takenkanban.sqlite3  (+ -wal, -shm)
                       backups/
```

**The rule that makes this hold:** the webview is granted no `fs` read permission, no `shell`
permission, and no network origin. Everything it can do, it does by naming a command. If a command
does not exist, the capability does not exist. See §11.

## 2. Frontend / backend responsibilities

| Concern | Owner | Rationale |
|---|---|---|
| SQL, schema, migrations | Rust | One place SQL can exist. ADR-0002 |
| Input validation (authoritative) | Rust | The webview is the attack surface, not the guard |
| Input validation (immediate feedback) | TypeScript / Zod | UX only; never the last line of defence |
| Ordering algorithm | Rust | Must be transactional with the write. ADR-0004 |
| Transaction boundaries | Rust | ADR-0005 |
| Undo semantics | Rust produces the inverse; TS sequences it | ADR-0009 |
| Read-model caching, invalidation | TanStack Query | ADR-0011 |
| Transient UI state | Zustand | Dialogs, drag overlay, filter draft, palette |
| Derived values (counts, due state) | Pure TS selectors | Never stored, never persisted |
| Theme, last-opened, filters | SQLite `app_state` via commands | Survives restart; one source of truth |

There is exactly one source of truth for persisted data: the SQLite file. The Query cache is a
cache, and is always invalidated by the mutation that changed the underlying rows.

## 3. Data model

IDs are **UUIDv7** stored as TEXT — globally unique, monotonic by creation time, so they sort
usefully and never collide across an import merge. Array indexes are never persisted as identity.

Timestamps (`created_at`, `updated_at`, `archived_at`) are **UTC epoch milliseconds** (INTEGER).
Due dates are **calendar dates** stored as `YYYY-MM-DD` TEXT and are never instants — this is what
makes the timezone/DST edge case disappear rather than needing handling. See product-spec §6.

### 3.1 Schema (migration 1)

```sql
PRAGMA foreign_keys = ON;      -- per-connection, set on every open. Default is OFF.
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;     -- writes are small and user-paced; durability is worth the fsync

CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY,
  description TEXT    NOT NULL,
  applied_at  INTEGER NOT NULL
);

CREATE TABLE app_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL          -- JSON scalar or object; read through a typed accessor
);

CREATE TABLE projects (
  id               TEXT    PRIMARY KEY,
  name             TEXT    NOT NULL,
  description      TEXT    NOT NULL DEFAULT '',
  color            TEXT    NOT NULL,          -- design token name, not a hex literal
  key_prefix       TEXT    NOT NULL,          -- 'KAN'
  next_task_number INTEGER NOT NULL DEFAULT 1,
  directory_path   TEXT,                      -- nullable; absolute
  position         INTEGER NOT NULL,
  archived_at      INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_projects_position ON projects(position);

CREATE TABLE boards (
  id         TEXT    PRIMARY KEY,
  project_id TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_boards_project_position ON boards(project_id, position);

-- Named board_columns, not columns: 'columns' collides with SQLite's PRAGMA vocabulary
-- and makes every query harder to read.
CREATE TABLE board_columns (
  id         TEXT    PRIMARY KEY,
  board_id   TEXT    NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  wip_limit  INTEGER CHECK (wip_limit IS NULL OR wip_limit > 0),
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_columns_board_position ON board_columns(board_id, position);

CREATE TABLE tasks (
  id               TEXT    PRIMARY KEY,
  project_id       TEXT    NOT NULL REFERENCES projects(id)      ON DELETE CASCADE,
  board_id         TEXT    NOT NULL REFERENCES boards(id)        ON DELETE CASCADE,
  column_id        TEXT    NOT NULL REFERENCES board_columns(id) ON DELETE CASCADE,
  number           INTEGER NOT NULL,           -- per-project, never reused
  title            TEXT    NOT NULL,
  description      TEXT    NOT NULL DEFAULT '',
  priority         INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),
  due_date         TEXT    CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  estimate_minutes INTEGER CHECK (estimate_minutes IS NULL OR estimate_minutes > 0),
  position         INTEGER NOT NULL,
  archived_at      INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_tasks_project_number ON tasks(project_id, number);
-- Partial: archived tasks leave the ordering sequence entirely, so they cannot
-- occupy or collide with a live position.
CREATE UNIQUE INDEX ux_tasks_column_position ON tasks(column_id, position)
  WHERE archived_at IS NULL;
CREATE INDEX ix_tasks_board_live      ON tasks(board_id)   WHERE archived_at IS NULL;
CREATE INDEX ix_tasks_project_archived ON tasks(project_id, archived_at);
CREATE INDEX ix_tasks_due             ON tasks(due_date)   WHERE archived_at IS NULL AND due_date IS NOT NULL;

CREATE TABLE subtasks (
  id         TEXT    PRIMARY KEY,
  task_id    TEXT    NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title      TEXT    NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0,1)),
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_subtasks_task_position ON subtasks(task_id, position);

CREATE TABLE labels (
  id         TEXT    PRIMARY KEY,
  project_id TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  color      TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_labels_project ON labels(project_id);

CREATE TABLE task_labels (
  task_id  TEXT NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);
CREATE INDEX ix_task_labels_label ON task_labels(label_id);

CREATE TABLE file_refs (
  id               TEXT    PRIMARY KEY,
  task_id          TEXT    NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  path             TEXT    NOT NULL,          -- absolute, canonicalised at insert
  display_name     TEXT    NOT NULL,
  last_verified_at INTEGER,
  found            INTEGER NOT NULL DEFAULT 1 CHECK (found IN (0,1)),
  position         INTEGER NOT NULL,
  created_at       INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_file_refs_task_position ON file_refs(task_id, position);

CREATE TABLE saved_filters (
  id         TEXT    PRIMARY KEY,
  project_id TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  filter     TEXT    NOT NULL,                -- JSON, validated on read AND write
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_saved_filters_project_position ON saved_filters(project_id, position);

-- Full-text search over live tasks. External-content FTS5 table kept in sync by triggers,
-- so there is no second copy of the truth to drift.
CREATE VIRTUAL TABLE tasks_fts USING fts5(
  title, description, content='tasks', content_rowid='rowid', tokenize='unicode61'
);
-- + AFTER INSERT / AFTER DELETE / AFTER UPDATE triggers on tasks
```

**FTS5 availability is a build assumption that must be verified, not assumed.** Milestone 2
includes a test that opens a connection and creates an FTS5 table. If the bundled SQLite lacks
FTS5, the fallback is a `title_norm` column with a `LIKE 'x%'`-friendly index plus a scan of
descriptions — slower, still meeting the 100 ms target at 5,000 rows, and the search API does not
change. This is recorded so the fallback is a decision, not a scramble.

### 3.2 Why `project_id` and `board_id` are denormalised onto `tasks`

They are derivable via `board_columns → boards`. They are stored anyway because the two hottest
queries — "all live tasks on this board" and "search across projects, excluding archived" — would
otherwise need two joins to answer, and because a task's project scopes its label set and its
`number`. The cost is that a task moved between boards must update three columns in one statement;
this happens in exactly one place (`move_task`) and is covered by a test asserting the three stay
consistent.

## 4. Ordering strategy

**Dense integers, transactionally reindexed, enforced by a partial unique index.** Full reasoning
and the rejected alternatives are in **ADR-0004**.

The move algorithm, run inside a single transaction:

1. Read the source column's live tasks ordered by position, and the destination column's.
2. If source == destination and target index == current index → **return early, write nothing**.
   (Product-spec §6: a no-op move must not dirty `updated_at`.)
3. Shift every affected row's position into a disjoint range: `UPDATE … SET position = position + 1000000 WHERE column_id = ?`. This is required because `ux_tasks_column_position` is a
   **non-deferrable** unique index — SQLite checks it per statement, so a naive renumber would
   collide mid-flight. Two-phase is not an optimisation, it is a correctness requirement.
4. Write the final dense `0..n-1` sequence for the source column, and for the destination column
   with the moved task inserted at the target index.
5. Update the task's `column_id`, `board_id`, `project_id` and `updated_at`.
6. Commit.

Invariant asserted after every move by a debug-build assertion and by tests: for every column,
the multiset of live positions equals `{0, 1, …, n-1}`.

## 5. Migration strategy

See **ADR-0003**. Summary:

- Migrations are an ordered `&[Migration { version, description, sql }]` compiled into the binary.
- On open: read `PRAGMA user_version` (mirrored into `schema_migrations` for the audit trail).
- If `db_version > code_version` → refuse to start with a clear error. A newer database opened by
  an older app is a data-loss scenario, not something to muddle through.
- If `db_version < code_version` → **copy the file to `backups/pre-migration-<version>-<iso>.sqlite3` first**, then apply each pending migration inside one transaction, setting
  `user_version` in the same transaction.
- Any failure rolls back and surfaces `AppError::Migration { backup_path }`; the app renders a
  recovery screen naming the backup instead of a blank board.
- Migrations are never edited after release. A mistake is fixed by a new migration.

## 6. Command contracts

All commands are `async` and return `Result<T, AppError>`. Names are `snake_case` in Rust and
invoked from TS through a single typed wrapper (`src/lib/ipc.ts`) — components never call
`invoke()` with a string directly, so the command surface is greppable and mockable.

```
projects_list(include_archived: bool)                -> Vec<Project>
project_create(input: NewProject)                    -> ProjectWithBoard
project_update(id, patch: ProjectPatch)              -> Project
project_set_archived(id, archived: bool)             -> Project
project_delete(id, confirm_name: String)             -> DeletedCounts

boards_list(project_id)                              -> Vec<Board>
board_create(project_id, name)                       -> Board
board_update(id, patch)                              -> Board
board_delete(id)                                     -> ()
boards_reorder(project_id, ordered_ids: Vec<Id>)     -> Vec<Board>

columns_list(board_id)                               -> Vec<Column>
column_create(board_id, name, wip_limit)             -> Column
column_update(id, patch)                             -> Column
column_delete(id, disposition: ColumnDisposition)    -> UndoToken
columns_reorder(board_id, ordered_ids)               -> Vec<Column>

board_load(board_id, filter: TaskFilter)             -> BoardSnapshot   // the 3-query read
task_create(input: NewTask)                          -> Task
task_update(id, patch: TaskPatch)                    -> Task
task_move(id, to_column_id, to_index)                -> MoveResult
task_set_archived(id, archived)                      -> Task
task_duplicate(id)                                   -> Task
task_delete(id)                                      -> UndoToken
tasks_search(query, scope: SearchScope, limit)       -> Vec<SearchHit>

subtask_create / subtask_update / subtask_delete / subtasks_reorder
label_create / label_update / label_delete / task_set_labels
file_ref_add / file_ref_remove / file_refs_verify(task_id) / file_ref_reveal(id)
saved_filter_create / saved_filter_delete / saved_filters_list

undo_apply(token: UndoToken)                         -> ()

app_state_get(key) / app_state_set(key, value)
export_data(scope: ExportScope)                      -> ExportDocument
import_preview(document: Value)                      -> ImportPlan
import_apply(document: Value, mode: ImportMode)      -> ImportResult
backup_create(label: Option<String>)                 -> BackupInfo
backups_list()                                       -> Vec<BackupInfo>
backup_restore(path)                                 -> ()
database_info()                                      -> DatabaseInfo   // path, size, counts
```

`BoardSnapshot` is deliberately one command returning columns + tasks + each task's labels and
subtask counts, satisfying the "no database query per rendered card" target (product-spec §9).

### 6.1 Type contract between Rust and TypeScript

Rust structs derive `serde::Serialize/Deserialize` **and** `ts_rs::TS`. `cargo test` regenerates
`src/lib/bindings/*.ts`, and CI fails if the checked-in bindings differ from the generated ones.
This makes drift between the two languages a build failure rather than a runtime surprise, and
means `any` is never needed at the IPC boundary. See ADR-0010.

## 7. Validation boundaries

Two layers, deliberately duplicated, with clearly different jobs:

1. **Zod, in the webview** — runs as the user types. Produces the inline messages. Never trusted.
2. **Rust, in the command** — the authoritative check. Runs on every call regardless of what the
   frontend did. Returns `AppError::Validation { field, message }`, which the frontend maps back
   onto the offending form field.

Shared rules (title length, priority range, date format, WIP > 0) are stated once in
`docs/product-spec.md` §5 and implemented in both places, with a test on each side asserting the
same boundary values. Where a rule is a database CHECK as well, that is a third net, not a
substitute.

## 8. Transaction boundaries

Every command that writes more than one row opens exactly one transaction:

| Command | Rows touched | Why it must be atomic |
|---|---|---|
| `task_move` | up to 2 columns' worth | A partial move corrupts ordering |
| `column_delete` | column + n tasks (reassign or delete) | Half-deleted column orphans tasks |
| `project_delete` | full cascade | Half-deleted project is unrecoverable |
| `task_duplicate` | task + subtasks + labels + refs | A copy missing its subtasks is silently wrong |
| `import_apply` | everything | Product-spec §7.2 |
| migrations | schema + `user_version` | ADR-0003 |
| `task_create` | task + counter increment | Two tasks must never get the same number |

Concurrency: one `Mutex<Connection>` in Rust — a single writer by construction. The frontend
additionally serialises moves through a queue so that a burst of drags cannot interleave
(product-spec §6, "rapid reordering").

## 9. Error model

```rust
#[derive(Debug, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AppError {
    Validation { field: String, message: String },
    NotFound    { entity: String, id: String },
    Conflict    { message: String },
    Database    { message: String },
    Io          { message: String },
    Migration   { message: String, backup_path: Option<String> },
    ImportInvalid { issues: Vec<ImportIssue> },
    Internal    { message: String },
}
```

Rules:
- No command returns `String` errors. No `unwrap()`/`expect()` in command paths.
- `Database` and `Io` carry a message safe to display; the full error is logged to `$APPLOG`.
- The frontend has one error renderer. There is **no** `catch {}` that discards — a lint rule
  (`@typescript-eslint/no-empty`) plus review enforces it.
- A failed mutation rolls back the optimistic cache update (§10) and shows a toast that names the
  action that failed.

## 10. Optimistic updates and rollback

Only three interactions are optimistic, because only they are latency-visible: task move, subtask
toggle, and archive. Each uses the TanStack Query `onMutate` → `onError` → `onSettled` contract:
`onMutate` snapshots the affected query data and applies the change; `onError` restores the exact
snapshot and raises a toast; `onSettled` invalidates so the server's truth wins regardless. No
optimistic update exists without that rollback path — ADR-0011.

Everything else (create, edit, delete, import) waits for the command and is not optimistic. Typing
in the editor is debounced but not optimistic: the local input is the input's own state, and the
persisted value is refetched on close.

## 11. Security posture

- **Capabilities:** one `main` capability, window `["main"]`, listing only:
  `core:default`, `dialog:allow-open`, `opener:allow-reveal-item-in-dir`,
  `opener:allow-open-url` (scoped to `http`/`https`/`mailto`), and in debug builds only,
  `wdio-webdriver:default`.
- **No `fs` plugin permission is granted to the webview at all.** The frontend cannot read, write,
  or list any path. File references are chosen through the system dialog (user-gated) and opened
  through a Rust command.
- **No `shell` or updater plugin permission is exposed to the webview.** Nothing in the interface
  can execute a subprocess, select an update URL, or install arbitrary bytes. Rust owns one fixed
  HTTPS feed for `main` and verifies every artifact against the embedded public key before
  installation. The webview receives status and may request a restart only after installation.
- **CSP** (explicit, since Tauri applies none unless configured):
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: data:; font-src 'self'; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`
  (`style-src 'unsafe-inline'` is required by Tailwind's runtime-injected styles; it is the one
  relaxation and it is recorded here rather than hidden.)
- **Markdown** is rendered with raw HTML disabled and a URL scheme allow-list of
  `http`, `https`, `mailto`, `file`. `file:` links are rendered as reveal-in-Finder actions, never
  as navigations.
- **Path handling:** every path crossing the boundary is canonicalised in Rust, rejected if it
  contains a NUL byte or is not absolute. Nothing interpolates a path into SQL or a shell string.

## 12. File references — representation

Stored as an absolute canonical path plus a display name (ADR-0007). No copy is made; no bookmark
API is used in v1 because the app is not sandboxed for the Mac App Store and therefore has ordinary
user-level file access. Consequence, recorded honestly: **if the app is ever sandboxed for App
Store distribution, plain paths will stop resolving and security-scoped bookmarks become
mandatory.** That is a known future migration, not a present bug.

Verification is lazy — `file_refs_verify` runs when a task editor opens, updates `found` and
`last_verified_at`, and never blocks the board.

## 13. Backup and recovery

- Backups use SQLite's `VACUUM INTO '<path>'`, which produces a consistent single-file copy
  without needing to checkpoint or stop writers — safer than copying three WAL-mode files.
- Automatic triggers: before migrations, before `import_apply` in replace mode, before
  `project_delete`. Rolling retention of 10 automatic backups; manual backups never auto-deleted.
- Restore: backup the current database first, close the connection, swap the file, reopen, run
  migrations. If the restored file fails to open or migrate, the pre-restore backup is swapped back
  automatically and the failure is reported.

## 14. Frontend structure

Split by product boundary, not by file size.

```
src/
  app/            shell, routing, providers, theme, global shortcuts
  features/
    projects/     switcher, project dialogs, archive view
    boards/       board toolbar, board switcher
    columns/      column, header, WIP indicator, column menu
    tasks/        card, editor, quick composer, move dialog, duplicate
    labels/       picker, manager
    filters/      filter bar, filter builder, saved filters
    search/       command palette, search results
    settings/     theme, database info, backups, import/export
  components/ui/  shadcn/Radix primitives (owned source, restyled)
  lib/
    ipc.ts        the ONLY module that calls invoke()
    bindings/     generated from Rust by ts-rs — do not edit
    query/        query keys, hooks, invalidation map
    dates.ts      calendar-date helpers (no timezone maths)
    filters.ts    pure filter predicates — unit tested
  styles/
    tokens.css    the design token layer (@theme)
```

Business rules (what "overdue" means, whether a WIP limit is breached, how a filter matches) live
in `lib/` as pure functions and are unit-tested without rendering anything. Components read them;
components do not contain them.

## 15. Open risks

| Risk | Impact | Mitigation / trigger |
|---|---|---|
| FTS5 absent from bundled SQLite | Search falls back to slower path | Verified by a test in milestone 2; fallback designed (§3.1) |
| `tauri-plugin-wdio-webdriver` immaturity | E2E on macOS unreliable | ADR-0008; if it fails, that is reported, not hidden, and integration tests carry more weight |
| ts-rs binding drift | TS/Rust disagreement | CI diff check (§6.1) |
| `style-src 'unsafe-inline'` | Weakened CSP | Accepted, documented; no user content ever reaches a style attribute |
| Dense reindex cost at very large columns | Slow move | Measured in milestone 10 against 5,000 tasks; ADR-0004 states the switch threshold |
| Sandboxing would break file refs | Feature breaks on App Store distribution | §12; not a v1 target |
