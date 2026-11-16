//! «لقطة شاشة»: Windows' own region snip (`ms-screenclip:`, the Win+Shift+S overlay) puts the
//! picture on the clipboard. NIMI waits for it (two minutes at most) through the clipboard
//! listener, then saves it the way Kai chose (setting «وين تنحفظ اللقطة»): ask with a save dialog,
//! straight into a folder (default `Pictures\Screenshots`), or leave it on the clipboard only.
//! Snips taken with Win+Shift+S directly, not through NIMI, are left alone.

use std::{
    path::PathBuf,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter, Manager};
use windows::{
    core::HSTRING,
    Win32::{
        Foundation::HGLOBAL,
        System::{
            DataExchange::{
                GetClipboardData, IsClipboardFormatAvailable, RegisterClipboardFormatW,
            },
            Memory::{GlobalLock, GlobalSize, GlobalUnlock},
        },
        UI::Shell::FOLDERID_Pictures,
    },
};

use crate::{
    files,
    ipc::{events, ScreenshotSave},
    settings::SettingsStore,
};

const WAIT: Duration = Duration::from_secs(120);
/// `CF_DIB`.
const CF_DIB: u32 = 8;

static PENDING: Mutex<Option<Instant>> = Mutex::new(None);

/// Opens the snip and starts waiting for its picture.
pub fn start() -> Result<(), String> {
    *PENDING.lock().expect("snip lock") = Some(Instant::now());
    super::shell_open("ms-screenclip:", None)
}

/// Called by the clipboard listener with the clipboard open. Takes the picture when NIMI is
/// waiting for one: PNG bytes when the snip offers them, else a `.bmp` built from `CF_DIB`.
pub fn on_clipboard(app: &AppHandle) -> bool {
    {
        let mut pending = PENDING.lock().expect("snip lock");
        match *pending {
            Some(at) if at.elapsed() <= WAIT => {}
            Some(_) => {
                *pending = None;
                return false;
            }
            None => return false,
        }
    }
    let Some(image) = read_image() else {
        return false; // something else was copied meanwhile; keep waiting
    };
    *PENDING.lock().expect("snip lock") = None;
    let app = app.clone();
    // Saving may open a dialog: never on the clipboard thread.
    thread::spawn(move || save(&app, image));
    true
}

enum Image {
    Png(Vec<u8>),
    Dib(Vec<u8>),
}

fn global_bytes(format: u32) -> Option<Vec<u8>> {
    // SAFETY: the caller has the clipboard open; the block is only read between lock / unlock.
    unsafe {
        IsClipboardFormatAvailable(format).ok()?;
        let h = GetClipboardData(format).ok()?;
        let g = HGLOBAL(h.0);
        let p = GlobalLock(g) as *const u8;
        if p.is_null() {
            return None;
        }
        let bytes = std::slice::from_raw_parts(p, GlobalSize(g)).to_vec();
        let _ = GlobalUnlock(g);
        Some(bytes)
    }
}

fn read_image() -> Option<Image> {
    // SAFETY: registers (or looks up) the named format.
    let png = unsafe { RegisterClipboardFormatW(&HSTRING::from("PNG")) };
    global_bytes(png)
        .filter(|b| b.starts_with(b"\x89PNG"))
        .map(Image::Png)
        .or_else(|| {
            global_bytes(CF_DIB)
                .filter(|b| b.len() > 40)
                .map(Image::Dib)
        })
}

/// A BMP file around a packed DIB (file header + the clipboard bytes).
fn bmp_file(dib: &[u8]) -> Vec<u8> {
    let header = u32::from_le_bytes([dib[0], dib[1], dib[2], dib[3]]) as usize;
    let bits = u16::from_le_bytes([dib[14], dib[15]]);
    let compression = u32::from_le_bytes([dib[16], dib[17], dib[18], dib[19]]);
    let colors = u32::from_le_bytes([dib[32], dib[33], dib[34], dib[35]]) as usize;
    let palette = if bits <= 8 {
        (if colors == 0 { 1usize << bits } else { colors }) * 4
    } else if compression == 3 && header == 40 {
        12 // BI_BITFIELDS masks after a plain BITMAPINFOHEADER
    } else {
        0
    };
    let offset = 14 + header + palette;
    let mut out = Vec::with_capacity(14 + dib.len());
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&((14 + dib.len()) as u32).to_le_bytes());
    out.extend_from_slice(&[0, 0, 0, 0]);
    out.extend_from_slice(&(offset as u32).to_le_bytes());
    out.extend_from_slice(dib);
    out
}

/// `Pictures\Screenshots` (Windows' own folder for them).
pub fn default_folder() -> Option<PathBuf> {
    super::known_folder_id(&FOLDERID_Pictures).map(|p| p.join("Screenshots"))
}

fn save(app: &AppHandle, image: Image) {
    let settings = app.state::<SettingsStore>().get();
    if settings.screenshot_save == ScreenshotSave::ClipboardOnly {
        return;
    }
    let folder = Some(settings.screenshot_folder.trim())
        .filter(|f| !f.is_empty())
        .map(PathBuf::from)
        .filter(|f| f.is_dir())
        .or_else(default_folder);
    let Some(folder) = folder else {
        let _ = app.emit(events::SCREENSHOT_SAVED, Err::<String, _>("no-folder"));
        return;
    };
    let _ = std::fs::create_dir_all(&folder);
    let stem = format!("Screenshot {}", files::shell::local_stamp());
    let target = match settings.screenshot_save {
        ScreenshotSave::Folder => Some(files::unique(&folder, &stem, "png")),
        _ => files::shell::save_file(app, &folder, &format!("{stem}.png")),
    };
    let Some(target) = target else {
        return; // «إلغاء» in the dialog: the picture stays on the clipboard
    };
    let result = write(&image, &target);
    if let Err(err) = &result {
        log::warn!("screenshot: could not save {}: {err}", target.display());
    }
    let _ = app.emit(
        events::SCREENSHOT_SAVED,
        result.map(|()| target.to_string_lossy().into_owned()),
    );
}

/// PNG bytes are written as they are; anything else (a DIB, or JPG chosen in the dialog) goes
/// through the image pipeline.
fn write(image: &Image, target: &std::path::Path) -> Result<(), String> {
    let ext = files::imaging::ext_of(target);
    if let (Image::Png(bytes), "png") = (image, ext.as_str()) {
        return std::fs::write(target, bytes).map_err(|e| e.to_string());
    }
    let tmp = files::imaging::temp_file(match image {
        Image::Png(_) => "png",
        Image::Dib(_) => "bmp",
    });
    let raw = match image {
        Image::Png(b) => b.clone(),
        Image::Dib(d) => bmp_file(d),
    };
    std::fs::write(&tmp, raw).map_err(|e| e.to_string())?;
    let px = files::imaging::decode(&tmp, 1.0);
    let _ = std::fs::remove_file(&tmp);
    let fmt = if ext == "jpg" { "jpg" } else { "png" };
    files::imaging::encode(&px?, target, fmt)
}
