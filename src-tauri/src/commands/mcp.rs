use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::boards::{self, Board};
use crate::db::mcp::{self, McpSettings};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "McpLaunchConfig.ts")]
pub struct McpLaunchConfig {
    pub command: String,
    pub args: Vec<String>,
}

#[tauri::command]
pub fn mcp_settings_get(state: State<'_, AppState>) -> AppResult<McpSettings> {
    let database = state.database()?;
    mcp::settings(database.connection())
}

#[tauri::command]
pub fn mcp_settings_set(
    state: State<'_, AppState>,
    settings: McpSettings,
) -> AppResult<McpSettings> {
    let database = state.database()?;
    mcp::set_settings(database.connection(), &settings)
}

#[tauri::command]
pub fn mcp_revision_get(state: State<'_, AppState>) -> AppResult<i64> {
    let database = state.database()?;
    mcp::revision(database.connection())
}

#[tauri::command]
pub fn mcp_managed_boards_list(state: State<'_, AppState>) -> AppResult<Vec<Board>> {
    let database = state.database()?;
    boards::list_mcp_managed(database.connection())
}

/// The installed Atticus executable is also the MCP executable when launched
/// with `--mcp`, so one application build is all the user has to install.
#[tauri::command]
pub fn mcp_launch_config() -> AppResult<McpLaunchConfig> {
    // Inside an AppImage `current_exe` points into its temporary mounted image,
    // which disappears when the app closes. APPIMAGE is the stable file the
    // user actually downloaded and is therefore the command an MCP client must
    // keep. Other packages and platforms use the installed executable itself.
    #[cfg(target_os = "linux")]
    let command = std::env::var_os("APPIMAGE")
        .filter(|value| !value.is_empty())
        .map(std::path::PathBuf::from)
        .map(Ok)
        .unwrap_or_else(std::env::current_exe)
        .map_err(|error| AppError::internal(format!("could not locate Atticus: {error}")))?;

    #[cfg(not(target_os = "linux"))]
    let command = std::env::current_exe()
        .map_err(|error| AppError::internal(format!("could not locate Atticus: {error}")))?;

    Ok(McpLaunchConfig {
        command: command.to_string_lossy().into_owned(),
        args: vec!["--mcp".to_owned()],
    })
}
