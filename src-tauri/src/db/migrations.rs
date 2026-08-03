//! Versioned, transactional schema migrations.
//!
//! See `docs/adr/0003-migration-strategy.md`. The three rules that matter:
//!
//! 1. A database newer than the running code is **refused**, not muddled through.
//! 2. Every pending migration and the version bump commit in **one** transaction.
//! 3. Released migrations are immutable; mistakes are fixed by adding another.

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

#[derive(Clone)]
pub struct Migration {
    pub version: u32,
    pub description: &'static str,
    pub sql: &'static str,
}

pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        description: "initial schema",
        sql: include_str!("schema/m0001_initial.sql"),
    },
    Migration {
        version: 2,
        description: "notes",
        sql: include_str!("schema/m0002_notes.sql"),
    },
    Migration {
        version: 3,
        description: "task web links",
        sql: include_str!("schema/m0003_link_refs.sql"),
    },
];

/// The version this build knows how to produce.
pub fn latest_version(migrations: &[Migration]) -> u32 {
    migrations.last().map_or(0, |migration| migration.version)
}

/// Reads the version currently stored in the file.
pub fn current_version(conn: &Connection) -> AppResult<u32> {
    conn.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
        .map_err(database_error)
        .map(|version| version.max(0) as u32)
}

/// Applies every migration newer than the file's current version.
///
/// Returns the versions actually applied, so a caller can report "upgraded 1 → 3"
/// rather than guessing.
pub fn apply(conn: &mut Connection, migrations: &[Migration]) -> AppResult<Vec<u32>> {
    debug_assert!(
        migrations
            .windows(2)
            .all(|pair| pair[0].version < pair[1].version),
        "migrations must be listed in ascending version order",
    );

    let current = current_version(conn)?;
    let latest = latest_version(migrations);

    if current > latest {
        return Err(AppError::Migration {
            message: format!(
                "This database was written by a newer version of Atticus \
                 (schema {current}); this build understands schema {latest}. \
                 Opening it could destroy data, so it was not opened. \
                 Update the application, or restore a backup."
            ),
            backup_path: None,
        });
    }

    let pending: Vec<&Migration> = migrations
        .iter()
        .filter(|migration| migration.version > current)
        .collect();

    if pending.is_empty() {
        return Ok(Vec::new());
    }

    let applied_at = crate::db::now_ms();
    let transaction = conn.transaction().map_err(database_error)?;

    for migration in &pending {
        transaction
            .execute_batch(migration.sql)
            .map_err(|error| AppError::Migration {
                message: format!(
                    "migration {} ({}) failed: {error}",
                    migration.version, migration.description
                ),
                backup_path: None,
            })?;

        transaction
            .execute(
                "INSERT INTO schema_migrations (version, description, applied_at) \
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![migration.version, migration.description, applied_at],
            )
            .map_err(|error| AppError::Migration {
                message: format!("could not record migration {}: {error}", migration.version),
                backup_path: None,
            })?;
    }

    // `PRAGMA user_version` takes no bound parameters. The value is a `u32` from
    // our own compiled-in constant, never user input.
    transaction
        .pragma_update(None, "user_version", latest)
        .map_err(database_error)?;

    transaction.commit().map_err(database_error)?;

    Ok(pending.iter().map(|migration| migration.version).collect())
}

fn database_error(error: rusqlite::Error) -> AppError {
    AppError::Database {
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    /// Just the first released migration, so a test can stand a database up at
    /// the schema a previous build produced and then upgrade it for real.
    const RELEASED_V1: &[Migration] = &[Migration {
        version: 1,
        description: "initial schema",
        sql: include_str!("schema/m0001_initial.sql"),
    }];

    /// A migration that fails, one version past whatever is currently released,
    /// so releasing another one moves this forward rather than breaking it.
    fn broken() -> Vec<Migration> {
        let mut list = Vec::from(MIGRATIONS);
        list.push(Migration {
            version: latest_version(MIGRATIONS) + 1,
            description: "deliberately invalid",
            sql: "CREATE TABLE good_table (id TEXT PRIMARY KEY);
                  CREATE TABLE bad_table (id TEXT REFERENCES nonexistent_table (id));
                  INSERT INTO not_a_table VALUES (1);",
        });
        list
    }

    /// Product-spec §12.6 asks for "a migration from a prior-schema fixture".
    ///
    /// This is now the **real** upgrade: a database stood up at released schema
    /// 1, populated through the ordinary commands so the rows are shaped the way
    /// real rows are, then reopened by a build that knows schema 2. What is being
    /// tested is the part that can lose somebody's work — the version advances,
    /// every row survives, the newly added table is queryable, and a backup was
    /// taken before any of it happened.
    #[test]
    fn a_populated_database_upgrades_from_the_prior_schema_without_losing_anything() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join(crate::db::DATABASE_FILE_NAME);

        let task_id;
        {
            // Opened at version 1 and populated through the ordinary commands, so
            // the rows are shaped the way real rows are rather than hand-written.
            let mut db = Database::open_with(&path, RELEASED_V1).expect("v1 opens");
            assert_eq!(current_version(db.connection()).expect("version"), 1);

            let (project, board) = crate::db::projects::create(
                db.connection_mut(),
                crate::db::projects::NewProject {
                    name: "Written before the upgrade".to_owned(),
                    description: "Must survive it".to_owned(),
                    color: "indigo".to_owned(),
                    key_prefix: None,
                    directory_path: None,
                },
            )
            .expect("project");

            let column = crate::db::columns::list(db.connection(), &board).expect("columns")[0]
                .id
                .clone();
            let task = crate::db::tasks::create(
                db.connection_mut(),
                crate::db::tasks::NewTask {
                    column_id: column,
                    title: "An older task".to_owned(),
                },
            )
            .expect("task");
            task_id = task.id;

            crate::db::subtasks::create(db.connection_mut(), &task_id, "An older subtask")
                .expect("subtask");
            assert_eq!(project.name, "Written before the upgrade");
        }

        // Reopened against the released migration list: this is what a user gets
        // when they install a build that knows more migrations than they do.
        let db = Database::open_with(&path, MIGRATIONS).expect("the upgrade succeeds");

        assert_eq!(
            current_version(db.connection()).expect("version"),
            latest_version(MIGRATIONS),
            "the schema version must advance"
        );

        let (title, description): (String, String) = db
            .connection()
            .query_row(
                "SELECT t.title, p.description FROM tasks t                  JOIN projects p ON p.id = t.project_id WHERE t.id = ?1",
                [&task_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("the task written before the upgrade is still there");
        assert_eq!(title, "An older task");
        assert_eq!(description, "Must survive it");

        let subtasks: i64 = db
            .connection()
            .query_row("SELECT COUNT(*) FROM subtasks", [], |row| row.get(0))
            .expect("subtasks");
        assert_eq!(subtasks, 1, "children survive the upgrade too");

        // What schema 2 added exists and is readable, which is what makes this an
        // upgrade rather than a no-op that happened to leave the data alone.
        let notes: i64 = db
            .connection()
            .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))
            .expect("the added table is queryable");
        assert_eq!(notes, 0, "an upgrade adds the table empty, not populated");

        let links: i64 = db
            .connection()
            .query_row("SELECT COUNT(*) FROM link_refs", [], |row| row.get(0))
            .expect("the web-link table is queryable");
        assert_eq!(links, 0, "an upgrade adds the table empty, not populated");

        // A pre-migration backup is the promise `docs/data-and-backups.md` §4
        // makes, and an upgrade over real data is exactly when it matters.
        let backups = crate::db::backup::list(&directory.path().join(crate::db::BACKUP_DIR_NAME))
            .expect("backups list");
        assert!(
            backups.iter().any(|b| b.label == "pre-migration-1"),
            "an upgrade must snapshot the database first, found: {:?}",
            backups.iter().map(|b| &b.label).collect::<Vec<_>>()
        );
    }

    #[test]
    fn applies_pending_migrations_and_records_the_version() {
        let db = Database::open_in_memory().expect("in-memory database should open");

        assert_eq!(
            current_version(db.connection()).expect("version should read back"),
            latest_version(MIGRATIONS),
        );
    }

    #[test]
    fn is_idempotent_when_already_up_to_date() {
        let mut db = Database::open_in_memory().expect("database should open");

        let applied = apply(db.connection_mut(), MIGRATIONS).expect("second run should succeed");

        assert!(
            applied.is_empty(),
            "expected no migrations to be re-applied"
        );
    }

    #[test]
    fn refuses_a_database_written_by_a_newer_build() {
        let mut db = Database::open_in_memory().expect("database should open");
        db.connection()
            .pragma_update(None, "user_version", 99u32)
            .expect("version should be settable");

        let error = apply(db.connection_mut(), MIGRATIONS).expect_err("should refuse to open");

        match error {
            AppError::Migration { message, .. } => {
                assert!(
                    message.contains("99"),
                    "message should name the file's version"
                );
                assert!(
                    message.contains("newer version"),
                    "message should explain why"
                );
            }
            other => panic!("expected Migration, got {other:?}"),
        }
    }

    #[test]
    fn a_failing_migration_leaves_the_database_untouched() {
        let mut db = Database::open_in_memory().expect("database should open");
        let before = current_version(db.connection()).expect("version should read");

        let error =
            apply(db.connection_mut(), &broken()).expect_err("the invalid migration should fail");

        assert!(matches!(error, AppError::Migration { .. }));
        assert_eq!(
            current_version(db.connection()).expect("version should read"),
            before,
            "a failed migration must not advance the schema version",
        );
        // The successful statements from the failing migration must be rolled back too.
        assert!(
            !db.table_exists("good_table").expect("query should succeed"),
            "partial work from a failed migration must not survive",
        );
    }

    #[test]
    fn records_every_applied_migration_for_audit() {
        let db = Database::open_in_memory().expect("database should open");

        let count: i64 = db
            .connection()
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("schema_migrations should be queryable");

        assert_eq!(count as usize, MIGRATIONS.len());
    }
}
