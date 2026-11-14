use tauri::{AppHandle, Manager, PhysicalPosition, Runtime};

/// Moves the overlay to the top-center of the primary monitor (physical pixels, so it is
/// correct under any DPI scale) and shows it. The window starts hidden to avoid a flash at
/// the wrong position.
pub fn place_top_center<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    let overlay = app
        .get_webview_window(super::OVERLAY_LABEL)
        .ok_or("overlay window is missing from tauri.conf.json")?;

    let monitor = overlay
        .primary_monitor()?
        .or(overlay.current_monitor()?)
        .ok_or("no monitor found")?;

    let size = overlay.outer_size()?;
    let x = monitor.position().x + (monitor.size().width as i32 - size.width as i32) / 2;
    let y = monitor.position().y;

    overlay.set_position(PhysicalPosition::new(x, y))?;
    overlay.show()?;
    Ok(())
}
