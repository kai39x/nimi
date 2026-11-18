import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Mood } from "@/features/character/rig/moods";

/**
 * «الطاقة»: drains slowly while NIMI is awake and recovers while he sleeps (board 11 notes).
 * Persisted per device so it survives restarts. 0..1.
 *
 * The clock runs in the shell (always mounted) with his real mood, so his naps count. It used to
 * run inside the Home tab only — where he is never asleep — and charged all the time between two
 * visits (nights with the PC off included) as awake time, so it sat at the 10 % floor. A gap
 * longer than `REST_GAP_MIN` (NIMI closed, the PC asleep, the page throttled) counts as rest.
 */
const KEY = "nimi.energy";
const DRAIN_PER_MIN = 0.0025; // ~100 % → 0 % over 6.7 h awake
const RECOVER_PER_MIN = 0.01; // full again after ~1.5 h of sleep
const FLOOR = 0.1;
const TICK_MS = 60_000;
const REST_GAP_MIN = 5;

type Energy = { value: number; at: number };

function load(): Energy {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Energy;
      if (Number.isFinite(parsed.value) && Number.isFinite(parsed.at)) return parsed;
    }
  } catch {
    /* storage unavailable: start fresh */
  }
  return { value: 0.8, at: Date.now() };
}

let energy = load();
const listeners = new Set<() => void>();

/** Books the time since the last update as `mood` (or as rest, after a long gap). */
function settle(mood: Mood) {
  const now = Date.now();
  const minutes = Math.max(0, (now - energy.at) / 60_000);
  const resting = mood === "sleeping" || minutes > REST_GAP_MIN;
  const delta = resting ? RECOVER_PER_MIN * minutes : -DRAIN_PER_MIN * minutes;
  const value = Math.min(1, Math.max(FLOOR, energy.value + delta));
  energy = { value, at: now };
  try {
    localStorage.setItem(KEY, JSON.stringify(energy));
  } catch {
    /* not saved: it still counts until NIMI restarts */
  }
  listeners.forEach((l) => l());
}

/** The shell runs this once with NIMI's current mood. */
export function useEnergyClock(mood: Mood) {
  const last = useRef(mood);
  useEffect(() => {
    // The stretch that just ended belongs to the previous mood.
    settle(last.current);
    last.current = mood;
  }, [mood]);
  useEffect(() => {
    const id = window.setInterval(() => settle(last.current), TICK_MS);
    return () => window.clearInterval(id);
  }, []);
}

/** The current level, for Home. */
export function useEnergy(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => energy.value,
  );
}
