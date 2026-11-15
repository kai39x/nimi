//! The overlay window: a single transparent, frameless, always-on-top, non-focusable window
//! parked at the top-center of a monitor. The window never resizes; everything visible is CSS.
//!
//! - `placement`: which monitor, top-center math, drag offset persistence
//! - `hittest`: click-through by default; mouse enabled only over the rects the frontend
//!   reports; also drives the capsule drag and click-outside detection
//! - `visibility`: one place that decides whether the window is shown (fullscreen, hide 1 h)
//! - `fullscreen`: detects a fullscreen app in front of NIMI
//! - `subclass`: Win32 message hook for display / DPI / theme changes
//! - `settings_window`: the secondary glass window

pub mod fullscreen;
pub mod hittest;
pub mod placement;
pub mod settings_window;
pub mod subclass;
pub mod visibility;

use std::{
    sync::{
        atomic::{AtomicBool, AtomicIsize, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};

use tauri::{AppHandle, Manager};

use crate::ipc::HitRect;

/// Labels as declared in `tauri.conf.json` / `settings_window.rs`.
pub const OVERLAY_LABEL: &str = "overlay";
pub const SETTINGS_LABEL: &str = "settings";

/// Logical size of the overlay window. Must match `tauri.conf.json`.
pub const OVERLAY_SIZE: (f64, f64) = (960.0, 720.0);
/// Logical width of the compact capsule (design spec §3); used to clamp dragging.
pub const CAPSULE_WIDTH: f64 = 148.0;

/// Cached physical geometry of the overlay so the poll threads never block on the main thread.
#[derive(Debug, Clone, Copy, Default)]
pub struct Geometry {
    pub x: i32,
    pub y: i32,
    pub scale: f64,
}

#[derive(Default)]
pub struct OverlayState {
    pub geometry: Mutex<Geometry>,
    /// Interactive regions reported by the frontend (CSS px, window-relative).
    pub rects: Mutex<Vec<HitRect>>,
    /// `true` while the window accepts mouse input (`set_ignore_cursor_events(false)`).
    pub interactive: AtomicBool,
    /// `true` while the expanded panel is open (enables click-outside detection).
    pub expanded: AtomicBool,
    pub drag: Mutex<Option<hittest::DragSession>>,
    /// A fullscreen app is in front of NIMI.
    pub fullscreen: AtomicBool,
    /// A maximized foreground window's title bar / tab strip lies under the capsule (peek mode).
    pub covered: AtomicBool,
    /// "Hide for 1 h" deadline.
    pub hidden_until: Mutex<Option<Instant>>,
    /// What we last told the window to be.
    pub visible: AtomicBool,
    /// Raw HWND of the overlay (0 until setup).
    pub hwnd: AtomicIsize,
    /// The window that had focus before the panel took it; focus goes back there on collapse.
    pub prev_foreground: AtomicIsize,
}

pub fn state(app: &AppHandle) -> Arc<OverlayState> {
    app.state::<Arc<OverlayState>>().inner().clone()
}

/// Places the window, makes it click-through, shows it and starts the watcher threads.
pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let overlay = app
        .get_webview_window(OVERLAY_LABEL)
        .ok_or("overlay window is missing from tauri.conf.json")?;
    let st = state(app);

    st.hwnd.store(overlay.hwnd()?.0 as isize, Ordering::Relaxed);
    if !dev_skip("clickthrough") {
        overlay.set_ignore_cursor_events(true)?;
    }
    placement::place(app)?;
    let before = foreground::current();
    overlay.show()?;
    st.visible.store(true, Ordering::Relaxed);
    settle_focus(app, before);

    if !dev_skip("subclass") {
        subclass::install(app, &overlay)?;
    }
    if !dev_skip("hittest") {
        hittest::spawn(app.clone());
    }
    if !dev_skip("fullscreen") {
        fullscreen::spawn(app.clone());
    }
    Ok(())
}

/// WebView2 marks the page focused when the overlay's webview is created, and since the overlay
/// is never activated it never gets the blur — Chromium then never throttles it (≈3× idle CPU)
/// until the panel is opened and closed once. A freshly launched process may also keep the
/// foreground itself. So once at startup, after WebView2 has settled, run the panel's own focus
/// round trip: focus the overlay, then hand the foreground back to whatever had it.
fn settle_focus(app: &AppHandle, before: isize) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1500));
        let st = state(&app);
        if st.expanded.load(Ordering::Relaxed) {
            return; // the panel is already open; its close does the same
        }
        let ours = st.hwnd.load(Ordering::Relaxed);
        let fg = foreground::current();
        let back_to = if fg != 0 && fg != ours { fg } else { before };
        if back_to == 0 || back_to == ours {
            return;
        }
        if let Err(err) = set_overlay_focus(&app, true) {
            log::info!("startup focus round trip skipped: {err}");
            return;
        }
        st.prev_foreground.store(back_to, Ordering::Relaxed);
        std::thread::sleep(std::time::Duration::from_millis(120));
        if !st.expanded.load(Ordering::Relaxed) {
            let _ = set_overlay_focus(&app, false);
        }
    });
}

/// Dev builds only: `NIMI_DEV_SKIP=clickthrough,subclass,hittest,fullscreen` disables parts of
/// the overlay setup so Win32 behaviour can be bisected without code changes.
fn dev_skip(part: &str) -> bool {
    cfg!(debug_assertions)
        && std::env::var("NIMI_DEV_SKIP")
            .map(|v| v.split(',').any(|p| p.trim() == part))
            .unwrap_or(false)
}

/// Re-reads position and scale factor into the cache. Call on the main thread (window events).
pub fn refresh_geometry(app: &AppHandle) {
    let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) else {
        return;
    };
    if let (Ok(pos), Ok(scale)) = (overlay.outer_position(), overlay.scale_factor()) {
        *state(app).geometry.lock().expect("geometry lock") = Geometry {
            x: pos.x,
            y: pos.y,
            scale,
        };
    }
}

/// Panel / command bar open → the overlay may take keyboard focus; closed → back to a window
/// that can never be activated (compact mode must not steal focus from the app underneath),
/// and focus returns to whatever app had it before the panel opened.
pub fn set_overlay_focus(app: &AppHandle, focus: bool) -> tauri::Result<()> {
    let overlay = app
        .get_webview_window(OVERLAY_LABEL)
        .ok_or(tauri::Error::WindowNotFound)?;
    let st = state(app);
    let ours = st.hwnd.load(Ordering::Relaxed);
    if focus {
        let fg = foreground::current();
        if fg != 0 && fg != ours {
            st.prev_foreground.store(fg, Ordering::Relaxed);
        }
        overlay.set_focusable(true)?;
        overlay.set_focus()?;
    } else {
        overlay.set_focusable(false)?;
        let prev = st.prev_foreground.swap(0, Ordering::Relaxed);
        if foreground::current() == ours && prev != 0 {
            foreground::restore(prev);
        }
    }
    Ok(())
}

mod foreground {
    use std::ffi::c_void;
    use windows::Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{GetForegroundWindow, IsWindow, SetForegroundWindow},
    };

    pub fn current() -> isize {
        // SAFETY: no arguments; returns a handle or null.
        unsafe { GetForegroundWindow().0 as isize }
    }

    /// Gives focus back to `hwnd`. Allowed because our process is the foreground one right now.
    pub fn restore(hwnd: isize) {
        let h = HWND(hwnd as *mut c_void);
        // SAFETY: plain Win32 calls on a handle we validate first.
        unsafe {
            if IsWindow(Some(h)).as_bool() {
                let _ = SetForegroundWindow(h);
            }
        }
    }
}
