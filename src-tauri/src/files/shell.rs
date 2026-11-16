//! Shell plumbing for feeding and the pocket: clipboard (files and text), the folder picker,
//! Explorer, a terminal, the Recycle Bin, moves, and dragging pocket files out to other apps.

use std::{
    ffi::c_void,
    mem::size_of,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
    sync::{atomic::Ordering, Arc},
    thread,
    time::Duration,
};

use tauri::AppHandle;
use windows::{
    core::{HSTRING, PCWSTR},
    Win32::{
        Foundation::{HANDLE, HGLOBAL, HWND, POINT},
        Storage::FileSystem::{MoveFileExW, MOVEFILE_COPY_ALLOWED, MOVEFILE_WRITE_THROUGH},
        System::{
            Com::{
                CoCreateInstance, CoInitializeEx, IDataObject, CLSCTX_INPROC_SERVER,
                COINIT_APARTMENTTHREADED, DVASPECT_CONTENT, FORMATETC, STGMEDIUM, STGMEDIUM_0,
                TYMED_HGLOBAL,
            },
            DataExchange::{
                CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW,
                SetClipboardData,
            },
            Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
            Ole::{CF_HDROP, CF_UNICODETEXT, DROPEFFECT_COPY, DROPEFFECT_LINK, DROPEFFECT_MOVE},
        },
        UI::Shell::{
            FileOpenDialog, IFileOpenDialog, IShellItem, SHCreateDataObject,
            SHCreateItemFromParsingName, SHDoDragDrop, SHFileOperationW, DROPFILES, FOF_ALLOWUNDO,
            FOF_NOCONFIRMATION, FOF_SILENT, FOF_WANTNUKEWARNING, FOS_FORCEFILESYSTEM,
            FOS_PICKFOLDERS, FO_DELETE, SHFILEOPSTRUCTW, SIGDN_FILESYSPATH,
        },
    },
};

use super::FilesShared;
use crate::window;

const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

// --- clipboard ---------------------------------------------------------------------------------

/// A movable global block holding `bytes`.
fn global(bytes: &[u8]) -> windows::core::Result<HGLOBAL> {
    // SAFETY: allocate, lock, copy, unlock; ownership passes to the clipboard / data object.
    unsafe {
        let h = GlobalAlloc(GMEM_MOVEABLE, bytes.len())?;
        let p = GlobalLock(h) as *mut u8;
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), p, bytes.len());
        let _ = GlobalUnlock(h);
        Ok(h)
    }
}

/// `DROPFILES` header + double-NUL-terminated wide paths (CF_HDROP).
fn hdrop_bytes(paths: &[String]) -> Vec<u8> {
    let header = DROPFILES {
        pFiles: size_of::<DROPFILES>() as u32,
        pt: POINT::default(),
        fNC: false.into(),
        fWide: true.into(),
    };
    let mut out = Vec::new();
    // SAFETY: DROPFILES is plain old data.
    out.extend_from_slice(unsafe {
        std::slice::from_raw_parts(&header as *const _ as *const u8, size_of::<DROPFILES>())
    });
    for p in paths {
        for u in p.encode_utf16().chain(Some(0)) {
            out.extend_from_slice(&u.to_le_bytes());
        }
    }
    out.extend_from_slice(&[0, 0]);
    out
}

fn with_clipboard(f: impl FnOnce() -> windows::core::Result<()>) -> windows::core::Result<()> {
    // The clipboard may be held by another app for a moment.
    for _ in 0..10 {
        // SAFETY: open / empty / close bracket the writes in `f`.
        unsafe {
            if OpenClipboard(None).is_ok() {
                let r = EmptyClipboard().and_then(|_| f());
                let _ = CloseClipboard();
                return r;
            }
        }
        thread::sleep(Duration::from_millis(30));
    }
    Err(windows::core::Error::from_thread())
}

/// Copy (or cut) files: paste them in Explorer or any app like a normal Ctrl+C / Ctrl+X.
pub fn copy_files(paths: &[String], cut: bool) -> windows::core::Result<()> {
    let drop = global(&hdrop_bytes(paths))?;
    let effect: u32 = if cut {
        DROPEFFECT_MOVE.0
    } else {
        DROPEFFECT_COPY.0 | DROPEFFECT_LINK.0
    };
    let effect_mem = global(&effect.to_le_bytes())?;
    with_clipboard(|| {
        // SAFETY: the clipboard takes ownership of both blocks.
        unsafe {
            SetClipboardData(u32::from(CF_HDROP.0), Some(HANDLE(drop.0)))?;
            let fmt = RegisterClipboardFormatW(&HSTRING::from("Preferred DropEffect"));
            SetClipboardData(fmt, Some(HANDLE(effect_mem.0)))?;
        }
        Ok(())
    })
}

pub fn copy_text(text: &str) -> windows::core::Result<()> {
    let mut bytes = Vec::new();
    for u in text.encode_utf16().chain(Some(0)) {
        bytes.extend_from_slice(&u.to_le_bytes());
    }
    let mem = global(&bytes)?;
    with_clipboard(|| {
        // SAFETY: the clipboard takes ownership of the block.
        unsafe { SetClipboardData(u32::from(CF_UNICODETEXT.0), Some(HANDLE(mem.0))) }.map(|_| ())
    })
}

// --- Explorer, terminal, picker ----------------------------------------------------------------

/// Explorer with `path` selected.
pub fn reveal(path: &str) -> std::io::Result<()> {
    if !Path::new(path).exists() {
        return Err(std::io::Error::new(std::io::ErrorKind::NotFound, "missing"));
    }
    // Paths cannot contain quotes on Windows, so this argument is safe to pass raw.
    Command::new("explorer.exe")
        .raw_arg(format!("/select,\"{path}\""))
        .spawn()
        .map(|_| ())
}

/// The default browser on an http(s) link (callers check the scheme with `link::parse`).
pub fn open_url(url: &str) -> windows::core::Result<()> {
    use windows::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
    // SAFETY: ShellExecute with an http(s) URL; >32 means success.
    let r = unsafe {
        ShellExecuteW(
            None,
            &HSTRING::from("open"),
            &HSTRING::from(url),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if r.0 as isize > 32 {
        Ok(())
    } else {
        Err(windows::core::Error::from_thread())
    }
}

/// The user's Desktop folder (may live in OneDrive).
pub fn desktop() -> Option<PathBuf> {
    use windows::Win32::{
        System::Com::CoTaskMemFree,
        UI::Shell::{FOLDERID_Desktop, SHGetKnownFolderPath, KF_FLAG_DEFAULT},
    };
    // SAFETY: known-folder lookup; the returned string is freed with CoTaskMemFree.
    unsafe {
        let p = SHGetKnownFolderPath(&FOLDERID_Desktop, KF_FLAG_DEFAULT, None).ok()?;
        let path = p.to_string().ok().map(PathBuf::from);
        CoTaskMemFree(Some(p.0 as *const c_void));
        path
    }
}

/// «2026-11-16 04-12» in local time, for file names.
pub fn local_stamp() -> String {
    // SAFETY: fills a plain struct.
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    format!(
        "{:04}-{:02}-{:02} {:02}-{:02}",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute
    )
}

/// Windows Terminal in `dir` when installed, else a Command Prompt there.
pub fn terminal(dir: &Path) -> std::io::Result<()> {
    let wt = std::env::var("LOCALAPPDATA")
        .map(|l| PathBuf::from(l).join("Microsoft\\WindowsApps\\wt.exe"));
    if let Some(wt) = wt.ok().filter(|p| p.exists()) {
        return Command::new(wt).arg("-d").arg(dir).spawn().map(|_| ());
    }
    Command::new("cmd.exe")
        .current_dir(dir)
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
        .map(|_| ())
}

/// The system folder picker, in front of everything; `None` when cancelled.
pub fn pick_folder(app: &AppHandle, start: Option<&Path>) -> Option<PathBuf> {
    let start = start.map(Path::to_path_buf);
    window::with_foreground(app, move |owner| {
        // The dialog needs its own STA thread with a message loop (Show() runs one).
        thread::spawn(move || {
            // SAFETY: COM on this thread only; the dialog is released before returning.
            unsafe {
                let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
                let dialog: IFileOpenDialog =
                    CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER).ok()?;
                let opts = dialog.GetOptions().ok()?;
                dialog
                    .SetOptions(opts | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM)
                    .ok()?;
                if let Some(dir) = start.filter(|d| d.is_dir()) {
                    if let Ok(item) = SHCreateItemFromParsingName::<_, _, IShellItem>(
                        &HSTRING::from(dir.as_os_str()),
                        None,
                    ) {
                        let _ = dialog.SetFolder(&item);
                    }
                }
                dialog.Show(Some(HWND(owner as *mut c_void))).ok()?;
                let item = dialog.GetResult().ok()?;
                let name = item.GetDisplayName(SIGDN_FILESYSPATH).ok()?;
                let path = name.to_string().ok();
                windows::Win32::System::Com::CoTaskMemFree(Some(name.0 as *const c_void));
                path.map(PathBuf::from)
            }
        })
        .join()
        .ok()
        .flatten()
    })
}

// --- move & recycle ----------------------------------------------------------------------------

/// Moves a file or folder; across drives Windows copies first and removes the original only
/// once the copy succeeded (folders cannot cross drives this way and fail cleanly).
pub fn move_path(from: &Path, to: &Path) -> windows::core::Result<()> {
    let (a, b) = (
        wide(&from.display().to_string()),
        wide(&to.display().to_string()),
    );
    // SAFETY: NUL-terminated paths that outlive the call.
    unsafe {
        MoveFileExW(
            PCWSTR(a.as_ptr()),
            PCWSTR(b.as_ptr()),
            MOVEFILE_COPY_ALLOWED | MOVEFILE_WRITE_THROUGH,
        )
    }
}

/// Sends paths to the Recycle Bin — never a silent permanent delete: if something is too big for
/// the bin, Windows asks first (`FOF_WANTNUKEWARNING`). Returns the paths that are still there.
pub fn recycle(paths: &[String]) -> Vec<String> {
    if paths.is_empty() {
        return vec![];
    }
    let mut from: Vec<u16> = Vec::new();
    for p in paths {
        from.extend(p.encode_utf16());
        from.push(0);
    }
    from.push(0);
    // SAFETY: the shell operation runs on this (COM-initialised) thread with buffers that outlive it.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let mut op = SHFILEOPSTRUCTW {
            wFunc: FO_DELETE,
            pFrom: PCWSTR(from.as_ptr()),
            fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_WANTNUKEWARNING | FOF_SILENT).0
                as u16,
            ..Default::default()
        };
        let _ = SHFileOperationW(&mut op);
    }
    paths
        .iter()
        .filter(|p| Path::new(p).exists())
        .cloned()
        .collect()
}

// --- drag out ----------------------------------------------------------------------------------

/// Starts a real OLE drag of `paths` from the overlay (pocket tray → Explorer, mail, any app).
/// Runs on the main thread, where OLE is initialised; returns once the drag has started.
pub fn drag_out(
    app: &AppHandle,
    shared: Arc<FilesShared>,
    paths: Vec<String>,
) -> Result<(), String> {
    if paths.is_empty() {
        return Err("nothing to drag".into());
    }
    if shared.dragging.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let owner = window::state(app).hwnd.load(Ordering::Relaxed);
    app.run_on_main_thread(move || {
        let r = (|| -> windows::core::Result<()> {
            // SAFETY: shell data object + standard drag loop on the OLE thread; the HGLOBAL is
            // handed to the data object (fRelease = true).
            unsafe {
                let data: IDataObject = SHCreateDataObject(None, None, None::<&IDataObject>)?;
                let fmt = FORMATETC {
                    cfFormat: CF_HDROP.0,
                    ptd: std::ptr::null_mut(),
                    dwAspect: DVASPECT_CONTENT.0,
                    lindex: -1,
                    tymed: TYMED_HGLOBAL.0 as u32,
                };
                let medium = STGMEDIUM {
                    tymed: TYMED_HGLOBAL.0 as u32,
                    u: STGMEDIUM_0 {
                        hGlobal: global(&hdrop_bytes(&paths))?,
                    },
                    pUnkForRelease: std::mem::ManuallyDrop::new(None),
                };
                data.SetData(&fmt, &medium, true)?;
                SHDoDragDrop(
                    Some(HWND(owner as *mut c_void)),
                    &data,
                    None,
                    DROPEFFECT_COPY | DROPEFFECT_MOVE | DROPEFFECT_LINK,
                )?;
            }
            Ok(())
        })();
        if let Err(e) = r {
            log::info!("pocket drag: {e}");
        }
        shared.dragging.store(false, Ordering::SeqCst);
    })
    .map_err(|e| e.to_string())
}
