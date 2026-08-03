//! Signed automatic updates from Atticus' main GitHub release feed.
//!
//! Checking, downloading, signature validation and installation stay in Rust.
//! The webview receives only progress/status and may request a restart after a
//! verified update has been installed.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::UpdaterExt;
use ts_rs::TS;

use crate::error::{AppError, AppResult};

const UPDATE_INTERVAL: Duration = Duration::from_secs(30 * 60);
const UPDATE_ENDPOINT: &str =
    "https://github.com/damienglanum/Atticus---Task-Manager/releases/download/main/latest.json";
const STATUS_EVENT: &str = "atticus://update-status";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "state", rename_all = "camelCase")]
#[ts(export, export_to = "UpdateStatus.ts")]
pub enum UpdateStatus {
    Idle,
    Downloading {
        version: String,
        #[ts(type = "number")]
        downloaded: u64,
        #[ts(type = "number | null")]
        total: Option<u64>,
    },
    Ready {
        version: String,
    },
}

pub struct AutoUpdater {
    checking: AtomicBool,
    status: Mutex<UpdateStatus>,
}

impl Default for AutoUpdater {
    fn default() -> Self {
        Self::new()
    }
}

impl AutoUpdater {
    pub fn new() -> Self {
        Self {
            checking: AtomicBool::new(false),
            status: Mutex::new(UpdateStatus::Idle),
        }
    }

    fn status(&self) -> UpdateStatus {
        self.status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn replace_status(&self, status: UpdateStatus) {
        *self
            .status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = status;
    }
}

/// Starts one immediate check and then checks again while the app remains open.
///
/// Debug binaries are deliberately excluded: they are unbundled executables in
/// `target/debug`, and an updater must never try to replace a developer's build
/// directory. The first manually installed release build takes over from here.
pub fn start(app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }

    spawn_check(app.clone());
    let _ = std::thread::Builder::new()
        .name("atticus-updater".to_owned())
        .spawn(move || loop {
            std::thread::sleep(UPDATE_INTERVAL);
            spawn_check(app.clone());
        });
}

fn spawn_check(app: AppHandle) {
    let updater = app.state::<AutoUpdater>();
    if updater.checking.swap(true, Ordering::AcqRel) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        if let Err(error) = check_and_install(&app).await {
            set_status(&app, UpdateStatus::Idle);
            eprintln!("updater: {error}");
        }

        app.state::<AutoUpdater>()
            .checking
            .store(false, Ordering::Release);
    });
}

fn set_status(app: &AppHandle, status: UpdateStatus) {
    app.state::<AutoUpdater>().replace_status(status.clone());
    // A frontend that is not ready yet recovers the same value through
    // `updates_status`, so a missed launch-time event cannot lose the banner.
    let _ = app.emit(STATUS_EVENT, status);
}

async fn check_and_install(app: &AppHandle) -> AppResult<()> {
    // Once installed, wait for the user to restart. Re-checking the same feed
    // would only redownload the same update into the still-running old process.
    if matches!(
        app.state::<AutoUpdater>().status(),
        UpdateStatus::Ready { .. }
    ) {
        return Ok(());
    }

    let endpoint = UPDATE_ENDPOINT
        .parse()
        .map_err(|error| AppError::internal(format!("invalid update endpoint: {error}")))?;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| AppError::internal(format!("could not select update feed: {error}")))?
        .build()
        .map_err(|error| AppError::internal(format!("could not initialise updater: {error}")))?;

    let Some(update) = updater
        .check()
        .await
        .map_err(|error| AppError::internal(format!("update check failed: {error}")))?
    else {
        set_status(app, UpdateStatus::Idle);
        return Ok(());
    };

    let version = update.version.clone();
    set_status(
        app,
        UpdateStatus::Downloading {
            version: version.clone(),
            downloaded: 0,
            total: None,
        },
    );

    let progress_app = app.clone();
    let progress_version = version.clone();
    let mut downloaded = 0_u64;
    update
        .download_and_install(
            move |chunk_length, total| {
                downloaded = downloaded.saturating_add(chunk_length as u64);
                set_status(
                    &progress_app,
                    UpdateStatus::Downloading {
                        version: progress_version.clone(),
                        downloaded,
                        total,
                    },
                );
            },
            || {},
        )
        .await
        .map_err(|error| AppError::internal(format!("update install failed: {error}")))?;

    set_status(app, UpdateStatus::Ready { version });
    Ok(())
}

#[tauri::command]
pub fn updates_status(updater: State<'_, AutoUpdater>) -> UpdateStatus {
    updater.status()
}

#[tauri::command]
pub fn updates_restart(app: AppHandle, updater: State<'_, AutoUpdater>) -> AppResult<()> {
    if !matches!(updater.status(), UpdateStatus::Ready { .. }) {
        return Err(AppError::validation(
            "update",
            "The update has not finished downloading yet.",
        ));
    }
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn updates_have_one_fixed_main_feed() {
        assert_eq!(
            UPDATE_ENDPOINT,
            "https://github.com/damienglanum/Atticus---Task-Manager/releases/download/main/latest.json"
        );
    }

    #[test]
    fn updater_starts_idle() {
        assert_eq!(AutoUpdater::new().status(), UpdateStatus::Idle);
    }
}
