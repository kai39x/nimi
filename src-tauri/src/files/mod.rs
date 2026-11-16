//! Feeding NIMI (phase 6, design spec §6, board 08): what he ate, the actions the bubbles and
//! «المزيد» offer, where results go, and «تراجع».
//!
//! - `drop`: the overlay's own OLE drop target (files, links, text).
//! - `tar`: ZIP create / extract / list with Windows' own `tar.exe` (bsdtar, Windows 10 1803+).
//! - `imaging`: convert (PNG, JPG, WebP, BMP, TIFF, ICO, PDF), shrink, strip camera data.
//! - `pdf`: merge, keep pages, compress, text, pages as images, images → PDF.
//! - `ocr`: «اقرأ النص» with `Windows.Media.Ocr` (offline, installed languages).
//! - `link`: recognising links and the local safety check (opt-in OpenPhish list).
//! - `shell`: clipboard (files / text), folder picker, Explorer, terminal, Recycle Bin, drag-out.
//!
//! Safety (CLAUDE.md): nothing is ever deleted permanently — undo of a created file sends it to
//! the Recycle Bin, a moved file moves back; system paths are refused.

pub mod drop;
mod imaging;
pub mod link;
mod ocr;
mod pdf;
pub mod shell;
mod tar;

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Arc, Mutex},
};

use tauri::{AppHandle, Manager};

use crate::{
    ipc::{FeedAction, FeedResult, Meal, MealKind, ResultsLocation},
    settings::SettingsStore,
};

const IMAGE: &[&str] = &[
    "png", "jpg", "jpeg", "bmp", "gif", "tif", "tiff", "webp", "heic", "jxr", "ico",
];
const ARCHIVE: &[&str] = &[
    "zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz", "cab", "iso",
];
const TEXT: &[&str] = &[
    "txt", "md", "csv", "log", "json", "xml", "ini", "yaml", "yml",
];

enum Undo {
    /// Created outputs: undo sends them to the Recycle Bin.
    Recycle(Vec<String>),
    /// (now at, came from): undo moves them back.
    MoveBack(Vec<(String, String)>),
}

#[derive(Default)]
pub struct FilesShared {
    undo: Mutex<HashMap<String, Undo>>,
    next: Mutex<u64>,
    /// A drag-out is running on the main thread.
    pub dragging: AtomicBool,
}

impl FilesShared {
    fn remember(&self, op: Undo) -> String {
        let mut n = self.next.lock().expect("undo counter lock");
        *n += 1;
        let token = format!("u{}", *n);
        self.undo
            .lock()
            .expect("undo lock")
            .insert(token.clone(), op);
        token
    }
}

// --- what did he eat ---------------------------------------------------------------------------

fn ext(p: &Path) -> String {
    p.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn kind_of(p: &Path) -> MealKind {
    if p.is_dir() {
        return MealKind::Folder;
    }
    let e = ext(p);
    if IMAGE.contains(&e.as_str()) {
        MealKind::Image
    } else if ARCHIVE.contains(&e.as_str()) {
        MealKind::Archive
    } else if e == "pdf" {
        MealKind::Pdf
    } else if TEXT.contains(&e.as_str()) {
        MealKind::Text
    } else {
        MealKind::Other
    }
}

/// Paths must exist and be outside Windows' own folders.
fn checked(paths: &[String]) -> Result<Vec<PathBuf>, String> {
    let windows = std::env::var("SystemRoot")
        .unwrap_or_else(|_| "C:\\Windows".into())
        .to_lowercase();
    let out: Vec<PathBuf> = paths
        .iter()
        .map(PathBuf::from)
        .filter(|p| p.exists())
        .collect();
    if out.is_empty() {
        return Err("missing".into());
    }
    if out
        .iter()
        .any(|p| p.to_string_lossy().to_lowercase().starts_with(&windows))
    {
        return Err("system".into());
    }
    Ok(out)
}

fn size_of_path(p: &Path) -> u64 {
    if p.is_file() {
        return p.metadata().map(|m| m.len()).unwrap_or(0);
    }
    let mut total = 0;
    let mut stack = vec![p.to_path_buf()];
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
            } else {
                total += md.len();
            }
        }
    }
    total
}

pub fn meal(app: &AppHandle, paths: &[String], text: Option<&str>) -> Result<Meal, String> {
    if paths.is_empty() {
        let text = text
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .ok_or("missing")?;
        return Ok(text_meal(app, text));
    }
    let items = checked(paths)?;
    let first = &items[0];
    // A dropped Internet shortcut is a link.
    if items.len() == 1 && ext(first) == "url" {
        if let Some(url) = link::from_shortcut(first) {
            return Ok(text_meal(app, url.as_str()));
        }
    }
    let kind = if items.len() > 1 {
        MealKind::Many
    } else {
        kind_of(first)
    };
    Ok(Meal {
        kind,
        name: first
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        bytes: items
            .iter()
            .filter(|p| p.is_file())
            .map(|p| size_of_path(p))
            .sum(),
        count: items.len() as u32,
        paths: items.iter().map(|p| p.display().to_string()).collect(),
        text: None,
        pages: (kind == MealKind::Pdf)
            .then(|| pdf::page_count(first))
            .flatten(),
        safety: None,
    })
}

/// A link (with its safety verdict) or a note.
fn text_meal(app: &AppHandle, text: &str) -> Meal {
    let url = link::parse(text);
    let name: String = match &url {
        Some(u) => u.host_str().unwrap_or_default().to_string(),
        None => {
            let line = text.lines().next().unwrap_or_default().trim();
            let mut short: String = line.chars().take(40).collect();
            if line.chars().count() > 40 || text.lines().nth(1).is_some() {
                short.push('…');
            }
            short
        }
    };
    Meal {
        kind: if url.is_some() {
            MealKind::Link
        } else {
            MealKind::Note
        },
        paths: vec![],
        name,
        bytes: text.len() as u64,
        count: 1,
        safety: url.as_ref().map(|u| link::check(app, u)),
        text: Some(url.map_or_else(|| text.to_string(), |u| u.to_string())),
        pages: None,
    }
}

// --- where results go --------------------------------------------------------------------------

fn downloads() -> PathBuf {
    std::env::var("USERPROFILE")
        .map(|p| PathBuf::from(p).join("Downloads"))
        .unwrap_or_else(|_| std::env::temp_dir())
}

/// The folder for a result, per «وين تروح النتيجة». `None` = the user cancelled the picker.
/// With no original (a dropped text), «جنب الأصلي» means Downloads.
fn output_dir(app: &AppHandle, items: &[PathBuf]) -> Option<PathBuf> {
    let setting = app.state::<SettingsStore>().get().results_location;
    let parent = items
        .first()
        .and_then(|p| p.parent())
        .map(Path::to_path_buf)
        .unwrap_or_else(downloads);
    match setting {
        ResultsLocation::NextToOriginal => Some(parent),
        ResultsLocation::Downloads => Some(downloads()),
        ResultsLocation::Ask => shell::pick_folder(app, Some(&parent)),
    }
}

/// `name.ext`, or `name (2).ext` … when taken.
pub fn unique(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let dot = if ext.is_empty() {
        String::new()
    } else {
        format!(".{ext}")
    };
    let first = dir.join(format!("{stem}{dot}"));
    if !first.exists() {
        return first;
    }
    (2..10_000)
        .map(|i| dir.join(format!("{stem} ({i}){dot}")))
        .find(|p| !p.exists())
        .unwrap_or(first)
}

fn stem(p: &Path) -> String {
    p.file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "NIMI".into())
}

fn result(action: FeedAction) -> FeedResult {
    FeedResult {
        action,
        outputs: vec![],
        bytes: 0,
        folder: None,
        text: None,
        undo: None,
        was: None,
        counts: None,
    }
}

// --- actions -----------------------------------------------------------------------------------

pub fn run(
    app: &AppHandle,
    action: FeedAction,
    paths: &[String],
    text: Option<&str>,
    target: Option<&str>,
) -> Result<FeedResult, String> {
    let shared = app.state::<Arc<FilesShared>>().inner().clone();
    let mut r = result(action);
    if matches!(
        action,
        FeedAction::OpenLink
            | FeedAction::LinkShortcut
            | FeedAction::CopyText
            | FeedAction::SaveNote
            | FeedAction::WordCount
    ) {
        let text = text.filter(|t| !t.trim().is_empty()).ok_or("missing")?;
        run_text(app, &shared, &mut r, action, text)?;
        return Ok(r);
    }
    let items = checked(paths)?;
    let strs: Vec<String> = items.iter().map(|p| p.display().to_string()).collect();
    match action {
        FeedAction::Copy | FeedAction::Cut => {
            shell::copy_files(&strs, action == FeedAction::Cut).map_err(|e| e.to_string())?;
        }
        FeedAction::CopyPath => {
            shell::copy_text(&strs.join("\r\n")).map_err(|e| e.to_string())?;
            r.text = Some(strs.join("\n"));
        }
        FeedAction::Zip => {
            let dir = output_dir(app, &items).ok_or("cancelled")?;
            let name = if items.len() == 1 {
                stem(&items[0])
            } else {
                format!("{} +{}", stem(&items[0]), items.len() - 1)
            };
            let out = unique(&dir, &name, "zip");
            tar::zip(&items, &out)?;
            created(&shared, &mut r, vec![out]);
        }
        FeedAction::Move => {
            let dir = shell::pick_folder(app, items[0].parent()).ok_or("cancelled")?;
            let mut moved = Vec::new();
            for p in &items {
                let name = p
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                let target = unique(&dir, &stem(Path::new(&name)), &ext(Path::new(&name)));
                if p.parent() == Some(dir.as_path()) {
                    continue;
                }
                shell::move_path(p, &target).map_err(|e| e.to_string())?;
                moved.push((target.display().to_string(), p.display().to_string()));
            }
            r.outputs = moved.iter().map(|(to, _)| to.clone()).collect();
            r.bytes = r.outputs.iter().map(|o| size_of_path(Path::new(o))).sum();
            r.folder = r.outputs.first().cloned();
            if !moved.is_empty() {
                r.undo = Some(shared.remember(Undo::MoveBack(moved)));
            }
        }
        FeedAction::Convert => {
            let src = &items[0];
            let to = target.ok_or("bad-target")?.to_lowercase();
            let dir = output_dir(app, &items).ok_or("cancelled")?;
            if kind_of(src) == MealKind::Pdf {
                match to.as_str() {
                    "txt" => {
                        let text = pdf::text(src)?;
                        let out = unique(&dir, &stem(src), "txt");
                        write_text(&out, &text)?;
                        r.text = Some(text);
                        created(&shared, &mut r, vec![out]);
                    }
                    "png" => {
                        let folder = unique(&dir, &format!("{} (pages)", stem(src)), "");
                        std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
                        let pages = pdf::render(src, &folder, &stem(src), 500)
                            .map_err(|e| e.message().to_string());
                        if pages.is_err() {
                            let _ = std::fs::remove_dir(&folder);
                        }
                        pages?;
                        created(&shared, &mut r, vec![folder]);
                    }
                    _ => return Err("bad-target".into()),
                }
            } else {
                if !imaging::targets_for(src).contains(&to.as_str()) {
                    return Err("bad-target".into());
                }
                let px = imaging::decode(src, 1.0)?;
                let out = unique(&dir, &stem(src), &to);
                imaging::encode(&px, &out, &to)?;
                created(&shared, &mut r, vec![out]);
            }
        }
        FeedAction::Shrink | FeedAction::StripMeta => {
            let src = &items[0];
            let dir = output_dir(app, &items).ok_or("cancelled")?;
            let (suffix, scale) = if action == FeedAction::Shrink {
                (" (small)", 0.5)
            } else {
                (" (clean)", 1.0)
            };
            let fmt = imaging::same_format_ext(src);
            let out = unique(&dir, &format!("{}{suffix}", stem(src)), fmt);
            let px = imaging::decode(src, scale)?;
            imaging::encode(&px, &out, fmt)?;
            created(&shared, &mut r, vec![out]);
        }
        FeedAction::ImagesToPdf => {
            let dir = output_dir(app, &items).ok_or("cancelled")?;
            let mut pages = Vec::new();
            for p in &items {
                let px = imaging::decode(p, 1.0)?;
                pages.push((px.w, px.h, imaging::jpeg_bytes(&px)?));
            }
            let name = if items.len() == 1 {
                stem(&items[0])
            } else {
                format!("{} +{}", stem(&items[0]), items.len() - 1)
            };
            let out = unique(&dir, &name, "pdf");
            pdf::from_jpegs(&pages, &out)?;
            created(&shared, &mut r, vec![out]);
        }
        FeedAction::PdfMerge => {
            let dir = output_dir(app, &items).ok_or("cancelled")?;
            let name = format!("{} +{}", stem(&items[0]), items.len() - 1);
            let out = unique(&dir, &name, "pdf");
            pdf::merge(&items, &out)?;
            created(&shared, &mut r, vec![out]);
        }
        FeedAction::PdfPages => {
            let src = &items[0];
            let spec = target.ok_or("bad-pages")?;
            let dir = output_dir(app, &items).ok_or("cancelled")?;
            let label: String = spec
                .chars()
                .filter(|c| !matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
                .take(24)
                .collect();
            let out = unique(&dir, &format!("{} (p {})", stem(src), label.trim()), "pdf");
            pdf::pages(src, spec, &out)?;
            created(&shared, &mut r, vec![out]);
        }
        FeedAction::PdfCompress => {
            let src = &items[0];
            let dir = output_dir(app, &items).ok_or("cancelled")?;
            let out = unique(&dir, &format!("{} (small)", stem(src)), "pdf");
            pdf::compress(src, &out)?;
            r.was = Some(size_of_path(src));
            created(&shared, &mut r, vec![out]);
        }
        FeedAction::OcrText => {
            let text = ocr::recognize(&items[0])?;
            if text.trim().is_empty() {
                return Err("no-text".into());
            }
            shell::copy_text(&text).map_err(|e| e.to_string())?;
            r.text = Some(text);
        }
        FeedAction::ExtractHere | FeedAction::ExtractTo => {
            let archive = &items[0];
            let parent = output_dir(app, &items).ok_or("cancelled")?;
            if action == FeedAction::ExtractTo {
                let dest = unique(&parent, &stem(archive), "");
                std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
                tar::extract(archive, &dest)?;
                created(&shared, &mut r, vec![dest]);
            } else {
                // Only what did not exist before can be undone (tar never overwrites: -k).
                let before: std::collections::HashSet<String> = std::fs::read_dir(&parent)
                    .map(|d| {
                        d.flatten()
                            .map(|e| e.file_name().to_string_lossy().to_lowercase())
                            .collect()
                    })
                    .unwrap_or_default();
                tar::extract(archive, &parent)?;
                let new: Vec<PathBuf> = std::fs::read_dir(&parent)
                    .map(|d| {
                        d.flatten()
                            .filter(|e| {
                                !before.contains(&e.file_name().to_string_lossy().to_lowercase())
                            })
                            .map(|e| e.path())
                            .collect()
                    })
                    .unwrap_or_default();
                if new.is_empty() {
                    return Err("nothing-new".into());
                }
                created(&shared, &mut r, new);
            }
        }
        FeedAction::ListArchive => {
            r.text = Some(tar::list(&items[0])?);
        }
        FeedAction::FolderSize => {
            r.bytes = items.iter().map(|p| size_of_path(p)).sum();
        }
        FeedAction::Terminal => {
            let dir = if items[0].is_dir() {
                items[0].clone()
            } else {
                items[0]
                    .parent()
                    .map(Path::to_path_buf)
                    .unwrap_or_else(downloads)
            };
            shell::terminal(&dir).map_err(|e| e.to_string())?;
        }
        _ => return Err("bad-action".into()),
    }
    Ok(r)
}

/// Link and note actions.
fn run_text(
    app: &AppHandle,
    shared: &FilesShared,
    r: &mut FeedResult,
    action: FeedAction,
    text: &str,
) -> Result<(), String> {
    match action {
        FeedAction::CopyText => {
            shell::copy_text(text).map_err(|e| e.to_string())?;
        }
        FeedAction::OpenLink => {
            let url = link::parse(text).ok_or("bad-link")?;
            shell::open_url(url.as_str()).map_err(|e| e.to_string())?;
        }
        FeedAction::LinkShortcut => {
            let url = link::parse(text).ok_or("bad-link")?;
            let dir = shell::desktop().unwrap_or_else(downloads);
            let host = url.host_str().unwrap_or("link").trim_start_matches("www.");
            let out = unique(&dir, host, "url");
            std::fs::write(&out, format!("[InternetShortcut]\r\nURL={url}\r\n"))
                .map_err(|e| e.to_string())?;
            created(shared, r, vec![out]);
        }
        FeedAction::SaveNote => {
            let dir = output_dir(app, &[]).ok_or("cancelled")?;
            let out = unique(&dir, &format!("NIMI note {}", shell::local_stamp()), "txt");
            write_text(&out, text)?;
            created(shared, r, vec![out]);
        }
        FeedAction::WordCount => {
            r.counts = Some(vec![
                text.split_whitespace().count() as u32,
                text.chars().filter(|c| !c.is_whitespace()).count() as u32,
                text.lines().count().max(1) as u32,
            ]);
        }
        _ => return Err("bad-action".into()),
    }
    Ok(())
}

/// UTF-8 with a BOM and Windows line ends, so Notepad shows Arabic right everywhere.
fn write_text(out: &Path, text: &str) -> Result<(), String> {
    let mut body = String::from("\u{feff}");
    body.push_str(&text.replace("\r\n", "\n").replace('\n', "\r\n"));
    std::fs::write(out, body).map_err(|e| e.to_string())
}

fn created(shared: &FilesShared, r: &mut FeedResult, outputs: Vec<PathBuf>) {
    r.bytes = outputs.iter().map(|p| size_of_path(p)).sum();
    r.folder = outputs.first().map(|p| p.display().to_string());
    r.outputs = outputs.iter().map(|p| p.display().to_string()).collect();
    r.undo = Some(shared.remember(Undo::Recycle(r.outputs.clone())));
}

pub fn undo(app: &AppHandle, token: &str) -> Result<(), String> {
    let shared = app.state::<Arc<FilesShared>>().inner().clone();
    let op = shared
        .undo
        .lock()
        .expect("undo lock")
        .remove(token)
        .ok_or("expired")?;
    match op {
        Undo::Recycle(paths) => {
            let left = shell::recycle(&paths);
            if !left.is_empty() {
                return Err("recycle-failed".into());
            }
        }
        Undo::MoveBack(moves) => {
            for (now, was) in moves {
                shell::move_path(Path::new(&now), Path::new(&was)).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}
