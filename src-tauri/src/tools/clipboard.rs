//! «سجل الحافظة»: the last copied texts, newest first, in memory only (never written to disk;
//! gone when NIMI quits). A message-only window listens with `AddClipboardFormatListener`.
//! Content that asks not to be recorded is skipped — password managers mark their copies with
//! `ExcludeClipboardContentFromMonitorProcessing` / `CanIncludeInClipboardHistory = 0`, the same
//! flags Windows' own clipboard history honours.

use std::{
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::Duration,
};

use tauri::{AppHandle, Emitter, Manager};
use windows::{
    core::{w, HSTRING},
    Win32::{
        Foundation::{HANDLE, HGLOBAL, HWND, LPARAM, LRESULT, WPARAM},
        System::{
            DataExchange::{
                AddClipboardFormatListener, CloseClipboard, GetClipboardData,
                IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW,
            },
            LibraryLoader::GetModuleHandleW,
            Memory::{GlobalLock, GlobalSize, GlobalUnlock},
            Ole::CF_UNICODETEXT,
        },
        UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW,
            HWND_MESSAGE, MSG, WINDOW_EX_STYLE, WINDOW_STYLE, WM_CLIPBOARDUPDATE, WNDCLASSW,
        },
    },
};

use super::now_ms;
use crate::{
    ipc::{events, ClipItem},
    settings::SettingsStore,
};

const MAX_ITEMS: usize = 30;
/// Longer texts are kept whole up to this many UTF-16 units; anything bigger is skipped.
const MAX_LEN: usize = 200_000;

#[derive(Default)]
pub struct ClipShared {
    items: Mutex<Vec<ClipItem>>,
}

static APP: OnceLock<AppHandle> = OnceLock::new();

fn shared(app: &AppHandle) -> Arc<ClipShared> {
    app.state::<Arc<ClipShared>>().inner().clone()
}

pub fn spawn(app: &AppHandle) {
    app.manage(Arc::new(ClipShared::default()));
    let _ = APP.set(app.clone());
    thread::Builder::new()
        .name("nimi-clipboard".into())
        .spawn(|| {
            // SAFETY: a message-only window owned by this thread, with a plain message loop.
            unsafe {
                let Ok(module) = GetModuleHandleW(None) else {
                    return;
                };
                let class = w!("NimiClipboardListener");
                let wc = WNDCLASSW {
                    lpfnWndProc: Some(wndproc),
                    hInstance: module.into(),
                    lpszClassName: class,
                    ..Default::default()
                };
                RegisterClassW(&wc);
                let Ok(hwnd) = CreateWindowExW(
                    WINDOW_EX_STYLE(0),
                    class,
                    w!(""),
                    WINDOW_STYLE(0),
                    0,
                    0,
                    0,
                    0,
                    Some(HWND_MESSAGE),
                    None,
                    Some(module.into()),
                    None,
                ) else {
                    log::warn!("clipboard: no listener window");
                    return;
                };
                if let Err(err) = AddClipboardFormatListener(hwnd) {
                    log::warn!("clipboard: listener refused: {err}");
                    return;
                }
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    DispatchMessageW(&msg);
                }
            }
        })
        .expect("spawn clipboard thread");
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    if msg == WM_CLIPBOARDUPDATE {
        if let Some(app) = APP.get() {
            on_change(hwnd, app);
        }
        return LRESULT(0);
    }
    // SAFETY: default handling for everything else.
    unsafe { DefWindowProcW(hwnd, msg, wp, lp) }
}

fn on_change(hwnd: HWND, app: &AppHandle) {
    // A snip NIMI asked for is saved, not remembered as text.
    if with_clipboard(hwnd, || super::screenshot::on_clipboard(app)).unwrap_or(false) {
        return;
    }
    if !app.state::<SettingsStore>().get().clipboard_history {
        return;
    }
    let Some(text) = read_text(hwnd) else {
        return;
    };
    if text.trim().is_empty() {
        return;
    }
    let sh = shared(app);
    let snapshot = {
        let mut items = sh.items.lock().expect("clip lock");
        items.retain(|i| i.text != text);
        let id = items.iter().map(|i| i.id).max().unwrap_or(0) + 1;
        items.insert(
            0,
            ClipItem {
                id,
                text,
                at_ms: now_ms(),
            },
        );
        items.truncate(MAX_ITEMS);
        items.clone()
    };
    let _ = app.emit(events::CLIPBOARD_CHANGED, &snapshot);
}

/// Runs `f` with the clipboard open (retried briefly: it can be busy right after a change).
fn with_clipboard<T>(hwnd: HWND, f: impl FnOnce() -> T) -> Option<T> {
    // SAFETY: open / close the clipboard on this thread around `f`.
    unsafe {
        if !(0..10).any(|i| {
            if i > 0 {
                thread::sleep(Duration::from_millis(15));
            }
            OpenClipboard(Some(hwnd)).is_ok()
        }) {
            return None;
        }
        let out = f();
        let _ = CloseClipboard();
        Some(out)
    }
}

fn format(name: &str) -> u32 {
    // SAFETY: registers (or looks up) a named clipboard format.
    unsafe { RegisterClipboardFormatW(&HSTRING::from(name)) }
}

/// The clipboard's text, unless it is private or not text. The clipboard may be busy for a
/// moment right after a change, so opening is retried briefly.
fn read_text(hwnd: HWND) -> Option<String> {
    // SAFETY: open / read / close the clipboard on this thread; the global block is only read
    // between GlobalLock and GlobalUnlock and never freed (the clipboard owns it).
    unsafe {
        if !(0..10).any(|i| {
            if i > 0 {
                thread::sleep(Duration::from_millis(15));
            }
            OpenClipboard(Some(hwnd)).is_ok()
        }) {
            return None;
        }
        let text = (|| {
            if IsClipboardFormatAvailable(format("ExcludeClipboardContentFromMonitorProcessing"))
                .is_ok()
                || IsClipboardFormatAvailable(format("Clipboard Viewer Ignore")).is_ok()
            {
                return None;
            }
            let can_include = format("CanIncludeInClipboardHistory");
            if IsClipboardFormatAvailable(can_include).is_ok() {
                if let Ok(h) = GetClipboardData(can_include) {
                    let p = GlobalLock(HGLOBAL(h.0)) as *const u32;
                    let allowed = p.is_null() || *p != 0;
                    let _ = GlobalUnlock(HGLOBAL(h.0));
                    if !allowed {
                        return None;
                    }
                }
            }
            IsClipboardFormatAvailable(CF_UNICODETEXT.0 as u32).ok()?;
            let h: HANDLE = GetClipboardData(CF_UNICODETEXT.0 as u32).ok()?;
            let g = HGLOBAL(h.0);
            let p = GlobalLock(g) as *const u16;
            if p.is_null() {
                return None;
            }
            let max = GlobalSize(g) / 2;
            let len = (0..max).take_while(|&i| *p.add(i) != 0).count();
            let out = (len <= MAX_LEN)
                .then(|| String::from_utf16_lossy(std::slice::from_raw_parts(p, len)));
            let _ = GlobalUnlock(g);
            out
        })();
        let _ = CloseClipboard();
        text
    }
}

pub fn list(app: &AppHandle) -> Vec<ClipItem> {
    shared(app).items.lock().expect("clip lock").clone()
}

pub fn copy(app: &AppHandle, id: u64) -> Result<(), String> {
    let text = list(app)
        .into_iter()
        .find(|i| i.id == id)
        .map(|i| i.text)
        .ok_or("missing")?;
    // The listener sees the change and moves the entry to the top.
    crate::files::shell::copy_text(&text).map_err(|e| e.message().to_string())
}

fn set(app: &AppHandle, f: impl FnOnce(&mut Vec<ClipItem>)) -> Vec<ClipItem> {
    let sh = shared(app);
    let snapshot = {
        let mut items = sh.items.lock().expect("clip lock");
        f(&mut items);
        items.clone()
    };
    let _ = app.emit(events::CLIPBOARD_CHANGED, &snapshot);
    snapshot
}

pub fn remove(app: &AppHandle, id: u64) -> Vec<ClipItem> {
    set(app, |items| items.retain(|i| i.id != id))
}

pub fn clear(app: &AppHandle) -> Vec<ClipItem> {
    set(app, Vec::clear)
}
