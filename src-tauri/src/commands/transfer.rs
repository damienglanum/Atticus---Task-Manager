//! Export, import, and backup/restore — the commands behind product-spec §7.
//!
//! Every one of these either reads the whole database or replaces it, so each
//! is deliberately explicit about what it touches and when a backup is taken.

use std::path::{Path, PathBuf};

use tauri::State;

use crate::db::backup::{self, BackupInfo};
use crate::db::export::{export, ExportScope};
use crate::db::import::{apply, ImportMode, ImportResult};
use crate::domain::export_format::{upgrade, ExportDocument};
use crate::domain::import_validate::{validate_document, ImportPlan};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Where snapshots live, derived from wherever the database is.
fn backup_directory(database_path: &Path) -> AppResult<PathBuf> {
    Ok(database_path
        .parent()
        .ok_or_else(|| AppError::internal("database path has no parent directory"))?
        .join(crate::db::BACKUP_DIR_NAME))
}

/// Writes the whole database, or one project, to a file the user chose.
///
/// The path comes from the system save dialog and the bytes are written here:
/// the webview holds no filesystem permission of its own (ADR-0007), so it
/// never sees the document and never writes it. Returns the path, so the
/// interface can name where the file went.
#[tauri::command]
pub fn export_data(
    state: State<'_, AppState>,
    scope: ExportScope,
    path: String,
) -> AppResult<String> {
    let document = {
        let database = state.database()?;
        export(
            database.connection(),
            &scope,
            &crate::commands::app_info::version(),
        )?
    };

    // Pretty-printed deliberately: product-spec §7.1 calls the export a promise
    // to the user's future self, and a file a person can read and diff is worth
    // more than the bytes saved by minifying it.
    let json = serde_json::to_string_pretty(&document)
        .map_err(|error| AppError::internal(format!("could not serialise the export: {error}")))?;
    std::fs::write(&path, json)?;

    Ok(path)
}

/// Reads and parses an export file, or says why it cannot be read.
fn read_document(path: &str) -> AppResult<ExportDocument> {
    let text = std::fs::read_to_string(path).map_err(|error| AppError::Io {
        message: format!("could not read {path}: {error}"),
    })?;

    let value: serde_json::Value = serde_json::from_str(&text).map_err(|error| {
        AppError::validation(
            "file",
            format!("This file is not valid JSON, so it is not an export: {error}"),
        )
    })?;

    upgrade(value)
}

/// What an import *would* do, with nothing written.
///
/// Separate from `import_apply` so the user sees the counts and agrees to them
/// first (product-spec §7.2). The document is validated here in full, so a
/// malformed file is reported before the user is asked to confirm anything.
#[tauri::command]
pub fn import_preview(path: String) -> AppResult<ImportPlan> {
    validate_document(&read_document(&path)?)
}

/// Applies an import, taking a backup first when it is going to replace data.
///
/// The file is read again rather than carried over from the preview: the two
/// are separate commands and nothing guarantees it has not changed between
/// them. Validation runs again inside `apply` for the same reason.
#[tauri::command]
pub fn import_apply(
    state: State<'_, AppState>,
    path: String,
    mode: ImportMode,
) -> AppResult<ImportResult> {
    let upgraded = read_document(&path)?;
    let mut database = state.database()?;

    // Replace mode is the one that destroys something, so it is the one that
    // gets a snapshot first. The backup is taken *before* the delete and after
    // the document parses, so a file that was never going to import does not
    // leave a spurious snapshot behind.
    if mode == ImportMode::Replace {
        if let Some(path) = database.path().map(Path::to_path_buf) {
            let directory = backup_directory(&path)?;
            backup::write_snapshot(database.connection(), &directory, "pre-import")?;
            backup::prune(&directory)?;
        }
    }

    apply(database.connection_mut(), &upgraded, mode)
}

/// Every snapshot on disk, newest first.
///
/// Deliberately does **not** require a working database. This is the one
/// command the recovery screen can still call when startup failed, and it is
/// the one the user most needs then: a list of their data, with paths.
#[tauri::command]
pub fn backups_list(state: State<'_, AppState>) -> AppResult<Vec<BackupInfo>> {
    let Some(path) = state.database_path() else {
        return Ok(Vec::new());
    };

    backup::list(&backup_directory(&path)?)
}

/// Replaces the live database with a snapshot, backing the current one up first
/// and putting it back automatically if the snapshot does not open.
///
/// Returns the path of the pre-restore backup, so the interface can say where
/// the previous database went rather than only that it was replaced.
#[tauri::command]
pub fn backup_restore(state: State<'_, AppState>, path: String) -> AppResult<String> {
    let mut database = state.database()?;

    // The path comes from `backups_list`, but a command is a public surface and
    // this one replaces the database, so it is checked against the directory
    // rather than trusted. A caller cannot ask us to swap in an arbitrary file.
    let live = database
        .path()
        .map(Path::to_path_buf)
        .ok_or_else(|| AppError::internal("cannot restore over an in-memory database"))?;
    let directory = backup_directory(&live)?;
    let snapshot = PathBuf::from(&path);

    let inside = snapshot
        .canonicalize()
        .ok()
        .zip(directory.canonicalize().ok())
        .is_some_and(|(file, dir)| file.starts_with(dir));
    if !inside {
        return Err(AppError::validation(
            "path",
            "A backup can only be restored from the application's own backups folder.",
        ));
    }

    let safety = backup::restore(&mut database, &snapshot)?;
    Ok(safety.to_string_lossy().into_owned())
}
