//! The overlay window: a single transparent, frameless, always-on-top window parked at the
//! top-center of a monitor. Placement lives here; click-through hit-testing and fullscreen
//! auto-hide are added in phase 1.

pub mod placement;

/// Label of the overlay window as declared in `tauri.conf.json`.
pub const OVERLAY_LABEL: &str = "overlay";
