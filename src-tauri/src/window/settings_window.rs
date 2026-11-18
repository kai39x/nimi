//! The settings window: an ordinary centered glass window (frameless, transparent). It is
//! declared in `tauri.conf.json` and created hidden at startup, so opening it is instant and
//! closing it only hides it (see `on_window_event` in `lib.rs`).

use tauri::{AppHandle, Manager};

use super::SETTINGS_LABEL;

pub fn open(app: &AppHandle) -> tauri::Result<()> {
    let window = app
        .get_webview_window(SETTINGS_LABEL)
        .ok_or(tauri::Error::WindowNotFound)?;
    if !window.is_visible()? {
        window.center()?;
    }
    super::memory::set_low(&window, false);
    window.unminimize()?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}
