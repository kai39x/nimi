//! «دوّر»: file names under the user's own folders (Desktop, Documents, Downloads, Pictures,
//! Videos, Music, OneDrive). The command bar builds the index in the background when it opens;
//! only paths are kept (≈ 100 B each, capped), and the index is dropped after ten idle minutes.
//! Hidden and system folders, junctions, `node_modules`, `.git` and build caches are skipped.

use std::{
    fs,
    os::windows::fs::MetadataExt,
    path::{Path, PathBuf},
    sync::Mutex,
    thread,
    time::{Duration, Instant, UNIX_EPOCH},
};

use super::{fold, known_folder, score, KNOWN_FOLDERS};
use crate::ipc::{FileHit, KnownFolder};

/// Rebuild when older than this.
const FRESH: Duration = Duration::from_secs(900);
/// Drop the index when nobody searched for this long.
const IDLE_DROP: Duration = Duration::from_secs(600);
const MAX_ENTRIES: usize = 250_000;
const MAX_DEPTH: usize = 14;

const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

struct Index {
    built: Instant,
    used: Instant,
    roots: Vec<(KnownFolder, PathBuf)>,
    /// Folders end with `\`.
    paths: Vec<Box<str>>,
}

static INDEX: Mutex<Option<Index>> = Mutex::new(None);
static BUILDING: Mutex<bool> = Mutex::new(false);

pub fn warm() {
    let stale = INDEX
        .lock()
        .expect("find lock")
        .as_ref()
        .is_none_or(|i| i.built.elapsed() > FRESH);
    if stale {
        thread::spawn(rebuild);
    }
}

fn rebuild() {
    {
        let mut b = BUILDING.lock().expect("find lock");
        if *b {
            return;
        }
        *b = true;
    }
    let started = Instant::now();
    let roots = roots();
    let mut paths = Vec::new();
    for (_, root) in &roots {
        walk(root, &mut paths);
    }
    log::info!(
        "find: indexed {} entries in {} ms",
        paths.len(),
        started.elapsed().as_millis()
    );
    let first = INDEX.lock().expect("find lock").is_none();
    *INDEX.lock().expect("find lock") = Some(Index {
        built: Instant::now(),
        used: Instant::now(),
        roots,
        paths,
    });
    *BUILDING.lock().expect("find lock") = false;
    if first {
        thread::spawn(janitor);
    }
}

/// Frees the index once it sits unused.
fn janitor() {
    loop {
        thread::sleep(Duration::from_secs(60));
        let mut idx = INDEX.lock().expect("find lock");
        if idx.as_ref().is_some_and(|i| i.used.elapsed() > IDLE_DROP) {
            *idx = None;
            log::info!("find: index dropped (idle)");
            return;
        }
        if idx.is_none() {
            return;
        }
    }
}

fn roots() -> Vec<(KnownFolder, PathBuf)> {
    let mut roots: Vec<(KnownFolder, PathBuf)> = KNOWN_FOLDERS
        .iter()
        .filter_map(|&k| known_folder(k).map(|p| (k, p)))
        .filter(|(_, p)| p.is_dir())
        .collect();
    // OneDrive holds Desktop / Documents when backup is on; index the rest of it as Documents.
    if let Some(od) = std::env::var_os("OneDrive").map(PathBuf::from) {
        if od.is_dir() && !roots.iter().any(|(_, p)| p == &od || od.starts_with(p)) {
            roots.push((KnownFolder::Documents, od));
        }
    }
    // A root inside another root would be walked twice.
    let all: Vec<PathBuf> = roots.iter().map(|(_, p)| p.clone()).collect();
    roots.retain(|(_, p)| !all.iter().any(|o| o != p && p.starts_with(o)));
    roots
}

fn skip_dir(name: &str, path: &Path, attrs: u32) -> bool {
    attrs & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM | FILE_ATTRIBUTE_REPARSE_POINT) != 0
        || name.starts_with('.')
        || name.starts_with('$')
        || matches!(
            name.to_ascii_lowercase().as_str(),
            "node_modules" | "__pycache__" | "appdata" | "site-packages" | "venv" | ".venv"
        )
        // Build output folders mark themselves (Rust `target`, many caches).
        || path.join("CACHEDIR.TAG").exists()
}

fn walk(root: &Path, out: &mut Vec<Box<str>>) {
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if out.len() >= MAX_ENTRIES {
                return;
            }
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let attrs = meta.file_attributes();
            if meta.is_dir() {
                if skip_dir(&name, &path, attrs) {
                    continue;
                }
                out.push(format!("{}\\", path.display()).into_boxed_str());
                if depth < MAX_DEPTH {
                    stack.push((path, depth + 1));
                }
            } else if attrs & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM) == 0 {
                out.push(path.to_string_lossy().into_owned().into_boxed_str());
            }
        }
    }
}

fn name_of(p: &str) -> &str {
    let p = p.trim_end_matches('\\');
    p.rsplit('\\').next().unwrap_or(p)
}

pub fn search(query: &str, limit: usize) -> Vec<FileHit> {
    let q = fold(query.trim());
    if q.chars().count() < 2 {
        return Vec::new();
    }
    if INDEX.lock().expect("find lock").is_none() {
        let _ = thread::spawn(rebuild).join();
    }
    let (picked, roots) = {
        let mut guard = INDEX.lock().expect("find lock");
        let Some(idx) = guard.as_mut() else {
            return Vec::new();
        };
        idx.used = Instant::now();
        let mut hits: Vec<(u32, usize, &str)> = idx
            .paths
            .iter()
            .filter_map(|p| {
                let name = fold(name_of(p));
                // Initials matching is too loose for file names: whole substrings only.
                score(&name, &q)
                    .filter(|&s| s > 100)
                    .map(|s| (s, p.len(), &**p))
            })
            .collect();
        hits.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
        let picked: Vec<String> = hits
            .into_iter()
            .take(limit.max(1))
            .map(|(_, _, p)| p.to_string())
            .collect();
        (picked, idx.roots.clone())
    };
    if INDEX
        .lock()
        .expect("find lock")
        .as_ref()
        .is_some_and(|i| i.built.elapsed() > FRESH)
    {
        warm();
    }
    picked
        .into_iter()
        .filter_map(|p| {
            let is_dir = p.ends_with('\\');
            let path = PathBuf::from(p.trim_end_matches('\\'));
            let meta = fs::metadata(&path).ok()?; // gone since the index was built
            Some(FileHit {
                name: name_of(&p).to_string(),
                size: if is_dir { 0 } else { meta.len() },
                is_dir,
                folder: roots
                    .iter()
                    .filter(|(_, r)| path.starts_with(r))
                    .max_by_key(|(_, r)| r.as_os_str().len())
                    .map(|(k, _)| *k),
                modified_ms: meta
                    .modified()
                    .ok()
                    .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_millis() as i64),
                path: path.to_string_lossy().into_owned(),
            })
        })
        .collect()
}
