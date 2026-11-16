//! «ضغط» in the command bar zips what is selected in Explorer — the Explorer window that was in
//! front when NIMI took focus (`OverlayState::origin`). `IShellWindows` lists the open Explorer
//! windows; on Windows 11 every tab is its own entry with the same top-level HWND, so the tab
//! whose view is visible is the one in front.

use std::thread;

use windows::{
    core::Interface,
    Win32::{
        Foundation::HWND,
        System::{
            Com::{
                CoCreateInstance, CoInitializeEx, IServiceProvider, CLSCTX_ALL,
                COINIT_APARTMENTTHREADED,
            },
            Variant::VARIANT,
        },
        UI::{
            Shell::{
                IFolderView2, IShellBrowser, IShellWindows, IWebBrowser2, SID_STopLevelBrowser,
                ShellWindows, SIGDN_FILESYSPATH,
            },
            WindowsAndMessaging::{GetAncestor, IsWindowVisible, GA_ROOT},
        },
    },
};

/// Paths selected in the Explorer window `origin` (a top-level HWND as isize).
/// Errors: `no-explorer` (the window in front was not Explorer), `no-selection`.
pub fn selection(origin: isize) -> Result<Vec<String>, String> {
    if origin == 0 {
        return Err("no-explorer".into());
    }
    thread::spawn(move || read(origin))
        .join()
        .map_err(|_| "explorer".to_string())?
}

fn read(origin: isize) -> Result<Vec<String>, String> {
    // SAFETY: shell automation on this thread's own STA; all interfaces are ref-counted.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let windows: IShellWindows = CoCreateInstance(&ShellWindows, None, CLSCTX_ALL)
            .map_err(|e| e.message().to_string())?;
        let count = windows.Count().unwrap_or(0);
        let origin_root = GetAncestor(HWND(origin as *mut _), GA_ROOT);
        let mut found_window = false;
        for i in 0..count {
            let Ok(disp) = windows.Item(&VARIANT::from(i)) else {
                continue;
            };
            let Ok(browser) = disp.cast::<IWebBrowser2>() else {
                continue;
            };
            let Ok(h) = browser.HWND() else {
                continue;
            };
            if h.0 != origin && HWND(h.0 as *mut _) != origin_root {
                continue;
            }
            found_window = true;
            let Ok(sp) = browser.cast::<IServiceProvider>() else {
                continue;
            };
            let Ok(shell) = sp.QueryService::<IShellBrowser>(&SID_STopLevelBrowser) else {
                continue;
            };
            let Ok(view) = shell.QueryActiveShellView() else {
                continue;
            };
            // Windows 11 tabs share the window; only the active tab's view is visible.
            if let Ok(vw) = view.GetWindow() {
                if !IsWindowVisible(vw).as_bool() {
                    continue;
                }
            }
            let Ok(folder_view) = view.cast::<IFolderView2>() else {
                continue;
            };
            let Ok(items) = folder_view.GetSelection(false) else {
                return Err("no-selection".into());
            };
            let n = items.GetCount().unwrap_or(0);
            let mut paths = Vec::new();
            for j in 0..n {
                let Ok(item) = items.GetItemAt(j) else {
                    continue;
                };
                if let Ok(p) = item.GetDisplayName(SIGDN_FILESYSPATH) {
                    if let Ok(s) = p.to_string() {
                        paths.push(s);
                    }
                    windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as *const _));
                }
            }
            return if paths.is_empty() {
                Err("no-selection".into())
            } else {
                Ok(paths)
            };
        }
        Err(if found_window {
            "no-selection"
        } else {
            "no-explorer"
        }
        .into())
    }
}
