//! A Win32 subclass on the overlay HWND: the one place that hears display, DPI and theme
//! changes. Tauri exposes none of these as events, hence the raw `SetWindowSubclass`.

use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        OnceLock,
    },
    thread,
    time::Duration,
};

use tauri::{AppHandle, WebviewWindow};
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        UI::{
            Shell::{DefSubclassProc, SetWindowSubclass},
            WindowsAndMessaging::{
                GetWindowLongPtrW, GWL_EXSTYLE, MA_NOACTIVATE, WM_DEVICECHANGE, WM_DISPLAYCHANGE,
                WM_DPICHANGED, WM_MOUSEACTIVATE, WM_SETTINGCHANGE, WS_EX_NOACTIVATE,
            },
        },
    },
};

use super::{placement, refresh_geometry};
use crate::tray;

static APP: OnceLock<AppHandle> = OnceLock::new();
static REPLACE_GENERATION: AtomicU64 = AtomicU64::new(0);
const SUBCLASS_ID: usize = 0x4E49_4D49; // "NIMI"
const REPLACE_DEBOUNCE: Duration = Duration::from_millis(400);

pub fn install(app: &AppHandle, overlay: &WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    let _ = APP.set(app.clone());
    let hwnd = overlay.hwnd()?;
    // SAFETY: called on the window's own (main) thread with a live HWND; the proc is 'static.
    let ok = unsafe { SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0) };
    if !ok.as_bool() {
        return Err("SetWindowSubclass failed".into());
    }
    Ok(())
}

/// While the panel is open the window is made focusable (WS_EX_NOACTIVATE cleared); then clicks
/// may activate it normally so typing and Esc work.
fn overlay_focusable(hwnd: HWND) -> bool {
    // SAFETY: plain style query on a live window handle.
    let ex = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    (ex as u32 & WS_EX_NOACTIVATE.0) == 0
}

/// Display topology changes arrive in bursts; re-place once they settle.
fn schedule_replace() {
    let generation = REPLACE_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    thread::spawn(move || {
        thread::sleep(REPLACE_DEBOUNCE);
        if REPLACE_GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }
        if let Some(app) = APP.get() {
            if let Err(err) = placement::place(app) {
                log::warn!("re-placing after display change failed: {err}");
            }
        }
    });
}

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    match msg {
        // Clicks on the capsule must never steal focus from the app underneath; keyboard focus is
        // requested explicitly when the panel or the command bar needs it.
        WM_MOUSEACTIVATE if !overlay_focusable(hwnd) => return LRESULT(MA_NOACTIVATE as isize),
        WM_DISPLAYCHANGE => schedule_replace(),
        // USB drives in / out (the overlay is a top-level window, so it gets the broadcast).
        WM_DEVICECHANGE => crate::notify::watch::on_device_change(wparam.0, lparam.0),
        // Windows resizes the window by the DPI ratio right after this message; once that is
        // done, put it back at its real size and centered position (placement::place).
        WM_DPICHANGED => {
            if let Some(app) = APP.get() {
                refresh_geometry(app);
            }
            schedule_replace();
        }
        WM_SETTINGCHANGE if lparam.0 != 0 => {
            // SAFETY: for WM_SETTINGCHANGE a non-null lParam is a NUL-terminated wide string.
            let section = unsafe { PCWSTR(lparam.0 as *const u16).to_string() };
            if matches!(section.as_deref(), Ok("ImmersiveColorSet")) {
                if let Some(app) = APP.get() {
                    tray::refresh_icon(app);
                }
            }
        }
        _ => {}
    }
    // SAFETY: forwarding to the original window procedure with the same arguments.
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}
