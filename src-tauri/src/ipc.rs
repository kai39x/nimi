//! Typed IPC surface between Rust and React.
//!
//! Every payload derives `ts_rs::TS` with `#[ts(export)]`; `npm run ipc:gen` writes the
//! TypeScript mirrors to `src/ipc/generated/`, and `src/ipc/commands.ts` wraps each command.

use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppInfo {
    pub version: String,
    pub tauri_version: String,
    pub debug: bool,
}

#[tauri::command]
pub fn app_info(app: tauri::AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        tauri_version: tauri::VERSION.to_string(),
        debug: cfg!(debug_assertions),
    }
}
