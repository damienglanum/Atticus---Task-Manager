use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::db::app_state;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

const THEME_KEY: &str = "theme";
const UPDATE_CHANNEL_KEY: &str = "update_channel";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "ThemePreference.ts")]
pub enum ThemePreference {
    Light,
    Dark,
    System,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "UpdateChannel.ts")]
pub enum UpdateChannel {
    Dev,
    #[default]
    Main,
}

/// A preference with "system" already decided.
///
/// Distinct from `ThemePreference` on purpose: the window chrome cannot be told
/// to "follow the system", it has to be told which of the two to paint. Having
/// the type refuse to carry "system" is what stops the frontend and the backend
/// resolving it separately and disagreeing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "ResolvedTheme.ts")]
pub enum ResolvedTheme {
    Light,
    Dark,
}

impl From<ResolvedTheme> for tauri::Theme {
    fn from(theme: ResolvedTheme) -> Self {
        match theme {
            ResolvedTheme::Light => tauri::Theme::Light,
            ResolvedTheme::Dark => tauri::Theme::Dark,
        }
    }
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "Preferences.ts")]
pub struct Preferences {
    pub theme: ThemePreference,
    pub update_channel: UpdateChannel,
}

fn read_preferences(state: &AppState) -> AppResult<Preferences> {
    let database = state.database()?;
    let theme = app_state::get_or(database.connection(), THEME_KEY, ThemePreference::System)?;
    let update_channel = read_update_channel(database.connection())?;
    Ok(Preferences {
        theme,
        update_channel,
    })
}

pub(crate) fn read_update_channel(connection: &rusqlite::Connection) -> AppResult<UpdateChannel> {
    app_state::get_or(connection, UPDATE_CHANNEL_KEY, UpdateChannel::default())
}

#[tauri::command]
pub fn preferences_get(state: State<'_, AppState>) -> AppResult<Preferences> {
    read_preferences(&state)
}

#[tauri::command]
pub fn preferences_set_theme(
    state: State<'_, AppState>,
    theme: ThemePreference,
) -> AppResult<Preferences> {
    let database = state.database()?;
    app_state::set(database.connection(), THEME_KEY, &theme)?;
    drop(database);
    read_preferences(&state)
}

#[tauri::command]
pub fn preferences_set_update_channel(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    update_channel: UpdateChannel,
) -> AppResult<Preferences> {
    let database = state.database()?;
    app_state::set(database.connection(), UPDATE_CHANNEL_KEY, &update_channel)?;
    drop(database);

    crate::commands::updates::set_channel(&app, update_channel);
    read_preferences(&state)
}

/// Repaints the window chrome to match the theme the interface is drawing.
///
/// macOS draws the titlebar from the *window's* theme, which Tauri leaves at the
/// system value; only the web contents follow the application's preference. A
/// user who runs the OS in dark mode and chooses the light theme therefore gets
/// a dark bar above a light interface — defect V-1 in `docs/visual-review.md`,
/// found in milestone 3 and fixed here.
///
/// Takes the resolved theme rather than the preference: the frontend already
/// turned "system" into one of the two in order to set the document class, and
/// deciding it twice is how the bar and the board come to disagree.
#[tauri::command]
pub fn window_set_theme(window: tauri::WebviewWindow, theme: ResolvedTheme) -> AppResult<()> {
    window
        .set_theme(Some(theme.into()))
        .map_err(|error| AppError::internal(format!("could not set the window theme: {error}")))
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
    fn a_resolved_theme_maps_onto_the_window_theme_it_names() {
        // The two enums are separate types precisely so this mapping is written
        // once. If a variant is ever added, this stops compiling rather than
        // silently painting the bar the wrong colour.
        assert_eq!(
            tauri::Theme::from(ResolvedTheme::Light),
            tauri::Theme::Light
        );
        assert_eq!(tauri::Theme::from(ResolvedTheme::Dark), tauri::Theme::Dark);
    }

    #[test]
    fn the_resolved_theme_cannot_carry_system() {
        // Serialising is how it reaches the frontend, so this is the shape the
        // binding promises: two values, and no way to ask for "whatever the OS
        // says" at a layer that has to answer with a colour.
        assert_eq!(
            serde_json::to_string(&ResolvedTheme::Light).expect("serialises"),
            "\"light\""
        );
        assert!(serde_json::from_str::<ResolvedTheme>("\"system\"").is_err());
    }

    #[test]
    fn the_theme_defaults_to_following_the_system() {
        let db = Database::open_in_memory().expect("database opens");

        let theme: ThemePreference =
            app_state::get_or(db.connection(), THEME_KEY, ThemePreference::System)
                .expect("read should succeed");

        assert_eq!(theme, ThemePreference::System);
    }

    #[test]
    fn updates_default_to_the_main_channel() {
        let db = Database::open_in_memory().expect("database opens");

        let channel = read_update_channel(db.connection()).expect("read should succeed");

        assert_eq!(channel, UpdateChannel::Main);
    }

    #[test]
    fn a_chosen_update_channel_survives_a_reopen_of_the_same_file() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join(crate::db::DATABASE_FILE_NAME);

        {
            let db = Database::open(&path).expect("database opens");
            app_state::set(db.connection(), UPDATE_CHANNEL_KEY, &UpdateChannel::Dev)
                .expect("write should succeed");
        }

        let reopened = Database::open(&path).expect("database reopens");
        let channel = read_update_channel(reopened.connection()).expect("read should succeed");

        assert_eq!(channel, UpdateChannel::Dev);
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
