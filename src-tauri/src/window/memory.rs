//! RAM: a hidden window's page tells WebView2 to keep as little in memory as it can
//! (`MemoryUsageTargetLevel = Low`: caches dropped, the renderer's memory trimmed), and goes back
//! to normal when it is shown again. The settings and color-picker windows are hidden almost all
//! the time, and the overlay while a fullscreen app is in front or NIMI is hidden for a while.
//!
//! The windows are not destroyed instead: one created at runtime once stuck on `about:blank` here
//! (docs/PLAN.md, phase 1). Tauri has no API for this setting, hence the WebView2 interface.

use tauri::WebviewWindow;

pub fn set_low(window: &WebviewWindow, low: bool) {
    let label = window.label().to_string();
    let result = window.with_webview(move |webview| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows::core::Interface;
        let level = if low {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
        } else {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
        };
        // SAFETY: COM calls on the live controller Tauri hands us, on the main thread.
        let applied = unsafe {
            webview
                .controller()
                .CoreWebView2()
                .and_then(|core| core.cast::<ICoreWebView2_19>())
                .and_then(|core| core.SetMemoryUsageTargetLevel(level))
        };
        if let Err(err) = applied {
            // An older WebView2 runtime without the interface: nothing to trim, nothing breaks.
            log::info!("memory target for '{label}' not set: {err}");
        }
    });
    if let Err(err) = result {
        log::info!("memory target: no webview yet: {err}");
    }
}
