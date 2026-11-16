//! Fullscreen auto-hide (design spec §3): twice a second, ask Windows whether an exclusive
//! fullscreen app or presentation mode is on (`SHQueryUserNotificationState`), and whether the
//! foreground window — a real, visible app window — covers the monitor NIMI lives on. Either →
//! hide; neither → show again. Every change is logged with the window that caused it.
//!
//! Not "fullscreen": the desktop and taskbar, invisible (cloaked) or minimized windows, click-
//! through overlays (NVIDIA, Discord…), NIMI's own windows, and `QUNS_BUSY` on its own — Windows
//! reports that in some desktop states (Kai saw NIMI vanish on the bare desktop, 2026-11-16).
//!
//! The same tick feeds peek mode (design/character/REFINEMENTS.md §1): a *maximized* foreground
//! window whose top edge (title bar / tab strip) lies under the capsule → `covered`, and the
//! frontend slides the capsule up so it stops blocking tabs.

use std::ffi::c_void;
use std::{mem::size_of, sync::atomic::Ordering, thread, time::Duration};

use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongW, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
    GWL_EXSTYLE, WS_EX_TRANSPARENT,
};

use tauri::{AppHandle, Emitter};
use windows::Win32::{
    Foundation::{HWND, RECT},
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
    UI::{
        Shell::{
            SHQueryUserNotificationState, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
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
                let verdict = detect(hwnd);
                if st.fullscreen.swap(verdict.hide, Ordering::Relaxed) != verdict.hide {
                    log::info!(
                        "fullscreen auto-hide: {} — {}",
                        if verdict.hide { "hide" } else { "show" },
                        verdict.why
                    );
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

/// Whether to hide, and why (for the log).
struct Verdict {
    hide: bool,
    why: String,
}

impl Verdict {
    fn show(why: impl Into<String>) -> Self {
        Self {
            hide: false,
            why: why.into(),
        }
    }
}

fn detect(our_hwnd: isize) -> Verdict {
    // SAFETY: read-only Win32 queries; every pointer is a valid local.
    unsafe {
        let quns = SHQueryUserNotificationState().ok();
        if let Some(s) = quns {
            if matches!(s, QUNS_RUNNING_D3D_FULL_SCREEN | QUNS_PRESENTATION_MODE) {
                return Verdict {
                    hide: true,
                    why: format!(
                        "Windows reports exclusive fullscreen / presentation (QUNS {})",
                        s.0
                    ),
                };
            }
        }

        let fg = GetForegroundWindow();
        if fg.0.is_null() {
            return Verdict::show("no foreground window");
        }
        if fg.0 as isize == our_hwnd || window_pid(fg) == std::process::id() {
            return Verdict::show("NIMI itself is in front");
        }
        let class = class_name(fg);
        let about = describe(fg, &class);
        if SHELL_CLASSES.contains(&class.as_str()) {
            return Verdict::show(format!("desktop / taskbar in front: {about}"));
        }
        if !IsWindowVisible(fg).as_bool() || IsIconic(fg).as_bool() || is_cloaked(fg) {
            return Verdict::show(format!(
                "foreground is invisible, cloaked or minimized: {about}"
            ));
        }
        if (GetWindowLongW(fg, GWL_EXSTYLE) as u32) & WS_EX_TRANSPARENT.0 != 0 {
            return Verdict::show(format!("foreground is a click-through overlay: {about}"));
        }
        // A maximized window ends at the taskbar; only borderless/fullscreen windows cover it all.
        if IsZoomed(fg).as_bool() {
            return Verdict::show(format!("maximized, not fullscreen: {about}"));
        }

        let monitor = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
        let ours = MonitorFromWindow(HWND(our_hwnd as *mut c_void), MONITOR_DEFAULTTONEAREST);
        if monitor != ours {
            return Verdict::show(format!("on another monitor: {about}"));
        }

        let mut rect = RECT::default();
        if GetWindowRect(fg, &mut rect).is_err() {
            return Verdict::show("foreground rect unavailable");
        }
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return Verdict::show("monitor info unavailable");
        }
        let m = info.rcMonitor;
        let covers = rect.left <= m.left
            && rect.top <= m.top
            && rect.right >= m.right
            && rect.bottom >= m.bottom;
        Verdict {
            hide: covers,
            why: format!(
                "{} the monitor ({}x{}), QUNS {:?}: {about} rect {},{},{},{}",
                if covers { "covers" } else { "does not cover" },
                m.right - m.left,
                m.bottom - m.top,
                quns.map(|q| q.0),
                rect.left,
                rect.top,
                rect.right,
                rect.bottom
            ),
        }
    }
}

fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked: u32 = 0;
    // SAFETY: DWMWA_CLOAKED writes one u32 into the provided buffer.
    let ok = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut c_void,
            size_of::<u32>() as u32,
        )
    };
    ok.is_ok() && cloaked != 0
}

fn window_pid(hwnd: HWND) -> u32 {
    let mut pid = 0u32;
    // SAFETY: plain query with a valid out-pointer.
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    pid
}

/// `class "title" (app.exe)` for the log.
fn describe(hwnd: HWND, class: &str) -> String {
    let mut title = [0u16; 96];
    // SAFETY: valid buffer, length passed explicitly.
    let len = unsafe { GetWindowTextW(hwnd, &mut title) };
    let title = String::from_utf16_lossy(&title[..len.max(0) as usize]);
    format!(
        "class {class} \"{title}\" ({})",
        process_name(window_pid(hwnd))
    )
}

fn process_name(pid: u32) -> String {
    // SAFETY: limited-information handle, closed below; buffer length passed explicitly.
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return format!("pid {pid}");
        };
        let mut buf = [0u16; 260];
        let mut len = buf.len() as u32;
        let name = if QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut len,
        )
        .is_ok()
        {
            let full = String::from_utf16_lossy(&buf[..len as usize]);
            full.rsplit('\\').next().unwrap_or(&full).to_string()
        } else {
            format!("pid {pid}")
        };
        let _ = CloseHandle(handle);
        name
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
