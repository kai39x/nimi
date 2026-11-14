//! Fullscreen auto-hide (design spec §3): once a second, ask Windows whether a fullscreen app
//! is running (`SHQueryUserNotificationState`) and check whether the foreground window covers
//! the monitor NIMI lives on. Either → hide; neither → show again.

use std::ffi::c_void;
use std::{mem::size_of, sync::atomic::Ordering, thread, time::Duration};

use tauri::AppHandle;
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

use super::{state, visibility};

const INTERVAL: Duration = Duration::from_secs(1);

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
                let fullscreen = detect(st.hwnd.load(Ordering::Relaxed));
                if st.fullscreen.swap(fullscreen, Ordering::Relaxed) != fullscreen {
                    visibility::sync(&app);
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
