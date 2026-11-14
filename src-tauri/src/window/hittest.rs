//! Click-through with selective hit-testing (design spec §3, docs/PLAN.md §2).
//!
//! The overlay window ignores the mouse by default. One thread polls the cursor position and
//! turns mouse input on only while the cursor is over a rect the frontend registered (or close
//! to one while the primary button is held, which is how an Explorer drag reaches our drop
//! target before the file arrives). The same loop drives the capsule drag along the top edge
//! and reports click-outside while the panel is expanded.
//!
//! Cost: one `GetCursorPos` + `GetAsyncKeyState` per tick, 16 ms near the UI and 100 ms away
//! from it; nothing at all while the overlay is hidden.

use std::{sync::atomic::Ordering, thread, time::Duration};

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition};
use windows::Win32::{
    Foundation::POINT,
    UI::{
        Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON},
        WindowsAndMessaging::{GetCursorPos, GetSystemMetrics, SM_SWAPBUTTON},
    },
};

use super::{placement, state, Geometry, OverlayState, OVERLAY_LABEL};
use crate::ipc::{events, CursorProximity, DragPhase, HitRect, OverlayDragEvent};

/// Extra logical px around a rect that still count as "inside" (rounded corners, fast exits).
const CLICK_SLACK: f64 = 6.0;
/// Within this distance the loop polls fast and the character can react to the cursor.
const NEAR_ZONE: f64 = 160.0;
/// With the primary button held (a possible file drag), enable input this far out so the
/// OLE drop target is active before the cursor reaches the capsule.
const HUNGRY_ZONE: f64 = 120.0;
/// Physical px the cursor must travel before a press becomes a window drag.
const DRAG_THRESHOLD: i32 = 4;

const TICK_NEAR: Duration = Duration::from_millis(16);
const TICK_FAR: Duration = Duration::from_millis(100);
const TICK_HIDDEN: Duration = Duration::from_millis(400);

pub struct DragSession {
    grab_cursor_x: i32,
    grab_window_x: i32,
    moved: bool,
}

#[derive(Clone, Copy)]
struct PhysRect {
    l: f64,
    t: f64,
    r: f64,
    b: f64,
}

impl PhysRect {
    fn from_logical(rect: &HitRect, g: Geometry) -> Self {
        let l = g.x as f64 + rect.x * g.scale;
        let t = g.y as f64 + rect.y * g.scale;
        Self {
            l,
            t,
            r: l + rect.w * g.scale,
            b: t + rect.h * g.scale,
        }
    }

    fn contains(&self, x: f64, y: f64, slack: f64) -> bool {
        x >= self.l - slack && x <= self.r + slack && y >= self.t - slack && y <= self.b + slack
    }
}

fn cursor() -> Option<(i32, i32)> {
    let mut p = POINT::default();
    // SAFETY: plain Win32 call with a valid out-pointer.
    unsafe { GetCursorPos(&mut p).ok()? };
    Some((p.x, p.y))
}

fn primary_button_down() -> bool {
    // SAFETY: plain Win32 queries without pointers.
    unsafe {
        let vk = if GetSystemMetrics(SM_SWAPBUTTON) != 0 {
            VK_RBUTTON
        } else {
            VK_LBUTTON
        };
        (GetAsyncKeyState(i32::from(vk.0)) as u16 & 0x8000) != 0
    }
}

pub fn spawn(app: AppHandle) {
    thread::Builder::new()
        .name("nimi-hittest".into())
        .spawn(move || run(app))
        .expect("spawn hit-test thread");
}

/// Turns mouse input for the overlay on or off (idempotent, cheap when unchanged).
pub fn set_interactive(app: &AppHandle, st: &OverlayState, want: bool) {
    if st.interactive.swap(want, Ordering::Relaxed) != want {
        if let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) {
            if let Err(err) = overlay.set_ignore_cursor_events(!want) {
                log::warn!("set_ignore_cursor_events failed: {err}");
            }
        }
    }
}

/// Called from the frontend on pointer-down over the capsule.
pub fn begin_drag(app: &AppHandle) -> Result<(), String> {
    let st = state(app);
    let (cx, _) = cursor().ok_or("cursor position unavailable")?;
    let geometry = *st.geometry.lock().expect("geometry lock");
    *st.drag.lock().expect("drag lock") = Some(DragSession {
        grab_cursor_x: cx,
        grab_window_x: geometry.x,
        moved: false,
    });
    emit_drag(app, DragPhase::Start, false);
    Ok(())
}

fn emit_drag(app: &AppHandle, phase: DragPhase, moved: bool) {
    let _ = app.emit(events::OVERLAY_DRAG, OverlayDragEvent { phase, moved });
}

/// Advances an active drag. Returns `false` when there is no drag session.
fn tick_drag(app: &AppHandle, st: &OverlayState, cursor_x: i32, button_down: bool) -> bool {
    let mut guard = st.drag.lock().expect("drag lock");
    let Some(session) = guard.as_mut() else {
        return false;
    };

    if !button_down {
        let moved = session.moved;
        *guard = None;
        drop(guard);
        if moved {
            let x = st.geometry.lock().expect("geometry lock").x;
            placement::persist_offset(app, x);
        }
        emit_drag(app, DragPhase::End, moved);
        return true;
    }

    let dx = cursor_x - session.grab_cursor_x;
    if !session.moved && dx.abs() >= DRAG_THRESHOLD {
        session.moved = true;
        emit_drag(app, DragPhase::Move, true);
    }
    if session.moved {
        let x = placement::clamp_x(app, session.grab_window_x + dx);
        let y = st.geometry.lock().expect("geometry lock").y;
        if let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) {
            let _ = overlay.set_position(PhysicalPosition::new(x, y));
        }
    }
    true
}

fn run(app: AppHandle) {
    let st = state(&app);
    let mut last_near = false;
    let mut last_inside = false;
    let mut last_down = false;
    let mut pressed_inside = false;

    loop {
        if !st.visible.load(Ordering::Relaxed) {
            set_interactive(&app, &st, false);
            thread::sleep(TICK_HIDDEN);
            continue;
        }

        let Some((cx, cy)) = cursor() else {
            thread::sleep(TICK_FAR);
            continue;
        };
        let down = primary_button_down();

        if tick_drag(&app, &st, cx, down) {
            last_down = down;
            thread::sleep(TICK_NEAR);
            continue;
        }

        let geometry = *st.geometry.lock().expect("geometry lock");
        let scale = if geometry.scale > 0.0 {
            geometry.scale
        } else {
            1.0
        };
        let (x, y) = (cx as f64, cy as f64);
        let rects: Vec<PhysRect> = st
            .rects
            .lock()
            .expect("hit rects lock")
            .iter()
            .map(|r| PhysRect::from_logical(r, geometry))
            .collect();

        let inside = rects.iter().any(|r| r.contains(x, y, CLICK_SLACK * scale));
        let near = rects.iter().any(|r| r.contains(x, y, NEAR_ZONE * scale));
        let hungry = down && rects.iter().any(|r| r.contains(x, y, HUNGRY_ZONE * scale));

        if down && !last_down {
            pressed_inside = inside;
        } else if !down {
            pressed_inside = false;
        }

        set_interactive(&app, &st, inside || hungry || pressed_inside);

        if near != last_near || inside != last_inside {
            let _ = app.emit(events::OVERLAY_CURSOR, CursorProximity { near, inside });
            last_near = near;
            last_inside = inside;
        }

        if st.expanded.load(Ordering::Relaxed) && down && !last_down && !inside {
            let _ = app.emit(events::OVERLAY_CLICK_OUTSIDE, ());
        }

        last_down = down;
        thread::sleep(if near || down { TICK_NEAR } else { TICK_FAR });
    }
}
