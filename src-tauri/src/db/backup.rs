//! Database snapshots.
//!
//! Uses SQLite's `VACUUM INTO`, which writes a consistent single-file copy while
//! the connection stays open. Copying the file by hand would mean copying three
//! files (`.sqlite3`, `-wal`, `-shm`) at three different instants, which is how
//! subtly-corrupt backups happen. See `docs/data-and-backups.md`.

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::error::{AppError, AppResult};

/// Automatic snapshots kept before they are pruned. Manual ones are never pruned.
pub const AUTOMATIC_RETENTION: usize = 10;

/// The label prefix a user asked for by hand. Everything else was taken by the
/// application on the user's behalf and is therefore prunable.
pub const MANUAL_LABEL: &str = "manual";

/// One snapshot on disk, as the restore list shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "BackupInfo.ts")]
pub struct BackupInfo {
    pub path: String,
    pub file_name: String,
    /// `manual`, `pre-migration-3`, `pre-import`, `pre-delete`, `pre-restore`.
    pub label: String,
    pub manual: bool,
    #[ts(type = "number")]
    pub size_bytes: u64,
    /// Taken from the filename rather than the filesystem: a copied or restored
    /// file carries a new mtime, but the name still says when it was made.
    #[ts(type = "number")]
    pub taken_at: i64,
}

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

/// Every snapshot in `directory`, newest first.
///
/// A file that does not parse as one of ours is skipped rather than reported:
/// the backup directory is a real directory the user can open, and something
/// else being in it is not an error.
pub fn list(directory: &Path) -> AppResult<Vec<BackupInfo>> {
    let Ok(entries) = std::fs::read_dir(directory) else {
        // No directory yet simply means no backups, which is not a failure.
        return Ok(Vec::new());
    };

    let mut snapshots: Vec<BackupInfo> = entries
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|extension| extension == "sqlite3")
        })
        .filter_map(|entry| {
            let path = entry.path();
            let file_name = path.file_name()?.to_string_lossy().into_owned();
            let (label, taken_at) = parse_name(&file_name)?;

            Some(BackupInfo {
                path: path.to_string_lossy().into_owned(),
                file_name,
                manual: label == MANUAL_LABEL,
                label,
                size_bytes: entry.metadata().map(|metadata| metadata.len()).unwrap_or(0),
                taken_at,
            })
        })
        .collect();

    snapshots.sort_by(|a, b| {
        b.taken_at
            .cmp(&a.taken_at)
            .then(b.file_name.cmp(&a.file_name))
    });
    Ok(snapshots)
}

/// Splits `pre-migration-3-1753822000000.sqlite3` into `pre-migration-3` and its
/// timestamp. The label may itself contain hyphens and digits, so the timestamp
/// is taken as the **last** hyphen-separated component that parses — and the
/// collision suffix (`-1`, `-2`) means the last component is not always it.
fn parse_name(file_name: &str) -> Option<(String, i64)> {
    let stem = file_name.strip_suffix(".sqlite3")?;
    let parts: Vec<&str> = stem.split('-').collect();

    // Timestamps are milliseconds since 1970 and so are 13 digits for any date
    // this application will see. A collision suffix is one or two digits, which
    // is what distinguishes the two.
    let (index, stamp) = parts.iter().enumerate().rev().find_map(|(index, part)| {
        (part.len() >= 13 && part.chars().all(|c| c.is_ascii_digit()))
            .then(|| part.parse::<i64>().ok().map(|stamp| (index, stamp)))
            .flatten()
    })?;

    if index == 0 {
        return None;
    }

    Some((parts[..index].join("-"), stamp))
}

/// Deletes the oldest automatic snapshots beyond [`AUTOMATIC_RETENTION`].
///
/// Manual snapshots are never touched: if the user asked for it, only the user
/// deletes it (product-spec §7.3). Returns what was removed so a caller can say
/// so rather than tidying up silently.
pub fn prune(directory: &Path) -> AppResult<Vec<String>> {
    let automatic: Vec<BackupInfo> = list(directory)?
        .into_iter()
        .filter(|snapshot| !snapshot.manual)
        .collect();

    let mut removed = Vec::new();
    for snapshot in automatic.into_iter().skip(AUTOMATIC_RETENTION) {
        // A snapshot that cannot be deleted is not worth failing the operation
        // that triggered the prune — the user's import or migration succeeded.
        if std::fs::remove_file(&snapshot.path).is_ok() {
            removed.push(snapshot.file_name);
        }
    }

    Ok(removed)
}

/// Swaps `snapshot` in as the live database, and puts the old one back if the
/// new one turns out not to open.
///
/// The order is what makes this safe (architecture §13):
///
/// 1. Back up the database that is about to be replaced, so restoring the wrong
///    snapshot is itself undoable.
/// 2. Check the snapshot is a readable database **before** moving anything. A
///    truncated or non-SQLite file is caught while the real database is still in
///    place, which is cheaper than catching it afterwards.
/// 3. Copy the snapshot over the database file.
/// 4. Open it, running any migrations it needs. If *that* fails, the
///    pre-restore backup is copied back and the failure is reported.
///
/// `database` is taken by mutable reference and left open on the restored file,
/// or on the original one if the restore failed. It is closed and reopened
/// internally rather than by the caller: SQLite holds the file open, so a
/// restore that left that to a doc comment would report "database is locked"
/// the first time someone forgot.
pub fn restore(database: &mut super::Database, snapshot: &Path) -> AppResult<PathBuf> {
    if !snapshot.exists() {
        return Err(AppError::Io {
            message: format!("there is no backup at {}", snapshot.display()),
        });
    }

    let database_path = database
        .path()
        .ok_or_else(|| AppError::internal("cannot restore over an in-memory database"))?
        .to_path_buf();
    let directory = database_path
        .parent()
        .ok_or_else(|| AppError::internal("database path has no parent directory"))?
        .join(super::BACKUP_DIR_NAME);

    // Step 1 — the current database, before it stops being the current one.
    let safety = write_snapshot(database.connection(), &directory, "pre-restore")?;

    // Step 2 — refuse a file that is not a database while nothing has moved.
    open_and_check(snapshot).map_err(|error| AppError::Io {
        message: format!(
            "{} is not a database this application can open ({error}). \
             Nothing has been changed.",
            snapshot.display()
        ),
    })?;

    // Step 3 — the swap. WAL sidecars belong to the *old* database and would be
    // read against the new file, which is how a restore produces a mixture of
    // two databases rather than one of them.
    database.detach()?;
    remove_wal_sidecars(&database_path);
    std::fs::copy(snapshot, &database_path)?;

    // Step 4 — prove the live path opens and migrates, or undo the swap.
    match database.reopen() {
        Ok(()) => Ok(safety),
        Err(error) => {
            database.detach().ok();
            remove_wal_sidecars(&database_path);
            std::fs::copy(&safety, &database_path).map_err(|rollback| AppError::Io {
                message: format!(
                    "the restored database did not open ({error}), and putting the \
                     previous one back also failed ({rollback}). The previous database \
                     is still at {}.",
                    safety.display()
                ),
            })?;
            database.reopen()?;

            Err(AppError::Io {
                message: format!(
                    "the restored database did not open ({error}), so the previous one \
                     was put back. It is also saved at {}.",
                    safety.display()
                ),
            })
        }
    }
}

/// Opens a file read-only and asks SQLite whether it is intact. `PRAGMA
/// schema_version` is enough: it fails on anything that is not a database, and
/// costs nothing on one that is.
fn open_and_check(path: &Path) -> rusqlite::Result<()> {
    let conn = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.query_row("PRAGMA schema_version", [], |row| row.get::<_, i64>(0))?;
    Ok(())
}

/// The `-wal` and `-shm` files are part of the database they were written for.
/// Leaving them beside a replaced file is how a restore silently mixes two.
fn remove_wal_sidecars(database_path: &Path) {
    for suffix in ["-wal", "-shm"] {
        let mut name = database_path.as_os_str().to_owned();
        name.push(suffix);
        let _ = std::fs::remove_file(PathBuf::from(name));
    }
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

    #[test]
    fn a_snapshot_name_splits_into_its_label_and_its_timestamp() {
        assert_eq!(
            parse_name("manual-1753822000000.sqlite3"),
            Some(("manual".to_owned(), 1_753_822_000_000))
        );
        // A label that itself contains a hyphen and a number.
        assert_eq!(
            parse_name("pre-migration-3-1753822000000.sqlite3"),
            Some(("pre-migration-3".to_owned(), 1_753_822_000_000))
        );
        // A collision suffix: the timestamp is the 13-digit component, not the
        // last one. Taking the last would read the suffix as the time.
        assert_eq!(
            parse_name("manual-1753822000000-1.sqlite3"),
            Some(("manual".to_owned(), 1_753_822_000_000))
        );
    }

    #[test]
    fn something_that_is_not_one_of_ours_is_skipped_rather_than_failing() {
        assert_eq!(parse_name("notes.sqlite3"), None);
        assert_eq!(parse_name("1753822000000.sqlite3"), None, "no label");
        assert_eq!(parse_name("manual-1753822000000.txt"), None);
    }

    #[test]
    fn listing_is_newest_first() {
        let dir = tempfile::tempdir().expect("temp dir");
        for name in [
            "manual-1753822000000.sqlite3",
            "pre-import-1753822999000.sqlite3",
            "pre-migration-1-1753821000000.sqlite3",
            "someone-elses-file.txt",
        ] {
            std::fs::write(dir.path().join(name), b"x").expect("write");
        }

        let listed = list(dir.path()).expect("lists");

        assert_eq!(listed.len(), 3, "the .txt is not one of ours");
        assert_eq!(listed[0].label, "pre-import");
        assert_eq!(listed[1].label, "manual");
        assert_eq!(listed[2].label, "pre-migration-1");
        assert!(listed[1].manual);
        assert!(!listed[0].manual);
    }

    #[test]
    fn listing_a_directory_that_does_not_exist_is_empty_rather_than_an_error() {
        let dir = tempfile::tempdir().expect("temp dir");

        assert_eq!(
            list(&dir.path().join("nothing-here")).expect("lists"),
            vec![]
        );
    }

    #[test]
    fn pruning_keeps_the_ten_most_recent_automatic_snapshots() {
        let dir = tempfile::tempdir().expect("temp dir");
        for index in 0..15 {
            let stamp = 1_753_822_000_000_i64 + index;
            std::fs::write(dir.path().join(format!("pre-import-{stamp}.sqlite3")), b"x")
                .expect("write");
        }

        let removed = prune(dir.path()).expect("prunes");

        assert_eq!(removed.len(), 5);
        let left = list(dir.path()).expect("lists");
        assert_eq!(left.len(), AUTOMATIC_RETENTION);
        // The ones kept are the newest, not simply ten of them.
        assert_eq!(left[0].taken_at, 1_753_822_000_014);
        assert_eq!(left[AUTOMATIC_RETENTION - 1].taken_at, 1_753_822_000_005);
    }

    #[test]
    fn pruning_never_deletes_a_manual_snapshot() {
        // "If you asked for it, only you delete it" — product-spec §7.3.
        let dir = tempfile::tempdir().expect("temp dir");
        for index in 0..15 {
            let stamp = 1_753_822_000_000_i64 + index;
            std::fs::write(dir.path().join(format!("manual-{stamp}.sqlite3")), b"x")
                .expect("write");
        }

        let removed = prune(dir.path()).expect("prunes");

        assert!(removed.is_empty());
        assert_eq!(list(dir.path()).expect("lists").len(), 15);
    }

    #[test]
    fn restoring_a_snapshot_brings_its_contents_back() {
        let dir = tempfile::tempdir().expect("temp dir");
        let live = dir.path().join(DATABASE_FILE_NAME);

        let db = Database::open(&live).expect("database opens");
        db.connection()
            .execute("CREATE TABLE marker (note TEXT)", [])
            .expect("table");
        db.connection()
            .execute("INSERT INTO marker VALUES ('from the snapshot')", [])
            .expect("row");
        let snapshot = write_snapshot(db.connection(), &dir.path().join("backups"), "manual")
            .expect("snapshot");

        // Change the live database so restoring is observable.
        db.connection()
            .execute("DELETE FROM marker", [])
            .expect("delete");

        let mut db = db;
        restore(&mut db, &snapshot).expect("restores");

        // Read through the same handle the restore left open, which is also the
        // assertion that it reopened rather than leaving a detached placeholder.
        let note: String = db
            .connection()
            .query_row("SELECT note FROM marker", [], |row| row.get(0))
            .expect("the row is back");

        assert_eq!(note, "from the snapshot");
    }

    #[test]
    fn restoring_backs_the_current_database_up_first() {
        let dir = tempfile::tempdir().expect("temp dir");
        let live = dir.path().join(DATABASE_FILE_NAME);
        let db = Database::open(&live).expect("database opens");
        let snapshot = write_snapshot(db.connection(), &dir.path().join("backups"), "manual")
            .expect("snapshot");

        let mut db = db;
        let safety = restore(&mut db, &snapshot).expect("restores");

        assert!(safety.exists(), "the pre-restore copy is on disk");
        assert!(safety.to_string_lossy().contains("pre-restore"));
    }

    #[test]
    fn a_file_that_is_not_a_database_is_refused_before_anything_moves() {
        let dir = tempfile::tempdir().expect("temp dir");
        let live = dir.path().join(DATABASE_FILE_NAME);
        let db = Database::open(&live).expect("database opens");
        db.connection()
            .execute("CREATE TABLE marker (note TEXT)", [])
            .expect("table");

        let rubbish = dir
            .path()
            .join("backups")
            .join("manual-1753822000000.sqlite3");
        std::fs::create_dir_all(rubbish.parent().expect("parent")).expect("dir");
        std::fs::write(&rubbish, b"this is not a database").expect("write");

        let mut db = db;
        let error = restore(&mut db, &rubbish).expect_err("refused");

        println!("  refused with: {error}");
        assert!(error.to_string().contains("Nothing has been changed"));

        // The live database is untouched, which is the whole point of checking
        // before moving rather than after.
        let still: i64 = db
            .connection()
            .query_row("SELECT COUNT(*) FROM marker", [], |row| row.get(0))
            .expect("the table is still there");
        assert_eq!(still, 0);
    }

    #[test]
    fn restoring_a_missing_file_says_so_rather_than_creating_one() {
        let dir = tempfile::tempdir().expect("temp dir");
        let live = dir.path().join(DATABASE_FILE_NAME);
        let mut db = Database::open(&live).expect("database opens");

        let error = restore(&mut db, &dir.path().join("nope.sqlite3")).expect_err("refused");

        assert!(error.to_string().contains("no backup at"));
    }
}
