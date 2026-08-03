//! References to files on disk — never copies of them.
//!
//! See ADR-0007. The webview holds **no filesystem permission at all**: a path
//! enters only through the system open dialog, and opening one goes through a
//! Rust command. Nothing here reads a file's contents; the most it ever asks the
//! filesystem is whether a path still resolves.

use std::path::{Path, PathBuf};

use rmcp::schemars::JsonSchema;
use rusqlite::{Connection, OptionalExtension, Row};
use serde::Serialize;
use ts_rs::TS;

use crate::db::projects::new_id;
use crate::db::{now_ms, ordering};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "FileRef.ts")]
pub struct FileRef {
    pub id: String,
    pub task_id: String,
    pub path: String,
    pub display_name: String,
    #[ts(type = "number | null")]
    pub last_verified_at: Option<i64>,
    /// Whether the path resolved the last time it was checked. Stored, so a
    /// board can render a missing file without touching the disk on every frame.
    pub found: bool,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub created_at: i64,
}

const SELECT: &str = "SELECT id, task_id, path, display_name, last_verified_at, found, position, \
                      created_at FROM file_refs";

fn row_to_file_ref(row: &Row<'_>) -> rusqlite::Result<FileRef> {
    Ok(FileRef {
        id: row.get("id")?,
        task_id: row.get("task_id")?,
        path: row.get("path")?,
        display_name: row.get("display_name")?,
        last_verified_at: row.get("last_verified_at")?,
        found: row.get("found")?,
        position: row.get("position")?,
        created_at: row.get("created_at")?,
    })
}

pub fn list(conn: &Connection, task_id: &str) -> AppResult<Vec<FileRef>> {
    let mut statement = conn.prepare(&format!("{SELECT} WHERE task_id = ?1 ORDER BY position"))?;
    let rows = statement.query_map([task_id], row_to_file_ref)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn find(conn: &Connection, id: &str) -> AppResult<FileRef> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), [id], row_to_file_ref)
        .optional()?
        .ok_or_else(|| AppError::NotFound {
            entity: "file reference".to_owned(),
            id: id.to_owned(),
        })
}

/// Checks a path is one we are willing to store.
///
/// Absolute only, no NUL byte. A relative path would resolve against whatever
/// the process's working directory happened to be, which is not a location the
/// user chose and would silently mean something different next launch.
pub fn validate_path(raw: &str) -> AppResult<PathBuf> {
    if raw.contains('\0') {
        return Err(AppError::validation(
            "path",
            "That path is not a valid file path.",
        ));
    }

    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err(AppError::validation(
            "path",
            "Only absolute paths can be stored, so the reference means the same thing next time.",
        ));
    }

    Ok(path)
}

/// A sensible name for a path: its file name, or the path itself if it has none.
pub fn display_name_for(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

pub fn add(
    conn: &mut Connection,
    task_id: &str,
    raw_path: &str,
    display_name: Option<String>,
) -> AppResult<FileRef> {
    crate::db::tasks::find(conn, task_id)?;
    let path = validate_path(raw_path)?;

    // Canonicalised when the file exists, so a reference survives being reached
    // through a symlink or a `..`. When it does not exist we keep what the user
    // gave us rather than refusing — a file on an unmounted volume is a valid
    // reference to a real thing.
    let stored = std::fs::canonicalize(&path).unwrap_or(path);
    let name = display_name.unwrap_or_else(|| display_name_for(&stored));
    let found = stored.exists();

    let id = new_id();
    let now = now_ms();

    let tx = conn.transaction()?;
    let position = ordering::next_position(&tx, ordering::FILE_REFS, Some(task_id))?;
    tx.execute(
        "INSERT INTO file_refs \
         (id, task_id, path, display_name, last_verified_at, found, position, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?5)",
        rusqlite::params![
            id,
            task_id,
            stored.to_string_lossy(),
            name,
            now,
            found,
            position
        ],
    )?;
    tx.execute(
        "UPDATE tasks SET updated_at = ?2 WHERE id = ?1",
        rusqlite::params![task_id, now],
    )?;
    tx.commit()?;

    find(conn, &id)
}

pub fn remove(conn: &mut Connection, id: &str) -> AppResult<()> {
    let existing = find(conn, id)?;

    let tx = conn.transaction()?;
    tx.execute("DELETE FROM file_refs WHERE id = ?1", [id])?;
    ordering::compact(&tx, ordering::FILE_REFS, Some(&existing.task_id))?;
    tx.execute(
        "UPDATE tasks SET updated_at = ?2 WHERE id = ?1",
        rusqlite::params![existing.task_id, now_ms()],
    )?;
    tx.commit()?;

    Ok(())
}

/// Points an existing reference at a new path — the "Locate…" action.
pub fn relocate(conn: &Connection, id: &str, raw_path: &str) -> AppResult<FileRef> {
    let existing = find(conn, id)?;
    let path = validate_path(raw_path)?;
    let stored = std::fs::canonicalize(&path).unwrap_or(path);
    let now = now_ms();

    conn.execute(
        "UPDATE file_refs SET path = ?2, display_name = ?3, found = ?4, last_verified_at = ?5 \
         WHERE id = ?1",
        rusqlite::params![
            id,
            stored.to_string_lossy(),
            display_name_for(&stored),
            stored.exists(),
            now
        ],
    )?;
    conn.execute(
        "UPDATE tasks SET updated_at = ?2 WHERE id = ?1",
        rusqlite::params![existing.task_id, now],
    )?;

    find(conn, id)
}

/// Re-checks every reference on a task and records what it found.
///
/// Called when a task editor opens, not on every board render: this is the only
/// code in the application that touches the filesystem for user files, and doing
/// it per card would mean a stat call per card.
pub fn verify_for_task(conn: &Connection, task_id: &str) -> AppResult<Vec<FileRef>> {
    let refs = list(conn, task_id)?;
    let now = now_ms();

    let mut update =
        conn.prepare("UPDATE file_refs SET found = ?2, last_verified_at = ?3 WHERE id = ?1")?;
    for file_ref in &refs {
        update.execute(rusqlite::params![
            file_ref.id,
            Path::new(&file_ref.path).exists(),
            now
        ])?;
    }
    drop(update);

    list(conn, task_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_relative_path_is_refused() {
        let error = validate_path("notes/todo.md").expect_err("relative paths mean nothing later");
        assert!(matches!(error, AppError::Validation { ref field, .. } if field == "path"));
    }

    #[test]
    fn a_path_containing_a_nul_byte_is_refused() {
        let error = validate_path("/tmp/evil\0.txt").expect_err("not a path");
        assert!(matches!(error, AppError::Validation { .. }));
    }

    #[test]
    fn an_absolute_path_is_accepted_even_when_nothing_is_there() {
        // A file on an unmounted volume is still a reference to a real thing.
        let path = validate_path("/Volumes/Archive/spec.pdf").expect("absolute");
        assert_eq!(path, PathBuf::from("/Volumes/Archive/spec.pdf"));
    }

    #[test]
    fn the_display_name_is_the_file_name() {
        assert_eq!(
            display_name_for(Path::new("/tmp/a/b/report.pdf")),
            "report.pdf"
        );
    }

    #[test]
    fn a_path_with_no_file_name_falls_back_to_the_whole_path() {
        assert_eq!(display_name_for(Path::new("/")), "/");
    }
}
