//! The splash window's lifecycle.
//!
//! Two things have to happen before the application is shown: the contours have
//! to finish drawing, and the frontend has to have a workspace to render. They
//! finish in an order that depends on the machine — a warm start beats the
//! animation, a cold one does not — so each reports in and whichever arrives
//! second does the swap.
//!
//! Doing it the obvious way instead, with a fixed delay, gets one of two
//! outcomes and no way to pick: either the animation is cut off mid-stroke on a
//! fast start, or a fast start is padded out to look slow. Milestone 10 measures
//! cold launch as a release gate, and padding it would be measuring a decision
//! rather than the application.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Manager, State, WebviewWindow};

/// Which of the two conditions have been met so far.
#[derive(Default)]
pub struct SplashState {
    animation_finished: AtomicBool,
    app_ready: AtomicBool,
}

impl SplashState {
    /// Records one signal and reports whether *both* have now arrived.
    ///
    /// `SeqCst` rather than something weaker: this runs twice per launch, so the
    /// ordering is free, and the failure it would buy is a window that never
    /// appears.
    fn mark(&self, flag: &AtomicBool) -> bool {
        flag.store(true, Ordering::SeqCst);
        self.animation_finished.load(Ordering::SeqCst) && self.app_ready.load(Ordering::SeqCst)
    }
}

/// Closes the splash and shows the application, if both parties are done.
fn swap_if_ready(app: &tauri::AppHandle, state: &SplashState, flag: &AtomicBool) {
    if !state.mark(flag) {
        return;
    }

    if let Some(main) = app.get_webview_window("main") {
        show(&main);
    }

    // Closed last. Closing it first leaves a frame with no window of ours in
    // front, which on macOS lets whatever is behind the application flash
    // through — the one thing a splash screen exists to prevent.
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.close();
    }
}

fn show(window: &WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
}

/// The splash animation has played. Sent by the splash window itself.
#[tauri::command]
pub fn splash_animation_finished(app: tauri::AppHandle, state: State<'_, SplashState>) {
    let flag = &state.inner().animation_finished;
    swap_if_ready(&app, state.inner(), flag);
}

/// The workspace has loaded and the interface can be looked at. Sent by the app.
///
/// Deliberately infallible and deliberately idempotent. It is called from an
/// effect that may run twice under React's strict mode, and a failure here must
/// never be the reason a user is left staring at a splash screen.
#[tauri::command]
pub fn app_ready(app: tauri::AppHandle, state: State<'_, SplashState>) {
    let flag = &state.inner().app_ready;
    swap_if_ready(&app, state.inner(), flag);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neither_signal_alone_is_enough() {
        let state = SplashState::default();

        assert!(!state.mark(&state.animation_finished));
        assert!(!SplashState::default().mark(&SplashState::default().app_ready));
    }

    #[test]
    fn the_second_signal_completes_it_whichever_order_they_arrive_in() {
        let animation_first = SplashState::default();
        assert!(!animation_first.mark(&animation_first.animation_finished));
        assert!(animation_first.mark(&animation_first.app_ready));

        let app_first = SplashState::default();
        assert!(!app_first.mark(&app_first.app_ready));
        assert!(app_first.mark(&app_first.animation_finished));
    }

    #[test]
    fn repeating_a_signal_does_not_complete_it_on_its_own() {
        // `app_ready` is called from a React effect, which strict mode runs
        // twice. Two of the same signal must not add up to both of them.
        let state = SplashState::default();

        assert!(!state.mark(&state.app_ready));
        assert!(!state.mark(&state.app_ready));
    }
}
