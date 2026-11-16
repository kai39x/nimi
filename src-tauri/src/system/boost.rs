//! Boost (spec §5, board 12 ج): a checklist first, then only what the user ticked —
//! temp files older than a day, emptying the Recycle Bin, closing heavy apps, and the
//! High performance power plan for 2 h. No fake "RAM cleaning".
//!
//! Apps: only background apps (no window on screen) are ticked by default; apps with a window
//! get WM_CLOSE so they can ask to save, and are never forced. Background apps that ignore
//! WM_CLOSE are ended after a few seconds. Only exes from the current preview can be closed.
//!
//! The previous power plan is remembered in `boost.json`, so it comes back after 2 h even if
//! NIMI restarts in between.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Mutex,
    thread,
    time::{Duration, SystemTime},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use windows::{
    core::{GUID, PCWSTR},
    Win32::{
        Foundation::{CloseHandle, HLOCAL, LPARAM, WPARAM},
        System::{
            Power::{PowerGetActiveScheme, PowerReadFriendlyName, PowerSetActiveScheme},
            Threading::{
                OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
                PROCESS_TERMINATE,
            },
        },
        UI::{
            Shell::{
                SHEmptyRecycleBinW, SHQueryRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI,
                SHERB_NOSOUND, SHQUERYRBINFO,
            },
            WindowsAndMessaging::{PostMessageW, WM_CLOSE},
        },
    },
};

use super::{now_ms, procs};
use crate::ipc::{AppCategory, BoostApp, BoostPlan, BoostPreview, BoostResult, PowerInfo};

/// Windows' built-in "High performance" scheme (GUID_MIN_POWER_SAVINGS).
const HIGH_PERFORMANCE: GUID = GUID::from_u128(0x8c5e7fda_e8bf_4a96_9a85_a6e23a8c635c);
const POWER_FOR_MS: i64 = 2 * 60 * 60 * 1000;
/// Apps below this (private bytes, all processes of the exe) are not worth listing.
const HEAVY_BYTES: u64 = 200 * 1024 * 1024;
const MAX_APPS: usize = 3;
const TEMP_MIN_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const CLOSE_WAIT: Duration = Duration::from_secs(4);

#[derive(Default, Serialize, Deserialize)]
struct State {
    last_run_ms: Option<i64>,
    last_freed: u64,
    /// The plan to put back, as a u128 GUID in hex.
    restore_scheme: Option<String>,
    restore_at_ms: i64,
}

static STATE_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

fn state_path() -> Option<PathBuf> {
    STATE_PATH.lock().expect("boost path lock").clone()
}

fn load() -> State {
    state_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(state: &State) {
    if let Some(p) = state_path() {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(p, serde_json::to_string_pretty(state).unwrap_or_default());
    }
}

/// At startup: remember where the state lives and finish (or re-arm) a pending power restore.
pub fn resume(app: &AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        *STATE_PATH.lock().expect("boost path lock") = Some(dir.join("boost.json"));
    }
    let state = load();
    if state.restore_scheme.is_some() {
        schedule_restore(state.restore_at_ms);
    }
}

pub fn preview() -> BoostPreview {
    let (temp_bytes, temp_files) = temp_files(false);
    let (recycle_bytes, recycle_items) = recycle_bin();
    let state = load();
    BoostPreview {
        temp_bytes,
        temp_files,
        recycle_bytes,
        recycle_items,
        apps: heavy_apps(),
        power: PowerInfo {
            available: state.restore_scheme.is_none()
                && scheme_exists(&HIGH_PERFORMANCE)
                && active_scheme() != Some(HIGH_PERFORMANCE),
            boosted_until_ms: state.restore_scheme.as_ref().map(|_| state.restore_at_ms),
        },
        last_run_ms: state.last_run_ms,
        last_freed: state.last_freed,
    }
}

pub fn run(_app: &AppHandle, plan: &BoostPlan) -> BoostResult {
    let mut freed = 0u64;
    if plan.temp {
        freed += temp_files(true).0;
    }
    if plan.recycle {
        let (bytes, items) = recycle_bin();
        // SAFETY: empties every drive's bin without UI; the user ticked this.
        if items > 0
            && unsafe {
                SHEmptyRecycleBinW(
                    None,
                    PCWSTR::null(),
                    SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND,
                )
            }
            .is_ok()
        {
            freed += bytes;
        }
    }
    let (closed, left_open, ram) = close_apps(&plan.apps);
    freed += ram;
    let mut power_until_ms = None;
    if plan.power {
        power_until_ms = boost_power();
    }
    let mut state = load();
    state.last_run_ms = Some(now_ms());
    state.last_freed = freed;
    save(&state);
    BoostResult {
        freed_bytes: freed,
        closed,
        left_open,
        power_until_ms,
    }
}

// --- temp files & Recycle Bin ------------------------------------------------------------------

/// Bytes and count of the user's temp files older than a day; deletes them when `delete`
/// (files in use simply fail and stay).
fn temp_files(delete: bool) -> (u64, u64) {
    let root = std::env::temp_dir();
    let cutoff = SystemTime::now() - TEMP_MIN_AGE;
    let (mut bytes, mut count) = (0u64, 0u64);
    let mut stack = vec![root.clone()];
    let mut dirs = Vec::new();
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for e in entries.flatten() {
            let Ok(md) = e.metadata() else { continue };
            if md.file_type().is_symlink() {
                continue;
            }
            if md.is_dir() {
                stack.push(e.path());
                dirs.push(e.path());
                continue;
            }
            let old = md.modified().map(|m| m < cutoff).unwrap_or(false);
            if !old {
                continue;
            }
            if delete {
                if std::fs::remove_file(e.path()).is_ok() {
                    bytes += md.len();
                    count += 1;
                }
            } else {
                bytes += md.len();
                count += 1;
            }
        }
    }
    if delete {
        // Deepest first; only folders that ended up empty.
        dirs.sort_by_key(|d| std::cmp::Reverse(d.components().count()));
        for d in dirs {
            if d != root {
                let _ = std::fs::remove_dir(d);
            }
        }
    }
    (bytes, count)
}

fn recycle_bin() -> (u64, u64) {
    let mut info = SHQUERYRBINFO {
        cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32,
        ..Default::default()
    };
    // SAFETY: cbSize set; null root = all drives.
    if unsafe { SHQueryRecycleBinW(PCWSTR::null(), &mut info) }.is_err() {
        return (0, 0);
    }
    (info.i64Size.max(0) as u64, info.i64NumItems.max(0) as u64)
}

// --- apps --------------------------------------------------------------------------------------

fn heavy_apps() -> Vec<BoostApp> {
    let mut by_exe: HashMap<String, (u64, Vec<u32>, String)> = HashMap::new();
    for p in procs::list() {
        let e = by_exe
            .entry(p.exe.clone())
            .or_insert((0, Vec::new(), p.path.clone()));
        e.0 += p.private_bytes;
        e.1.push(p.pid);
    }
    let mut apps: Vec<BoostApp> = by_exe
        .into_iter()
        .filter(|(_, (bytes, _, _))| *bytes >= HEAVY_BYTES)
        .map(|(exe, (bytes, pids, path))| {
            let windowed = procs::has_visible_window(&pids);
            let category = procs::category(&exe);
            BoostApp {
                name: procs::display_name(&path, &exe),
                suggested: !windowed && category == Some(AppCategory::Launcher),
                category,
                exe,
                bytes,
                processes: pids.len() as u32,
                windowed,
            }
        })
        .collect();
    apps.sort_by_key(|a| std::cmp::Reverse(a.bytes));
    apps.truncate(MAX_APPS);
    apps
}

/// Closes the ticked apps (only exes that are in the current heavy list).
fn close_apps(exes: &[String]) -> (Vec<String>, Vec<String>, u64) {
    let candidates = heavy_apps();
    let (mut closed, mut left_open, mut freed) = (Vec::new(), Vec::new(), 0u64);
    for exe in exes {
        let exe = procs::exe_of(exe);
        let Some(app) = candidates.iter().find(|a| a.exe == exe) else {
            continue;
        };
        let pids: Vec<u32> = procs::list()
            .into_iter()
            .filter(|p| p.exe == exe)
            .map(|p| p.pid)
            .collect();
        for hwnd in procs::windows_of(&pids, false) {
            // SAFETY: posting a close request; the window may already be gone.
            unsafe {
                let _ = PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0));
            }
        }
        let still: Vec<u32> = pids
            .iter()
            .copied()
            .filter(|&pid| !exited_within(pid, CLOSE_WAIT))
            .collect();
        if !still.is_empty() && !app.windowed && !procs::has_visible_window(&still) {
            for pid in &still {
                // SAFETY: handle opened with terminate rights and closed right after.
                unsafe {
                    if let Ok(h) = OpenProcess(PROCESS_TERMINATE, false, *pid) {
                        let _ = TerminateProcess(h, 0);
                        let _ = CloseHandle(h);
                    }
                }
            }
        }
        let remaining = procs::list().into_iter().filter(|p| p.exe == exe).count();
        if remaining == 0 {
            closed.push(app.name.clone());
            freed += app.bytes;
        } else {
            left_open.push(app.name.clone());
        }
    }
    (closed, left_open, freed)
}

fn exited_within(pid: u32, wait: Duration) -> bool {
    // SAFETY: synchronize-only handle, closed after the wait.
    unsafe {
        let Ok(h) = OpenProcess(PROCESS_SYNCHRONIZE, false, pid) else {
            return true; // already gone
        };
        let r = WaitForSingleObject(h, wait.as_millis() as u32);
        let _ = CloseHandle(h);
        r.0 == 0 // WAIT_OBJECT_0
    }
}

// --- power plan --------------------------------------------------------------------------------

fn active_scheme() -> Option<GUID> {
    let mut ptr: *mut GUID = std::ptr::null_mut();
    // SAFETY: Windows allocates the GUID; we copy it and free it with LocalFree.
    unsafe {
        if PowerGetActiveScheme(None, &mut ptr).0 != 0 || ptr.is_null() {
            return None;
        }
        let g = *ptr;
        let _ = windows::Win32::Foundation::LocalFree(Some(HLOCAL(ptr as *mut _)));
        Some(g)
    }
}

fn scheme_exists(g: &GUID) -> bool {
    let mut size = 0u32;
    // SAFETY: size-only query.
    unsafe { PowerReadFriendlyName(None, Some(g), None, None, None, &mut size).0 == 0 && size > 0 }
}

fn boost_power() -> Option<i64> {
    let current = active_scheme()?;
    if current == HIGH_PERFORMANCE || !scheme_exists(&HIGH_PERFORMANCE) {
        return None;
    }
    // SAFETY: switching to an existing scheme; standard users may do this.
    if unsafe { PowerSetActiveScheme(None, Some(&HIGH_PERFORMANCE)) }.0 != 0 {
        return None;
    }
    let until = now_ms() + POWER_FOR_MS;
    let mut state = load();
    state.restore_scheme = Some(format!("{:032x}", current.to_u128()));
    state.restore_at_ms = until;
    save(&state);
    schedule_restore(until);
    Some(until)
}

fn schedule_restore(at_ms: i64) {
    thread::spawn(move || {
        let wait = (at_ms - now_ms()).max(0) as u64;
        thread::sleep(Duration::from_millis(wait));
        // Only if this is still the pending restore (the user may have restored by hand).
        if load().restore_at_ms == at_ms {
            let _ = restore_power();
        }
    });
}

/// Puts the remembered plan back and forgets it.
pub fn restore_power() -> windows::core::Result<()> {
    let mut state = load();
    let Some(hex) = state.restore_scheme.take() else {
        return Ok(());
    };
    if let Ok(v) = u128::from_str_radix(&hex, 16) {
        let g = GUID::from_u128(v);
        if scheme_exists(&g) {
            // SAFETY: switching back to a scheme that exists.
            let r = unsafe { PowerSetActiveScheme(None, Some(&g)) };
            if r.0 != 0 {
                state.restore_scheme = Some(hex);
                save(&state);
                return Err(windows::core::Error::from(r.to_hresult()));
            }
        }
    }
    state.restore_at_ms = 0;
    save(&state);
    Ok(())
}
