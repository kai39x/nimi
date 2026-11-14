//! NIMI — Rust backend.
//!
//! One module per feature (see CLAUDE.md): `window` (overlay placement, click-through
//! hit-testing, fullscreen auto-hide), `tray`, `settings`, and later `media`, `system`, `files`,
//! `hotkeys`, `notifications`. All IPC payload types live in `ipc` so their TypeScript mirrors
//! are generated from one place.

mod ipc;
mod settings;
mod tray;
mod window;

use std::sync::Arc;

use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

pub fn run() {
    let app = tauri::Builder::default()
        // Must be registered first so a second launch is caught before anything else starts.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A second launch just brings NIMI back; `nimi.exe --settings` opens the settings.
            window::visibility::show_now(app);
            if argv.iter().any(|arg| arg == "--settings") {
                if let Err(err) = window::settings_window::open(app) {
                    log::warn!("could not open settings: {err}");
                }
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .manage(Arc::new(window::OverlayState::default()))
        .invoke_handler(tauri::generate_handler![
            ipc::app_info,
            ipc::get_settings,
            ipc::set_settings,
            ipc::list_monitors,
            ipc::set_hit_rects,
            ipc::get_overlay_visibility,
            ipc::hide_overlay_for,
            ipc::show_overlay,
            ipc::start_overlay_drag,
            ipc::recenter_overlay,
            ipc::set_overlay_expanded,
            ipc::open_settings_window,
            ipc::set_tray_state,
            ipc::dev_window_flags,
        ])
        .on_window_event(|win, event| match (win.label(), event) {
            (
                window::OVERLAY_LABEL,
                WindowEvent::Moved(_) | WindowEvent::ScaleFactorChanged { .. },
            ) => {
                window::refresh_geometry(win.app_handle());
            }
            // The overlay can only go away through the tray's "quit".
            (window::OVERLAY_LABEL, WindowEvent::CloseRequested { api, .. }) => api.prevent_close(),
            // Settings is created once and hidden on close, so reopening is instant.
            (window::SETTINGS_LABEL, WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let _ = win.hide();
            }
            _ => {}
        })
        .setup(|app| {
            let handle = app.handle();
            settings::SettingsStore::init(handle)?;
            let current = app.state::<settings::SettingsStore>().get();
            if let Err(err) = settings::sync_autostart(handle, current.autostart) {
                log::warn!("autostart sync failed: {err}");
            }
            window::setup(handle)?;
            tray::setup(handle)?;
            if std::env::args().any(|arg| arg == "--settings") {
                window::settings_window::open(handle)?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build NIMI");

    app.run(|_app, event| {
        // Closing the settings window must not end the app; it lives in the tray.
        if let RunEvent::ExitRequested {
            api, code: None, ..
        } = event
        {
            api.prevent_exit();
        }
    });
}
