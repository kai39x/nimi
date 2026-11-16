//! Double-tap hotkey for the command bar (spec §8, data sources: `WH_KEYBOARD_LL`). A tap is
//! the key going down and up within 300 ms with no other key in between; two taps within 400 ms
//! open the bar. Ctrl+C and friends never count (another key "dirties" the tap). The hook runs on
//! its own thread with a message loop and only posts to a channel, so typing never waits on NIMI.

use std::{
    sync::{
        atomic::{AtomicU8, Ordering},
        mpsc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter};
use windows::Win32::{
    Foundation::{LPARAM, LRESULT, WPARAM},
    UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, KBDLLHOOKSTRUCT, MSG,
        WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    },
};

use crate::{
    ipc::{events, CommandHotkey},
    window,
};

const TAP_MAX: Duration = Duration::from_millis(300);
const GAP_MAX: Duration = Duration::from_millis(400);

/// 0 = Ctrl, 1 = Alt, 2 = Shift, 3 = off.
static MODE: AtomicU8 = AtomicU8::new(0);
static TX: OnceLock<mpsc::Sender<()>> = OnceLock::new();

#[derive(Default)]
struct Taps {
    held: bool,
    down_at: Option<Instant>,
    dirty: bool,
    last_tap: Option<Instant>,
}

static TAPS: Mutex<Taps> = Mutex::new(Taps {
    held: false,
    down_at: None,
    dirty: false,
    last_tap: None,
});

pub fn set_mode(mode: CommandHotkey) {
    MODE.store(
        match mode {
            CommandHotkey::DoubleCtrl => 0,
            CommandHotkey::DoubleAlt => 1,
            CommandHotkey::DoubleShift => 2,
            CommandHotkey::Off => 3,
        },
        Ordering::Relaxed,
    );
}

fn in_group(vk: u32, mode: u8) -> bool {
    match mode {
        0 => matches!(vk, 0x11 | 0xA2 | 0xA3), // VK_CONTROL, VK_LCONTROL, VK_RCONTROL
        1 => matches!(vk, 0x12 | 0xA4 | 0xA5), // VK_MENU, VK_LMENU, VK_RMENU
        2 => matches!(vk, 0x10 | 0xA0 | 0xA1), // VK_SHIFT, VK_LSHIFT, VK_RSHIFT
        _ => false,
    }
}

pub fn spawn(app: &AppHandle, mode: CommandHotkey) {
    set_mode(mode);
    let (tx, rx) = mpsc::channel::<()>();
    let _ = TX.set(tx);

    let app = app.clone();
    thread::Builder::new()
        .name("nimi-hotkey-open".into())
        .spawn(move || {
            for () in rx {
                let st = window::state(&app);
                // Never pop up over a fullscreen game or video, or while NIMI is hidden.
                if st.fullscreen.load(Ordering::Relaxed) || !st.visible.load(Ordering::Relaxed) {
                    log::info!("hotkey: ignored (fullscreen or hidden)");
                    continue;
                }
                log::info!("hotkey: command bar");
                let _ = app.emit(events::COMMAND_OPEN, ());
            }
        })
        .expect("spawn hotkey thread");

    thread::Builder::new()
        .name("nimi-hotkey-hook".into())
        .spawn(|| {
            // SAFETY: a low-level hook owned by this thread, serviced by its message loop.
            unsafe {
                if let Err(err) = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook), None, 0) {
                    log::warn!("hotkey: keyboard hook refused: {err}");
                    return;
                }
                log::info!("hotkey: keyboard hook installed");
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    DispatchMessageW(&msg);
                }
            }
        })
        .expect("spawn hook thread");
}

unsafe extern "system" fn hook(code: i32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    if code >= 0 {
        let mode = MODE.load(Ordering::Relaxed);
        if mode != 3 {
            // SAFETY: for WH_KEYBOARD_LL, lParam points to a KBDLLHOOKSTRUCT for this call.
            let vk = unsafe { (*(lp.0 as *const KBDLLHOOKSTRUCT)).vkCode };
            let msg = wp.0 as u32;
            on_key(
                vk,
                msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN,
                msg == WM_KEYUP || msg == WM_SYSKEYUP,
                mode,
            );
        }
    }
    // SAFETY: always pass the event on; NIMI never swallows keys.
    unsafe { CallNextHookEx(None, code, wp, lp) }
}

fn on_key(vk: u32, down: bool, up: bool, mode: u8) {
    let Ok(mut t) = TAPS.try_lock() else {
        return;
    };
    let now = Instant::now();
    let ours = in_group(vk, mode);
    if down {
        if ours {
            if !t.held {
                t.held = true;
                t.down_at = Some(now);
                t.dirty = false;
            }
        } else {
            // Any other key breaks a pending double tap (Ctrl+C, typing…).
            t.dirty = true;
            t.last_tap = None;
        }
    } else if up && ours && t.held {
        t.held = false;
        let quick = t.down_at.is_some_and(|d| now.duration_since(d) <= TAP_MAX);
        if quick && !t.dirty {
            if t.last_tap.is_some_and(|l| now.duration_since(l) <= GAP_MAX) {
                t.last_tap = None;
                if let Some(tx) = TX.get() {
                    let _ = tx.send(());
                }
            } else {
                t.last_tap = Some(now);
            }
        } else {
            t.last_tap = None;
        }
        t.dirty = false;
    }
}
