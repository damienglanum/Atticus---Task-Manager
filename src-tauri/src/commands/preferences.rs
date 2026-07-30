use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::db::app_state;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

const THEME_KEY: &str = "theme";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "ThemePreference.ts")]
pub enum ThemePreference {
    Light,
    Dark,
    System,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "Preferences.ts")]
pub struct Preferences {
    pub theme: ThemePreference,
}

#[tauri::command]
pub fn preferences_get(state: State<'_, AppState>) -> AppResult<Preferences> {
    let database = state.database()?;
    let theme = app_state::get_or(database.connection(), THEME_KEY, ThemePreference::System)?;
    Ok(Preferences { theme })
}

#[tauri::command]
pub fn preferences_set_theme(
    state: State<'_, AppState>,
    theme: ThemePreference,
) -> AppResult<Preferences> {
    let database = state.database()?;
    app_state::set(database.connection(), THEME_KEY, &theme)?;
    Ok(Preferences { theme })
}

/// Keys the webview may read and write in `app_state`.
///
/// Everything it stores goes under this prefix, so a generic key-value command
/// can never overwrite `workspace` or `theme` — state this application owns and
/// whose shape it relies on. The prefix is enforced here, not merely by
/// convention in the caller.
const UI_PREFIX: &str = "ui:";

fn ui_key(key: &str) -> AppResult<String> {
    if key.is_empty() || key.contains(char::is_whitespace) {
        return Err(AppError::validation(
            "key",
            "That is not a usable settings key.",
        ));
    }
    Ok(format!("{UI_PREFIX}{key}"))
}

/// Reads a piece of interface state, or `None` if it was never stored.
#[tauri::command]
pub fn ui_state_get(state: State<'_, AppState>, key: String) -> AppResult<Option<String>> {
    let database = state.database()?;
    app_state::get_raw(database.connection(), &ui_key(&key)?)
}

#[tauri::command]
pub fn ui_state_set(state: State<'_, AppState>, key: String, value: String) -> AppResult<()> {
    let database = state.database()?;
    app_state::set_raw(database.connection(), &ui_key(&key)?, &value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    #[test]
    fn the_theme_defaults_to_following_the_system() {
        let db = Database::open_in_memory().expect("database opens");

        let theme: ThemePreference =
            app_state::get_or(db.connection(), THEME_KEY, ThemePreference::System)
                .expect("read should succeed");

        assert_eq!(theme, ThemePreference::System);
    }

    #[test]
    fn a_chosen_theme_survives_a_reopen_of_the_same_file() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join(crate::db::DATABASE_FILE_NAME);

        {
            let db = Database::open(&path).expect("database opens");
            app_state::set(db.connection(), THEME_KEY, &ThemePreference::Dark)
                .expect("write should succeed");
        }

        let reopened = Database::open(&path).expect("database reopens");
        let theme: ThemePreference =
            app_state::get_or(reopened.connection(), THEME_KEY, ThemePreference::System)
                .expect("read should succeed");

        assert_eq!(
            theme,
            ThemePreference::Dark,
            "the preference must survive a restart"
        );
    }
}
