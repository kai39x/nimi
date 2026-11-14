//! NIMI — Rust backend.
//!
//! One module per feature (see CLAUDE.md): `window` (overlay placement, click-through
//! hit-testing, fullscreen auto-hide), and later `media`, `system`, `files`, `hotkeys`,
//! `notifications`. All IPC payload types live in `ipc` so their TypeScript mirrors can
//! be generated from one place.

mod ipc;
mod window;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        // Must be registered first so a second launch is caught before anything else starts.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(overlay) = app.get_webview_window(window::OVERLAY_LABEL) {
                let _ = overlay.show();
            }
        }))
        .invoke_handler(tauri::generate_handler![ipc::app_info])
        .setup(|app| {
            window::placement::place_top_center(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start NIMI");
}
