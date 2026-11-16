//! The overlay's own OLE drop target.
//!
//! wry registers an `IDropTarget` on the WebView2 child windows that only accepts `CF_HDROP`
//! (files) and refuses everything else, so a link or a text selection dragged from a browser
//! never reached NIMI. We replace it (Revoke + Register on the same child windows, on the main
//! thread right after the webview exists) with one that reads files, links and text and emits
//! them as `nimi://drop` ([`DropEvent`]). The frontend's feeding flow listens to that instead of
//! Tauri's `onDragDropEvent`.
//!
//! Safety: the effect we report is COPY (or LINK) — never MOVE — so a source like Word or a text
//! editor never deletes what was dragged out of it. Our own pocket drag-out is ignored.

use std::{
    cell::{Cell, RefCell},
    ffi::c_void,
    sync::{atomic::Ordering, Arc},
};

use tauri::{AppHandle, Emitter, Manager};
use windows::{
    core::{implement, w, Ref, Result, BOOL},
    Win32::{
        Foundation::{HWND, LPARAM, POINT, POINTL},
        Graphics::Gdi::ScreenToClient,
        System::{
            Com::{IDataObject, DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL},
            DataExchange::RegisterClipboardFormatW,
            Memory::{GlobalLock, GlobalSize, GlobalUnlock},
            Ole::{
                IDropTarget, IDropTarget_Impl, RegisterDragDrop, ReleaseStgMedium, RevokeDragDrop,
                CF_HDROP, CF_UNICODETEXT, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_LINK,
                DROPEFFECT_NONE,
            },
            SystemServices::MODIFIERKEYS_FLAGS,
        },
        UI::{
            Shell::{
                DragQueryFileW, IShellItemArray, SHCreateShellItemArrayFromDataObject, HDROP,
                SIGDN_FILESYSPATH,
            },
            WindowsAndMessaging::EnumChildWindows,
        },
    },
};

use super::FilesShared;
use crate::{
    ipc::{events, DropEvent, DropKind},
    window,
};

thread_local! {
    /// Our targets live on the main (OLE) thread for the life of the app.
    static TARGETS: RefCell<Vec<IDropTarget>> = const { RefCell::new(Vec::new()) };
}

/// Puts our drop target on the overlay's WebView2 child windows. Safe to call again: it simply
/// re-registers (WebView2 may create its input window a little after the controller).
pub fn install(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let hwnd = window::state(&handle).hwnd.load(Ordering::Relaxed);
        if hwnd == 0 {
            return;
        }
        let mut children: Vec<HWND> = Vec::new();
        unsafe extern "system" fn collect(child: HWND, lparam: LPARAM) -> BOOL {
            // SAFETY: lparam is the &mut Vec passed below, alive for the EnumChildWindows call.
            let list = unsafe { &mut *(lparam.0 as *mut Vec<HWND>) };
            list.push(child);
            true.into()
        }
        // SAFETY: plain enumeration of our own window's children.
        unsafe {
            let _ = EnumChildWindows(
                Some(HWND(hwnd as *mut c_void)),
                Some(collect),
                LPARAM(&mut children as *mut _ as isize),
            );
        }
        let mut count = 0;
        TARGETS.with(|targets| {
            let mut targets = targets.borrow_mut();
            targets.clear();
            for child in children {
                let target: IDropTarget = Target::new(handle.clone(), child).into();
                // SAFETY: main thread, OLE initialised by wry; the child belongs to our process.
                unsafe {
                    let _ = RevokeDragDrop(child);
                    if RegisterDragDrop(child, &target).is_ok() {
                        targets.push(target);
                        count += 1;
                    }
                }
            }
        });
        log::info!("drop target on {count} webview window(s)");
    });
}

#[implement(IDropTarget)]
struct Target {
    app: AppHandle,
    hwnd: HWND,
    active: Cell<bool>,
    effect: Cell<DROPEFFECT>,
    last: Cell<(i32, i32)>,
}

impl Target {
    fn new(app: AppHandle, hwnd: HWND) -> Self {
        Self {
            app,
            hwnd,
            active: Cell::new(false),
            effect: Cell::new(DROPEFFECT_NONE),
            last: Cell::new((i32::MIN, i32::MIN)),
        }
    }

    fn client(&self, pt: &POINTL) -> (i32, i32) {
        let mut p = POINT { x: pt.x, y: pt.y };
        // SAFETY: our own child window.
        let _ = unsafe { ScreenToClient(self.hwnd, &mut p) };
        (p.x, p.y)
    }

    fn emit(&self, kind: DropKind, paths: Vec<String>, text: Option<String>, at: (i32, i32)) {
        let _ = self.app.emit(
            events::DROP,
            DropEvent {
                kind,
                paths,
                text,
                x: at.0,
                y: at.1,
            },
        );
    }

    fn own_drag(&self) -> bool {
        self.app
            .try_state::<Arc<FilesShared>>()
            .is_some_and(|s| s.dragging.load(Ordering::SeqCst))
    }
}

/// COPY when the source allows it, else LINK; never MOVE (the source would delete its copy).
fn pick(allowed: DROPEFFECT) -> DROPEFFECT {
    if allowed.0 & DROPEFFECT_COPY.0 != 0 {
        DROPEFFECT_COPY
    } else if allowed.0 & DROPEFFECT_LINK.0 != 0 {
        DROPEFFECT_LINK
    } else {
        DROPEFFECT_NONE
    }
}

#[allow(non_snake_case)]
impl IDropTarget_Impl for Target_Impl {
    fn DragEnter(
        &self,
        data: Ref<'_, IDataObject>,
        _keys: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> Result<()> {
        self.active.set(false);
        self.effect.set(DROPEFFECT_NONE);
        let (paths, text) = data.as_ref().map(read).unwrap_or_default();
        // SAFETY: OLE passes a valid out pointer.
        let allowed = unsafe { *effect };
        let fx = if self.own_drag() || (paths.is_empty() && text.is_none()) {
            DROPEFFECT_NONE
        } else {
            pick(allowed)
        };
        unsafe { *effect = fx };
        if fx == DROPEFFECT_NONE {
            return Ok(());
        }
        self.active.set(true);
        self.effect.set(fx);
        let at = self.client(pt);
        self.last.set(at);
        self.emit(DropKind::Enter, paths, text, at);
        Ok(())
    }

    fn DragOver(
        &self,
        _keys: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> Result<()> {
        // SAFETY: OLE passes a valid out pointer.
        unsafe { *effect = self.effect.get() };
        if self.active.get() {
            let at = self.client(pt);
            if at != self.last.get() {
                self.last.set(at);
                self.emit(DropKind::Over, vec![], None, at);
            }
        }
        Ok(())
    }

    fn DragLeave(&self) -> Result<()> {
        if self.active.replace(false) {
            self.emit(DropKind::Leave, vec![], None, self.last.get());
        }
        Ok(())
    }

    fn Drop(
        &self,
        data: Ref<'_, IDataObject>,
        _keys: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> Result<()> {
        if !self.active.replace(false) {
            // SAFETY: OLE passes a valid out pointer.
            unsafe { *effect = DROPEFFECT_NONE };
            return Ok(());
        }
        let (paths, text) = data.as_ref().map(read).unwrap_or_default();
        // SAFETY: as above.
        unsafe { *effect = self.effect.get() };
        self.emit(DropKind::Drop, paths, text, self.client(pt));
        Ok(())
    }
}

/// Files first; else a link («UniformResourceLocatorW», browsers); else plain text.
fn read(data: &IDataObject) -> (Vec<String>, Option<String>) {
    let paths = files(data);
    if !paths.is_empty() {
        return (paths, None);
    }
    // SAFETY: registering a well-known clipboard format name.
    let url_format = unsafe { RegisterClipboardFormatW(w!("UniformResourceLocatorW")) } as u16;
    let text = global_text(data, url_format)
        .or_else(|| global_text(data, CF_UNICODETEXT.0))
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());
    (vec![], text)
}

fn format(cf: u16) -> FORMATETC {
    FORMATETC {
        cfFormat: cf,
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
    }
}

fn files(data: &IDataObject) -> Vec<String> {
    let mut out = Vec::new();
    // SAFETY: standard CF_HDROP read; the medium is released after use.
    unsafe {
        if let Ok(mut medium) = data.GetData(&format(CF_HDROP.0)) {
            let hdrop = HDROP(medium.u.hGlobal.0);
            let n = DragQueryFileW(hdrop, u32::MAX, None);
            for i in 0..n {
                let len = DragQueryFileW(hdrop, i, None) as usize;
                let mut buf = vec![0u16; len + 1];
                DragQueryFileW(hdrop, i, Some(&mut buf));
                out.push(String::from_utf16_lossy(&buf[..len]));
            }
            ReleaseStgMedium(&mut medium);
            return out;
        }
        // Explorer can't build CF_HDROP for some paths (very long ones): ask the shell instead.
        if let Ok(items) = SHCreateShellItemArrayFromDataObject::<_, IShellItemArray>(data) {
            let n = items.GetCount().unwrap_or(0);
            for i in 0..n {
                let Ok(item) = items.GetItemAt(i) else {
                    continue;
                };
                if let Ok(name) = item.GetDisplayName(SIGDN_FILESYSPATH) {
                    if let Ok(path) = name.to_string() {
                        out.push(path);
                    }
                    windows::Win32::System::Com::CoTaskMemFree(Some(name.0 as *const c_void));
                }
            }
        }
    }
    out
}

fn global_text(data: &IDataObject, cf: u16) -> Option<String> {
    // SAFETY: locked HGLOBAL read as UTF-16 up to its size or the first NUL; released after.
    unsafe {
        let mut medium = data.GetData(&format(cf)).ok()?;
        let h = medium.u.hGlobal;
        let ptr = GlobalLock(h) as *const u16;
        let text = if ptr.is_null() {
            None
        } else {
            let units = GlobalSize(h) / 2;
            let slice = std::slice::from_raw_parts(ptr, units);
            let end = slice.iter().position(|&c| c == 0).unwrap_or(units);
            Some(String::from_utf16_lossy(&slice[..end]))
        };
        let _ = GlobalUnlock(h);
        ReleaseStgMedium(&mut medium);
        text
    }
}
