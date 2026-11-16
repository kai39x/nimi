//! Persisted settings: one JSON file, loaded at startup, replaced atomically on change.
//! Changes are applied through [`update`], which persists, runs the side effects that live in
//! Rust (autostart, placement, tray) and broadcasts `nimi://settings/changed` to every window.

use std::{fs, io, path::PathBuf, sync::Mutex};

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;

use crate::ipc::{events, Settings};

pub struct SettingsStore {
    path: PathBuf,
    inner: Mutex<Settings>,
}

impl SettingsStore {
    /// Loads `settings.json` (or defaults) and registers the store as managed state.
    pub fn init(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
        let dir = app.path().app_config_dir()?;
        fs::create_dir_all(&dir)?;
        let path = dir.join("settings.json");

        let mut settings: Settings = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|err| {
                log::warn!("settings.json is unreadable ({err}); starting from defaults");
                Settings::default()
            }),
            Err(_) => Settings::default(),
        };
        if settings.first_run_ms == 0 {
            settings.first_run_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            if let Ok(json) = serde_json::to_vec_pretty(&settings) {
                let _ = fs::write(&path, json);
            }
        }

        app.manage(SettingsStore {
            path,
            inner: Mutex::new(settings),
        });
        Ok(())
    }

    pub fn get(&self) -> Settings {
        self.inner.lock().expect("settings lock").clone()
    }

    /// Mutates in place and persists. Returns `(before, after)`.
    fn mutate(&self, f: impl FnOnce(&mut Settings)) -> (Settings, Settings) {
        let mut guard = self.inner.lock().expect("settings lock");
        let before = guard.clone();
        f(&mut guard);
        let after = guard.clone();
        drop(guard);

        if before != after {
            if let Err(err) = self.save(&after) {
                log::error!("could not save settings: {err}");
            }
        }
        (before, after)
    }

    fn save(&self, settings: &Settings) -> io::Result<()> {
        let json = serde_json::to_vec_pretty(settings).map_err(io::Error::other)?;
        // Write to a sibling file first so a crash mid-write never truncates the real one.
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, json)?;
        fs::rename(&tmp, &self.path)
    }
}

/// Applies a settings change end to end: persist, side effects, broadcast. Returns the new value.
pub fn update(app: &AppHandle, f: impl FnOnce(&mut Settings)) -> Settings {
    let (before, after) = app.state::<SettingsStore>().mutate(f);
    if before != after {
        apply_side_effects(app, &before, &after);
        if let Err(err) = app.emit(events::SETTINGS_CHANGED, &after) {
            log::warn!("could not broadcast settings: {err}");
        }
    }
    after
}

fn apply_side_effects(app: &AppHandle, before: &Settings, after: &Settings) {
    if before.autostart != after.autostart {
        if let Err(err) = sync_autostart(app, after.autostart) {
            log::warn!("autostart change failed: {err}");
        }
    }
    if before.display != after.display {
        if let Err(err) = crate::window::placement::place(app) {
            log::warn!("re-placing the overlay failed: {err}");
        }
    }
    if before.language != after.language {
        crate::tray::rebuild_menu(app);
    }
    if before.sounds_muted != after.sounds_muted {
        crate::tray::sync_mute(app);
    }
    if before.command_hotkey != after.command_hotkey {
        crate::hotkeys::set_mode(after.command_hotkey);
    }
    if before.clipboard_history && !after.clipboard_history {
        crate::tools::clipboard::clear(app);
    }
    if before.phish_feed != after.phish_feed {
        if after.phish_feed {
            crate::files::link::refresh_feed(app);
        } else {
            crate::files::link::drop_feed();
        }
    }
}

/// Makes the Windows Run key match the setting (the setting is the source of truth).
pub fn sync_autostart(app: &AppHandle, enabled: bool) -> Result<(), tauri_plugin_autostart::Error> {
    let launcher = app.autolaunch();
    match (enabled, launcher.is_enabled()?) {
        (true, false) => launcher.enable(),
        (false, true) => launcher.disable(),
        _ => Ok(()),
    }
}
