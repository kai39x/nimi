//! Phase 7 — the shortcuts tab and the command bar (spec §5 «اختصارات», §8; boards 10 and 13).
//!
//! - `timer`: countdown, Pomodoro (25/5 × 4) and reminders, kept in Rust so they finish even
//!   while the overlay is hidden and its timers are paused
//! - `clipboard`: «سجل الحافظة», the last copied texts, in memory only
//! - `mic`: «كتم المايك» on the default capture device (Core Audio)
//! - `picker`: «لاقط ألوان», a window over the screen that samples the pixels under the cursor
//! - `apps`: Windows' Apps folder (every Start-menu and Store app) for «افتح» and favorites
//! - `find`: «دوّر», a file-name index of the user's folders
//! - `explorer`: the selection of the Explorer window in front, for «ضغط»
//!
//! The double-Ctrl hook lives in `crate::hotkeys`.

pub mod apps;
pub mod clipboard;
pub mod explorer;
pub mod find;
pub mod mic;
pub mod picker;
pub mod screenshot;
pub mod timer;

use std::{ffi::c_void, os::windows::process::CommandExt, path::PathBuf, process::Command};

use tauri::AppHandle;
use windows::{
    core::{HSTRING, PCWSTR},
    Win32::{
        System::{Com::CoTaskMemFree, Shutdown::LockWorkStation},
        UI::{
            Shell::{
                FOLDERID_Desktop, FOLDERID_Documents, FOLDERID_Downloads, FOLDERID_Music,
                FOLDERID_Pictures, FOLDERID_Videos, SHGetKnownFolderPath, ShellExecuteW,
                KF_FLAG_DEFAULT,
            },
            WindowsAndMessaging::SW_SHOWNORMAL,
        },
    },
};

use crate::ipc::{KnownFolder, ShortcutKind, Tool, UserShortcut};

const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

pub fn spawn(app: &AppHandle) {
    timer::spawn(app);
    clipboard::spawn(app);
}

/// The command bar opened: build the app list and the file index if they are cold or stale.
pub fn warm() {
    apps::warm();
    find::warm();
}

pub fn run(app: &AppHandle, tool: Tool) -> Result<(), String> {
    match tool {
        // Windows' own region snip (Win+Shift+S); `screenshot` then saves what lands on the clipboard.
        Tool::Screenshot => screenshot::start(),
        Tool::Lock => {
            // SAFETY: no arguments; asks Windows to show the lock screen.
            unsafe { LockWorkStation() }.map_err(|e| e.message().to_string())
        }
        Tool::ColorPicker => picker::open(app),
    }
}

/// Opens an app id (`shell:AppsFolder\…`), a file or a folder the way Explorer would.
pub fn launch(target: &str) -> Result<(), String> {
    let target = target.trim();
    if target.is_empty() {
        return Err("empty".into());
    }
    let is_app = target
        .get(..16)
        .is_some_and(|p| p.eq_ignore_ascii_case("shell:AppsFolder"));
    if !is_app && !std::path::Path::new(target).exists() {
        return Err("missing".into());
    }
    shell_open(target, None)
}

pub fn run_shortcut(s: &UserShortcut) -> Result<(), String> {
    let target = s.target.trim();
    match s.kind {
        ShortcutKind::Folder => {
            if !std::path::Path::new(target).is_dir() {
                return Err("missing".into());
            }
            shell_open(target, None)
        }
        ShortcutKind::Url => {
            let url = crate::files::link::parse(target).ok_or("bad-url")?;
            crate::files::shell::open_url(url.as_str()).map_err(|e| e.message().to_string())
        }
        ShortcutKind::Command => {
            // A visible console that stays open, so the output (or an error) can be read.
            let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".into());
            Command::new("cmd.exe")
                .raw_arg(format!("/k {target}"))
                .current_dir(home)
                .creation_flags(CREATE_NEW_CONSOLE)
                .spawn()
                .map(|_| ())
                .map_err(|e| e.to_string())
        }
    }
}

fn shell_open(target: &str, params: Option<&str>) -> Result<(), String> {
    let params = params.map(HSTRING::from);
    // SAFETY: ShellExecute with a path, an app id or a protocol URI; > 32 means success.
    let r = unsafe {
        ShellExecuteW(
            None,
            PCWSTR::null(),
            &HSTRING::from(target),
            params
                .as_ref()
                .map_or(PCWSTR::null(), |p| PCWSTR(p.as_ptr())),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if r.0 as isize > 32 {
        Ok(())
    } else {
        Err(format!("shell-open {}", r.0 as isize))
    }
}

pub fn known_folder(folder: KnownFolder) -> Option<PathBuf> {
    known_folder_id(match folder {
        KnownFolder::Downloads => &FOLDERID_Downloads,
        KnownFolder::Documents => &FOLDERID_Documents,
        KnownFolder::Desktop => &FOLDERID_Desktop,
        KnownFolder::Pictures => &FOLDERID_Pictures,
        KnownFolder::Videos => &FOLDERID_Videos,
        KnownFolder::Music => &FOLDERID_Music,
    })
}

pub fn known_folder_id(id: &windows::core::GUID) -> Option<PathBuf> {
    // SAFETY: known-folder lookup; the returned string is freed with CoTaskMemFree.
    unsafe {
        let p = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
        let path = p.to_string().ok().map(PathBuf::from);
        CoTaskMemFree(Some(p.0 as *const c_void));
        path
    }
}

pub const KNOWN_FOLDERS: [KnownFolder; 6] = [
    KnownFolder::Downloads,
    KnownFolder::Documents,
    KnownFolder::Desktop,
    KnownFolder::Pictures,
    KnownFolder::Videos,
    KnownFolder::Music,
];

/// Unix time in ms.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Lowercase, Arabic letter variants folded (أ/إ/آ → ا, ة → ه, ى → ي), diacritics and tatweel
/// dropped, Arabic-Indic digits → ASCII. Used to match names typed either way.
pub fn fold(s: &str) -> String {
    s.chars()
        .filter_map(|c| match c {
            '\u{064B}'..='\u{065F}' | '\u{0670}' | '\u{0640}' => None,
            'أ' | 'إ' | 'آ' | 'ٱ' => Some('ا'),
            'ة' => Some('ه'),
            'ى' => Some('ي'),
            '٠'..='٩' => char::from_digit(c as u32 - '٠' as u32, 10),
            '۰'..='۹' => char::from_digit(c as u32 - '۰' as u32, 10),
            _ => Some(c),
        })
        .flat_map(char::to_lowercase)
        .collect()
}

/// Score of `name` for `query` (both folded): prefix > word start > contains > in-order letters.
pub fn score(name: &str, query: &str) -> Option<u32> {
    if query.is_empty() {
        return Some(1);
    }
    if name == query {
        return Some(1000);
    }
    if name.starts_with(query) {
        return Some(800 - (name.len() as u32).min(200));
    }
    if let Some(i) = name.find(query) {
        let word_start = name[..i]
            .chars()
            .last()
            .is_some_and(|c| !c.is_alphanumeric());
        return Some(if word_start { 600 } else { 400 } - (i as u32).min(100));
    }
    // Word initials («vsc» → «Visual Studio Code»).
    let initials: String = name
        .split(|c: char| !c.is_alphanumeric())
        .filter_map(|w| w.chars().next())
        .collect();
    if query.chars().count() >= 2 && initials.starts_with(query) {
        return Some(300);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{fold, score};

    #[test]
    fn folds_arabic_variants_and_digits() {
        assert_eq!(fold("أُمّ إبراهيم ١٢"), "ام ابراهيم 12");
        assert_eq!(fold("مكتبة"), "مكتبه");
    }

    #[test]
    fn ranks_prefix_over_contains_and_initials_by_words() {
        let q = fold("vsc");
        assert!(score(&fold("Visual Studio Code"), &q).is_some());
        // Letters in order but not word initials: no match (was «note» → «Defragment…»).
        assert!(score(&fold("Defragment and Optimize Drives"), &fold("note")).is_none());
        let pre = score("notepad", "note").unwrap();
        let mid = score("sticky notes", "note").unwrap();
        assert!(pre > mid);
    }
}
