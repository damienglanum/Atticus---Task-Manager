//! SQLite access. All SQL in this application lives under this module.
//!
//! See `docs/adr/0002-sqlite-via-rusqlite-commands.md`.

pub mod app_state;
pub mod backup;
#[cfg(test)]
mod board_tests;
pub mod board_view;
pub mod boards;
pub mod columns;
pub mod export;
pub mod file_refs;
pub mod import;
pub mod labels;
pub mod migrations;
pub mod notes;
pub mod ordering;
pub mod projects;
pub mod saved_filters;
pub mod search;
pub mod subtasks;
pub mod tasks;
pub mod undo;
pub mod workspace;

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

pub const DATABASE_FILE_NAME: &str = "takenkanban.sqlite3";
pub const BACKUP_DIR_NAME: &str = "backups";

/// UTC epoch milliseconds. Every timestamp in the schema uses this.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as i64)
}

pub struct Database {
    conn: Connection,
    path: Option<PathBuf>,
}

// Hand-written so the connection handle is never printed: only the location,
// which is what is actually useful in a test failure or a log line.
impl std::fmt::Debug for Database {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Database")
            .field(
                "path",
                &self.path.as_deref().unwrap_or(Path::new("<in memory>")),
            )
            .finish()
    }
}

impl Database {
    /// Opens (creating if needed) the database at `path`, applies the connection
    /// pragmas, takes a pre-migration backup when an existing database is about
    /// to be upgraded, and runs any pending migrations.
    pub fn open(path: &Path) -> AppResult<Self> {
        Self::open_with(path, migrations::MIGRATIONS)
    }

    /// Same as [`Database::open`], parameterised by the migration list so tests
    /// can exercise upgrade and failure paths against the real code path rather
    /// than a simulation of it.
    pub fn open_with(path: &Path, list: &[migrations::Migration]) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(path).map_err(database_error)?;
        apply_pragmas(&conn)?;

        let mut database = Self {
            conn,
            path: Some(path.to_path_buf()),
        };

        // Only back up when there is something to lose. A brand-new file at
        // version 0 has no data a failed migration could destroy.
        let current = migrations::current_version(&database.conn)?;
        let backup_path = if current > 0 && current < migrations::latest_version(list) {
            Some(database.take_pre_migration_backup(current)?)
        } else {
            None
        };

        match migrations::apply(&mut database.conn, list) {
            Ok(_) => Ok(database),
            // Attach the backup location to the error: a migration failure is the
            // one moment the user most needs to be told where their data still is.
            Err(AppError::Migration { message, .. }) => Err(AppError::Migration {
                message,
                backup_path: backup_path.map(|p| p.to_string_lossy().into_owned()),
            }),
            Err(other) => Err(other),
        }
    }

    /// An isolated in-memory database with the full schema applied. Tests only.
    pub fn open_in_memory() -> AppResult<Self> {
        let conn = Connection::open_in_memory().map_err(database_error)?;
        apply_pragmas(&conn)?;

        let mut database = Self { conn, path: None };
        migrations::apply(&mut database.conn, migrations::MIGRATIONS)?;
        Ok(database)
    }

    pub fn connection(&self) -> &Connection {
        &self.conn
    }

    pub fn connection_mut(&mut self) -> &mut Connection {
        &mut self.conn
    }

    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    /// Closes the live connection, leaving this handle pointing at an empty
    /// in-memory database.
    ///
    /// Exists so the file underneath can be replaced. SQLite holds the file
    /// open, and copying over it while a connection is live is how a restore
    /// reports "database is locked" — or worse, succeeds against a handle that
    /// is still reading the inode that is no longer there.
    pub fn detach(&mut self) -> AppResult<()> {
        let placeholder = Connection::open_in_memory().map_err(database_error)?;
        let live = std::mem::replace(&mut self.conn, placeholder);

        live.close().map_err(|(_, error)| database_error(error))?;
        Ok(())
    }

    /// Replaces this handle with a freshly opened database at the same path.
    pub fn reopen(&mut self) -> AppResult<()> {
        let path = self
            .path
            .clone()
            .ok_or_else(|| AppError::internal("cannot reopen an in-memory database"))?;

        *self = Self::open(&path)?;
        Ok(())
    }

    pub fn table_exists(&self, name: &str) -> AppResult<bool> {
        let count: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type IN ('table','view') AND name = ?1",
                [name],
                |row| row.get(0),
            )
            .map_err(database_error)?;
        Ok(count > 0)
    }

    fn take_pre_migration_backup(&self, from_version: u32) -> AppResult<PathBuf> {
        let path = self
            .path
            .as_ref()
            .ok_or_else(|| AppError::internal("cannot back up an in-memory database"))?;
        let directory = path
            .parent()
            .ok_or_else(|| AppError::internal("database path has no parent directory"))?
            .join(BACKUP_DIR_NAME);

        backup::write_snapshot(
            &self.conn,
            &directory,
            &format!("pre-migration-{from_version}"),
        )
    }
}

/// Connection-level settings. These are **per connection**, not properties of the
/// file, so they are applied on every open — and asserted by tests, because a
/// silently-off `foreign_keys` looks exactly like a working database until the
/// day it does not.
fn apply_pragmas(conn: &Connection) -> AppResult<()> {
    // Foreign keys default to OFF in SQLite for backwards compatibility.
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(database_error)?;

    // WAL: a crash or power loss can never corrupt the file.
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(database_error)?;

    // FULL: writes here are small and user-paced, so the fsync cost is invisible
    // and full durability is worth having. See docs/product-spec.md §6.
    conn.pragma_update(None, "synchronous", "FULL")
        .map_err(database_error)?;

    // Never hang forever behind another writer; surface a real error instead.
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(database_error)?;

    Ok(())
}

fn database_error(error: rusqlite::Error) -> AppError {
    AppError::Database {
        message: error.to_string(),
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        database_error(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scalar_pragma(db: &Database, name: &str) -> String {
        db.connection()
            .query_row(&format!("PRAGMA {name}"), [], |row| {
                row.get::<_, rusqlite::types::Value>(0)
            })
            .map(|value| match value {
                rusqlite::types::Value::Integer(number) => number.to_string(),
                rusqlite::types::Value::Text(text) => text,
                other => format!("{other:?}"),
            })
            .expect("pragma should be readable")
    }

    #[test]
    fn foreign_keys_are_actually_on() {
        let db = Database::open_in_memory().expect("database should open");

        assert_eq!(scalar_pragma(&db, "foreign_keys"), "1");
    }

    #[test]
    fn durability_pragmas_are_set() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db =
            Database::open(&dir.path().join(DATABASE_FILE_NAME)).expect("database should open");

        // journal_mode is only meaningful for a file-backed database; an
        // in-memory one silently reports "memory", which would make this
        // assertion pass for the wrong reason.
        assert_eq!(scalar_pragma(&db, "journal_mode").to_lowercase(), "wal");
        assert_eq!(scalar_pragma(&db, "synchronous"), "2"); // 2 == FULL
    }

    #[test]
    fn foreign_key_violations_are_rejected() {
        let db = Database::open_in_memory().expect("database should open");

        let result = db.connection().execute(
            "INSERT INTO boards (id, project_id, name, position, created_at, updated_at) \
             VALUES ('b1', 'no-such-project', 'Board', 0, 0, 0)",
            [],
        );

        assert!(
            result.is_err(),
            "inserting a board for a nonexistent project must fail",
        );
    }

    #[test]
    fn deleting_a_project_cascades_to_everything_beneath_it() {
        let db = Database::open_in_memory().expect("database should open");
        seed_one_task(&db);

        db.connection()
            .execute("DELETE FROM projects WHERE id = 'p1'", [])
            .expect("delete should succeed");

        for table in ["boards", "board_columns", "tasks", "subtasks", "labels"] {
            let count: i64 = db
                .connection()
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .expect("count should succeed");
            assert_eq!(count, 0, "{table} should have been cascaded away");
        }
    }

    #[test]
    fn fts5_is_available_and_indexes_tasks() {
        // If this fails, the bundled SQLite lacks FTS5 and the documented
        // fallback in docs/architecture.md §3.1 must be implemented. It is
        // asserted rather than assumed precisely because it is a build property.
        let db = Database::open_in_memory().expect("database should open");
        seed_one_task(&db);

        let hits: i64 = db
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM tasks_fts WHERE tasks_fts MATCH 'migration'",
                [],
                |row| row.get(0),
            )
            .expect("FTS5 query should succeed");

        assert_eq!(
            hits, 1,
            "the seeded task should be findable by full-text search"
        );
    }

    #[test]
    fn the_fts_index_follows_updates_and_deletes() {
        let db = Database::open_in_memory().expect("database should open");
        seed_one_task(&db);

        db.connection()
            .execute(
                "UPDATE tasks SET title = 'Something else entirely' WHERE id = 't1'",
                [],
            )
            .expect("update should succeed");

        let stale: i64 = db
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM tasks_fts WHERE tasks_fts MATCH 'migration'",
                [],
                |row| row.get(0),
            )
            .expect("query should succeed");
        assert_eq!(stale, 0, "the index must not keep the old title");

        db.connection()
            .execute("DELETE FROM tasks WHERE id = 't1'", [])
            .expect("delete should succeed");

        let remaining: i64 = db
            .connection()
            .query_row("SELECT COUNT(*) FROM tasks_fts", [], |row| row.get(0))
            .expect("query should succeed");
        assert_eq!(remaining, 0, "the index must not keep deleted rows");
    }

    #[test]
    fn archived_tasks_leave_the_position_sequence() {
        let db = Database::open_in_memory().expect("database should open");
        seed_one_task(&db);

        // Archive the task at position 0, then insert a live task at position 0.
        // The partial unique index must allow this: an archived row holds no slot.
        db.connection()
            .execute("UPDATE tasks SET archived_at = 1 WHERE id = 't1'", [])
            .expect("archive should succeed");

        let result = db.connection().execute(
            "INSERT INTO tasks (id, project_id, board_id, column_id, number, title, position, \
             created_at, updated_at) \
             VALUES ('t2', 'p1', 'b1', 'c1', 2, 'Another task', 0, 0, 0)",
            [],
        );

        assert!(
            result.is_ok(),
            "an archived task must not occupy a live position: {result:?}",
        );
    }

    #[test]
    fn two_live_tasks_cannot_share_a_position() {
        let db = Database::open_in_memory().expect("database should open");
        seed_one_task(&db);

        let result = db.connection().execute(
            "INSERT INTO tasks (id, project_id, board_id, column_id, number, title, position, \
             created_at, updated_at) \
             VALUES ('t2', 'p1', 'b1', 'c1', 2, 'Clash', 0, 0, 0)",
            [],
        );

        assert!(
            result.is_err(),
            "duplicate live positions must be impossible"
        );
    }

    #[test]
    fn a_task_number_is_unique_within_its_project() {
        let db = Database::open_in_memory().expect("database should open");
        seed_one_task(&db);

        let result = db.connection().execute(
            "INSERT INTO tasks (id, project_id, board_id, column_id, number, title, position, \
             created_at, updated_at) \
             VALUES ('t2', 'p1', 'b1', 'c1', 1, 'Same number', 1, 0, 0)",
            [],
        );

        assert!(result.is_err(), "task numbers must never be reused");
    }

    #[test]
    fn a_due_date_must_be_a_calendar_date() {
        let db = Database::open_in_memory().expect("database should open");
        seed_one_task(&db);

        let bad = db.connection().execute(
            "UPDATE tasks SET due_date = '2026-07-30T10:00:00Z' WHERE id = 't1'",
            [],
        );
        assert!(bad.is_err(), "instants must be rejected as due dates");

        let good = db.connection().execute(
            "UPDATE tasks SET due_date = '2026-07-30' WHERE id = 't1'",
            [],
        );
        assert!(good.is_ok(), "a calendar date should be accepted: {good:?}");
    }

    #[test]
    fn a_wip_limit_must_be_positive() {
        let db = Database::open_in_memory().expect("database should open");
        seed_one_task(&db);

        let result = db
            .connection()
            .execute("UPDATE board_columns SET wip_limit = 0 WHERE id = 'c1'", []);

        assert!(
            result.is_err(),
            "a WIP limit of zero is meaningless and must be rejected"
        );
    }

    // ── Upgrade paths ───────────────────────────────────────────────────────
    //
    // These exercise `open_with`, the same code path production uses, rather
    // than a simulation of it. A migration failure is the single most dangerous
    // moment in this application's life, so it gets tested against a real file
    // on disk, not an in-memory database.

    /// The released list, plus one more. The synthetic migration sits *after*
    /// the last real one rather than at a fixed 2, so releasing another
    /// migration moves these tests forward instead of breaking them.
    fn next_version() -> u32 {
        migrations::latest_version(migrations::MIGRATIONS) + 1
    }

    fn released_plus(extra: migrations::Migration) -> Vec<migrations::Migration> {
        let mut list = Vec::from(migrations::MIGRATIONS);
        list.push(extra);
        list
    }

    fn upgrade_ok() -> Vec<migrations::Migration> {
        released_plus(migrations::Migration {
            version: next_version(),
            description: "adds a table",
            sql: "CREATE TABLE later_addition (id TEXT PRIMARY KEY);",
        })
    }

    fn upgrade_broken() -> Vec<migrations::Migration> {
        released_plus(migrations::Migration {
            version: next_version(),
            description: "deliberately invalid",
            sql: "CREATE TABLE half_written (id TEXT PRIMARY KEY);
                  INSERT INTO not_a_table VALUES (1);",
        })
    }

    /// The label a pre-migration backup carries: the version it was taken *at*,
    /// which is the last released one.
    fn released_backup_prefix() -> String {
        format!(
            "pre-migration-{}-",
            migrations::latest_version(migrations::MIGRATIONS)
        )
    }

    fn open_at_released_with_data(path: &std::path::Path) {
        let db = Database::open(path).expect("database opens at the released schema");
        db.connection()
            .execute(
                "INSERT INTO projects (id, name, color, key_prefix, position, created_at, updated_at) \
                 VALUES ('p1', 'Precious', 'indigo', 'PRE', 0, 0, 0)",
                [],
            )
            .expect("insert should succeed");
    }

    fn backups_in(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
        std::fs::read_dir(dir.join(BACKUP_DIR_NAME))
            .map(|entries| entries.filter_map(Result::ok).map(|e| e.path()).collect())
            .unwrap_or_default()
    }

    #[test]
    fn a_fresh_database_is_not_backed_up_before_its_first_migration() {
        let dir = tempfile::tempdir().expect("temp dir");

        Database::open(&dir.path().join(DATABASE_FILE_NAME)).expect("database opens");

        assert!(
            backups_in(dir.path()).is_empty(),
            "there is nothing to lose at version 0, so no backup should be written",
        );
    }

    #[test]
    fn upgrading_an_existing_database_takes_a_backup_first() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join(DATABASE_FILE_NAME);
        open_at_released_with_data(&path);

        let upgraded = Database::open_with(&path, &upgrade_ok()).expect("upgrade should succeed");

        let backups = backups_in(dir.path());
        assert_eq!(
            backups.len(),
            1,
            "exactly one pre-migration backup should exist"
        );
        let prefix = released_backup_prefix();
        assert!(
            backups[0]
                .file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with(&prefix)),
            "the backup should be named for the version it was taken at: {backups:?}",
        );

        assert!(
            upgraded
                .table_exists("later_addition")
                .expect("query succeeds"),
            "the upgrade should have been applied",
        );

        // The backup must hold the *old* schema — otherwise it is not a backup.
        let snapshot = Connection::open(&backups[0]).expect("snapshot opens");
        let snapshot_version = migrations::current_version(&snapshot).expect("version reads");
        assert_eq!(
            snapshot_version,
            migrations::latest_version(migrations::MIGRATIONS),
            "the backup should predate the migration"
        );
    }

    #[test]
    fn a_failing_upgrade_preserves_the_data_and_names_the_backup() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join(DATABASE_FILE_NAME);
        open_at_released_with_data(&path);

        let error = Database::open_with(&path, &upgrade_broken())
            .expect_err("the invalid migration should fail");

        let AppError::Migration { backup_path, .. } = error else {
            panic!("expected a Migration error, got {error:?}");
        };
        let backup_path = backup_path.expect("the error must tell the user where their backup is");
        assert!(
            std::path::Path::new(&backup_path).exists(),
            "the named backup must actually exist at {backup_path}",
        );

        // The live database must be exactly as it was.
        let reopened = Database::open(&path).expect("the original database still opens");
        assert_eq!(
            migrations::current_version(reopened.connection()).expect("version reads"),
            migrations::latest_version(migrations::MIGRATIONS),
            "a failed migration must not advance the version",
        );
        assert!(
            !reopened
                .table_exists("half_written")
                .expect("query succeeds"),
            "partial work from the failed migration must have been rolled back",
        );
        let name: String = reopened
            .connection()
            .query_row("SELECT name FROM projects WHERE id = 'p1'", [], |row| {
                row.get(0)
            })
            .expect("the user's data must still be there");
        assert_eq!(name, "Precious");
    }

    #[test]
    fn a_database_from_a_newer_build_is_refused_rather_than_opened() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join(DATABASE_FILE_NAME);
        {
            let db = Database::open_with(&path, &upgrade_ok()).expect("opens one past released");
            assert_eq!(
                migrations::current_version(db.connection()).expect("reads"),
                next_version()
            );
        }

        // Now open the same file with a build that knows only what is released.
        let error = Database::open_with(&path, migrations::MIGRATIONS)
            .expect_err("should refuse the newer file");

        assert!(matches!(error, AppError::Migration { .. }));
        assert!(
            backups_in(dir.path()).is_empty(),
            "refusing to open must not write anything, including a backup",
        );
    }

    /// Minimal but complete graph: project → board → column → task, plus a
    /// subtask and a label, so cascade tests have something to cascade.
    fn seed_one_task(db: &Database) {
        db.connection()
            .execute_batch(
                "INSERT INTO projects (id, name, color, key_prefix, position, created_at, updated_at)
                   VALUES ('p1', 'Takenkanban', 'indigo', 'KAN', 0, 0, 0);
                 INSERT INTO boards (id, project_id, name, position, created_at, updated_at)
                   VALUES ('b1', 'p1', 'Board', 0, 0, 0);
                 INSERT INTO board_columns (id, board_id, name, position, created_at, updated_at)
                   VALUES ('c1', 'b1', 'Todo', 0, 0, 0);
                 INSERT INTO tasks (id, project_id, board_id, column_id, number, title,
                                    description, position, created_at, updated_at)
                   VALUES ('t1', 'p1', 'b1', 'c1', 1, 'Rewrite the migration runner',
                           'Back up before applying', 0, 0, 0);
                 INSERT INTO subtasks (id, task_id, title, position, created_at, updated_at)
                   VALUES ('s1', 't1', 'Write the test first', 0, 0, 0);
                 INSERT INTO labels (id, project_id, name, color, created_at, updated_at)
                   VALUES ('l1', 'p1', 'db', 'indigo', 0, 0);
                 INSERT INTO task_labels (task_id, label_id) VALUES ('t1', 'l1');",
            )
            .expect("seed should succeed");
    }
}
