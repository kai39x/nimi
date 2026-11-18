//! The one place that decides whether the overlay window is shown. Inputs: a fullscreen app in
//! front (set by `fullscreen`), and a "hide for a while" deadline (tray / right-click menu).

use std::{
    sync::atomic::Ordering,
    thread,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter, Manager};

use super::{hittest, state, OverlayState, OVERLAY_LABEL};
use crate::ipc::{events, HideReason, OverlayVisibility};

fn desired(st: &OverlayState) -> OverlayVisibility {
    if st.fullscreen.load(Ordering::Relaxed) {
        return OverlayVisibility {
            visible: false,
            reason: Some(HideReason::Fullscreen),
        };
    }
    let timer_active = st
        .hidden_until
        .lock()
        .expect("hidden_until lock")
        .is_some_and(|until| until > Instant::now());
    if timer_active {
        return OverlayVisibility {
            visible: false,
            reason: Some(HideReason::Timer),
        };
    }
    OverlayVisibility {
        visible: true,
        reason: None,
    }
}

pub fn current(st: &OverlayState) -> OverlayVisibility {
    desired(st)
}

/// Applies the desired visibility to the window and tells the frontend when it changes.
pub fn sync(app: &AppHandle) {
    let st = state(app);
    let next = desired(&st);
    if st.visible.swap(next.visible, Ordering::Relaxed) == next.visible {
        return;
    }

    if let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) {
        let result = if next.visible {
            super::memory::set_low(&overlay, false);
            overlay.show()
        } else {
            hittest::set_interactive(app, &st, false);
            let hidden = overlay.hide();
            super::memory::set_low(&overlay, true);
            hidden
        };
        if let Err(err) = result {
            log::warn!("overlay show/hide failed: {err}");
        }
    }

    crate::notify::sync_tray(app);
    let _ = app.emit(events::OVERLAY_VISIBILITY, &next);
}

/// Hides the overlay for `duration` and schedules the return.
pub fn hide_for(app: &AppHandle, duration: Duration) {
    let st = state(app);
    let until = Instant::now() + duration;
    *st.hidden_until.lock().expect("hidden_until lock") = Some(until);
    sync(app);

    let app = app.clone();
    thread::Builder::new()
        .name("nimi-unhide-timer".into())
        .spawn(move || {
            thread::sleep(duration);
            let st = state(&app);
            let mut guard = st.hidden_until.lock().expect("hidden_until lock");
            // Only clear if nobody re-armed the timer in the meantime.
            if *guard == Some(until) {
                *guard = None;
                drop(guard);
                sync(&app);
            }
        })
        .expect("spawn unhide timer");
}

/// Cancels any "hide for a while" and shows the overlay (unless a fullscreen app is in front).
pub fn show_now(app: &AppHandle) {
    *state(app).hidden_until.lock().expect("hidden_until lock") = None;
    sync(app);
}
