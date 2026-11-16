//! NIMI's pocket (design spec §7, board 09): files dropped on Nuri. Stores **paths only** — no
//! copies — in `pocket.json`. Empties itself after a day or a week (setting «الجيب يفضى»);
//! a file that was moved or deleted is shown once with a mark, then dropped.

use std::{
    path::Path,
    sync::Mutex,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    ipc::{events, PocketEmpty, PocketItem},
    settings::SettingsStore,
};

const CHECK_EVERY: Duration = Duration::from_secs(10 * 60);
const MAX_ITEMS: usize = 200;

#[derive(Clone, Serialize, Deserialize)]
struct Stored {
    id: String,
    path: String,
    added_ms: i64,
    /// Already shown once as missing: drop it next time.
    #[serde(default)]
    seen_missing: bool,
}

static LOCK: Mutex<()> = Mutex::new(());

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("pocket.json"))
}

fn load(app: &AppHandle) -> Vec<Stored> {
    file(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(app: &AppHandle, items: &[Stored]) {
    if let Some(p) = file(app) {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(p, serde_json::to_string(items).unwrap_or_default());
    }
}

fn view(s: &Stored) -> PocketItem {
    let p = Path::new(&s.path);
    let md = p.metadata().ok();
    PocketItem {
        id: s.id.clone(),
        name: p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| s.path.clone()),
        size: md
            .as_ref()
            .filter(|m| m.is_file())
            .map(|m| m.len())
            .unwrap_or(0),
        is_dir: md.as_ref().is_some_and(|m| m.is_dir()),
        folder: p
            .parent()
            .and_then(|d| d.file_name())
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        added_ms: s.added_ms,
        missing: md.is_none(),
        path: s.path.clone(),
    }
}

/// Applies auto-empty and the missing-file rule, saves, and returns what to show.
fn sweep(app: &AppHandle, mut items: Vec<Stored>) -> Vec<PocketItem> {
    let max_age = match app.state::<SettingsStore>().get().pocket_empty {
        PocketEmpty::Day => Some(24 * 60 * 60 * 1000),
        PocketEmpty::Week => Some(7 * 24 * 60 * 60 * 1000),
        PocketEmpty::Never => None,
    };
    let now = now_ms();
    items.retain(|s| max_age.is_none_or(|age| now - s.added_ms < age));
    items.retain(|s| !(s.seen_missing && !Path::new(&s.path).exists()));
    for s in &mut items {
        if !Path::new(&s.path).exists() {
            s.seen_missing = true;
        }
    }
    save(app, &items);
    items.iter().map(view).collect()
}

fn publish(app: &AppHandle, items: &[PocketItem]) {
    let _ = app.emit(events::POCKET_CHANGED, items.to_vec());
}

pub fn list(app: &AppHandle) -> Vec<PocketItem> {
    let _g = LOCK.lock().expect("pocket lock");
    sweep(app, load(app))
}

pub fn add(app: &AppHandle, paths: &[String]) -> Vec<PocketItem> {
    let _g = LOCK.lock().expect("pocket lock");
    let mut items = load(app);
    let now = now_ms();
    for (i, p) in paths.iter().enumerate() {
        if !Path::new(p).exists() || items.iter().any(|s| s.path.eq_ignore_ascii_case(p)) {
            continue;
        }
        items.push(Stored {
            id: format!("{now:x}{i:02x}"),
            path: p.clone(),
            added_ms: now,
            seen_missing: false,
        });
    }
    if items.len() > MAX_ITEMS {
        let drop = items.len() - MAX_ITEMS;
        items.drain(..drop);
    }
    let shown = sweep(app, items);
    publish(app, &shown);
    shown
}

pub fn remove(app: &AppHandle, ids: &[String]) -> Vec<PocketItem> {
    let _g = LOCK.lock().expect("pocket lock");
    let mut items = load(app);
    if ids.is_empty() {
        items.clear(); // «فضّ الجيب»
    } else {
        items.retain(|s| !ids.contains(&s.id));
    }
    let shown = sweep(app, items);
    publish(app, &shown);
    shown
}

/// Paths of existing pocket items (only ids the pocket really holds).
pub fn paths(app: &AppHandle, ids: &[String]) -> Vec<String> {
    let _g = LOCK.lock().expect("pocket lock");
    load(app)
        .into_iter()
        .filter(|s| ids.contains(&s.id) && Path::new(&s.path).exists())
        .map(|s| s.path)
        .collect()
}

/// Re-reads the pocket after files moved and tells every window.
pub fn refresh(app: &AppHandle) {
    let shown = list(app);
    publish(app, &shown);
}

/// Auto-empty check every 10 minutes.
pub fn spawn(app: &AppHandle) {
    let app = app.clone();
    thread::Builder::new()
        .name("nimi-pocket".into())
        .spawn(move || loop {
            refresh(&app);
            thread::sleep(CHECK_EVERY);
        })
        .expect("spawn pocket thread");
}
