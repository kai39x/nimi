//! Installed apps for «افتح» and the favorites picker: Windows' Apps folder (`shell:AppsFolder`)
//! lists every Start-menu shortcut and Store app (Settings, Calculator…) under its display name,
//! with an id that `ShellExecute("shell:AppsFolder\<id>")` launches. Cached for ten minutes.

use std::{
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use windows::Win32::{
    System::Com::{CoInitializeEx, CoTaskMemFree, COINIT_APARTMENTTHREADED},
    UI::Shell::{
        BHID_EnumItems, FOLDERID_AppsFolder, IEnumShellItems, IShellItem, SHGetKnownFolderItem,
        KF_FLAG_DEFAULT, SIGDN, SIGDN_NORMALDISPLAY, SIGDN_PARENTRELATIVEPARSING,
    },
};

use super::{fold, score};
use crate::ipc::AppHit;

const FRESH: Duration = Duration::from_secs(600);

struct Entry {
    key: String,
    hit: AppHit,
}

static CACHE: Mutex<Option<(Instant, Vec<Entry>)>> = Mutex::new(None);
static BUILDING: Mutex<bool> = Mutex::new(false);

/// Builds the list in the background if it is missing or stale.
pub fn warm() {
    let stale = CACHE
        .lock()
        .expect("apps lock")
        .as_ref()
        .is_none_or(|(at, _)| at.elapsed() > FRESH);
    if stale {
        thread::spawn(rebuild);
    }
}

fn rebuild() {
    {
        let mut b = BUILDING.lock().expect("apps lock");
        if *b {
            return;
        }
        *b = true;
    }
    let list = enumerate();
    if !list.is_empty() {
        *CACHE.lock().expect("apps lock") = Some((Instant::now(), list));
    }
    *BUILDING.lock().expect("apps lock") = false;
}

pub fn search(query: &str, limit: usize) -> Vec<AppHit> {
    if CACHE.lock().expect("apps lock").is_none() {
        // First use: build it now (on its own STA thread) and wait.
        let _ = thread::spawn(rebuild).join();
    } else {
        warm();
    }
    let q = fold(query.trim());
    let cache = CACHE.lock().expect("apps lock");
    let Some((_, list)) = cache.as_ref() else {
        return Vec::new();
    };
    let mut hits: Vec<(u32, &Entry)> = list
        .iter()
        .filter_map(|e| score(&e.key, &q).map(|s| (s, e)))
        .collect();
    hits.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.key.cmp(&b.1.key)));
    hits.into_iter()
        .take(limit.max(1))
        .map(|(_, e)| e.hit.clone())
        .collect()
}

fn display(item: &IShellItem, kind: SIGDN) -> Option<String> {
    // SAFETY: shell string out-param, freed with CoTaskMemFree.
    unsafe {
        let p = item.GetDisplayName(kind).ok()?;
        let s = p.to_string().ok();
        CoTaskMemFree(Some(p.0 as *const _));
        s
    }
}

/// Uninstallers, readmes and web links are noise in a launcher.
fn is_noise(name: &str, id: &str) -> bool {
    let n = name.to_lowercase();
    let id = id.to_lowercase();
    [
        "uninstall",
        "readme",
        "read me",
        "release notes",
        "documentation",
        "website",
        "help",
    ]
    .iter()
    .any(|w| n.contains(w))
        || [".url", ".chm", ".txt", ".html", ".htm", ".pdf", ".rtf"]
            .iter()
            .any(|e| id.ends_with(e))
        || id.starts_with("http")
}

fn enumerate() -> Vec<Entry> {
    let mut out = Vec::new();
    // SAFETY: shell enumeration on this thread's own STA; every interface is ref-counted.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let Ok(folder) =
            SHGetKnownFolderItem::<IShellItem>(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None)
        else {
            return out;
        };
        let Ok(items) = folder.BindToHandler::<_, IEnumShellItems>(None, &BHID_EnumItems) else {
            return out;
        };
        loop {
            let mut batch: [Option<IShellItem>; 1] = [None];
            let mut fetched = 0u32;
            if items.Next(&mut batch, Some(&mut fetched)).is_err() || fetched == 0 {
                break;
            }
            let Some(item) = batch[0].take() else {
                break;
            };
            let (Some(name), Some(id)) = (
                display(&item, SIGDN_NORMALDISPLAY),
                display(&item, SIGDN_PARENTRELATIVEPARSING),
            ) else {
                continue;
            };
            if name.trim().is_empty() || is_noise(&name, &id) {
                continue;
            }
            out.push(Entry {
                key: fold(&name),
                hit: AppHit {
                    name,
                    target: format!("shell:AppsFolder\\{id}"),
                },
            });
        }
    }
    out.sort_by(|a, b| a.key.cmp(&b.key));
    out.dedup_by(|a, b| a.key == b.key);
    out
}
