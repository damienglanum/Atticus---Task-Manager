use serde::Serialize;
use tauri::{AppHandle, Manager};
use ts_rs::TS;

use crate::error::{AppError, AppResult};

/// Where the application's data actually lives, so the user is never left
/// guessing. Surfaced in Settings and used by the backup tooling.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "AppInfo.ts")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub data_dir: String,
    pub platform: String,
}

/// The build's own version, for anything that has to stamp a file with it.
///
/// Read from Cargo rather than from the `AppHandle`, so a command that does not
/// already need the handle does not take one purely to learn its own version.
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppResult<AppInfo> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::internal(format!("could not resolve app data dir: {error}")))?;

    Ok(AppInfo {
        name: app.package_info().name.clone(),
        version: app.package_info().version.to_string(),
        data_dir: data_dir.to_string_lossy().into_owned(),
        platform: std::env::consts::OS.to_string(),
    })
}
