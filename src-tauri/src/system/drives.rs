//! Fixed drives for the storage card (spec §5): free / total, label, SSD or HDD, state colour.

use std::{collections::HashMap, ffi::c_void, mem::size_of, sync::Mutex};

use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::CloseHandle,
        Storage::FileSystem::{
            CreateFileW, GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDriveStringsW,
            GetVolumeInformationW, FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE,
            OPEN_EXISTING,
        },
        System::{
            Ioctl::{
                PropertyStandardQuery, StorageDeviceSeekPenaltyProperty,
                DEVICE_SEEK_PENALTY_DESCRIPTOR, IOCTL_STORAGE_QUERY_PROPERTY,
                STORAGE_PROPERTY_QUERY,
            },
            IO::DeviceIoControl,
        },
    },
};

use crate::ipc::{DriveInfo, DriveState};

/// `DRIVE_FIXED` from `GetDriveTypeW`.
const DRIVE_FIXED: u32 = 3;
/// Used share at which the card turns butter (warn) and coral (full / «قرب يمتلي»).
const WARN_AT: f64 = 0.80;
const FULL_AT: f64 = 0.90;

static SSD: Mutex<Option<HashMap<String, Option<bool>>>> = Mutex::new(None);

pub fn list() -> Vec<DriveInfo> {
    let system = std::env::var("SystemDrive")
        .unwrap_or_else(|_| "C:".into())
        .to_uppercase();
    let mut out = Vec::new();
    for root in roots() {
        let wide: Vec<u16> = root.encode_utf16().chain(Some(0)).collect();
        // SAFETY: NUL-terminated root path; out-pointers are valid locals.
        unsafe {
            if GetDriveTypeW(PCWSTR(wide.as_ptr())) != DRIVE_FIXED {
                continue;
            }
            let (mut free, mut total) = (0u64, 0u64);
            if GetDiskFreeSpaceExW(
                PCWSTR(wide.as_ptr()),
                Some(&mut free),
                Some(&mut total),
                None,
            )
            .is_err()
                || total == 0
            {
                continue;
            }
            let mut label = [0u16; 64];
            let _ = GetVolumeInformationW(
                PCWSTR(wide.as_ptr()),
                Some(&mut label),
                None,
                None,
                None,
                None,
            );
            let len = label.iter().position(|&c| c == 0).unwrap_or(0);
            let letter = root.trim_end_matches('\\').to_uppercase();
            let used = 1.0 - free as f64 / total as f64;
            out.push(DriveInfo {
                state: if used >= FULL_AT {
                    DriveState::Full
                } else if used >= WARN_AT {
                    DriveState::Warn
                } else {
                    DriveState::Ok
                },
                system: letter == system,
                ssd: ssd(&letter),
                label: String::from_utf16_lossy(&label[..len]),
                letter,
                total,
                free,
            });
        }
    }
    out
}

fn roots() -> Vec<String> {
    let mut buf = [0u16; 256];
    // SAFETY: valid buffer.
    let len = unsafe { GetLogicalDriveStringsW(Some(&mut buf)) } as usize;
    String::from_utf16_lossy(&buf[..len.min(buf.len())])
        .split('\0')
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

/// SSD = no seek penalty (works without admin: the volume is opened with no access rights).
fn ssd(letter: &str) -> Option<bool> {
    if let Some(v) = SSD
        .lock()
        .expect("ssd lock")
        .as_ref()
        .and_then(|m| m.get(letter))
    {
        return *v;
    }
    let value = query_ssd(letter);
    SSD.lock()
        .expect("ssd lock")
        .get_or_insert_with(HashMap::new)
        .insert(letter.to_string(), value);
    value
}

fn query_ssd(letter: &str) -> Option<bool> {
    let path: Vec<u16> = format!("\\\\.\\{letter}")
        .encode_utf16()
        .chain(Some(0))
        .collect();
    // SAFETY: the handle is closed below; buffers are locals of the right size.
    unsafe {
        let handle = CreateFileW(
            PCWSTR(path.as_ptr()),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_FLAGS_AND_ATTRIBUTES(0),
            None,
        )
        .ok()?;
        let query = STORAGE_PROPERTY_QUERY {
            PropertyId: StorageDeviceSeekPenaltyProperty,
            QueryType: PropertyStandardQuery,
            ..Default::default()
        };
        let mut out = DEVICE_SEEK_PENALTY_DESCRIPTOR::default();
        let mut returned = 0u32;
        let ok = DeviceIoControl(
            handle,
            IOCTL_STORAGE_QUERY_PROPERTY,
            Some(&query as *const _ as *const c_void),
            size_of::<STORAGE_PROPERTY_QUERY>() as u32,
            Some(&mut out as *mut _ as *mut c_void),
            size_of::<DEVICE_SEEK_PENALTY_DESCRIPTOR>() as u32,
            Some(&mut returned),
            None,
        )
        .is_ok();
        let _ = CloseHandle(handle);
        (ok && returned as usize >= size_of::<DEVICE_SEEK_PENALTY_DESCRIPTOR>())
            .then_some(!out.IncursSeekPenalty)
    }
}

/// `C:` for a user-given drive, if it is one of the fixed drives.
pub fn normalize(drive: &str) -> Option<String> {
    let letter = drive.trim().trim_end_matches(['\\', '/']).to_uppercase();
    let letter = if letter.len() == 1 {
        format!("{letter}:")
    } else {
        letter
    };
    list()
        .into_iter()
        .find(|d| d.letter == letter)
        .map(|d| d.letter)
}
