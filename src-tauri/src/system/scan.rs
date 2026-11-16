//! «أكبر الملفات» (spec §5, board 12 ب, board_states «يدوّر على أكبر الملفات»): an on-demand
//! walk of one fixed drive that keeps the biggest files, with progress and cancel. It keeps
//! running if the panel closes. Windows' own folders are skipped; Program Files, ProgramData and
//! root `.sys` files are listed but locked. Move and recycle only accept files from the last
//! scan that are not locked — the frontend can never name an arbitrary path.

use std::{
    cmp::Reverse,
    collections::BinaryHeap,
    os::windows::fs::MetadataExt,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant, UNIX_EPOCH},
};

use tauri::{AppHandle, Emitter, Manager};
use windows::{
    core::PCWSTR,
    Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_COPY_ALLOWED, MOVEFILE_WRITE_THROUGH},
};

use super::{drives, now_ms, SystemShared};
use crate::ipc::{
    events, BigFile, FileActionResult, FileKind, ScanPhase, ScanProgress, ScanResult,
};

/// How many files the list keeps.
const KEEP: usize = 300;
/// Files smaller than this never make the list (keeps the heap small).
const MIN_SIZE: u64 = 20 * 1024 * 1024;
const PROGRESS_EVERY: Duration = Duration::from_millis(150);
/// Top-level folders Windows owns: never walked.
const SKIP_ROOT_DIRS: &[&str] = &[
    "windows",
    "$recycle.bin",
    "system volume information",
    "recovery",
    "$winreagent",
    "config.msi",
    "$sysreset",
    "$windows.~bt",
    "$windows.~ws",
    "windows.old",
];
/// Top-level folders that are listed but locked (moving or deleting breaks installed apps).
const LOCKED_ROOT_DIRS: &[&str] = &["program files", "program files (x86)", "programdata"];
const VIDEO: &[&str] = &[
    "mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "ts", "mpg", "mpeg", "3gp", "m2ts",
];
const ARCHIVE: &[&str] = &[
    "zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zst", "tgz", "cab", "iso", "img", "vhd", "vhdx",
];

const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

pub fn start(app: &AppHandle, drive: &str) -> Result<(), String> {
    let letter = drives::normalize(drive).ok_or_else(|| format!("{drive} is not a fixed drive"))?;
    let used = drives::list()
        .into_iter()
        .find(|d| d.letter == letter)
        .map(|d| d.total.saturating_sub(d.free))
        .unwrap_or(0);
    let shared = app.state::<Arc<SystemShared>>().inner().clone();
    // A new scan replaces any running one.
    let cancel = Arc::new(AtomicBool::new(false));
    std::mem::replace(
        &mut *shared.scan_cancel.lock().expect("scan cancel lock"),
        cancel.clone(),
    )
    .store(true, Ordering::Relaxed);
    let app = app.clone();
    thread::Builder::new()
        .name("nimi-scan".into())
        .spawn(move || run(&app, &shared, &letter, used, &cancel))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn run(app: &AppHandle, shared: &SystemShared, letter: &str, used: u64, cancel: &AtomicBool) {
    let root = PathBuf::from(format!("{letter}\\"));
    let downloads = downloads_dir();
    let mut heap: BinaryHeap<Reverse<(u64, PathBuf, i64, u32)>> = BinaryHeap::new();
    let mut stack = vec![root.clone()];
    let mut progress = ScanProgress {
        drive: letter.to_string(),
        phase: ScanPhase::Running,
        files: 0,
        bytes: 0,
        bytes_total: used,
        current: root.display().to_string(),
    };
    let publish = |p: &ScanProgress| {
        *shared.scan_progress.lock().expect("scan progress lock") = Some(p.clone());
        let _ = app.emit(events::SYSTEM_SCAN, p.clone());
    };
    publish(&progress);
    let mut last = Instant::now();

    while let Some(dir) = stack.pop() {
        if cancel.load(Ordering::Relaxed) {
            progress.phase = ScanPhase::Cancelled;
            publish(&progress);
            return;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let at_root = dir == root;
        for entry in entries.flatten() {
            // DirEntry metadata comes from the directory listing: no file is opened.
            let Ok(md) = entry.metadata() else { continue };
            let attrs = md.file_attributes();
            if attrs & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                continue; // junctions, symlinks, cloud placeholders: not real space here
            }
            if md.is_dir() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if at_root && SKIP_ROOT_DIRS.contains(&name.as_str()) {
                    continue;
                }
                stack.push(entry.path());
                continue;
            }
            let size = md.len();
            progress.files += 1;
            progress.bytes += size;
            if size < MIN_SIZE {
                continue;
            }
            let modified = md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            heap.push(Reverse((size, entry.path(), modified, attrs)));
            if heap.len() > KEEP {
                heap.pop();
            }
        }
        if last.elapsed() >= PROGRESS_EVERY {
            last = Instant::now();
            progress.current = dir.display().to_string();
            publish(&progress);
        }
    }

    let mut files: Vec<BigFile> = heap
        .into_sorted_vec()
        .into_iter()
        .map(|Reverse((size, path, modified, attrs))| {
            big_file(&root, &downloads, path, size, modified, attrs)
        })
        .collect();
    files.sort_by_key(|f| Reverse(f.size));
    shared
        .scan_results
        .lock()
        .expect("scan results lock")
        .insert(
            letter.to_string(),
            ScanResult {
                drive: letter.to_string(),
                files,
                finished_ms: now_ms(),
            },
        );
    progress.phase = ScanPhase::Done;
    progress.bytes = progress.bytes.max(progress.bytes_total);
    progress.current = String::new();
    publish(&progress);
}

fn big_file(
    root: &Path,
    downloads: &Option<String>,
    path: PathBuf,
    size: u64,
    modified_ms: i64,
    attrs: u32,
) -> BigFile {
    let full = path.display().to_string();
    let lower = full.to_lowercase();
    let rel = path.strip_prefix(root).ok();
    let top = rel
        .and_then(|r| r.components().next())
        .map(|c| c.as_os_str().to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let at_root = rel.is_some_and(|r| r.components().count() == 1);
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    BigFile {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        folder: path
            .parent()
            .and_then(|p| p.file_name())
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| root.display().to_string()),
        size,
        modified_ms,
        kind: if VIDEO.contains(&ext.as_str()) {
            FileKind::Video
        } else if ARCHIVE.contains(&ext.as_str()) {
            FileKind::Archive
        } else {
            FileKind::Other
        },
        locked: attrs & FILE_ATTRIBUTE_SYSTEM != 0
            || LOCKED_ROOT_DIRS.contains(&top.as_str())
            || (at_root && ext == "sys"),
        in_downloads: downloads.as_ref().is_some_and(|d| lower.starts_with(d)),
        path: full,
    }
}

fn downloads_dir() -> Option<String> {
    std::env::var("USERPROFILE")
        .ok()
        .map(|p| format!("{}\\downloads\\", p.trim_end_matches('\\').to_lowercase()))
}

/// The scanned, unlocked entries for `paths` (anything else is refused).
fn allowed(shared: &SystemShared, paths: &[String]) -> Vec<BigFile> {
    let results = shared.scan_results.lock().expect("scan results lock");
    paths
        .iter()
        .filter_map(|p| {
            results
                .values()
                .flat_map(|r| r.files.iter())
                .find(|f| f.path.eq_ignore_ascii_case(p))
                .cloned()
        })
        .filter(|f| !f.locked)
        .collect()
}

fn forget(shared: &SystemShared, done: &[String]) {
    let mut results = shared.scan_results.lock().expect("scan results lock");
    for r in results.values_mut() {
        r.files
            .retain(|f| !done.iter().any(|d| d.eq_ignore_ascii_case(&f.path)));
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

/// Moves files to `<drive>\NIMI\` (same name, numbered on collision). A move, not a delete:
/// Windows copies across drives and removes the original only once the copy succeeded.
pub fn move_files(
    app: &AppHandle,
    paths: &[String],
    to_drive: &str,
) -> Result<FileActionResult, String> {
    let to =
        drives::normalize(to_drive).ok_or_else(|| format!("{to_drive} is not a fixed drive"))?;
    let shared = app.state::<Arc<SystemShared>>().inner().clone();
    let files = allowed(&shared, paths);
    let dest = PathBuf::from(format!("{to}\\NIMI"));
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let (mut done, mut failed, mut bytes) = (Vec::new(), Vec::new(), 0u64);
    for f in files {
        if f.path.to_uppercase().starts_with(&to) {
            failed.push(f.path);
            continue;
        }
        let target = unique(&dest, &f.name);
        let (src, dst) = (wide(&f.path), wide(&target.display().to_string()));
        // SAFETY: NUL-terminated paths that live for the call.
        let ok = unsafe {
            MoveFileExW(
                PCWSTR(src.as_ptr()),
                PCWSTR(dst.as_ptr()),
                MOVEFILE_COPY_ALLOWED | MOVEFILE_WRITE_THROUGH,
            )
        }
        .is_ok();
        if ok {
            bytes += f.size;
            done.push(f.path);
        } else {
            failed.push(f.path);
        }
    }
    let missing: Vec<String> = paths
        .iter()
        .filter(|p| !done.contains(p) && !failed.contains(p))
        .cloned()
        .collect();
    failed.extend(missing);
    forget(&shared, &done);
    Ok(FileActionResult {
        done,
        failed,
        bytes,
        dest: Some(dest.display().to_string()),
    })
}

fn unique(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let p = Path::new(name);
    let stem = p
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = p
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    (2..1000)
        .map(|i| dir.join(format!("{stem} ({i}){ext}")))
        .find(|c| !c.exists())
        .unwrap_or(first)
}

/// Sends files to the Recycle Bin, never a permanent delete without asking: if a file is too big
/// for the bin, Windows shows its own «delete permanently?» warning (`FOF_WANTNUKEWARNING`).
pub fn recycle_files(app: &AppHandle, paths: &[String]) -> Result<FileActionResult, String> {
    let shared = app.state::<Arc<SystemShared>>().inner().clone();
    let files = allowed(&shared, paths);
    if files.is_empty() {
        return Ok(FileActionResult {
            done: vec![],
            failed: paths.to_vec(),
            bytes: 0,
            dest: None,
        });
    }
    let paths_ok: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
    crate::files::shell::recycle(&paths_ok);
    // Whatever no longer exists went to the bin.
    let (mut done, mut failed, mut bytes) = (Vec::new(), Vec::new(), 0u64);
    for f in files {
        if Path::new(&f.path).exists() {
            failed.push(f.path);
        } else {
            bytes += f.size;
            done.push(f.path);
        }
    }
    let missing: Vec<String> = paths
        .iter()
        .filter(|p| !done.contains(p) && !failed.contains(p))
        .cloned()
        .collect();
    failed.extend(missing);
    forget(&shared, &done);
    Ok(FileActionResult {
        done,
        failed,
        bytes,
        dest: None,
    })
}
