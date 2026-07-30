//! Database snapshots.
//!
//! Uses SQLite's `VACUUM INTO`, which writes a consistent single-file copy while
//! the connection stays open. Copying the file by hand would mean copying three
//! files (`.sqlite3`, `-wal`, `-shm`) at three different instants, which is how
//! subtly-corrupt backups happen. See `docs/data-and-backups.md`.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

/// Automatic snapshots kept before they are pruned. Manual ones are never pruned.
pub const AUTOMATIC_RETENTION: usize = 10;

/// Writes a snapshot into `directory` named `<label>-<timestamp>.sqlite3` and
/// returns its path.
pub fn write_snapshot(conn: &Connection, directory: &Path, label: &str) -> AppResult<PathBuf> {
    std::fs::create_dir_all(directory)?;

    let path = unique_path(directory, label);

    // `VACUUM INTO` refuses to overwrite, so a name collision surfaces as an
    // error rather than silently destroying an older snapshot.
    conn.execute("VACUUM INTO ?1", [path.to_string_lossy().as_ref()])
        .map_err(|error| AppError::Io {
            message: format!("could not write backup to {}: {error}", path.display()),
        })?;

    Ok(path)
}

/// Names a snapshot after its label and the time it was taken. The timestamp is
/// filename-safe and sorts lexicographically in chronological order.
fn unique_path(directory: &Path, label: &str) -> PathBuf {
    let stamp = super::now_ms();
    let mut candidate = directory.join(format!("{label}-{stamp}.sqlite3"));

    // Two snapshots inside the same millisecond is unlikely but not impossible,
    // and losing one silently would be worse than an ugly name.
    let mut suffix = 1;
    while candidate.exists() {
        candidate = directory.join(format!("{label}-{stamp}-{suffix}.sqlite3"));
        suffix += 1;
    }

    candidate
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{Database, DATABASE_FILE_NAME};

    #[test]
    fn a_snapshot_is_a_readable_database_with_the_same_contents() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Database::open(&dir.path().join(DATABASE_FILE_NAME)).expect("database opens");
        db.connection()
            .execute(
                "INSERT INTO projects (id, name, color, key_prefix, position, created_at, updated_at) \
                 VALUES ('p1', 'Kept', 'indigo', 'KEP', 0, 0, 0)",
                [],
            )
            .expect("insert should succeed");

        let snapshot =
            write_snapshot(db.connection(), &dir.path().join("backups"), "manual").expect("backup");

        let restored = Database::open(&snapshot).expect("the snapshot should open as a database");
        let name: String = restored
            .connection()
            .query_row("SELECT name FROM projects WHERE id = 'p1'", [], |row| {
                row.get(0)
            })
            .expect("the row should be present in the snapshot");

        assert_eq!(name, "Kept");
    }

    #[test]
    fn snapshots_never_overwrite_each_other() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Database::open(&dir.path().join(DATABASE_FILE_NAME)).expect("database opens");
        let backups = dir.path().join("backups");

        let first = write_snapshot(db.connection(), &backups, "manual").expect("first backup");
        let second = write_snapshot(db.connection(), &backups, "manual").expect("second backup");

        assert_ne!(first, second);
        assert!(first.exists() && second.exists());
    }
}
