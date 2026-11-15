import { useEffect, useState } from "react";
import type { Mood } from "@/features/character/rig/moods";

/**
 * «الطاقة»: drains slowly while NIMI is awake and recovers while he sleeps (board 11 notes).
 * Persisted per device so it survives restarts. 0..1.
 */
const KEY = "nimi.energy";
const DRAIN_PER_MIN = 0.0025; // ~100 % → 0 % over 6.7 h awake
const RECOVER_PER_MIN = 0.01; // full again after ~1.5 h of sleep
const FLOOR = 0.1;

function load(): { value: number; at: number } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { value: number; at: number };
      if (Number.isFinite(parsed.value) && Number.isFinite(parsed.at)) return parsed;
    }
  } catch {
    /* storage unavailable: start fresh */
  }
  return { value: 0.8, at: Date.now() };
}

export function useEnergy(mood: Mood): number {
  const [state, setState] = useState(load);

  useEffect(() => {
    const tick = () => {
      setState((prev) => {
        const now = Date.now();
        const minutes = (now - prev.at) / 60_000;
        const delta = mood === "sleeping" ? RECOVER_PER_MIN * minutes : -DRAIN_PER_MIN * minutes;
        const value = Math.min(1, Math.max(FLOOR, prev.value + delta));
        const next = { value, at: now };
        try {
          localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [mood]);

  return state.value;
}
