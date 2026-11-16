//! NIMI — Rust backend.
//!
//! One module per feature (see CLAUDE.md): `window` (overlay placement, click-through
//! hit-testing, fullscreen auto-hide), `tray`, `settings`, and later `media`, `system`, `files`,
//! `hotkeys`, `notifications`. All IPC payload types live in `ipc` so their TypeScript mirrors
//! are generated from one place.

mod files;
mod ipc;
mod media;
mod pocket;
mod settings;
mod system;
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
        .manage(Arc::new(media::MediaShared::default()))
        .manage(Arc::new(system::SystemShared::default()))
        .manage(Arc::new(files::FilesShared::default()))
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
            ipc::get_overlay_covered,
            ipc::focus_overlay,
            ipc::open_settings_window,
            ipc::set_tray_state,
            ipc::get_media_state,
            ipc::get_media_art,
            ipc::media_command,
            ipc::open_media_player,
            ipc::get_volume,
            ipc::set_volume,
            ipc::set_volume_muted,
            ipc::get_system_stats,
            ipc::start_scan,
            ipc::cancel_scan,
            ipc::get_scan,
            ipc::move_files,
            ipc::recycle_files,
            ipc::boost_preview,
            ipc::run_boost,
            ipc::restore_power,
            ipc::feed_info,
            ipc::feed_run,
            ipc::feed_undo,
            ipc::copy_text,
            ipc::open_folder,
            ipc::pocket_list,
            ipc::pocket_add,
            ipc::pocket_remove,
            ipc::pocket_copy,
            ipc::pocket_run,
            ipc::pocket_drag,
            ipc::dev_window_flags,
            ipc::dev_hittest_state,
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
            media::spawn(handle);
            system::spawn(handle);
            pocket::spawn(handle);
            files::drop::install(handle);
            {
                // WebView2 may add its input window a moment after the controller: install again.
                let handle = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    files::drop::install(&handle);
                });
            }
            if current.phish_feed {
                files::link::refresh_feed(handle);
            }
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
