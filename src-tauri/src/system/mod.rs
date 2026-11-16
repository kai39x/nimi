//! System (phase 5, design spec §5 «النظام», board 12): live CPU / RAM / GPU / drives, the
//! largest-files scan, and Boost. All local Windows APIs (spec §15), no admin rights.
//!
//! - `stats` + `procs` + `drives`: one sampler thread; every 2 s while the panel is open (with
//!   the per-app breakdown and the GPU counters), every 10 s when compact (totals only) — the
//!   performance budget in spec §15. Each sample goes out as `nimi://system/stats`.
//! - `scan`: on-demand largest-files scan of one drive, with progress, cancel, move and recycle.
//! - `boost`: preview → run what the user ticked → result; the power plan comes back after 2 h.

pub mod boost;
mod drives;
mod procs;
pub mod scan;
mod stats;

use std::{
    collections::HashMap,
    sync::{atomic::AtomicBool, Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Emitter, Manager};

use crate::{
    ipc::{events, ScanProgress, ScanResult, SystemStats},
    window,
};

const OPEN_INTERVAL: Duration = Duration::from_secs(2);
const COMPACT_INTERVAL: Duration = Duration::from_secs(10);
/// How often the sleeping sampler checks whether the panel just opened.
const WAKE_CHECK: Duration = Duration::from_millis(250);

#[derive(Default)]
pub struct SystemShared {
    stats: Mutex<Option<SystemStats>>,
    scan_cancel: Mutex<Arc<AtomicBool>>,
    scan_progress: Mutex<Option<ScanProgress>>,
    scan_results: Mutex<HashMap<String, ScanResult>>,
}

impl SystemShared {
    pub fn stats(&self) -> Option<SystemStats> {
        self.stats.lock().expect("stats lock").clone()
    }

    pub fn cancel_scan(&self) {
        self.scan_cancel
            .lock()
            .expect("scan cancel lock")
            .store(true, std::sync::atomic::Ordering::Relaxed);
    }

    pub fn scan_state(&self, drive: &str) -> (Option<ScanProgress>, Option<ScanResult>) {
        let drive = drive.to_uppercase();
        let progress = self
            .scan_progress
            .lock()
            .expect("scan progress lock")
            .clone()
            .filter(|p| p.drive == drive);
        let result = self
            .scan_results
            .lock()
            .expect("scan results lock")
            .get(&drive)
            .cloned();
        (progress, result)
    }
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn spawn(app: &AppHandle) {
    boost::resume(app);
    let app = app.clone();
    thread::Builder::new()
        .name("nimi-system".into())
        .spawn(move || {
            let shared = app.state::<Arc<SystemShared>>().inner().clone();
            let overlay = window::state(&app);
            let mut sampler = stats::Sampler::new();
            loop {
                let open = overlay.expanded.load(std::sync::atomic::Ordering::Relaxed);
                let (cpu, ram) = sampler.cpu_ram(open);
                let sample = SystemStats {
                    at_ms: now_ms(),
                    cpu,
                    ram,
                    gpu: if open { sampler.gpu() } else { None },
                    drives: drives::list(),
                    battery: stats::battery(),
                    detailed: open,
                };
                *shared.stats.lock().expect("stats lock") = Some(sample.clone());
                let _ = app.emit(events::SYSTEM_STATS, sample);

                // Sleep until the next tick, but wake at once when the panel opens.
                let wait = if open {
                    OPEN_INTERVAL
                } else {
                    COMPACT_INTERVAL
                };
                let start = Instant::now();
                while start.elapsed() < wait {
                    thread::sleep(WAKE_CHECK);
                    if !open && overlay.expanded.load(std::sync::atomic::Ordering::Relaxed) {
                        break;
                    }
                }
            }
        })
        .expect("spawn system sampler");
}
