//! «مؤقت» / «بومودورو» / «ذكّرني»: countdowns kept in Rust. The overlay pauses its own timers
//! while hidden (performance budget), so the deadline lives here and one thread sleeps until the
//! nearest one. The frontend only draws `ends_at_ms - now` and reacts to `nimi://timer/done`.

use std::{
    sync::{Arc, Condvar, Mutex},
    thread,
    time::Duration,
};

use tauri::{AppHandle, Emitter, Manager};

use super::now_ms;
use crate::ipc::{events, TimerDone, TimerInfo, TimerKind, TimerPhase, TimerState};

/// Pomodoro (spec §5): 25 min work, 5 min break, 4 rounds; no break after the last round.
pub const WORK_MIN: f64 = 25.0;
pub const BREAK_MIN: f64 = 5.0;
pub const ROUNDS: u32 = 4;
/// Longest countdown accepted (a day).
const MAX_MIN: f64 = 24.0 * 60.0;
const MAX_REMINDERS: usize = 20;

#[derive(Default)]
pub struct TimerShared {
    state: Mutex<TimerState>,
    wake: Condvar,
}

fn shared(app: &AppHandle) -> Arc<TimerShared> {
    app.state::<Arc<TimerShared>>().inner().clone()
}

pub fn spawn(app: &AppHandle) {
    app.manage(Arc::new(TimerShared::default()));
    let app = app.clone();
    thread::Builder::new()
        .name("nimi-timer".into())
        .spawn(move || run(&app))
        .expect("spawn timer thread");
}

fn run(app: &AppHandle) {
    let sh = shared(app);
    let mut st = sh.state.lock().expect("timer lock");
    loop {
        let now = now_ms();
        let mut done = Vec::new();
        let mut changed = false;

        if let Some(main) = st.main.as_mut() {
            if main.paused_left_ms.is_none() && main.ends_at_ms <= now {
                changed = true;
                match advance(main, now) {
                    Some(event) => done.push(event),
                    None => {
                        done.push(finished(main));
                        st.main = None;
                    }
                }
            }
        }
        st.reminders.retain(|r| {
            if r.paused_left_ms.is_none() && r.ends_at_ms <= now {
                done.push(finished(r));
                changed = true;
                false
            } else {
                true
            }
        });
        if changed {
            let snapshot = st.clone();
            drop(st);
            let _ = app.emit(events::TIMER_STATE, &snapshot);
            for d in done {
                let _ = app.emit(events::TIMER_DONE, &d);
            }
            st = sh.state.lock().expect("timer lock");
            continue;
        }

        let next = st
            .main
            .iter()
            .chain(st.reminders.iter())
            .filter(|t| t.paused_left_ms.is_none())
            .map(|t| t.ends_at_ms)
            .min();
        st = match next {
            Some(at) => {
                let wait = Duration::from_millis((at - now).clamp(1, 60_000) as u64);
                sh.wake.wait_timeout(st, wait).expect("timer lock").0
            }
            None => sh.wake.wait(st).expect("timer lock"),
        };
    }
}

/// A Pomodoro stretch ended: start the next one and say so, or `None` when all rounds are done.
fn advance(t: &mut TimerInfo, now: i64) -> Option<TimerDone> {
    if t.kind != TimerKind::Pomodoro {
        return None;
    }
    let (phase, round, minutes) = match t.phase {
        TimerPhase::Work if t.round >= t.rounds => return None,
        TimerPhase::Work => (TimerPhase::Break, t.round, BREAK_MIN),
        TimerPhase::Break => (TimerPhase::Work, t.round + 1, WORK_MIN),
    };
    let total = (minutes * 60_000.0) as i64;
    t.phase = phase;
    t.round = round;
    t.total_ms = total;
    t.ends_at_ms = now + total;
    Some(TimerDone {
        kind: t.kind,
        label: t.label.clone(),
        phase,
        round,
        rounds: t.rounds,
        finished: false,
    })
}

fn finished(t: &TimerInfo) -> TimerDone {
    TimerDone {
        kind: t.kind,
        label: t.label.clone(),
        phase: t.phase,
        round: t.round,
        rounds: t.rounds,
        finished: true,
    }
}

fn new_id() -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    format!("t{}-{}", now_ms(), N.fetch_add(1, Ordering::Relaxed))
}

/// Applies `f`, wakes the thread, broadcasts and returns the new state.
fn change(app: &AppHandle, f: impl FnOnce(&mut TimerState)) -> TimerState {
    let sh = shared(app);
    let snapshot = {
        let mut st = sh.state.lock().expect("timer lock");
        f(&mut st);
        st.clone()
    };
    sh.wake.notify_all();
    let _ = app.emit(events::TIMER_STATE, &snapshot);
    snapshot
}

pub fn state(app: &AppHandle) -> TimerState {
    shared(app).state.lock().expect("timer lock").clone()
}

pub fn start(
    app: &AppHandle,
    kind: TimerKind,
    minutes: f64,
    label: Option<String>,
) -> Result<TimerState, String> {
    let minutes = if kind == TimerKind::Pomodoro {
        WORK_MIN
    } else {
        minutes
    };
    if !minutes.is_finite() || minutes <= 0.0 || minutes > MAX_MIN {
        return Err("bad-minutes".into());
    }
    let total = (minutes * 60_000.0).round() as i64;
    let label = label
        .map(|l| l.trim().chars().take(120).collect::<String>())
        .filter(|l| !l.is_empty());
    let info = TimerInfo {
        id: new_id(),
        kind,
        label,
        ends_at_ms: now_ms() + total,
        total_ms: total,
        paused_left_ms: None,
        round: 1,
        rounds: if kind == TimerKind::Pomodoro {
            ROUNDS
        } else {
            1
        },
        phase: TimerPhase::Work,
    };
    Ok(change(app, move |st| {
        if kind == TimerKind::Reminder {
            if st.reminders.len() >= MAX_REMINDERS {
                st.reminders.remove(0);
            }
            st.reminders.push(info);
        } else {
            st.main = Some(info);
        }
    }))
}

fn with_timer(st: &mut TimerState, id: &str, f: impl FnOnce(&mut TimerInfo)) {
    if let Some(t) = st
        .main
        .iter_mut()
        .chain(st.reminders.iter_mut())
        .find(|t| t.id == id)
    {
        f(t);
    }
}

pub fn pause(app: &AppHandle, id: &str) -> TimerState {
    change(app, |st| {
        with_timer(st, id, |t| {
            if t.paused_left_ms.is_none() {
                t.paused_left_ms = Some((t.ends_at_ms - now_ms()).max(0));
            }
        })
    })
}

pub fn resume(app: &AppHandle, id: &str) -> TimerState {
    change(app, |st| {
        with_timer(st, id, |t| {
            if let Some(left) = t.paused_left_ms.take() {
                t.ends_at_ms = now_ms() + left;
            }
        })
    })
}

pub fn extend(app: &AppHandle, id: &str, minutes: f64) -> TimerState {
    let add = (minutes.clamp(0.0, 60.0) * 60_000.0) as i64;
    change(app, |st| {
        with_timer(st, id, |t| {
            match t.paused_left_ms.as_mut() {
                Some(left) => *left += add,
                None => t.ends_at_ms += add,
            }
            t.total_ms += add;
        })
    })
}

pub fn stop(app: &AppHandle, id: &str) -> TimerState {
    change(app, |st| {
        if st.main.as_ref().is_some_and(|t| t.id == id) {
            st.main = None;
        }
        st.reminders.retain(|t| t.id != id);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pomodoro(round: u32, phase: TimerPhase) -> TimerInfo {
        TimerInfo {
            id: "t".into(),
            kind: TimerKind::Pomodoro,
            label: None,
            ends_at_ms: 0,
            total_ms: 0,
            paused_left_ms: None,
            round,
            rounds: ROUNDS,
            phase,
        }
    }

    #[test]
    fn pomodoro_work_then_break_then_next_round() {
        let mut t = pomodoro(1, TimerPhase::Work);
        let d = advance(&mut t, 1_000).expect("break starts");
        assert_eq!(
            (d.phase, d.round, d.finished),
            (TimerPhase::Break, 1, false)
        );
        assert_eq!(t.ends_at_ms, 1_000 + 5 * 60_000);
        let d = advance(&mut t, 2_000).expect("round 2 starts");
        assert_eq!((d.phase, d.round), (TimerPhase::Work, 2));
        assert_eq!(t.ends_at_ms, 2_000 + 25 * 60_000);
    }

    #[test]
    fn pomodoro_ends_after_the_last_work_round() {
        let mut t = pomodoro(ROUNDS, TimerPhase::Work);
        assert!(advance(&mut t, 0).is_none());
    }

    #[test]
    fn plain_timers_do_not_repeat() {
        let mut t = pomodoro(1, TimerPhase::Work);
        t.kind = TimerKind::Timer;
        assert!(advance(&mut t, 0).is_none());
    }
}
