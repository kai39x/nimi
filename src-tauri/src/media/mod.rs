//! Music (phase 4, docs/PLAN.md §3): the current SMTC media session — the same one Windows' own
//! media flyout shows — and the system master volume.
//!
//! - `smtc`: one thread owns the WinRT session manager, follows the current session's events,
//!   publishes `MediaState` snapshots (`nimi://media/state`) and album art (`nimi://media/art`),
//!   and runs the transport commands.
//! - `volume`: Core Audio master volume with change notifications (`nimi://media/volume`); SMTC
//!   has no volume API.
//!
//! Both threads are fire-and-forget from the IPC side: commands go through a channel and the
//! result shows up as the next event. If either API is unavailable the feature stays dark and
//! nothing else is affected.

mod smtc;
mod volume;

use std::sync::{mpsc::Sender, Mutex};

use tauri::AppHandle;

use crate::ipc::{MediaArt, MediaCommand, MediaState, VolumeState};

pub enum Msg {
    /// Re-read the session (debounced by the thread).
    Refresh,
    /// Media properties changed: re-read title / artist / art too.
    PropsChanged,
    /// The current session changed: re-subscribe.
    SessionChanged,
    Command(MediaCommand),
}

pub enum VolumeMsg {
    Set(f64),
    Mute(bool),
}

/// Last published values plus the channels into the two worker threads.
#[derive(Default)]
pub struct MediaShared {
    state: Mutex<MediaState>,
    art: Mutex<Option<MediaArt>>,
    volume: Mutex<VolumeState>,
    tx: Mutex<Option<Sender<Msg>>>,
    volume_tx: Mutex<Option<Sender<VolumeMsg>>>,
}

impl MediaShared {
    pub fn state(&self) -> MediaState {
        self.state.lock().expect("media state lock").clone()
    }

    pub fn art(&self) -> Option<MediaArt> {
        self.art.lock().expect("media art lock").clone()
    }

    pub fn volume(&self) -> VolumeState {
        *self.volume.lock().expect("volume lock")
    }

    pub fn send(&self, msg: Msg) {
        if let Some(tx) = self.tx.lock().expect("media tx lock").as_ref() {
            let _ = tx.send(msg);
        }
    }

    pub fn send_volume(&self, msg: VolumeMsg) {
        if let Some(tx) = self.volume_tx.lock().expect("volume tx lock").as_ref() {
            let _ = tx.send(msg);
        }
    }
}

/// «افتح مشغّلك المفضّل»: reopens the player that last shared media when we can tell how
/// (a packaged app's AppUserModelId, or Spotify's URI), else the system's media player.
/// `explorer.exe` gets the target as one argument, never through a shell.
pub fn open_player(last_app: Option<&str>) -> std::io::Result<()> {
    let target = last_app
        .and_then(launch_target)
        .unwrap_or_else(|| "mswindowsmusic:".to_string());
    std::process::Command::new("explorer.exe")
        .arg(target)
        .spawn()
        .map(|_| ())
}

fn launch_target(aumid: &str) -> Option<String> {
    let safe = !aumid.is_empty()
        && aumid.len() < 256
        && aumid
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-!".contains(c));
    if !safe {
        return None;
    }
    if aumid.to_ascii_lowercase().contains("spotify") {
        return Some("spotify:".to_string());
    }
    aumid
        .contains('!')
        .then(|| format!("shell:AppsFolder\\{aumid}"))
}

pub fn spawn(app: &AppHandle) {
    smtc::spawn(app.clone());
    volume::spawn(app.clone());
}

#[cfg(test)]
mod tests {
    use super::launch_target;

    #[test]
    fn launch_targets() {
        assert_eq!(launch_target("Spotify.exe").as_deref(), Some("spotify:"));
        assert_eq!(
            launch_target("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic").as_deref(),
            Some("shell:AppsFolder\\Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic")
        );
        assert_eq!(launch_target("MSEdge"), None);
        assert_eq!(launch_target("evil.exe & calc"), None);
    }
}
