//! Versioned, transactional schema migrations.
//!
//! See `docs/adr/0003-migration-strategy.md`. The three rules that matter:
//!
//! 1. A database newer than the running code is **refused**, not muddled through.
//! 2. Every pending migration and the version bump commit in **one** transaction.
//! 3. Released migrations are immutable; mistakes are fixed by adding another.

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

pub struct Migration {
    pub version: u32,
    pub description: &'static str,
    pub sql: &'static str,
}

pub const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    description: "initial schema",
    sql: include_str!("schema/m0001_initial.sql"),
}];

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

    const BROKEN: &[Migration] = &[
        Migration {
            version: 1,
            description: "initial schema",
            sql: include_str!("schema/m0001_initial.sql"),
        },
        Migration {
            version: 2,
            description: "deliberately invalid",
            sql: "CREATE TABLE good_table (id TEXT PRIMARY KEY);
                  CREATE TABLE bad_table (id TEXT REFERENCES nonexistent_table (id));
                  INSERT INTO not_a_table VALUES (1);",
        },
    ];

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

        let error = apply(db.connection_mut(), BROKEN).expect_err("migration 2 should fail");

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
