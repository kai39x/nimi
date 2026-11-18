//! «إشعارات البرامج»: other apps' notifications (WhatsApp, Teams, mail…) shown by NIMI.
//!
//! Windows' `UserNotificationListener` lists the toasts in the notification center. Its change
//! event is refused to unpackaged apps (0x80070490, tested), so this polls the list every 1.5 s
//! while the switch is on, and announces the ids it has not seen. What was already there when it
//! starts is not news. Nothing is removed from Windows' notification center, and the messages are
//! never written to disk (`notify::changed` skips `App`).
//!
//! NIMI cannot stop Windows' own pop-ups for other apps; Windows' «Do not disturb» does that while
//! still keeping the notifications in the center, where this reads them (the tour and the settings
//! say so and open that page).

use std::{
    collections::{HashMap, HashSet},
    thread,
    time::Duration,
};

use tauri::{AppHandle, Manager};
use windows::{
    ApplicationModel::AppDisplayInfo,
    Foundation::Size,
    Storage::Streams::DataReader,
    Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED},
    UI::Notifications::{
        KnownNotificationBindings,
        Management::{UserNotificationListener, UserNotificationListenerAccessStatus},
        NotificationKinds, UserNotification,
    },
};

use super::{notification, push};
use crate::{ipc::NotifyKind, settings::SettingsStore};

const POLL: Duration = Duration::from_millis(1500);
const IDLE: Duration = Duration::from_secs(3);
/// Longest title / body kept (characters).
const MAX_TEXT: usize = 400;
/// Larger logos are skipped rather than carried in every event.
const MAX_LOGO_BYTES: u32 = 256 * 1024;

fn init_com() {
    // SAFETY: COM on this worker thread; a repeat call just returns S_FALSE.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

/// "allowed", "denied" (Settings → Privacy → Notifications is off) or "unspecified".
/// Blocking WinRT call: run it on a worker thread.
pub fn access() -> &'static str {
    init_com();
    match UserNotificationListener::Current().and_then(|l| l.GetAccessStatus()) {
        Ok(UserNotificationListenerAccessStatus::Allowed) => "allowed",
        Ok(UserNotificationListenerAccessStatus::Denied) => "denied",
        _ => "unspecified",
    }
}

pub fn spawn(app: &AppHandle) {
    let app = app.clone();
    thread::Builder::new()
        .name("nimi-app-notify".into())
        .spawn(move || run(&app))
        .expect("spawn app notification watcher");
}

fn run(app: &AppHandle) {
    init_com();
    let mut seen: Option<HashSet<u32>> = None;
    let mut logos: HashMap<String, Option<String>> = HashMap::new();
    let mut warned = false;
    loop {
        if !app.state::<SettingsStore>().get().notify_watch.apps {
            // Off: forget everything, so turning it on again does not replay old toasts.
            seen = None;
            logos.clear();
            thread::sleep(IDLE);
            continue;
        }
        match poll(app, &mut seen, &mut logos) {
            Ok(()) => warned = false,
            Err(err) => {
                if !warned {
                    log::warn!("app notifications: {err}");
                    warned = true;
                }
                thread::sleep(IDLE);
                continue;
            }
        }
        thread::sleep(POLL);
    }
}

fn poll(
    app: &AppHandle,
    seen: &mut Option<HashSet<u32>>,
    logos: &mut HashMap<String, Option<String>>,
) -> windows::core::Result<()> {
    let listener = UserNotificationListener::Current()?;
    if listener.GetAccessStatus()? != UserNotificationListenerAccessStatus::Allowed {
        return Err(windows::core::Error::new(
            windows::Win32::Foundation::E_ACCESSDENIED,
            "Windows does not allow reading notifications",
        ));
    }
    let list = listener
        .GetNotificationsAsync(NotificationKinds::Toast)?
        .join()?;
    let mut ids = HashSet::new();
    let mut fresh = Vec::new();
    for i in 0..list.Size()? {
        let n = list.GetAt(i)?;
        let id = n.Id()?;
        ids.insert(id);
        if seen.as_ref().is_some_and(|s| !s.contains(&id)) {
            fresh.push(n);
        }
    }
    *seen = Some(ids);
    // Oldest first, so the newest ends up on top of NIMI's list.
    fresh.sort_by_key(|n| {
        n.CreationTime()
            .map(|t| t.UniversalTime)
            .unwrap_or_default()
    });
    for n in fresh {
        if let Some(note) = describe(&n, logos) {
            push(app, note);
        }
    }
    Ok(())
}

fn clip(s: &str) -> String {
    let s = s.trim();
    if s.chars().count() <= MAX_TEXT {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(MAX_TEXT).collect::<String>())
    }
}

fn describe(
    n: &UserNotification,
    logos: &mut HashMap<String, Option<String>>,
) -> Option<crate::ipc::Notification> {
    let info = n.AppInfo().ok();
    let aumid = info
        .as_ref()
        .and_then(|i| i.AppUserModelId().ok())
        .map(|s| s.to_string());
    let display = info.as_ref().and_then(|i| i.DisplayInfo().ok());
    let name = display
        .as_ref()
        .and_then(|d| d.DisplayName().ok())
        .map(|s| s.to_string())
        .filter(|s| !s.trim().is_empty());

    let binding = n
        .Notification()
        .ok()?
        .Visual()
        .ok()?
        .GetBinding(&KnownNotificationBindings::ToastGeneric().ok()?)
        .ok()?;
    let texts = binding.GetTextElements().ok()?;
    let lines: Vec<String> = (0..texts.Size().unwrap_or(0))
        .filter_map(|i| texts.GetAt(i).and_then(|e| e.Text()).ok())
        .map(|s| s.to_string())
        .filter(|s| !s.trim().is_empty())
        .collect();
    if lines.is_empty() && name.is_none() {
        return None;
    }

    let mut out = notification(NotifyKind::App);
    out.name = name;
    out.title = lines.first().map(|s| clip(s));
    let body = lines.iter().skip(1).cloned().collect::<Vec<_>>().join("\n");
    out.body = (!body.is_empty()).then(|| clip(&body));
    if let Some(id) = aumid {
        out.icon = logos
            .entry(id.clone())
            .or_insert_with(|| display.as_ref().and_then(logo))
            .clone();
        out.path = Some(format!("shell:AppsFolder\\{id}"));
    }
    Some(out)
}

/// The app's logo as a `data:` URL (cached per app by the caller).
fn logo(d: &AppDisplayInfo) -> Option<String> {
    let stream = d
        .GetLogo(Size {
            Width: 48.0,
            Height: 48.0,
        })
        .ok()?
        .OpenReadAsync()
        .ok()?
        .join()
        .ok()?;
    let size = u32::try_from(stream.Size().ok()?).ok()?;
    if size == 0 || size > MAX_LOGO_BYTES {
        return None;
    }
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    reader.LoadAsync(size).ok()?.join().ok()?;
    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    let kind = stream
        .ContentType()
        .ok()
        .map(|s| s.to_string())
        .filter(|s| s.starts_with("image/"))
        .unwrap_or_else(|| "image/png".into());
    Some(format!(
        "data:{kind};base64,{}",
        crate::media::smtc::base64(&bytes)
    ))
}
