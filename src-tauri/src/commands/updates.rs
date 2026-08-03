//! Signed automatic updates from the selected GitHub release channel.
//!
//! The frontend can choose `dev` or `main`, but it never receives updater
//! permissions or an arbitrary URL. Endpoint selection, signature validation,
//! installation and restart all stay in Rust.

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::commands::preferences::UpdateChannel;
use crate::error::{AppError, AppResult};

const UPDATE_INTERVAL: Duration = Duration::from_secs(30 * 60);
const RELEASES: &str = "https://github.com/damienglanum/Atticus---Task-Manager/releases/download";

pub struct AutoUpdater {
    channel: AtomicU8,
    checking: AtomicBool,
}

impl AutoUpdater {
    pub fn new(channel: UpdateChannel) -> Self {
        Self {
            channel: AtomicU8::new(channel_number(channel)),
            checking: AtomicBool::new(false),
        }
    }

    fn channel(&self) -> UpdateChannel {
        match self.channel.load(Ordering::Relaxed) {
            0 => UpdateChannel::Dev,
            _ => UpdateChannel::Main,
        }
    }

    fn set_channel(&self, channel: UpdateChannel) {
        self.channel
            .store(channel_number(channel), Ordering::Relaxed);
    }
}

const fn channel_number(channel: UpdateChannel) -> u8 {
    match channel {
        UpdateChannel::Dev => 0,
        UpdateChannel::Main => 1,
    }
}

fn endpoint(channel: UpdateChannel) -> String {
    let channel = match channel {
        UpdateChannel::Dev => "dev",
        UpdateChannel::Main => "main",
    };
    format!("{RELEASES}/{channel}/latest.json")
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

/// Changes the live channel and checks it immediately.
pub fn set_channel(app: &AppHandle, channel: UpdateChannel) {
    let updater = app.state::<AutoUpdater>();
    updater.set_channel(channel);
    if !cfg!(debug_assertions) {
        spawn_check(app.clone());
    }
}

fn spawn_check(app: AppHandle) {
    let checked_channel = {
        let updater = app.state::<AutoUpdater>();
        if updater.checking.swap(true, Ordering::AcqRel) {
            return;
        }
        updater.channel()
    };

    tauri::async_runtime::spawn(async move {
        match check_and_install(&app, checked_channel).await {
            Ok(true) => app.restart(),
            Ok(false) => {}
            Err(error) => eprintln!("updater: {error}"),
        }

        let requested_channel = {
            let updater = app.state::<AutoUpdater>();
            updater.checking.store(false, Ordering::Release);
            updater.channel()
        };

        // A setting change may have landed while the old channel was checking.
        if requested_channel != checked_channel {
            spawn_check(app);
        }
    });
}

async fn check_and_install(app: &AppHandle, channel: UpdateChannel) -> AppResult<bool> {
    let endpoint = endpoint(channel)
        .parse()
        .map_err(|error| AppError::internal(format!("invalid update endpoint: {error}")))?;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| AppError::internal(format!("could not select update channel: {error}")))?
        // Switching from a newer dev build to main is an intentional channel
        // change and may be a semantic-version downgrade.
        .version_comparator(|current, release| release.version != current)
        .build()
        .map_err(|error| AppError::internal(format!("could not initialise updater: {error}")))?;

    let Some(update) = updater
        .check()
        .await
        .map_err(|error| AppError::internal(format!("update check failed: {error}")))?
    else {
        return Ok(false);
    };

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| AppError::internal(format!("update install failed: {error}")))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channels_have_separate_fixed_feed_locations() {
        assert_eq!(
            endpoint(UpdateChannel::Dev),
            "https://github.com/damienglanum/Atticus---Task-Manager/releases/download/dev/latest.json"
        );
        assert_eq!(
            endpoint(UpdateChannel::Main),
            "https://github.com/damienglanum/Atticus---Task-Manager/releases/download/main/latest.json"
        );
    }
}
