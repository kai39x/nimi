//! The watchers behind notifications (spec §5 «تنبيهات», §15 data sources). Each one reports a
//! fact once and re-arms only when the condition clears, so nothing repeats every sample.

use std::{
    collections::{HashMap, HashSet},
    ffi::c_void,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};

use tauri::AppHandle;
use windows::{
    core::HSTRING,
    Win32::{
        Foundation::CloseHandle,
        Networking::NetworkListManager::{
            INetworkListManager, NetworkListManager, NLM_CONNECTIVITY_IPV4_INTERNET,
            NLM_CONNECTIVITY_IPV6_INTERNET,
        },
        Storage::FileSystem::{
            CreateFileW, GetDriveTypeW, GetVolumeInformationW, ReadDirectoryChangesW,
            FILE_FLAG_BACKUP_SEMANTICS, FILE_LIST_DIRECTORY, FILE_NOTIFY_CHANGE_FILE_NAME,
            FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
        },
        System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED},
    },
};

use super::{list, notification, push};
use crate::{
    ipc::{KnownFolder, NotifyKind, SystemStats},
    tools::{known_folder, now_ms},
};

static APP: OnceLock<AppHandle> = OnceLock::new();

/// CPU / RAM must stay high this long (spec: «فوق ٨٥٪ لأكثر من ٥ دقايق»).
const SUSTAIN: Duration = Duration::from_secs(5 * 60);
const HIGH: f64 = 85.0;
/// Below this the load watcher re-arms.
const CALM: f64 = 75.0;
const DISK_LOW: f64 = 0.10;
const DISK_REARM: f64 = 0.12;
/// A low-disk or low-battery note is not repeated within a day (also across restarts).
const QUIET_REPEAT_MS: i64 = 24 * 3600 * 1000;

pub fn spawn(app: &AppHandle) {
    let _ = APP.set(app.clone());
    let a = app.clone();
    thread::Builder::new()
        .name("nimi-watch-downloads".into())
        .spawn(move || downloads(&a))
        .expect("spawn downloads watcher");
    let a = app.clone();
    thread::Builder::new()
        .name("nimi-watch-network".into())
        .spawn(move || network(&a))
        .expect("spawn network watcher");
}

/// A notification of `kind` about `name` already exists from the last day.
fn recent(app: &AppHandle, kind: NotifyKind, name: &str) -> bool {
    let since = now_ms() - QUIET_REPEAT_MS;
    list(app)
        .iter()
        .any(|n| n.kind == Some(kind) && n.name.as_deref() == Some(name) && n.at_ms >= since)
}

// --- system sampler: drives, CPU, RAM, battery -------------------------------------------------

#[derive(Default)]
struct Load {
    since: Option<Instant>,
    /// Lowest value seen while high (CPU ≥ 95 the whole time → important).
    low: f64,
    fired: bool,
}

impl Load {
    /// Returns the sustained level once, when it has been high for `SUSTAIN`.
    fn feed(&mut self, usage: f64) -> Option<f64> {
        if usage < CALM {
            *self = Load::default();
            return None;
        }
        if usage < HIGH {
            self.since = None; // dipped: the five minutes start again
            return None;
        }
        let since = *self.since.get_or_insert_with(|| {
            self.low = usage;
            Instant::now()
        });
        self.low = self.low.min(usage);
        if !self.fired && since.elapsed() >= SUSTAIN {
            self.fired = true;
            return Some(self.low);
        }
        None
    }
}

#[derive(Default)]
struct SystemWatch {
    cpu: Load,
    ram: Load,
    low_drives: HashSet<String>,
    charging: Option<bool>,
    battery_low: bool,
}

static SYSTEM: Mutex<Option<SystemWatch>> = Mutex::new(None);

/// Called by the system sampler after every sample (2 s open, 10 s compact).
pub fn on_stats(app: &AppHandle, s: &SystemStats) {
    let mut out = Vec::new();
    {
        let mut guard = SYSTEM.lock().expect("watch lock");
        let w = guard.get_or_insert_with(SystemWatch::default);

        for d in s.drives.iter().filter(|d| d.total > 0) {
            let share = d.free as f64 / d.total as f64;
            if share < DISK_LOW && !w.low_drives.contains(&d.letter) {
                w.low_drives.insert(d.letter.clone());
                let mut n = notification(NotifyKind::DiskLow);
                n.name = Some(d.letter.clone());
                n.size = Some(d.free);
                n.total = Some(d.total);
                out.push(n);
            } else if share > DISK_REARM {
                w.low_drives.remove(&d.letter);
            }
        }

        if let Some(low) = w.cpu.feed(s.cpu.usage) {
            let mut n = notification(NotifyKind::CpuHigh);
            n.percent = Some(low.round());
            n.name = s.cpu.top.as_ref().map(|t| t.name.clone());
            out.push(n);
        }
        if let Some(low) = w.ram.feed(s.ram.usage) {
            let mut n = notification(NotifyKind::RamHigh);
            n.percent = Some(low.round());
            n.size = Some(s.ram.used);
            n.total = Some(s.ram.total);
            n.name = s.ram.top.as_ref().map(|t| t.name.clone());
            out.push(n);
        }

        if let Some(b) = s.battery {
            if let Some(was) = w.charging {
                if was != b.charging {
                    let mut n = notification(if b.charging {
                        NotifyKind::PowerIn
                    } else {
                        NotifyKind::PowerOut
                    });
                    n.percent = Some(f64::from(b.percent));
                    out.push(n);
                }
            }
            w.charging = Some(b.charging);
            if b.percent <= 15 && !b.charging && !w.battery_low {
                w.battery_low = true;
                let mut n = notification(NotifyKind::BatteryLow);
                n.percent = Some(f64::from(b.percent));
                n.name = Some("battery".into());
                out.push(n);
            } else if b.percent > 20 || b.charging {
                w.battery_low = false;
            }
        }
    }
    for n in out {
        let quiet = matches!(n.kind, Some(NotifyKind::DiskLow | NotifyKind::BatteryLow))
            && recent(
                app,
                n.kind.expect("kind"),
                n.name.as_deref().unwrap_or_default(),
            );
        if !quiet {
            push(app, n);
        }
    }
}

// --- Downloads -----------------------------------------------------------------------------------

/// Files NIMI itself just wrote (results saved to Downloads, notes, screenshots) are not news.
static OWN: Mutex<Vec<(PathBuf, Instant)>> = Mutex::new(Vec::new());

pub fn mark_own<P: AsRef<Path>>(paths: &[P]) {
    let mut own = OWN.lock().expect("own lock");
    own.retain(|(_, at)| at.elapsed() < Duration::from_secs(120));
    own.extend(
        paths
            .iter()
            .map(|p| (p.as_ref().to_path_buf(), Instant::now())),
    );
}

fn is_own(path: &Path) -> bool {
    OWN.lock()
        .expect("own lock")
        .iter()
        .any(|(p, at)| at.elapsed() < Duration::from_secs(120) && p == path)
}

/// Partial downloads and helper files never count; browsers rename them when done.
fn is_partial(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.starts_with('~')
        || lower.starts_with('.')
        || lower == "desktop.ini"
        || [
            ".crdownload",
            ".part",
            ".partial",
            ".tmp",
            ".download",
            ".opdownload",
            ".!ut",
            ".!qb",
            ".aria2",
        ]
        .iter()
        .any(|e| lower.ends_with(e))
}

fn downloads(app: &AppHandle) {
    let Some(dir) = known_folder(KnownFolder::Downloads) else {
        return;
    };
    // SAFETY: a directory handle for change notifications, closed when the loop ends.
    let handle = match unsafe {
        CreateFileW(
            &HSTRING::from(dir.as_os_str()),
            FILE_LIST_DIRECTORY.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            None,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            None,
        )
    } {
        Ok(h) => h,
        Err(err) => {
            log::warn!("downloads watcher: {err}");
            return;
        }
    };
    let mut buf = vec![0u32; 16 * 1024]; // 64 KB, DWORD-aligned as the API requires
    let mut seen: HashMap<String, Instant> = HashMap::new();
    loop {
        let mut bytes = 0u32;
        // SAFETY: synchronous call into our own aligned buffer.
        let ok = unsafe {
            ReadDirectoryChangesW(
                handle,
                buf.as_mut_ptr() as *mut c_void,
                (buf.len() * 4) as u32,
                false,
                FILE_NOTIFY_CHANGE_FILE_NAME,
                Some(&mut bytes),
                None,
                None,
            )
        };
        if ok.is_err() {
            break;
        }
        if bytes == 0 {
            continue; // overflow: changes were lost, nothing to report
        }
        for name in added_names(&buf, bytes as usize) {
            if is_partial(&name) {
                continue;
            }
            seen.retain(|_, at| at.elapsed() < Duration::from_secs(30));
            if seen.insert(name.to_lowercase(), Instant::now()).is_some() {
                continue;
            }
            let path = dir.join(&name);
            let app = app.clone();
            // Let the writer finish: a placeholder that stays empty is not a download.
            thread::spawn(move || {
                thread::sleep(Duration::from_secs(2));
                let Ok(meta) = std::fs::metadata(&path) else {
                    return;
                };
                if !meta.is_file() || meta.len() == 0 || is_own(&path) {
                    return;
                }
                let mut n = notification(NotifyKind::Download);
                n.name = Some(name);
                n.size = Some(meta.len());
                n.path = Some(path.to_string_lossy().into_owned());
                push(&app, n);
            });
        }
    }
    // SAFETY: closing the handle we opened.
    unsafe {
        let _ = CloseHandle(handle);
    }
}

/// Names from `FILE_NOTIFY_INFORMATION` records that were added or renamed into place.
fn added_names(buf: &[u32], len: usize) -> Vec<String> {
    const ADDED: u32 = 1;
    const RENAMED_NEW: u32 = 5;
    let raw = buf.as_ptr() as *const u8;
    let mut out = Vec::new();
    let mut offset = 0usize;
    while offset + 12 <= len {
        // SAFETY: records lie inside the `len` bytes the API filled; fields are DWORD-aligned.
        let (next, action, name_len) = unsafe {
            let p = raw.add(offset) as *const u32;
            (*p, *p.add(1), *p.add(2) as usize)
        };
        if offset + 12 + name_len > len {
            break;
        }
        if action == ADDED || action == RENAMED_NEW {
            // SAFETY: the name follows the three DWORDs, `name_len` bytes of UTF-16.
            let name = unsafe {
                std::slice::from_raw_parts(raw.add(offset + 12) as *const u16, name_len / 2)
            };
            let name = String::from_utf16_lossy(name);
            if !name.contains('\\') {
                out.push(name);
            }
        }
        if next == 0 {
            break;
        }
        offset += next as usize;
    }
    out
}

// --- network -------------------------------------------------------------------------------------

/// Internet reachability every 5 s (Network List Manager); a loss counts after two misses, so a
/// Wi-Fi hiccup is not news.
fn network(app: &AppHandle) {
    // SAFETY: COM (MTA) for this thread; the manager lives as long as the thread.
    let manager: INetworkListManager = match unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        CoCreateInstance(&NetworkListManager, None, CLSCTX_ALL)
    } {
        Ok(m) => m,
        Err(err) => {
            log::warn!("network watcher: {err}");
            return;
        }
    };
    let online = || {
        // SAFETY: plain COM getter.
        unsafe { manager.GetConnectivity() }.is_ok_and(|c| {
            c.0 & (NLM_CONNECTIVITY_IPV4_INTERNET.0 | NLM_CONNECTIVITY_IPV6_INTERNET.0) != 0
        })
    };
    let mut misses = 0u32;
    let mut lost = false;
    loop {
        if online() {
            if lost {
                push(app, notification(NotifyKind::NetBack));
            }
            lost = false;
            misses = 0;
        } else {
            misses += 1;
            if misses == 2 && !lost {
                lost = true;
                push(app, notification(NotifyKind::NetLost));
            }
        }
        thread::sleep(Duration::from_secs(5));
    }
}

// --- USB volumes (WM_DEVICECHANGE, forwarded by window::subclass) ------------------------------

#[repr(C)]
struct BroadcastHeader {
    size: u32,
    device_type: u32,
    reserved: u32,
}

#[repr(C)]
struct BroadcastVolume {
    header: BroadcastHeader,
    unit_mask: u32,
    flags: u16,
}

const DBT_DEVICEARRIVAL: usize = 0x8000;
const DBT_DEVICEREMOVECOMPLETE: usize = 0x8004;
const DBT_DEVTYP_VOLUME: u32 = 2;
const DBTF_MEDIA: u16 = 1;
const DRIVE_REMOVABLE: u32 = 2;
const DRIVE_FIXED: u32 = 3;

static LABELS: Mutex<Option<HashMap<char, String>>> = Mutex::new(None);

/// Copies what it needs out of the broadcast (valid only during the call), then works off-thread.
pub fn on_device_change(wparam: usize, lparam: isize) {
    if (wparam != DBT_DEVICEARRIVAL && wparam != DBT_DEVICEREMOVECOMPLETE) || lparam == 0 {
        return;
    }
    // SAFETY: for these two events lParam points to a DEV_BROADCAST_HDR; the volume fields are
    // read only when the header says it is a volume.
    let (mask, flags) = unsafe {
        let hdr = &*(lparam as *const BroadcastHeader);
        if hdr.device_type != DBT_DEVTYP_VOLUME {
            return;
        }
        let vol = &*(lparam as *const BroadcastVolume);
        (vol.unit_mask, vol.flags)
    };
    if flags & DBTF_MEDIA != 0 {
        return; // a disc was inserted, not a device
    }
    let arrived = wparam == DBT_DEVICEARRIVAL;
    let Some(app) = APP.get().cloned() else {
        return;
    };
    thread::spawn(move || {
        for i in 0..26u32 {
            if mask & (1 << i) == 0 {
                continue;
            }
            let letter = char::from(b'A' + i as u8);
            let root = format!("{letter}:\\");
            let mut labels = LABELS.lock().expect("labels lock");
            let labels = labels.get_or_insert_with(HashMap::new);
            let mut n = if arrived {
                // SAFETY: plain query on a drive root string.
                let kind = unsafe { GetDriveTypeW(&HSTRING::from(root.as_str())) };
                if kind != DRIVE_REMOVABLE && kind != DRIVE_FIXED {
                    continue;
                }
                let label = volume_label(&root);
                let name = if label.is_empty() {
                    format!("{letter}:")
                } else {
                    format!("{label} ({letter}:)")
                };
                labels.insert(letter, name.clone());
                let mut n = notification(NotifyKind::UsbIn);
                n.name = Some(name);
                n.path = Some(root);
                n
            } else {
                let mut n = notification(NotifyKind::UsbOut);
                n.name = Some(
                    labels
                        .remove(&letter)
                        .unwrap_or_else(|| format!("{letter}:")),
                );
                n
            };
            n.read = false;
            push(&app, n);
        }
    });
}

fn volume_label(root: &str) -> String {
    let mut name = [0u16; 261];
    // SAFETY: fills our fixed buffer with the volume label.
    let ok = unsafe {
        GetVolumeInformationW(
            &HSTRING::from(root),
            Some(&mut name),
            None,
            None,
            None,
            None,
        )
    };
    if ok.is_err() {
        return String::new();
    }
    let len = name.iter().position(|&c| c == 0).unwrap_or(0);
    String::from_utf16_lossy(&name[..len])
}
