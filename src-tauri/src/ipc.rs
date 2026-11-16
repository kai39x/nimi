//! Typed IPC surface between Rust and React.
//!
//! Every payload derives `ts_rs::TS` with `#[ts(export)]`; `npm run ipc:gen` writes the
//! TypeScript mirrors to `src/ipc/generated/`, and `src/ipc/commands.ts` wraps each command.
//! Event names live in [`events`] and are mirrored by hand in `src/ipc/events.ts`.

use std::{collections::HashMap, sync::Arc};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use ts_rs::TS;

use crate::{
    files::{self, FilesShared},
    media::{self, MediaShared},
    pocket,
    settings::SettingsStore,
    system::{self, SystemShared},
    window::{self, OverlayState},
};

/// Event names (Rust → React). Keep `src/ipc/events.ts` in sync.
pub mod events {
    pub const OVERLAY_VISIBILITY: &str = "nimi://overlay/visibility";
    pub const OVERLAY_DRAG: &str = "nimi://overlay/drag";
    pub const OVERLAY_CURSOR: &str = "nimi://overlay/cursor";
    pub const OVERLAY_CLICK_OUTSIDE: &str = "nimi://overlay/click-outside";
    /// `bool`: a maximized window's title bar / tab strip lies under the capsule (peek mode).
    pub const OVERLAY_COVERED: &str = "nimi://overlay/covered";
    pub const SETTINGS_CHANGED: &str = "nimi://settings/changed";
    pub const TRAY_OPEN: &str = "nimi://tray/open";
    pub const MEDIA_STATE: &str = "nimi://media/state";
    pub const MEDIA_ART: &str = "nimi://media/art";
    pub const MEDIA_VOLUME: &str = "nimi://media/volume";
    pub const SYSTEM_STATS: &str = "nimi://system/stats";
    pub const SYSTEM_SCAN: &str = "nimi://system/scan";
    pub const POCKET_CHANGED: &str = "nimi://pocket/changed";
    /// [`DropEvent`]: OS drag-and-drop over the overlay (files, links, text).
    pub const DROP: &str = "nimi://drop";
}

// ---------------------------------------------------------------------------------------------
// App

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppInfo {
    pub version: String,
    pub tauri_version: String,
    pub debug: bool,
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        tauri_version: tauri::VERSION.to_string(),
        debug: cfg!(debug_assertions),
    }
}

// ---------------------------------------------------------------------------------------------
// Settings

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Language {
    #[default]
    Ar,
    En,
}

/// Persisted user settings (`%APPDATA%/io.github.kai39x.nimi/settings.json`).
/// Every field has a default so older files keep loading when new fields are added.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Settings {
    pub language: Language,
    pub autostart: bool,
    /// `"primary"` or a monitor name as reported by `list_monitors`.
    pub display: String,
    /// Horizontal offset of the capsule from the monitor's top-center, in logical px, per monitor name.
    pub overlay_offsets: HashMap<String, i32>,
    pub sounds_muted: bool,
    pub reduce_motion: bool,
    /// NIMI's nominal size in the capsule (48–96); the capsule scales with it.
    pub nimi_size: u32,
    pub winter: WinterMode,
    /// Snowfall around the capsule in winter (hat and scarf stay when off).
    pub snow: bool,
    /// Minutes of inactivity after getting bored before sleeping; 0 = never.
    pub sleep_after_min: u32,
    pub nuri_activity: NuriActivity,
    /// «الكبسولة»: what the compact state shows (glass with NIMI, glass only, or NIMI alone).
    pub capsule_style: CapsuleStyle,
    /// «يطل»: over a maximized window the capsule slides up and only a 12 px strip stays.
    pub peek_over_maximized: bool,
    /// «وين تروح النتيجة»: where feeding results are saved.
    pub results_location: ResultsLocation,
    /// «الجيب يفضى»: when the pocket empties itself.
    pub pocket_empty: PocketEmpty,
    /// «فحص الروابط بقائمة OpenPhish»: download the public phishing list once a day and check
    /// dropped links against it locally. Off by default: NIMI stays offline unless asked.
    pub phish_feed: bool,
    /// Unix time (ms) of the very first launch — «معك من N يوم». 0 until set.
    #[ts(type = "number")]
    pub first_run_ms: u64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: Language::Ar,
            autostart: false,
            display: "primary".into(),
            overlay_offsets: HashMap::new(),
            sounds_muted: false,
            reduce_motion: false,
            nimi_size: 64,
            winter: WinterMode::Auto,
            snow: true,
            sleep_after_min: 10,
            nuri_activity: NuriActivity::Normal,
            capsule_style: CapsuleStyle::NimiInCapsule,
            peek_over_maximized: true,
            results_location: ResultsLocation::NextToOriginal,
            pocket_empty: PocketEmpty::Day,
            phish_feed: false,
            first_run_ms: 0,
        }
    }
}

/// «زينة الشتاء»: auto = Dec 1 → end of Feb by the device date.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum WinterMode {
    #[default]
    Auto,
    Always,
    Off,
}

/// «نشاط نوري»: how fast Nuri orbits in the normal state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum NuriActivity {
    Calm,
    #[default]
    Normal,
    Active,
}

/// Where a feeding result (ZIP, converted image…) is saved (spec §6).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ResultsLocation {
    #[default]
    NextToOriginal,
    Downloads,
    Ask,
}

/// The pocket empties itself after a day, a week, or never (spec §7).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PocketEmpty {
    #[default]
    Day,
    Week,
    Never,
}

/// «الكبسولة»: how the compact state looks. The panel is always glass with NIMI on top.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum CapsuleStyle {
    /// NIMI inside the glass capsule (board 06).
    #[default]
    NimiInCapsule,
    /// The glass capsule alone, no character.
    CapsuleOnly,
    /// NIMI floating on his own, no glass.
    NimiOnly,
}

#[tauri::command]
pub fn get_settings(store: State<'_, SettingsStore>) -> Settings {
    store.get()
}

/// Replaces the whole settings object (the frontend always holds the full value).
#[tauri::command]
pub fn set_settings(app: AppHandle, settings: Settings) -> Settings {
    crate::settings::update(&app, move |current| *current = settings)
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MonitorInfo {
    pub name: String,
    pub is_primary: bool,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

#[tauri::command]
pub fn list_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    window::placement::list_monitors(&app).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------------------------
// Overlay window

/// A mouse-interactive region of the overlay, in CSS px relative to the window's client area.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HitRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[tauri::command]
pub fn set_hit_rects(state: State<'_, Arc<OverlayState>>, rects: Vec<HitRect>) {
    *state.rects.lock().expect("hit rects lock") = rects;
}

/// Why the overlay is hidden right now (`None` in the visibility payload means visible).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum HideReason {
    Fullscreen,
    Timer,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct OverlayVisibility {
    pub visible: bool,
    pub reason: Option<HideReason>,
}

#[tauri::command]
pub fn get_overlay_visibility(state: State<'_, Arc<OverlayState>>) -> OverlayVisibility {
    window::visibility::current(&state)
}

#[tauri::command]
pub fn hide_overlay_for(app: AppHandle, seconds: u64) {
    window::visibility::hide_for(&app, std::time::Duration::from_secs(seconds));
}

#[tauri::command]
pub fn show_overlay(app: AppHandle) {
    window::visibility::show_now(&app);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum DragPhase {
    Start,
    Move,
    End,
}

/// Progress of a capsule drag along the top edge (driven by Rust, see `window::hittest`).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct OverlayDragEvent {
    pub phase: DragPhase,
    pub moved: bool,
}

#[tauri::command]
pub fn start_overlay_drag(app: AppHandle) -> Result<(), String> {
    window::hittest::begin_drag(&app)
}

#[tauri::command]
pub fn recenter_overlay(app: AppHandle) -> Result<(), String> {
    window::placement::recenter(&app).map_err(|e| e.to_string())
}

/// Cursor relation to the interactive regions: `near` = within the approach zone,
/// `inside` = over an interactive element.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CursorProximity {
    pub near: bool,
    pub inside: bool,
    /// Within 60 px of the hit rects, or the primary button is held close by (a file drag):
    /// a peeking capsule slides down.
    pub reveal: bool,
}

/// Whether a maximized window sits under the capsule right now (peek mode), for the first render.
#[tauri::command]
pub fn get_overlay_covered(state: State<'_, Arc<OverlayState>>) -> bool {
    state.covered.load(std::sync::atomic::Ordering::Relaxed)
}

/// Tells the hit-test loop whether the panel is open, so clicks outside it can collapse it.
#[tauri::command]
pub fn set_overlay_expanded(state: State<'_, Arc<OverlayState>>, expanded: bool) {
    state
        .expanded
        .store(expanded, std::sync::atomic::Ordering::Relaxed);
}

/// Gives the overlay keyboard focus while the panel / command bar is open (Esc, typing) and
/// makes it non-activatable again afterwards so it never steals focus in compact mode.
#[tauri::command]
pub fn focus_overlay(app: AppHandle, focus: bool) -> Result<(), String> {
    window::set_overlay_focus(&app, focus).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_settings_window(app: AppHandle) -> Result<(), String> {
    // Windows are created on the main thread; commands run on the async runtime.
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if let Err(err) = window::settings_window::open(&handle) {
            log::warn!("could not open settings: {err}");
        }
    })
    .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------------------------
// Media (SMTC + system volume, docs/PLAN.md §3)

/// Playback status of the current SMTC session; `none` when no app shares media.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum PlaybackStatus {
    #[default]
    None,
    Stopped,
    Changing,
    Paused,
    Playing,
}

/// One snapshot of the current media session. Position is sampled at `lastUpdatedMs` (Unix
/// ms); the frontend interpolates `positionMs + (now − lastUpdatedMs) × rate` while playing.
#[derive(Debug, Clone, PartialEq, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MediaState {
    pub status: PlaybackStatus,
    pub title: String,
    pub artist: String,
    pub album: String,
    /// The app's AppUserModelId (`Spotify.exe`, `MSEdge`, …).
    pub source_app: String,
    /// A readable app name for «يشتغل من …».
    pub source_name: String,
    #[ts(type = "number")]
    pub position_ms: i64,
    #[ts(type = "number")]
    pub duration_ms: i64,
    #[ts(type = "number")]
    pub last_updated_ms: i64,
    pub rate: f64,
    pub can_play_pause: bool,
    pub can_next: bool,
    pub can_prev: bool,
    /// Seeking (and ±10 s) is allowed; otherwise the seek bar is read-only.
    pub can_seek: bool,
    /// Id of the album art (fetch it with `get_media_art`); changes only when the art does.
    pub art_id: Option<String>,
}

/// Album art as a `data:` URL, sent once per change (`nimi://media/art`).
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MediaArt {
    pub id: String,
    pub data_url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "kind")]
#[ts(export)]
pub enum MediaCommand {
    PlayPause,
    Next,
    Previous,
    /// Absolute position in ms.
    SeekTo {
        #[ts(type = "number")]
        ms: i64,
    },
    /// Relative jump in ms (±10 s buttons).
    SeekBy {
        #[ts(type = "number")]
        ms: i64,
    },
}

/// System master volume (Core Audio), 0..1.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct VolumeState {
    pub level: f64,
    pub muted: bool,
    /// False when no audio endpoint could be opened (the slider hides).
    pub available: bool,
}

#[tauri::command]
pub fn get_media_state(media: State<'_, Arc<MediaShared>>) -> MediaState {
    media.state()
}

#[tauri::command]
pub fn get_media_art(media: State<'_, Arc<MediaShared>>) -> Option<MediaArt> {
    media.art()
}

/// Fire-and-forget: the result arrives as the next `nimi://media/state`.
#[tauri::command]
pub fn media_command(media: State<'_, Arc<MediaShared>>, command: MediaCommand) {
    media.send(media::Msg::Command(command));
}

/// «افتح مشغّلك المفضّل» in the empty music state.
#[tauri::command]
pub fn open_media_player(last_app: Option<String>) -> Result<(), String> {
    media::open_player(last_app.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_volume(media: State<'_, Arc<MediaShared>>) -> VolumeState {
    media.volume()
}

#[tauri::command]
pub fn set_volume(media: State<'_, Arc<MediaShared>>, level: f64) {
    media.send_volume(media::VolumeMsg::Set(level.clamp(0.0, 1.0)));
}

#[tauri::command]
pub fn set_volume_muted(media: State<'_, Arc<MediaShared>>, muted: bool) {
    media.send_volume(media::VolumeMsg::Mute(muted));
}

// ---------------------------------------------------------------------------------------------
// System (phase 5, design spec §5 «النظام», board 12)

/// What kind of app it is, so the UI can say «المتصفح» / «مشغّل الألعاب» like board 12.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum AppCategory {
    Browser,
    Launcher,
}

/// The app using the most of something (CPU % or RAM bytes), grouped by exe.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TopApp {
    /// Readable name from the exe's version info («Google Chrome»).
    pub name: String,
    /// Lower-case exe name.
    pub exe: String,
    pub category: Option<AppCategory>,
    /// CPU percent of the whole machine, or bytes of RAM.
    pub value: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CpuStats {
    /// 0..100
    pub usage: f64,
    pub cores: u32,
    pub threads: u32,
    pub top: Option<TopApp>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RamStats {
    pub usage: f64,
    #[ts(type = "number")]
    pub used: u64,
    #[ts(type = "number")]
    pub total: u64,
    pub top: Option<TopApp>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GpuStats {
    pub name: String,
    pub usage: f64,
    #[ts(type = "number")]
    pub vram_used: u64,
    #[ts(type = "number")]
    pub vram_total: u64,
    /// °C when the driver reports it without admin rights (WDDM 2.4+); the line hides otherwise.
    pub temp_c: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum DriveState {
    Ok,
    Warn,
    Full,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DriveInfo {
    /// `C:`
    pub letter: String,
    pub label: String,
    #[ts(type = "number")]
    pub total: u64,
    #[ts(type = "number")]
    pub free: u64,
    pub ssd: Option<bool>,
    pub state: DriveState,
    /// Holds Windows.
    pub system: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BatteryInfo {
    pub percent: u8,
    pub charging: bool,
}

/// One sample: every 2 s while the panel is open (with GPU and top apps), every 10 s compact.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SystemStats {
    #[ts(type = "number")]
    pub at_ms: i64,
    pub cpu: CpuStats,
    pub ram: RamStats,
    pub gpu: Option<GpuStats>,
    pub drives: Vec<DriveInfo>,
    /// Only when the machine has one (spec: no battery card on a desktop).
    pub battery: Option<BatteryInfo>,
    /// Top apps and GPU are only measured while the panel is open.
    pub detailed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum ScanPhase {
    Running,
    Done,
    Cancelled,
}

/// «أفحص القرص C…»: progress of the largest-files scan (board_states).
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ScanProgress {
    pub drive: String,
    pub phase: ScanPhase,
    #[ts(type = "number")]
    pub files: u64,
    /// Bytes seen so far against the drive's used bytes → the progress bar.
    #[ts(type = "number")]
    pub bytes: u64,
    #[ts(type = "number")]
    pub bytes_total: u64,
    pub current: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum FileKind {
    Video,
    Archive,
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BigFile {
    pub path: String,
    pub name: String,
    /// Name of the folder it sits in («Downloads»).
    pub folder: String,
    #[ts(type = "number")]
    pub size: u64,
    #[ts(type = "number")]
    pub modified_ms: i64,
    pub kind: FileKind,
    /// System file: shown with a lock, never selectable.
    pub locked: bool,
    pub in_downloads: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ScanResult {
    pub drive: String,
    pub files: Vec<BigFile>,
    #[ts(type = "number")]
    pub finished_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileActionResult {
    pub done: Vec<String>,
    pub failed: Vec<String>,
    #[ts(type = "number")]
    pub bytes: u64,
    /// Where moved files went (`G:\NIMI`).
    pub dest: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BoostApp {
    pub exe: String,
    pub name: String,
    pub category: Option<AppCategory>,
    #[ts(type = "number")]
    pub bytes: u64,
    pub processes: u32,
    /// Has a visible window (even minimized or on another desktop); such apps are asked to
    /// close and never forced. Otherwise it runs in the background.
    pub windowed: bool,
    /// Ticked by default: background game launchers only (board 12 ج); everything else waits
    /// for the user to tick it.
    pub suggested: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PowerInfo {
    /// The High performance plan exists and is not already active.
    pub available: bool,
    /// Boost switched it on; Windows' previous plan comes back at this time (Unix ms).
    #[ts(type = "number | null")]
    pub boosted_until_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BoostPreview {
    #[ts(type = "number")]
    pub temp_bytes: u64,
    #[ts(type = "number")]
    pub temp_files: u64,
    #[ts(type = "number")]
    pub recycle_bytes: u64,
    #[ts(type = "number")]
    pub recycle_items: u64,
    pub apps: Vec<BoostApp>,
    pub power: PowerInfo,
    #[ts(type = "number | null")]
    pub last_run_ms: Option<i64>,
    #[ts(type = "number")]
    pub last_freed: u64,
}

/// What the user ticked.
#[derive(Debug, Clone, PartialEq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BoostPlan {
    pub temp: bool,
    pub recycle: bool,
    /// Exe names of the apps to close.
    pub apps: Vec<String>,
    pub power: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BoostResult {
    #[ts(type = "number")]
    pub freed_bytes: u64,
    pub closed: Vec<String>,
    /// Apps that would not close (they have a window; NIMI never forces those).
    pub left_open: Vec<String>,
    #[ts(type = "number | null")]
    pub power_until_ms: Option<i64>,
}

#[tauri::command]
pub fn get_system_stats(system: State<'_, Arc<SystemShared>>) -> Option<SystemStats> {
    system.stats()
}

/// Starts (or restarts) the largest-files scan of one fixed drive; progress on `nimi://system/scan`.
#[tauri::command]
pub fn start_scan(app: AppHandle, drive: String) -> Result<(), String> {
    system::scan::start(&app, &drive)
}

#[tauri::command]
pub fn cancel_scan(system: State<'_, Arc<SystemShared>>) {
    system.cancel_scan();
}

#[tauri::command]
pub fn get_scan(
    system: State<'_, Arc<SystemShared>>,
    drive: String,
) -> (Option<ScanProgress>, Option<ScanResult>) {
    system.scan_state(&drive)
}

/// Moves files from the last scan to `<drive>\NIMI` (only files from that scan, never locked ones).
#[tauri::command]
pub async fn move_files(
    app: AppHandle,
    paths: Vec<String>,
    to_drive: String,
) -> Result<FileActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || system::scan::move_files(&app, &paths, &to_drive))
        .await
        .map_err(|e| e.to_string())?
}

/// Sends files from the last scan to the Recycle Bin (Windows warns if one is too big to recycle).
#[tauri::command]
pub async fn recycle_files(app: AppHandle, paths: Vec<String>) -> Result<FileActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || system::scan::recycle_files(&app, &paths))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn boost_preview() -> Result<BoostPreview, String> {
    tauri::async_runtime::spawn_blocking(system::boost::preview)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn run_boost(app: AppHandle, plan: BoostPlan) -> Result<BoostResult, String> {
    tauri::async_runtime::spawn_blocking(move || system::boost::run(&app, &plan))
        .await
        .map_err(|e| e.to_string())
}

/// «رجّع الطاقة»: puts the previous power plan back now.
#[tauri::command]
pub fn restore_power() -> Result<(), String> {
    system::boost::restore_power().map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------------------------
// Feeding & pocket (phase 6, design spec §6–7, boards 08–09)

/// What NIMI just ate — picks the bubbles and the «المزيد» actions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum MealKind {
    Image,
    Archive,
    Folder,
    Pdf,
    Text,
    Other,
    /// More than one item.
    Many,
    /// A dragged web link (or a `.url` shortcut file).
    Link,
    /// Dragged text (a selection from a browser or an editor).
    Note,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Meal {
    pub kind: MealKind,
    pub paths: Vec<String>,
    /// First item's name (the pill under the bubbles).
    pub name: String,
    #[ts(type = "number")]
    pub bytes: u64,
    pub count: u32,
    /// The link or the text, for `Link` / `Note` meals.
    pub text: Option<String>,
    /// Page count of a PDF.
    pub pages: Option<u32>,
    /// Offline safety verdict for a link.
    pub safety: Option<LinkSafety>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SafetyLevel {
    Safe,
    Caution,
    Danger,
}

/// «فحص الرابط»: heuristics run locally; `listed` only when the opt-in OpenPhish list matched.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LinkSafety {
    pub level: SafetyLevel,
    /// Reason codes: http, ip, punycode, at, subdomains, shortener, tld, brand, long, listed.
    pub reasons: Vec<String>,
    pub host: String,
    /// The OpenPhish list is on and was loaded (so "not listed" means something).
    pub feed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum DropKind {
    Enter,
    Over,
    Leave,
    Drop,
}

/// The overlay's own OLE drop target (files/drop.rs). Position in physical client px.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DropEvent {
    pub kind: DropKind,
    pub paths: Vec<String>,
    /// A link or text when no files were dragged.
    pub text: Option<String>,
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum FeedAction {
    Copy,
    Cut,
    CopyPath,
    Zip,
    Move,
    /// To the format in `target` (png, jpg, webp, bmp, tiff, ico, pdf for images; txt, png for PDF).
    Convert,
    Shrink,
    OcrText,
    StripMeta,
    ExtractHere,
    ExtractTo,
    ListArchive,
    FolderSize,
    Terminal,
    PdfMerge,
    /// Keep the pages in `target` («1-3, 5»).
    PdfPages,
    PdfCompress,
    ImagesToPdf,
    OpenLink,
    LinkShortcut,
    CopyText,
    SaveNote,
    WordCount,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FeedResult {
    pub action: FeedAction,
    /// Files created or moved by the action (the one that «pops out of his mouth»).
    pub outputs: Vec<String>,
    #[ts(type = "number")]
    pub bytes: u64,
    /// Folder to open with «افتح المجلد».
    pub folder: Option<String>,
    /// Text to show (OCR result, archive listing, folder size line).
    pub text: Option<String>,
    /// Pass to `feed_undo` for «تراجع»; None when there is nothing to undo.
    pub undo: Option<String>,
    /// Size before (PDF compress).
    #[ts(type = "number | null")]
    pub was: Option<u64>,
    /// Words, characters, lines (word count).
    pub counts: Option<Vec<u32>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PocketItem {
    pub id: String,
    pub path: String,
    pub name: String,
    #[ts(type = "number")]
    pub size: u64,
    pub is_dir: bool,
    /// Name of the folder it came from («التنزيلات»).
    pub folder: String,
    #[ts(type = "number")]
    pub added_ms: i64,
    /// The file was moved or deleted since; shown with a mark, then dropped.
    pub missing: bool,
}

#[tauri::command]
pub async fn feed_info(
    app: AppHandle,
    paths: Vec<String>,
    text: Option<String>,
) -> Result<Meal, String> {
    tauri::async_runtime::spawn_blocking(move || files::meal(&app, &paths, text.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn feed_run(
    app: AppHandle,
    action: FeedAction,
    paths: Vec<String>,
    text: Option<String>,
    target: Option<String>,
) -> Result<FeedResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        files::run(&app, action, &paths, text.as_deref(), target.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// «نسخ النص» on a text result (OCR, PDF text).
#[tauri::command]
pub fn copy_text(text: String) -> Result<(), String> {
    files::shell::copy_text(&text).map_err(|e| e.to_string())
}

/// «تراجع»: created files go to the Recycle Bin, moved files go back.
#[tauri::command]
pub async fn feed_undo(app: AppHandle, token: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || files::undo(&app, &token))
        .await
        .map_err(|e| e.to_string())?
}

/// «افتح المجلد»: Explorer with the file selected.
#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    files::shell::reveal(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pocket_list(app: AppHandle) -> Vec<PocketItem> {
    pocket::list(&app)
}

#[tauri::command]
pub fn pocket_add(app: AppHandle, paths: Vec<String>) -> Vec<PocketItem> {
    pocket::add(&app, &paths)
}

#[tauri::command]
pub fn pocket_remove(app: AppHandle, ids: Vec<String>) -> Vec<PocketItem> {
    pocket::remove(&app, &ids)
}

/// Copies the selected pocket files to the clipboard (paste them anywhere).
#[tauri::command]
pub fn pocket_copy(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    files::shell::copy_files(&pocket::paths(&app, &ids), false).map_err(|e| e.to_string())
}

/// ZIP / move of pocket files, same results and undo as feeding.
#[tauri::command]
pub async fn pocket_run(
    app: AppHandle,
    action: FeedAction,
    ids: Vec<String>,
) -> Result<FeedResult, String> {
    let paths = pocket::paths(&app, &ids);
    let result = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || files::run(&app, action, &paths, None, None)
    })
    .await
    .map_err(|e| e.to_string())??;
    if action == FeedAction::Move {
        pocket::refresh(&app);
    }
    Ok(result)
}

/// Starts a real OS drag of the selected pocket files (drop them in Explorer, mail, any app).
#[tauri::command]
pub fn pocket_drag(
    app: AppHandle,
    files: State<'_, Arc<FilesShared>>,
    ids: Vec<String>,
) -> Result<(), String> {
    let paths = pocket::paths(&app, &ids);
    files::shell::drag_out(&app, files.inner().clone(), paths)
}

// ---------------------------------------------------------------------------------------------
// Tray

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum TrayState {
    Normal,
    Notify,
    Sleep,
    Dnd,
}

#[tauri::command]
pub fn set_tray_state(app: AppHandle, state: TrayState) {
    crate::tray::set_state(&app, state);
}

// ---------------------------------------------------------------------------------------------
// Dev tooling

/// Dev-only: flips window styles at runtime to bisect Win32 behaviour (driven by scripts/cdp.py).
#[tauri::command]
pub fn dev_window_flags(
    app: AppHandle,
    label: Option<String>,
    always_on_top: Option<bool>,
    skip_taskbar: Option<bool>,
    focusable: Option<bool>,
    ignore_cursor: Option<bool>,
) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("dev builds only".into());
    }
    let label = label.unwrap_or_else(|| window::OVERLAY_LABEL.to_string());
    let target = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("window {label} missing"))?;
    let err = |e: tauri::Error| e.to_string();
    if let Some(v) = always_on_top {
        target.set_always_on_top(v).map_err(err)?;
    }
    if let Some(v) = skip_taskbar {
        target.set_skip_taskbar(v).map_err(err)?;
    }
    if let Some(v) = focusable {
        target.set_focusable(v).map_err(err)?;
    }
    if let Some(v) = ignore_cursor {
        target.set_ignore_cursor_events(v).map_err(err)?;
    }
    Ok(())
}

/// Dev-only: what the hit-test loop currently sees.
#[tauri::command]
pub fn dev_hittest_state(state: State<'_, Arc<OverlayState>>) -> Result<serde_json::Value, String> {
    if !cfg!(debug_assertions) {
        return Err("dev builds only".into());
    }
    use std::sync::atomic::Ordering;
    let g = *state.geometry.lock().expect("geometry lock");
    let rects = state.rects.lock().expect("hit rects lock").clone();
    Ok(serde_json::json!({
        "geometry": { "x": g.x, "y": g.y, "scale": g.scale },
        "rects": rects,
        "interactive": state.interactive.load(Ordering::Relaxed),
        "expanded": state.expanded.load(Ordering::Relaxed),
        "visible": state.visible.load(Ordering::Relaxed),
        "fullscreen": state.fullscreen.load(Ordering::Relaxed),
        "dragging": state.drag.lock().expect("drag lock").is_some(),
        "hwnd": state.hwnd.load(Ordering::Relaxed),
    }))
}
