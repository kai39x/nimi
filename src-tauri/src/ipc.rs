//! Typed IPC surface between Rust and React.
//!
//! Every payload derives `ts_rs::TS` with `#[ts(export)]`; `npm run ipc:gen` writes the
//! TypeScript mirrors to `src/ipc/generated/`, and `src/ipc/commands.ts` wraps each command.
//! Event names live in [`events`] and are mirrored by hand in `src/ipc/events.ts`.

use std::{collections::HashMap, sync::Arc};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use ts_rs::TS;

use crate::{
    settings::SettingsStore,
    window::{self, OverlayState},
};

/// Event names (Rust → React). Keep `src/ipc/events.ts` in sync.
pub mod events {
    pub const OVERLAY_VISIBILITY: &str = "nimi://overlay/visibility";
    pub const OVERLAY_DRAG: &str = "nimi://overlay/drag";
    pub const OVERLAY_CURSOR: &str = "nimi://overlay/cursor";
    pub const OVERLAY_CLICK_OUTSIDE: &str = "nimi://overlay/click-outside";
    pub const SETTINGS_CHANGED: &str = "nimi://settings/changed";
    pub const TRAY_OPEN: &str = "nimi://tray/open";
}

// ---------------------------------------------------------------------------------------------
// App

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppInfo {
    pub version: String,
    pub tauri_version: String,
    pub debug: bool,
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        tauri_version: tauri::VERSION.to_string(),
        debug: cfg!(debug_assertions),
    }
}

// ---------------------------------------------------------------------------------------------
// Settings

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Language {
    #[default]
    Ar,
    En,
}

/// Persisted user settings (`%APPDATA%/io.github.kai39x.nimi/settings.json`).
/// Every field has a default so older files keep loading when new fields are added.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Settings {
    pub language: Language,
    pub autostart: bool,
    /// `"primary"` or a monitor name as reported by `list_monitors`.
    pub display: String,
    /// Horizontal offset of the capsule from the monitor's top-center, in logical px, per monitor name.
    pub overlay_offsets: HashMap<String, i32>,
    pub sounds_muted: bool,
    pub reduce_motion: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: Language::Ar,
            autostart: false,
            display: "primary".into(),
            overlay_offsets: HashMap::new(),
            sounds_muted: false,
            reduce_motion: false,
        }
    }
}

#[tauri::command]
pub fn get_settings(store: State<'_, SettingsStore>) -> Settings {
    store.get()
}

/// Replaces the whole settings object (the frontend always holds the full value).
#[tauri::command]
pub fn set_settings(app: AppHandle, settings: Settings) -> Settings {
    crate::settings::update(&app, move |current| *current = settings)
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MonitorInfo {
    pub name: String,
    pub is_primary: bool,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

#[tauri::command]
pub fn list_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    window::placement::list_monitors(&app).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------------------------
// Overlay window

/// A mouse-interactive region of the overlay, in CSS px relative to the window's client area.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HitRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[tauri::command]
pub fn set_hit_rects(state: State<'_, Arc<OverlayState>>, rects: Vec<HitRect>) {
    *state.rects.lock().expect("hit rects lock") = rects;
}

/// Why the overlay is hidden right now (`None` in the visibility payload means visible).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum HideReason {
    Fullscreen,
    Timer,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct OverlayVisibility {
    pub visible: bool,
    pub reason: Option<HideReason>,
}

#[tauri::command]
pub fn get_overlay_visibility(state: State<'_, Arc<OverlayState>>) -> OverlayVisibility {
    window::visibility::current(&state)
}

#[tauri::command]
pub fn hide_overlay_for(app: AppHandle, seconds: u64) {
    window::visibility::hide_for(&app, std::time::Duration::from_secs(seconds));
}

#[tauri::command]
pub fn show_overlay(app: AppHandle) {
    window::visibility::show_now(&app);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum DragPhase {
    Start,
    Move,
    End,
}

/// Progress of a capsule drag along the top edge (driven by Rust, see `window::hittest`).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct OverlayDragEvent {
    pub phase: DragPhase,
    pub moved: bool,
}

#[tauri::command]
pub fn start_overlay_drag(app: AppHandle) -> Result<(), String> {
    window::hittest::begin_drag(&app)
}

#[tauri::command]
pub fn recenter_overlay(app: AppHandle) -> Result<(), String> {
    window::placement::recenter(&app).map_err(|e| e.to_string())
}

/// Cursor relation to the interactive regions: `near` = within the approach zone,
/// `inside` = over an interactive element.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CursorProximity {
    pub near: bool,
    pub inside: bool,
}

/// Tells the hit-test loop whether the panel is open, so clicks outside it can collapse it.
#[tauri::command]
pub fn set_overlay_expanded(state: State<'_, Arc<OverlayState>>, expanded: bool) {
    state
        .expanded
        .store(expanded, std::sync::atomic::Ordering::Relaxed);
}

#[tauri::command]
pub fn open_settings_window(app: AppHandle) -> Result<(), String> {
    // Windows are created on the main thread; commands run on the async runtime.
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if let Err(err) = window::settings_window::open(&handle) {
            log::warn!("could not open settings: {err}");
        }
    })
    .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------------------------
// Tray

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum TrayState {
    Normal,
    Notify,
    Sleep,
    Dnd,
}

#[tauri::command]
pub fn set_tray_state(app: AppHandle, state: TrayState) {
    crate::tray::set_state(&app, state);
}

// ---------------------------------------------------------------------------------------------
// Dev tooling

/// Dev-only: flips window styles at runtime to bisect Win32 behaviour (driven by scripts/cdp.py).
#[tauri::command]
pub fn dev_window_flags(
    app: AppHandle,
    label: Option<String>,
    always_on_top: Option<bool>,
    skip_taskbar: Option<bool>,
    focusable: Option<bool>,
    ignore_cursor: Option<bool>,
) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("dev builds only".into());
    }
    let label = label.unwrap_or_else(|| window::OVERLAY_LABEL.to_string());
    let target = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("window {label} missing"))?;
    let err = |e: tauri::Error| e.to_string();
    if let Some(v) = always_on_top {
        target.set_always_on_top(v).map_err(err)?;
    }
    if let Some(v) = skip_taskbar {
        target.set_skip_taskbar(v).map_err(err)?;
    }
    if let Some(v) = focusable {
        target.set_focusable(v).map_err(err)?;
    }
    if let Some(v) = ignore_cursor {
        target.set_ignore_cursor_events(v).map_err(err)?;
    }
    Ok(())
}
