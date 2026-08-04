pub mod commands;
pub mod db;
pub mod domain;
pub mod error;
pub mod mcp;
pub mod state;

use tauri::Manager;

use crate::db::{Database, DATABASE_FILE_NAME};
use crate::error::AppError;
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // An embedded WebDriver server can execute arbitrary script in this window,
    // so it is compiled in only for binaries built explicitly for end-to-end
    // testing — never by `cargo build`, `tauri dev`, or `tauri build`. Gated on
    // a Cargo feature rather than `debug_assertions` so that an ordinary debug
    // build a developer runs all day does not open a listening socket.
    #[cfg(feature = "e2e-webdriver")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // The window opens whether or not the database did. A failed start is
            // reported through the normal command path so the UI can render a
            // recovery screen naming the backup, rather than the process dying
            // with the user's data unexplained.
            let state = match open_database(app.handle()) {
                Ok(database) => AppState::ready(database),
                Err(error) => {
                    eprintln!("startup: could not open the database: {error}");
                    // The path is resolved again rather than carried out of the
                    // failure, because the recovery screen lists the backups
                    // beside it — and "where is my data" is the question that
                    // screen exists to answer.
                    let path = resolve_data_dir(app.handle())
                        .ok()
                        .map(|dir| dir.join(DATABASE_FILE_NAME));
                    AppState::failed(error, path)
                }
            };
            app.manage(state);
            app.manage(crate::commands::splash::SplashState::default());
            app.manage(commands::updates::AutoUpdater::new());

            // The end-to-end harness pins the `main` window by label and drives
            // it directly. A second window that is briefly in front of it, and a
            // main window that starts hidden, are a launch experience rather
            // than behaviour under test — so under the harness the splash is
            // dismissed before the first spec can see it.
            #[cfg(feature = "e2e-webdriver")]
            {
                if let Some(splash) = app.get_webview_window("splash") {
                    let _ = splash.close();
                }
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            }

            // Sized here rather than in `tauri.conf.json`. A fixed size leaves
            // a wide display mostly empty and forces the board to scroll; the
            // `maximized` flag was tried and put the window partly off-screen on
            // a multi-monitor setup. The work area is what the OS actually says
            // is usable — menu bar and dock already excluded — so a window
            // derived from it always lands on screen.
            if let Some(window) = app.get_webview_window("main") {
                fit_to_work_area(&window);
            }

            #[cfg(not(feature = "e2e-webdriver"))]
            commands::updates::start(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info::app_info,
            commands::database::database_info,
            commands::database::backup_create,
            commands::transfer::export_data,
            commands::transfer::import_preview,
            commands::transfer::import_apply,
            commands::transfer::backups_list,
            commands::transfer::backup_restore,
            commands::preferences::preferences_get,
            commands::preferences::preferences_set_theme,
            commands::preferences::preferences_set_color_palette,
            commands::preferences::window_set_theme,
            commands::preferences::ui_state_get,
            commands::preferences::ui_state_set,
            commands::mcp::mcp_settings_get,
            commands::mcp::mcp_settings_set,
            commands::mcp::mcp_revision_get,
            commands::mcp::mcp_managed_boards_list,
            commands::mcp::mcp_launch_config,
            commands::projects::projects_list,
            commands::projects::project_create,
            commands::projects::project_update,
            commands::projects::project_set_archived,
            commands::projects::project_delete_preview,
            commands::projects::project_delete,
            commands::projects::projects_reorder,
            commands::boards::boards_list,
            commands::boards::board_create,
            commands::boards::board_update,
            commands::boards::board_delete,
            commands::boards::boards_reorder,
            commands::boards::workspace_get,
            commands::boards::workspace_set,
            commands::board::board_load,
            commands::board::board_archived_tasks,
            commands::board::column_create,
            commands::board::column_update,
            commands::board::column_task_count,
            commands::board::column_delete,
            commands::board::columns_reorder,
            commands::board::task_create,
            commands::board::task_update,
            commands::board::task_duplicate,
            commands::board::task_move,
            commands::board::task_set_archived,
            commands::board::task_delete,
            commands::board::undo_last,
            commands::board::undo_available,
            commands::detail::task_detail,
            commands::detail::subtask_create,
            commands::detail::subtask_update,
            commands::detail::subtask_delete,
            commands::detail::subtasks_reorder,
            commands::detail::labels_list,
            commands::detail::label_create,
            commands::detail::label_update,
            commands::detail::label_usage_count,
            commands::detail::label_delete,
            commands::detail::task_set_labels,
            commands::detail::file_ref_add,
            commands::detail::file_ref_relocate,
            commands::detail::file_ref_remove,
            commands::detail::file_refs_verify,
            commands::detail::file_ref_reveal,
            commands::detail::link_ref_add,
            commands::detail::link_ref_remove,
            commands::splash::splash_animation_finished,
            commands::splash::app_ready,
            commands::updates::updates_status,
            commands::updates::updates_restart,
            commands::notes::notes_list,
            commands::notes::notes_list_all,
            commands::notes::note_create,
            commands::notes::note_update,
            commands::notes::note_delete,
            commands::find::tasks_search,
            commands::find::saved_filters_list,
            commands::find::saved_filter_create,
            commands::find::saved_filter_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// The largest window worth opening, in logical pixels.
///
/// An ultrawide display would otherwise give a board a metre of empty space to
/// the right of its last column. Wide enough here for six columns and the
/// add-column affordance without scrolling.
const MAX_INITIAL_WIDTH: f64 = 2200.0;
const MAX_INITIAL_HEIGHT: f64 = 1400.0;

/// Fills the screen the window opened on, minus a margin, within limits.
fn fit_to_work_area(window: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        // No monitor information: leave the configured fallback size alone
        // rather than guessing at a geometry that might be off-screen.
        return;
    };

    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let usable =
        tauri::PhysicalSize::new(area.size.width, area.size.height).to_logical::<f64>(scale);
    let origin =
        tauri::PhysicalPosition::new(area.position.x, area.position.y).to_logical::<f64>(scale);

    let width = (usable.width - 48.0).clamp(900.0, MAX_INITIAL_WIDTH);
    let height = (usable.height - 48.0).clamp(600.0, MAX_INITIAL_HEIGHT);

    if window
        .set_size(tauri::LogicalSize::new(width, height))
        .is_err()
    {
        return;
    }

    // Positioned by arithmetic rather than `Window::center()`, which centres on
    // the size the window had when it was called — and on this display that put
    // a 2200-wide window where a 1440-wide one belonged, well off centre. The
    // work area's own origin is included, so a second monitor above or to the
    // left of the main one is handled too.
    let _ = window.set_position(tauri::LogicalPosition::new(
        origin.x + (usable.width - width) / 2.0,
        origin.y + (usable.height - height) / 2.0,
    ));
}

/// Overrides where the database and its backups live.
///
/// Real feature, not test scaffolding: it is how a second profile, a portable
/// install on an external disk, or an end-to-end run gets its own data without
/// touching the one the user works in. Documented in `docs/data-and-backups.md`.
pub const DATA_DIR_ENV: &str = "TAKENKANBAN_DATA_DIR";

fn open_database(app: &tauri::AppHandle) -> Result<Database, AppError> {
    let data_dir = resolve_data_dir(app)?;
    Database::open(&data_dir.join(DATABASE_FILE_NAME))
}

fn resolve_data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, AppError> {
    match data_dir_override(std::env::var_os(DATA_DIR_ENV)) {
        Some(path) => Ok(path),
        None => app.path().app_data_dir().map_err(|error| {
            AppError::internal(format!("could not resolve app data dir: {error}"))
        }),
    }
}

/// An empty value counts as unset rather than as "the current directory", which
/// is what an unquoted shell variable expands to and is never what was meant.
fn data_dir_override(value: Option<std::ffi::OsString>) -> Option<std::path::PathBuf> {
    value
        .filter(|value| !value.is_empty())
        .map(std::path::PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    #[test]
    fn an_absent_or_empty_data_dir_variable_falls_back_to_the_platform_location() {
        assert_eq!(data_dir_override(None), None);
        assert_eq!(data_dir_override(Some(OsString::new())), None);
    }

    #[test]
    fn a_set_data_dir_variable_wins_over_the_platform_location() {
        assert_eq!(
            data_dir_override(Some(OsString::from("/tmp/profile-two"))),
            Some(std::path::PathBuf::from("/tmp/profile-two"))
        );
    }

    /// The end-to-end WebDriver server can execute arbitrary script in the app
    /// window, so it must stay opt-in.
    ///
    /// This reads the manifest rather than asserting on `cfg!`, which the
    /// compiler would fold to a constant and which would only ever describe the
    /// feature set of the run doing the asserting. The invariant being protected
    /// is a property of `Cargo.toml`: the plugin is optional, and no default
    /// feature turns it on.
    #[test]
    fn the_webdriver_server_is_never_enabled_by_default() {
        let manifest = include_str!("../Cargo.toml");

        let dependency = manifest
            .lines()
            .find(|line| line.starts_with("tauri-plugin-wdio-webdriver"))
            .expect("the WebDriver plugin should still be declared in Cargo.toml");
        assert!(
            dependency.contains("optional = true"),
            "the WebDriver plugin must be an optional dependency, found: {dependency}"
        );

        for line in manifest.lines().filter(|line| line.starts_with("default")) {
            assert!(
                !line.contains("e2e-webdriver"),
                "e2e-webdriver must never be a default feature — it opens a listening \
                 socket that can drive the application window. Found: {line}"
            );
        }
    }
}
