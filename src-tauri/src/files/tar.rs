//! ZIP through Windows' own `tar.exe` (bsdtar / libarchive, in Windows 10 1803+): `-a` picks the
//! zip format from the `.zip` name; extraction reads zip, 7z, rar, tar.* and iso, and `-k` never
//! overwrites an existing file. No console window flashes.

use std::{
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn tar() -> PathBuf {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    PathBuf::from(root).join("System32").join("tar.exe")
}

fn run(args: &[&std::ffi::OsStr]) -> Result<String, String> {
    let out = Command::new(tar())
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("tar: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "tar failed".into()
        } else {
            err
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// One ZIP of all `items` (files and folders), each stored under its own name.
pub fn zip(items: &[PathBuf], out: &Path) -> Result<(), String> {
    let mut args: Vec<std::ffi::OsString> = vec![
        "-a".into(),
        "-c".into(),
        "-f".into(),
        out.as_os_str().into(),
    ];
    for p in items {
        let parent = p.parent().ok_or("no parent")?;
        let name = p.file_name().ok_or("no name")?;
        args.push("-C".into());
        args.push(parent.as_os_str().into());
        args.push(name.into());
    }
    let refs: Vec<&std::ffi::OsStr> = args.iter().map(|a| a.as_os_str()).collect();
    run(&refs).map(|_| ()).inspect_err(|_| {
        let _ = std::fs::remove_file(out); // a half-written zip is not a result
    })
}

pub fn extract(archive: &Path, dest: &Path) -> Result<(), String> {
    run(&[
        "-x".as_ref(),
        "-k".as_ref(),
        "-f".as_ref(),
        archive.as_os_str(),
        "-C".as_ref(),
        dest.as_os_str(),
    ])
    .map(|_| ())
}

/// The archive's entries, one per line (at most 200).
pub fn list(archive: &Path) -> Result<String, String> {
    let text = run(&["-t".as_ref(), "-f".as_ref(), archive.as_os_str()])?;
    let lines: Vec<&str> = text.lines().collect();
    let mut shown = lines
        .iter()
        .take(200)
        .copied()
        .collect::<Vec<_>>()
        .join("\n");
    if lines.len() > 200 {
        shown.push_str(&format!("\n… +{}", lines.len() - 200));
    }
    Ok(shown)
}
