//! The SMTC worker thread (docs/PLAN.md §3). WinRT objects live on this one MTA thread; event
//! handlers (called on the WinRT thread pool) only post messages back to it.

use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    sync::{
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
        Arc,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Emitter, Manager};
use windows::{
    Foundation::TypedEventHandler,
    Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as SessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    },
    Storage::Streams::DataReader,
    Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
};

use super::{MediaShared, Msg};
use crate::ipc::{events, MediaArt, MediaCommand, MediaState, PlaybackStatus};

/// Some players skip timeline events; re-read now and then while a session exists.
const POLL_ACTIVE: Duration = Duration::from_secs(4);
const POLL_IDLE: Duration = Duration::from_secs(15);
/// Album art larger than this is skipped (players send ≤ 300 px JPEG/PNG, a few dozen KB).
const MAX_ART_BYTES: u64 = 1_500_000;
/// 100 ns ticks between 1601-01-01 (WinRT `DateTime`) and the Unix epoch.
const UNIX_EPOCH_TICKS: i64 = 116_444_736_000_000_000;

pub fn spawn(app: AppHandle) {
    let (tx, rx) = mpsc::channel();
    let shared = app.state::<Arc<MediaShared>>().inner().clone();
    *shared.tx.lock().expect("media tx lock") = Some(tx.clone());
    thread::Builder::new()
        .name("nimi-media".into())
        .spawn(move || {
            if let Err(err) = run(&app, &shared, &tx, &rx) {
                // No SMTC (stripped-down Windows): music features stay dark.
                log::warn!("media session manager unavailable: {err}");
            }
        })
        .expect("spawn media thread");
}

/// Tokens of the current session's event subscriptions.
struct Subscription {
    session: Session,
    props: i64,
    playback: i64,
    timeline: i64,
}

impl Drop for Subscription {
    fn drop(&mut self) {
        let _ = self.session.RemoveMediaPropertiesChanged(self.props);
        let _ = self.session.RemovePlaybackInfoChanged(self.playback);
        let _ = self.session.RemoveTimelinePropertiesChanged(self.timeline);
    }
}

/// Title / artist / album / art, re-read only when the player says they changed.
#[derive(Default, Clone)]
struct Props {
    title: String,
    artist: String,
    album: String,
    art_id: Option<String>,
}

fn run(
    app: &AppHandle,
    shared: &MediaShared,
    tx: &Sender<Msg>,
    rx: &Receiver<Msg>,
) -> windows::core::Result<()> {
    // SAFETY: initialises WinRT for this thread only; it lives for the app's lifetime.
    unsafe { RoInitialize(RO_INIT_MULTITHREADED)? };
    let manager = SessionManager::RequestAsync()?.join()?;
    {
        let tx = tx.clone();
        manager.CurrentSessionChanged(&TypedEventHandler::new(move |_, _| {
            let _ = tx.send(Msg::SessionChanged);
            Ok(())
        }))?;
    }

    let mut sub: Option<Subscription> = None;
    let mut props = Props::default();
    let mut resubscribe = true;
    let mut props_dirty = true;

    loop {
        if resubscribe {
            sub = None;
            if let Ok(session) = manager.GetCurrentSession() {
                sub = subscribe(session, tx).ok();
            }
            resubscribe = false;
            props_dirty = true;
        }

        let session = sub.as_ref().map(|s| &s.session);
        if props_dirty {
            props = session
                .and_then(|s| read_props(app, shared, s, &props).ok())
                .unwrap_or_default();
            props_dirty = false;
        }
        let state = session
            .and_then(|s| snapshot(s, &props).ok())
            .unwrap_or_default();
        publish(app, shared, state);

        // Wait for the next event, then drain the queue so a burst becomes one refresh.
        let wait = if sub.is_some() {
            POLL_ACTIVE
        } else {
            POLL_IDLE
        };
        let first = match rx.recv_timeout(wait) {
            Ok(msg) => Some(msg),
            Err(RecvTimeoutError::Timeout) => None,
            Err(RecvTimeoutError::Disconnected) => return Ok(()),
        };
        for msg in first.into_iter().chain(rx.try_iter()) {
            match msg {
                Msg::Refresh => {}
                Msg::PropsChanged => props_dirty = true,
                Msg::SessionChanged => resubscribe = true,
                Msg::Command(cmd) => {
                    if let Some(s) = sub.as_ref() {
                        if let Err(err) = command(&s.session, cmd) {
                            log::info!("media command {cmd:?} failed: {err}");
                        }
                    }
                }
            }
        }
    }
}

fn subscribe(session: Session, tx: &Sender<Msg>) -> windows::core::Result<Subscription> {
    let t1 = tx.clone();
    let props = session.MediaPropertiesChanged(&TypedEventHandler::new(move |_, _| {
        let _ = t1.send(Msg::PropsChanged);
        Ok(())
    }))?;
    let t2 = tx.clone();
    let playback = session.PlaybackInfoChanged(&TypedEventHandler::new(move |_, _| {
        let _ = t2.send(Msg::Refresh);
        Ok(())
    }))?;
    let t3 = tx.clone();
    let timeline = session.TimelinePropertiesChanged(&TypedEventHandler::new(move |_, _| {
        let _ = t3.send(Msg::Refresh);
        Ok(())
    }))?;
    Ok(Subscription {
        session,
        props,
        playback,
        timeline,
    })
}

fn read_props(
    app: &AppHandle,
    shared: &MediaShared,
    session: &Session,
    prev: &Props,
) -> windows::core::Result<Props> {
    let p = session.TryGetMediaPropertiesAsync()?.join()?;
    let mut out = Props {
        title: p.Title()?.to_string(),
        artist: p.Artist()?.to_string(),
        album: p.AlbumTitle()?.to_string(),
        art_id: None,
    };
    if let Some(art) = p
        .Thumbnail()
        .ok()
        .and_then(|thumb| read_art(&thumb).ok().flatten())
    {
        out.art_id = Some(art.id.clone());
        if prev.art_id.as_deref() != Some(art.id.as_str()) {
            *shared.art.lock().expect("media art lock") = Some(art.clone());
            let _ = app.emit(events::MEDIA_ART, art);
        }
    }
    Ok(out)
}

fn read_art(
    thumb: &windows::Storage::Streams::IRandomAccessStreamReference,
) -> windows::core::Result<Option<MediaArt>> {
    let stream = thumb.OpenReadAsync()?.join()?;
    let size = stream.Size()?;
    if size == 0 || size > MAX_ART_BYTES {
        return Ok(None);
    }
    let content_type = stream.ContentType()?.to_string();
    let reader = DataReader::CreateDataReader(&stream)?;
    reader.LoadAsync(size as u32)?.join()?;
    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes)?;
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    let mime = if content_type.starts_with("image/") {
        content_type
    } else {
        sniff_mime(&bytes).to_string()
    };
    Ok(Some(MediaArt {
        id: format!("{:016x}", hasher.finish()),
        data_url: format!("data:{mime};base64,{}", base64(&bytes)),
    }))
}

fn snapshot(session: &Session, props: &Props) -> windows::core::Result<MediaState> {
    let info = session.GetPlaybackInfo()?;
    let controls = info.Controls()?;
    let timeline = session.GetTimelineProperties()?;
    let start = timeline.StartTime()?.Duration;
    let end = timeline.EndTime()?.Duration;
    let position = timeline.Position()?.Duration;
    let updated = timeline.LastUpdatedTime()?.UniversalTime;
    let status = match info.PlaybackStatus()? {
        Status::Playing => PlaybackStatus::Playing,
        Status::Paused => PlaybackStatus::Paused,
        Status::Changing => PlaybackStatus::Changing,
        Status::Stopped => PlaybackStatus::Stopped,
        _ => PlaybackStatus::None,
    };
    let source_app = session.SourceAppUserModelId()?.to_string();
    Ok(MediaState {
        status,
        title: props.title.clone(),
        artist: props.artist.clone(),
        album: props.album.clone(),
        source_name: friendly_name(&source_app),
        source_app,
        position_ms: ((position - start).max(0)) / 10_000,
        duration_ms: ((end - start).max(0)) / 10_000,
        last_updated_ms: if updated > 0 {
            (updated - UNIX_EPOCH_TICKS) / 10_000
        } else {
            now_ms()
        },
        rate: info
            .PlaybackRate()
            .ok()
            .and_then(|r| r.Value().ok())
            .filter(|r| *r > 0.0)
            .unwrap_or(1.0),
        can_play_pause: controls.IsPlayPauseToggleEnabled()?,
        can_next: controls.IsNextEnabled()?,
        can_prev: controls.IsPreviousEnabled()?,
        can_seek: controls.IsPlaybackPositionEnabled()? && end > start,
        art_id: props.art_id.clone(),
    })
}

fn publish(app: &AppHandle, shared: &MediaShared, state: MediaState) {
    let mut current = shared.state.lock().expect("media state lock");
    if *current != state {
        *current = state.clone();
        drop(current);
        let _ = app.emit(events::MEDIA_STATE, state);
    }
}

fn command(session: &Session, cmd: MediaCommand) -> windows::core::Result<()> {
    match cmd {
        MediaCommand::PlayPause => {
            session.TryTogglePlayPauseAsync()?.join()?;
        }
        MediaCommand::Next => {
            session.TrySkipNextAsync()?.join()?;
        }
        MediaCommand::Previous => {
            session.TrySkipPreviousAsync()?.join()?;
        }
        MediaCommand::SeekTo { ms } => seek(session, |_, _| ms)?,
        MediaCommand::SeekBy { ms } => seek(session, |now, _| now + ms)?,
    }
    Ok(())
}

/// Seeks to `target(current_ms, duration_ms)`, clamped to the track.
fn seek(session: &Session, target: impl Fn(i64, i64) -> i64) -> windows::core::Result<()> {
    let timeline = session.GetTimelineProperties()?;
    let start = timeline.StartTime()?.Duration;
    let end = timeline.EndTime()?.Duration;
    let mut position = timeline.Position()?.Duration - start;
    let info = session.GetPlaybackInfo()?;
    if info.PlaybackStatus()? == Status::Playing {
        let updated = timeline.LastUpdatedTime()?.UniversalTime;
        if updated > 0 {
            position += (now_ms() * 10_000 + UNIX_EPOCH_TICKS - updated).max(0);
        }
    }
    let duration_ms = (end - start) / 10_000;
    let ms = target(position / 10_000, duration_ms).clamp(0, duration_ms.max(0));
    session
        .TryChangePlaybackPositionAsync(start + ms * 10_000)?
        .join()?;
    Ok(())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// «يشتغل من …»: a readable name for the common players, else the exe / package name.
fn friendly_name(aumid: &str) -> String {
    const KNOWN: &[(&str, &str)] = &[
        ("spotify", "Spotify"),
        ("msedge", "Edge"),
        ("chrome", "Chrome"),
        ("firefox", "Firefox"),
        ("opera", "Opera"),
        ("brave", "Brave"),
        ("vivaldi", "Vivaldi"),
        ("zunemusic", "Media Player"),
        ("mediaplayer", "Media Player"),
        ("applemusic", "Apple Music"),
        ("itunes", "iTunes"),
        ("vlc", "VLC"),
        ("deezer", "Deezer"),
        ("tidal", "TIDAL"),
        ("foobar2000", "foobar2000"),
        ("musicbee", "MusicBee"),
        ("aimp", "AIMP"),
    ];
    let lower = aumid.to_lowercase();
    if let Some((_, name)) = KNOWN.iter().find(|(key, _)| lower.contains(key)) {
        return (*name).to_string();
    }
    let last = aumid.rsplit(['\\', '/']).next().unwrap_or(aumid);
    let base = last.split(['!', '_']).next().unwrap_or(last);
    base.trim_end_matches(".exe")
        .trim_end_matches(".EXE")
        .to_string()
}

fn sniff_mime(bytes: &[u8]) -> &'static str {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [b'G', b'I', b'F', ..] => "image/gif",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "image/webp",
        _ => "image/jpeg",
    }
}

fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_rfc4648() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn friendly_names() {
        assert_eq!(friendly_name("Spotify.exe"), "Spotify");
        assert_eq!(friendly_name("MSEdge"), "Edge");
        assert_eq!(
            friendly_name("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"),
            "Media Player"
        );
        assert_eq!(friendly_name("C:\\Apps\\Strawberry.exe"), "Strawberry");
    }
}
