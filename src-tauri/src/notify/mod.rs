//! Notifications (phase 8, spec §5 «تنبيهات», board 14). Watchers report facts here; this keeps
//! the list (newest first, last 7 days, at most 60, in `notifications.json` next to the settings),
//! applies the user's «وش يراقب» switches, and broadcasts. The frontend decides how a level looks
//! (expression / capsule for 5 s / capsule until clicked) and honours «لا تزعجني».
//!
//! Watchers (`watch.rs`): drives and CPU / RAM from the system sampler, Downloads
//! (`ReadDirectoryChangesW`), USB volumes (`WM_DEVICECHANGE` on the overlay), the network
//! (Network List Manager), the battery on laptops; timers report from `tools::timer`.

pub mod apps;
pub mod watch;

use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use tauri::{AppHandle, Emitter, Manager};

use crate::{
    ipc::{events, Notification, NotifyKind, NotifyLevel, TrayState},
    settings::SettingsStore,
    tools::now_ms,
};

const KEEP: usize = 60;
const KEEP_MS: i64 = 7 * 24 * 3600 * 1000;

#[derive(Default)]
pub struct NotifyShared {
    list: Mutex<Vec<Notification>>,
    path: Mutex<Option<PathBuf>>,
}

fn shared(app: &AppHandle) -> Arc<NotifyShared> {
    app.state::<Arc<NotifyShared>>().inner().clone()
}

pub fn spawn(app: &AppHandle) {
    let sh = Arc::new(NotifyShared::default());
    let path = app
        .path()
        .app_local_data_dir()
        .ok()
        .map(|d| d.join("notifications.json"));
    if let Some(p) = path.as_ref() {
        if let Ok(bytes) = fs::read(p) {
            if let Ok(mut list) = serde_json::from_slice::<Vec<Notification>>(&bytes) {
                let cutoff = now_ms() - KEEP_MS;
                list.retain(|n| n.at_ms >= cutoff && n.kind.is_some());
                *sh.list.lock().expect("notify lock") = list;
            }
        }
    }
    *sh.path.lock().expect("notify lock") = path;
    app.manage(sh);
    sync_tray(app);
    watch::spawn(app);
    apps::spawn(app);
}

/// The level each kind gets (board 14: هادي «تنزيل خلص، فلاش انوصل» · عادي «المؤقت خلص، رام
/// عالية» · مهم «مساحة قربت تخلص، المعالج ٩٥٪ لدقايق»).
pub fn level_of(kind: NotifyKind, percent: Option<f64>) -> NotifyLevel {
    use NotifyKind::*;
    match kind {
        DiskLow | Reminder | BatteryLow => NotifyLevel::Important,
        CpuHigh if percent.is_some_and(|p| p >= 95.0) => NotifyLevel::Important,
        CpuHigh | RamHigh | TimerDone | PomodoroBreak | PomodoroWork | PomodoroDone | NetLost
        | App => NotifyLevel::Normal,
        Download | UsbIn | UsbOut | NetBack | PowerIn | PowerOut => NotifyLevel::Calm,
    }
}

fn watched(app: &AppHandle, kind: NotifyKind) -> bool {
    use NotifyKind::*;
    let w = app.state::<SettingsStore>().get().notify_watch;
    match kind {
        DiskLow => w.disk,
        CpuHigh | RamHigh => w.load,
        TimerDone | PomodoroBreak | PomodoroWork | PomodoroDone | Reminder => w.timer,
        Download => w.downloads,
        UsbIn | UsbOut => w.usb,
        NetLost | NetBack => w.network,
        BatteryLow | PowerIn | PowerOut => w.battery,
        App => w.apps,
    }
}

/// Adds a notification (unless its watcher is switched off) and announces it.
pub fn push(app: &AppHandle, mut n: Notification) {
    let Some(kind) = n.kind else {
        return;
    };
    if !watched(app, kind) {
        return;
    }
    n.level = Some(n.level.unwrap_or_else(|| level_of(kind, n.percent)));
    n.at_ms = now_ms();
    n.read = false;
    let sh = shared(app);
    {
        let mut list = sh.list.lock().expect("notify lock");
        n.id = list.iter().map(|x| x.id).max().unwrap_or(0) + 1;
        list.insert(0, n.clone());
        // Week-old ones go now too, not only at the next start (NIMI may run for weeks).
        let cutoff = n.at_ms - KEEP_MS;
        list.retain(|x| x.at_ms >= cutoff);
        list.truncate(KEEP);
    }
    log::info!("notify: {kind:?} {:?}", n.name);
    let _ = app.emit(events::NOTIFY_NEW, &n);
    changed(app);
}

pub fn notification(kind: NotifyKind) -> Notification {
    Notification {
        kind: Some(kind),
        ..Default::default()
    }
}

fn changed(app: &AppHandle) {
    let sh = shared(app);
    let list = sh.list.lock().expect("notify lock").clone();
    if let Some(p) = sh.path.lock().expect("notify lock").as_ref() {
        if let Some(dir) = p.parent() {
            let _ = fs::create_dir_all(dir);
        }
        // Other apps' messages stay in memory: they are private and gone when NIMI quits.
        let saved: Vec<&Notification> = list
            .iter()
            .filter(|n| n.kind != Some(NotifyKind::App))
            .collect();
        if let Ok(json) = serde_json::to_vec(&saved) {
            let tmp = p.with_extension("json.tmp");
            if fs::write(&tmp, json).is_ok() {
                let _ = fs::rename(&tmp, p);
            }
        }
    }
    let _ = app.emit(events::NOTIFY_LIST, &list);
    sync_tray(app);
}

/// The one place that picks the tray icon, from everything that affects it: hidden for a while
/// (sleeping NIMI) beats «لا تزعجني», which beats the unread dot. Every input calls this, so
/// one of them can no longer reset another's icon (showing again after a fullscreen game used
/// to drop the DND / unread icon).
pub fn sync_tray(app: &AppHandle) {
    let hidden_for_a_while = app
        .try_state::<Arc<crate::window::OverlayState>>()
        .is_some_and(|st| {
            crate::window::visibility::current(&st).reason == Some(crate::ipc::HideReason::Timer)
        });
    let dnd = app.state::<SettingsStore>().get().dnd;
    let unread = app
        .try_state::<Arc<NotifyShared>>()
        .is_some_and(|sh| sh.list.lock().expect("notify lock").iter().any(|n| !n.read));
    crate::tray::set_state(
        app,
        if hidden_for_a_while {
            TrayState::Sleep
        } else if dnd {
            TrayState::Dnd
        } else if unread {
            TrayState::Notify
        } else {
            TrayState::Normal
        },
    );
}

fn update(app: &AppHandle, f: impl FnOnce(&mut Vec<Notification>)) -> Vec<Notification> {
    let sh = shared(app);
    let list = {
        let mut list = sh.list.lock().expect("notify lock");
        f(&mut list);
        list.clone()
    };
    changed(app);
    list
}

pub fn list(app: &AppHandle) -> Vec<Notification> {
    shared(app).list.lock().expect("notify lock").clone()
}

pub fn dismiss(app: &AppHandle, id: u64) -> Vec<Notification> {
    update(app, |l| l.retain(|n| n.id != id))
}

pub fn clear(app: &AppHandle) -> Vec<Notification> {
    update(app, Vec::clear)
}

pub fn read_all(app: &AppHandle) -> Vec<Notification> {
    update(app, |l| l.iter_mut().for_each(|n| n.read = true))
}

/// Dev builds: one plausible notification of each kind, to see the levels on demand.
pub fn dev_fake(app: &AppHandle, kind: NotifyKind) {
    use NotifyKind::*;
    let mut n = notification(kind);
    match kind {
        DiskLow => {
            n.name = Some("C:".into());
            n.size = Some(12 << 30);
            n.total = Some(512 << 30);
        }
        CpuHigh => n.percent = Some(96.0),
        RamHigh => {
            n.percent = Some(88.0);
            n.name = Some("Brave".into());
            n.size = Some(3_400 << 20);
        }
        PomodoroBreak | PomodoroWork | PomodoroDone => {
            n.round = Some(1);
            n.rounds = Some(4);
        }
        Reminder => n.name = Some("اشرب موية".into()),
        Download => {
            n.name = Some("setup.exe".into());
            n.size = Some(84 << 20);
        }
        UsbIn | UsbOut => {
            n.name = Some("USB Drive (E:)".into());
            n.path = Some("E:\\".into());
        }
        NetLost | NetBack => n.name = Some("Wi-Fi".into()),
        BatteryLow => n.percent = Some(12.0),
        _ => {}
    }
    push(app, n);
}
