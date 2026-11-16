import { useEffect, useState, useSyncExternalStore } from "react";
import { timerExtend, timerPause, timerResume, timerStart, timerState, timerStop } from "@/ipc/commands";
import { Events, onEvent } from "@/ipc/events";
import type { TimerDone } from "@/ipc/generated/TimerDone";
import type { TimerInfo } from "@/ipc/generated/TimerInfo";
import type { TimerState } from "@/ipc/generated/TimerState";

/**
 * Timer / Pomodoro / reminders (spec §5 «اختصارات»). Rust owns the deadlines (they must fire
 * while the overlay is hidden); this mirrors them and draws `endsAtMs - now`.
 */

let state: TimerState = { main: null, reminders: [] };
let started = false;
const listeners = new Set<() => void>();
const doneListeners = new Set<(d: TimerDone) => void>();

function publish(next: TimerState) {
  state = next;
  listeners.forEach((fn) => fn());
}

function ensure() {
  if (started) return;
  started = true;
  onEvent<TimerState>(Events.timerState, publish);
  onEvent<TimerDone>(Events.timerDone, (d) => doneListeners.forEach((fn) => fn(d)));
  void timerState().then(publish);
}

export function useTimers(): TimerState {
  ensure();
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}

/** A stretch ended (timer / reminder finished, Pomodoro switched or finished). */
export function onTimerDone(fn: (d: TimerDone) => void): () => void {
  ensure();
  doneListeners.add(fn);
  return () => doneListeners.delete(fn);
}

/** `Date.now()`, re-rendered once a second on the second while `active`. */
export function useClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    let id = 0;
    const tick = () => {
      setNow(Date.now());
      id = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    };
    id = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    return () => window.clearTimeout(id);
  }, [active]);
  return now;
}

export function leftMs(t: TimerInfo, now: number): number {
  return Math.max(0, t.pausedLeftMs ?? t.endsAtMs - now);
}

/** Share of the current stretch already gone (0 → 1), for rings. */
export function progress(t: TimerInfo, now: number): number {
  return t.totalMs > 0 ? 1 - leftMs(t, now) / t.totalMs : 1;
}

/** «18:42», «1:05:09». Clock digits stay Latin, as on the boards. Rounds up so 0:00 means done. */
export function fmtClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export const timers = {
  startTimer: (minutes: number, label: string | null = null) => timerStart("timer", minutes, label),
  startPomodoro: () => timerStart("pomodoro", 25),
  remind: (minutes: number, label: string | null) => timerStart("reminder", minutes, label),
  toggle: (t: TimerInfo) => (t.pausedLeftMs != null ? timerResume(t.id) : timerPause(t.id)),
  extend: (t: TimerInfo, minutes = 5) => timerExtend(t.id, minutes),
  stop: (t: TimerInfo) => timerStop(t.id),
};
