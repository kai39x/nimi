//! The user's processes: exe, path, private memory, CPU time, and a readable name. Shared by the
//! stats sampler (top consumer) and Boost (heavy background apps). Only the current Windows
//! session, never anything under the Windows folder, never NIMI itself.

use std::{collections::HashMap, ffi::c_void, mem::size_of, path::Path, sync::Mutex};

use crate::ipc::AppCategory;

use windows::{
    core::{PCWSTR, PWSTR},
    Win32::{
        Foundation::{CloseHandle, FILETIME, HANDLE, HWND, LPARAM},
        Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED},
        Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            },
            ProcessStatus::{
                K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX,
            },
            RemoteDesktop::ProcessIdToSessionId,
            Threading::{
                GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
                PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
            },
        },
        UI::WindowsAndMessaging::{
            EnumWindows, GetWindow, GetWindowThreadProcessId, IsWindowVisible, GW_OWNER,
        },
    },
};

/// Processes that belong to Windows or to NIMI and are never shown or closed, even outside the
/// Windows folder.
const NEVER: &[&str] = &[
    "explorer.exe",
    "nimi.exe",
    "msedgewebview2.exe",
    "searchhost.exe",
    "startmenuexperiencehost.exe",
    "shellexperiencehost.exe",
    "textinputhost.exe",
    "widgets.exe",
    "widgetservice.exe",
    "runtimebroker.exe",
    "applicationframehost.exe",
    "systemsettings.exe",
    "securityhealthsystray.exe",
    "ctfmon.exe",
    "sihost.exe",
    "taskhostw.exe",
    "dllhost.exe",
    "conhost.exe",
    "smartscreen.exe",
    "lockapp.exe",
];

const BROWSERS: &[&str] = &[
    "chrome.exe",
    "msedge.exe",
    "brave.exe",
    "firefox.exe",
    "opera.exe",
    "opera_gx.exe",
    "vivaldi.exe",
    "arc.exe",
    "zen.exe",
    "librewolf.exe",
    "waterfox.exe",
    "floorp.exe",
    "thorium.exe",
    "yandex.exe",
];

/// Game launchers and their helpers: safe to close in the background, ticked by default.
const LAUNCHERS: &[&str] = &[
    "steam.exe",
    "steamwebhelper.exe",
    "epicgameslauncher.exe",
    "epicwebhelper.exe",
    "battle.net.exe",
    "eadesktop.exe",
    "eabackgroundservice.exe",
    "origin.exe",
    "upc.exe",
    "ubisoftconnect.exe",
    "uplaywebcore.exe",
    "galaxyclient.exe",
    "galaxyclient helper.exe",
    "riotclientservices.exe",
    "riotclientux.exe",
    "rockstarservice.exe",
    "socialclubhelper.exe",
    "playnite.desktopapp.exe",
    "amazon games ui.exe",
];

pub fn category(exe: &str) -> Option<AppCategory> {
    if BROWSERS.contains(&exe) {
        Some(AppCategory::Browser)
    } else if LAUNCHERS.contains(&exe) {
        Some(AppCategory::Launcher)
    } else {
        None
    }
}

#[derive(Clone, Debug)]
pub struct Proc {
    pub pid: u32,
    /// Lower-case exe name, e.g. `chrome.exe`.
    pub exe: String,
    pub path: String,
    /// Private bytes (commit charge) — what the process really costs in RAM.
    pub private_bytes: u64,
    /// Kernel + user time in 100 ns units.
    pub cpu_time: u64,
}

/// Every process of the current session that the user owns and may care about.
pub fn list() -> Vec<Proc> {
    let mut out = Vec::new();
    let mut session = 0u32;
    // SAFETY: plain Win32 queries with valid out-pointers; every opened handle is closed.
    unsafe {
        let _ = ProcessIdToSessionId(std::process::id(), &mut session);
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return out;
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let windows_dir = windows_dir();
        let own = std::process::id();
        let mut ok = Process32FirstW(snap, &mut entry).is_ok();
        while ok {
            let pid = entry.th32ProcessID;
            let exe = wide_to_string(&entry.szExeFile).to_lowercase();
            let mut s = u32::MAX;
            let same_session = ProcessIdToSessionId(pid, &mut s).is_ok() && s == session;
            if pid != own && pid > 4 && same_session && !NEVER.contains(&exe.as_str()) {
                if let Some(p) = open(pid, exe) {
                    if !p.path.to_lowercase().starts_with(&windows_dir) {
                        out.push(p);
                    }
                }
            }
            ok = Process32NextW(snap, &mut entry).is_ok();
        }
        let _ = CloseHandle(snap);
    }
    out
}

unsafe fn open(pid: u32, exe: String) -> Option<Proc> {
    let handle = OpenProcess(
        PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ,
        false,
        pid,
    )
    .or_else(|_| OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid))
    .ok()?;
    let path = image_path(handle).unwrap_or_default();
    let mut mem = PROCESS_MEMORY_COUNTERS_EX {
        cb: size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
        ..Default::default()
    };
    let private_bytes = if K32GetProcessMemoryInfo(
        handle,
        &mut mem as *mut _ as *mut PROCESS_MEMORY_COUNTERS,
        mem.cb,
    )
    .as_bool()
    {
        mem.PrivateUsage as u64
    } else {
        0
    };
    let (mut c, mut e, mut k, mut u) = (
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
    );
    let cpu_time = if GetProcessTimes(handle, &mut c, &mut e, &mut k, &mut u).is_ok() {
        ft(k) + ft(u)
    } else {
        0
    };
    let _ = CloseHandle(handle);
    Some(Proc {
        pid,
        exe,
        path,
        private_bytes,
        cpu_time,
    })
}

unsafe fn image_path(handle: HANDLE) -> Option<String> {
    let mut buf = [0u16; 520];
    let mut len = buf.len() as u32;
    QueryFullProcessImageNameW(
        handle,
        PROCESS_NAME_WIN32,
        PWSTR(buf.as_mut_ptr()),
        &mut len,
    )
    .ok()?;
    Some(String::from_utf16_lossy(&buf[..len as usize]))
}

fn ft(t: FILETIME) -> u64 {
    (u64::from(t.dwHighDateTime) << 32) | u64::from(t.dwLowDateTime)
}

fn wide_to_string(buf: &[u16]) -> String {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
}

fn windows_dir() -> String {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    format!("{}\\", root.trim_end_matches('\\').to_lowercase())
}

// --- readable names ----------------------------------------------------------------------------

static NAMES: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

/// The app's own name from its version resource («Google Chrome», «Steam»), cached per path;
/// falls back to the exe name without `.exe`.
pub fn display_name(path: &str, exe: &str) -> String {
    let key = path.to_lowercase();
    if let Some(name) = NAMES
        .lock()
        .expect("names lock")
        .as_ref()
        .and_then(|m| m.get(&key))
    {
        return name.clone();
    }
    let name = file_description(path).unwrap_or_else(|| {
        let base = exe.trim_end_matches(".exe");
        let mut c = base.chars();
        c.next()
            .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
            .unwrap_or_default()
    });
    NAMES
        .lock()
        .expect("names lock")
        .get_or_insert_with(HashMap::new)
        .insert(key, name.clone());
    name
}

fn file_description(path: &str) -> Option<String> {
    if path.is_empty() {
        return None;
    }
    let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
    // SAFETY: the version block is sized by GetFileVersionInfoSizeW and outlives every pointer
    // VerQueryValueW returns into it.
    unsafe {
        let size = GetFileVersionInfoSizeW(PCWSTR(wide.as_ptr()), None);
        if size == 0 {
            return None;
        }
        let mut block = vec![0u8; size as usize];
        GetFileVersionInfoW(
            PCWSTR(wide.as_ptr()),
            None,
            size,
            block.as_mut_ptr() as *mut c_void,
        )
        .ok()?;
        // First translation (language, code page).
        let mut ptr: *mut c_void = std::ptr::null_mut();
        let mut len = 0u32;
        let sub: Vec<u16> = "\\VarFileInfo\\Translation"
            .encode_utf16()
            .chain(Some(0))
            .collect();
        if !VerQueryValueW(
            block.as_ptr() as *const c_void,
            PCWSTR(sub.as_ptr()),
            &mut ptr,
            &mut len,
        )
        .as_bool()
            || len < 4
        {
            return None;
        }
        let lang = *(ptr as *const u16);
        let cp = *((ptr as *const u16).add(1));
        let q: Vec<u16> = format!("\\StringFileInfo\\{lang:04x}{cp:04x}\\FileDescription")
            .encode_utf16()
            .chain(Some(0))
            .collect();
        if !VerQueryValueW(
            block.as_ptr() as *const c_void,
            PCWSTR(q.as_ptr()),
            &mut ptr,
            &mut len,
        )
        .as_bool()
            || len == 0
        {
            return None;
        }
        let s = std::slice::from_raw_parts(ptr as *const u16, len as usize);
        let name = wide_to_string(s).trim().to_string();
        (!name.is_empty() && name.len() < 60).then_some(name)
    }
}

// --- windows of a process ----------------------------------------------------------------------

struct WinSearch {
    pids: Vec<u32>,
    found: Vec<HWND>,
    visible_only: bool,
}

/// Top-level windows owned by any of `pids` (visible, uncloaked, unowned ones when `visible_only`).
pub fn windows_of(pids: &[u32], visible_only: bool) -> Vec<HWND> {
    let mut search = WinSearch {
        pids: pids.to_vec(),
        found: Vec::new(),
        visible_only,
    };
    // SAFETY: the callback only runs during EnumWindows, while `search` is alive.
    unsafe {
        let _ = EnumWindows(
            Some(collect),
            LPARAM(&mut search as *mut WinSearch as isize),
        );
    }
    search.found
}

unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
    let search = &mut *(lparam.0 as *mut WinSearch);
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if search.pids.contains(&pid) {
        let keep = if search.visible_only {
            let mut cloaked = 0u32;
            let _ = DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                &mut cloaked as *mut u32 as *mut c_void,
                4,
            );
            IsWindowVisible(hwnd).as_bool()
                && cloaked == 0
                && GetWindow(hwnd, GW_OWNER).map_or(true, |o| o.0.is_null())
        } else {
            true
        };
        if keep {
            search.found.push(hwnd);
        }
    }
    true.into()
}

/// Whether any of `pids` has a visible top-level window — minimized or cloaked (another virtual
/// desktop) still counts. Boost never forces such an app.
pub fn has_visible_window(pids: &[u32]) -> bool {
    windows_of(pids, false)
        .into_iter()
        // SAFETY: plain query on a window handle from EnumWindows.
        .any(|h| unsafe { IsWindowVisible(h) }.as_bool())
}

/// Exe file name in lower case, for paths coming from the frontend.
pub fn exe_of(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}
