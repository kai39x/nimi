//! Where the overlay lives: the chosen monitor's top edge, horizontally centered plus a
//! per-monitor offset the user set by dragging. All math is in physical pixels.

use tauri::{AppHandle, Manager, Monitor, PhysicalPosition};

use super::{refresh_geometry, CAPSULE_WIDTH, OVERLAY_LABEL, OVERLAY_SIZE};
use crate::{
    ipc::MonitorInfo,
    settings::{self, SettingsStore},
};

fn monitor_name(monitor: &Monitor) -> String {
    monitor
        .name()
        .cloned()
        .unwrap_or_else(|| "unknown".to_string())
}

/// The monitor from settings (`"primary"` or a name), falling back to primary, then to
/// whichever monitor the window is on now.
pub fn target_monitor(app: &AppHandle) -> tauri::Result<Option<Monitor>> {
    let overlay = app
        .get_webview_window(OVERLAY_LABEL)
        .ok_or(tauri::Error::WindowNotFound)?;
    let choice = app.state::<SettingsStore>().get().display;

    if choice != "primary" {
        if let Some(m) = overlay
            .available_monitors()?
            .into_iter()
            .find(|m| monitor_name(m) == choice)
        {
            return Ok(Some(m));
        }
    }
    Ok(overlay.primary_monitor()?.or(overlay.current_monitor()?))
}

fn window_width_px(scale: f64) -> i32 {
    (OVERLAY_SIZE.0 * scale).round() as i32
}

/// Physical x of the window when the capsule is exactly centered on `monitor`.
fn centered_x(monitor: &Monitor) -> i32 {
    monitor.position().x
        + (monitor.size().width as i32 - window_width_px(monitor.scale_factor())) / 2
}

/// Allowed window x range on `monitor`: the capsule itself must stay fully on screen, the
/// transparent margins of the window may hang off the edges.
fn x_bounds(monitor: &Monitor) -> (i32, i32) {
    let scale = monitor.scale_factor();
    let w = window_width_px(scale);
    let cap = (CAPSULE_WIDTH * scale).round() as i32;
    let min = monitor.position().x - (w - cap) / 2;
    let max = monitor.position().x + monitor.size().width as i32 - (w + cap) / 2;
    (min, max.max(min))
}

/// Moves the overlay to its resting place on the target monitor.
pub fn place(app: &AppHandle) -> tauri::Result<()> {
    let overlay = app
        .get_webview_window(OVERLAY_LABEL)
        .ok_or(tauri::Error::WindowNotFound)?;
    let Some(monitor) = target_monitor(app)? else {
        return Ok(());
    };

    let offset = app
        .state::<SettingsStore>()
        .get()
        .overlay_offsets
        .get(&monitor_name(&monitor))
        .copied()
        .unwrap_or(0);
    let (min, max) = x_bounds(&monitor);
    let x = (centered_x(&monitor) + (offset as f64 * monitor.scale_factor()).round() as i32)
        .clamp(min, max);

    overlay.set_position(PhysicalPosition::new(x, monitor.position().y))?;
    refresh_geometry(app);
    Ok(())
}

/// Clamps a proposed physical x (while dragging) to the target monitor's top edge.
pub fn clamp_x(app: &AppHandle, x: i32) -> i32 {
    match target_monitor(app) {
        Ok(Some(monitor)) => {
            let (min, max) = x_bounds(&monitor);
            x.clamp(min, max)
        }
        _ => x,
    }
}

/// Remembers the current physical x as a logical offset from the monitor's center.
pub fn persist_offset(app: &AppHandle, x: i32) {
    let Ok(Some(monitor)) = target_monitor(app) else {
        return;
    };
    let offset = ((x - centered_x(&monitor)) as f64 / monitor.scale_factor()).round() as i32;
    let name = monitor_name(&monitor);
    settings::update(app, move |s| {
        if offset == 0 {
            s.overlay_offsets.remove(&name);
        } else {
            s.overlay_offsets.insert(name, offset);
        }
    });
}

/// Forgets the offset for the current monitor and re-centers.
pub fn recenter(app: &AppHandle) -> tauri::Result<()> {
    if let Some(monitor) = target_monitor(app)? {
        let name = monitor_name(&monitor);
        settings::update(app, move |s| {
            s.overlay_offsets.remove(&name);
        });
    }
    place(app)
}

pub fn list_monitors(app: &AppHandle) -> tauri::Result<Vec<MonitorInfo>> {
    let overlay = app
        .get_webview_window(OVERLAY_LABEL)
        .ok_or(tauri::Error::WindowNotFound)?;
    let primary = overlay.primary_monitor()?.map(|m| monitor_name(&m));
    Ok(overlay
        .available_monitors()?
        .iter()
        .map(|m| {
            let name = monitor_name(m);
            MonitorInfo {
                is_primary: primary.as_deref() == Some(name.as_str()),
                width: m.size().width,
                height: m.size().height,
                scale: m.scale_factor(),
                name,
            }
        })
        .collect())
}
