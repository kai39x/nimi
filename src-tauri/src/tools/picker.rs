//! «لاقط ألوان»: a borderless, nearly invisible window over the monitor under the cursor takes
//! the mouse; the page draws a loupe from `sample()` (11×11 screen pixels around the cursor read
//! with GDI) and a click copies the center color as `#RRGGBB`. The window is excluded from screen
//! capture (`WDA_EXCLUDEFROMCAPTURE`, Windows 10 2004+), so sampling sees what is under it.

use std::ffi::c_void;

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};
use windows::Win32::{
    Foundation::{HWND, POINT},
    Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, GetMonitorInfoW, MonitorFromPoint, ReleaseDC, SelectObject, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, MONITORINFO, MONITOR_DEFAULTTONEAREST, SRCCOPY,
    },
    UI::WindowsAndMessaging::{GetCursorPos, SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE},
};

use crate::ipc::{events, PickerSample};

pub const PICKER_LABEL: &str = "picker";
const SIZE: i32 = 11;

fn cursor() -> Option<POINT> {
    let mut p = POINT::default();
    // SAFETY: fills a POINT.
    unsafe { GetCursorPos(&mut p) }.ok().map(|_| p)
}

/// Physical rect (x, y, w, h) of the monitor under the cursor.
fn monitor_rect() -> Option<(i32, i32, i32, i32)> {
    let p = cursor()?;
    // SAFETY: monitor lookup and a plain struct fill.
    unsafe {
        let m = MonitorFromPoint(p, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        GetMonitorInfoW(m, &mut info).ok().ok()?;
        let r = info.rcMonitor;
        Some((r.left, r.top, r.right - r.left, r.bottom - r.top))
    }
}

fn place(win: &tauri::WebviewWindow) -> tauri::Result<()> {
    if let Some((x, y, w, h)) = monitor_rect() {
        win.set_position(PhysicalPosition::new(x, y))?;
        win.set_size(PhysicalSize::new(w as u32, h as u32))?;
    }
    Ok(())
}

pub fn open(app: &AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window(PICKER_LABEL)
        .ok_or("picker window missing")?;
    let err = |e: tauri::Error| e.to_string();
    place(&win).map_err(err)?;
    if let Ok(h) = win.hwnd() {
        // SAFETY: our own window; failure (older Windows) only means the loupe could see itself.
        unsafe {
            let _ = SetWindowDisplayAffinity(HWND(h.0), WDA_EXCLUDEFROMCAPTURE);
        }
    }
    crate::window::memory::set_low(&win, false);
    win.show().map_err(err)?;
    win.set_focus().map_err(err)?;
    let _ = win.emit("nimi://picker/open", ());
    Ok(())
}

pub fn follow(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(PICKER_LABEL) {
        let _ = place(&win);
    }
}

pub fn close(app: &AppHandle, hex: Option<String>) {
    if let Some(win) = app.get_webview_window(PICKER_LABEL) {
        let _ = win.hide();
        crate::window::memory::set_low(&win, true);
    }
    let _ = app.emit(events::PICKER_DONE, hex);
}

pub fn pick(app: &AppHandle) -> Option<String> {
    let hex = sample().map(|s| s.hex);
    if let Some(h) = hex.as_deref() {
        let _ = crate::files::shell::copy_text(h);
    }
    close(app, hex.clone());
    hex
}

/// 11×11 screen pixels centered on the cursor, RGB, row by row (top first).
pub fn sample() -> Option<PickerSample> {
    let p = cursor()?;
    let mut bgra = vec![0u8; (SIZE * SIZE * 4) as usize];
    // SAFETY: GDI copy of a tiny screen rect into our own bitmap; every object is released.
    unsafe {
        let screen = GetDC(None);
        let mem = CreateCompatibleDC(Some(screen));
        let bmp = CreateCompatibleBitmap(screen, SIZE, SIZE);
        let old = SelectObject(mem, bmp.into());
        let ok = BitBlt(
            mem,
            0,
            0,
            SIZE,
            SIZE,
            Some(screen),
            p.x - SIZE / 2,
            p.y - SIZE / 2,
            SRCCOPY,
        )
        .is_ok();
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: SIZE,
                biHeight: -SIZE, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let rows = GetDIBits(
            mem,
            bmp,
            0,
            SIZE as u32,
            Some(bgra.as_mut_ptr() as *mut c_void),
            &mut info,
            DIB_RGB_COLORS,
        );
        SelectObject(mem, old);
        let _ = DeleteObject(bmp.into());
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        if !ok || rows == 0 {
            return None;
        }
    }
    let rgb: Vec<u8> = bgra
        .chunks_exact(4)
        .flat_map(|px| [px[2], px[1], px[0]])
        .collect();
    let c = ((SIZE / 2) * SIZE + SIZE / 2) as usize * 3;
    Some(PickerSample {
        hex: format!("#{:02X}{:02X}{:02X}", rgb[c], rgb[c + 1], rgb[c + 2]),
        size: SIZE as u32,
        rgb,
    })
}
