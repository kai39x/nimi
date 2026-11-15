//! Fullscreen auto-hide (design spec §3): twice a second, ask Windows whether a fullscreen app
//! is running (`SHQueryUserNotificationState`) and check whether the foreground window covers
//! the monitor NIMI lives on. Either → hide; neither → show again.
//!
//! The same tick feeds peek mode (design/character/REFINEMENTS.md §1): a *maximized* foreground
//! window whose top edge (title bar / tab strip) lies under the capsule → `covered`, and the
//! frontend slides the capsule up so it stops blocking tabs.

use std::ffi::c_void;
use std::{mem::size_of, sync::atomic::Ordering, thread, time::Duration};

use tauri::{AppHandle, Emitter};
use windows::Win32::{
    Foundation::{HWND, RECT},
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
    UI::{
        Shell::{
            SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE,
            QUNS_RUNNING_D3D_FULL_SCREEN,
        },
        WindowsAndMessaging::{GetClassNameW, GetForegroundWindow, GetWindowRect, IsZoomed},
    },
};

use super::{state, visibility, Geometry, OVERLAY_SIZE};
use crate::ipc::events;

const INTERVAL: Duration = Duration::from_millis(500);
/// Logical zone around the capsule (window-relative) that a maximized window's top edge must
/// reach to count as "under the capsule": the widest capsule (size 96 → 222 px) plus margin.
const CAPSULE_ZONE_HALF_WIDTH: f64 = 125.0;
const CAPSULE_ZONE_BOTTOM: f64 = 70.0;

/// Shell windows that may legitimately cover a monitor (the desktop itself, the taskbar).
const SHELL_CLASSES: &[&str] = &[
    "Progman",
    "WorkerW",
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
];

pub fn spawn(app: AppHandle) {
    thread::Builder::new()
        .name("nimi-fullscreen".into())
        .spawn(move || {
            let st = state(&app);
            loop {
                let hwnd = st.hwnd.load(Ordering::Relaxed);
                let fullscreen = detect(hwnd);
                if st.fullscreen.swap(fullscreen, Ordering::Relaxed) != fullscreen {
                    visibility::sync(&app);
                }
                let geometry = *st.geometry.lock().expect("geometry lock");
                // While NIMI has the foreground (panel open) keep the last answer.
                if let Some(covered) = detect_covered(hwnd, geometry) {
                    if st.covered.swap(covered, Ordering::Relaxed) != covered {
                        let _ = app.emit(events::OVERLAY_COVERED, covered);
                    }
                }
                thread::sleep(INTERVAL);
            }
        })
        .expect("spawn fullscreen watcher");
}

fn class_name(hwnd: HWND) -> String {
    let mut buf = [0u16; 128];
    // SAFETY: valid buffer, length passed explicitly.
    let len = unsafe { GetClassNameW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..len.max(0) as usize])
}

fn detect(our_hwnd: isize) -> bool {
    // SAFETY: read-only Win32 queries; every pointer is a valid local.
    unsafe {
        if let Ok(s) = SHQueryUserNotificationState() {
            if matches!(
                s,
                QUNS_BUSY | QUNS_RUNNING_D3D_FULL_SCREEN | QUNS_PRESENTATION_MODE
            ) {
                return true;
            }
        }

        let fg = GetForegroundWindow();
        if fg.0.is_null() || fg.0 as isize == our_hwnd {
            return false;
        }
        if SHELL_CLASSES.contains(&class_name(fg).as_str()) {
            return false;
        }
        // A maximized window ends at the taskbar; only borderless/fullscreen windows cover it all.
        if IsZoomed(fg).as_bool() {
            return false;
        }

        let monitor = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
        let ours = MonitorFromWindow(HWND(our_hwnd as *mut c_void), MONITOR_DEFAULTTONEAREST);
        if monitor != ours {
            return false;
        }

        let mut rect = RECT::default();
        if GetWindowRect(fg, &mut rect).is_err() {
            return false;
        }
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return false;
        }
        let m = info.rcMonitor;
        rect.left <= m.left && rect.top <= m.top && rect.right >= m.right && rect.bottom >= m.bottom
    }
}

/// Is the foreground window maximized with its top edge under the capsule? `None` when the
/// foreground is NIMI itself (the panel is open), so the previous answer stands.
fn detect_covered(our_hwnd: isize, g: Geometry) -> Option<bool> {
    // SAFETY: read-only Win32 queries; every pointer is a valid local.
    unsafe {
        let fg = GetForegroundWindow();
        if fg.0.is_null() {
            return Some(false);
        }
        if fg.0 as isize == our_hwnd {
            return None;
        }
        if SHELL_CLASSES.contains(&class_name(fg).as_str()) || !IsZoomed(fg).as_bool() {
            return Some(false);
        }
        let monitor = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
        let ours = MonitorFromWindow(HWND(our_hwnd as *mut c_void), MONITOR_DEFAULTTONEAREST);
        if monitor != ours {
            return Some(false);
        }
        let mut rect = RECT::default();
        if GetWindowRect(fg, &mut rect).is_err() {
            return Some(false);
        }
        // The capsule zone in physical px: centered in the overlay window, at its top.
        let scale = if g.scale > 0.0 { g.scale } else { 1.0 };
        let cx = g.x as f64 + OVERLAY_SIZE.0 / 2.0 * scale;
        let (zl, zr) = (
            cx - CAPSULE_ZONE_HALF_WIDTH * scale,
            cx + CAPSULE_ZONE_HALF_WIDTH * scale,
        );
        let zb = g.y as f64 + CAPSULE_ZONE_BOTTOM * scale;
        Some((rect.left as f64) < zr && (rect.right as f64) > zl && (rect.top as f64) < zb)
    }
}
