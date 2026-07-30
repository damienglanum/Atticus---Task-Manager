use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::{backup, migrations, BACKUP_DIR_NAME};
use crate::error::AppResult;
use crate::state::AppState;

/// Everything the user needs to find, inspect, or back up their own data.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "DatabaseInfo.ts")]
pub struct DatabaseInfo {
    pub path: Option<String>,
    // `u64` defaults to `bigint` in ts-rs, but serde_json writes it as a JSON
    // number and Tauri's IPC therefore delivers a JS `number`. See ADR-0010.
    #[ts(type = "number | null")]
    pub size_bytes: Option<u64>,
    pub schema_version: u32,
    pub latest_schema_version: u32,
    pub backup_directory: Option<String>,
    pub backup_count: u32,
}

#[tauri::command]
pub fn database_info(state: State<'_, AppState>) -> AppResult<DatabaseInfo> {
    let database = state.database()?;
    let path = database.path().map(|p| p.to_path_buf());

    let size_bytes = path
        .as_ref()
        .and_then(|p| std::fs::metadata(p).ok())
        .map(|metadata| metadata.len());

    let backup_directory = path
        .as_ref()
        .and_then(|p| p.parent())
        .map(|parent| parent.join(BACKUP_DIR_NAME));

    let backup_count = backup_directory
        .as_ref()
        .and_then(|dir| std::fs::read_dir(dir).ok())
        .map_or(0, |entries| {
            entries
                .filter_map(Result::ok)
                .filter(|entry| {
                    entry
                        .path()
                        .extension()
                        .is_some_and(|extension| extension == "sqlite3")
                })
                .count() as u32
        });

    Ok(DatabaseInfo {
        path: path.as_ref().map(|p| p.to_string_lossy().into_owned()),
        size_bytes,
        schema_version: migrations::current_version(database.connection())?,
        latest_schema_version: migrations::latest_version(migrations::MIGRATIONS),
        backup_directory: backup_directory.map(|p| p.to_string_lossy().into_owned()),
        backup_count,
    })
}

/// Writes a snapshot on demand and reports where it went.
#[tauri::command]
pub fn backup_create(state: State<'_, AppState>) -> AppResult<String> {
    let database = state.database()?;
    let directory = database
        .path()
        .and_then(|p| p.parent())
        .map(|parent| parent.join(BACKUP_DIR_NAME))
        .ok_or_else(|| crate::error::AppError::internal("no database file to back up"))?;

    let path = backup::write_snapshot(database.connection(), &directory, "manual")?;
    Ok(path.to_string_lossy().into_owned())
}
