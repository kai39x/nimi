import { useCallback, useEffect, useRef, useState } from "react";
import { Events, onEvent } from "@/ipc/events";
import type { CursorProximity } from "@/ipc/generated/CursorProximity";
import type { OverlayDragEvent } from "@/ipc/generated/OverlayDragEvent";
import type { OverlayVisibility } from "@/ipc/generated/OverlayVisibility";
import type { Mood } from "./rig/moods";

/**
 * Mood state machine (design spec §2 / board 19):
 *   idle → bored (no interaction) → sleeping (setting: 10/20/30 min, never) → wakes when the
 *   cursor comes near · hover/near → curious · click → happy · repeated clicks → shy ·
 *   drag → grabbed · shaken while dragging → dizzy.
 * Other features set moods through `setMoodOverride` (music, working, error, hungry, …).
 */

const BORED_AFTER_MS = 3 * 60_000;
const HAPPY_MS = 1500;
const SHY_MS = 3600;
const DIZZY_LINGER_MS = 1300;
const SHY_CLICKS = 4;
const SHY_WINDOW_MS = 3000;

type Base = "idle" | "bored" | "sleeping";

interface Override {
  mood: Mood;
  until: number | null;
}

let override: Override | null = null;
const overrideListeners = new Set<() => void>();

/** Lets other features drive the mood (`null` releases it; `ttlMs` auto-releases). */
export function setMoodOverride(mood: Mood | null, ttlMs?: number) {
  override = mood ? { mood, until: ttlMs ? Date.now() + ttlMs : null } : null;
  overrideListeners.forEach((fn) => fn());
}

export interface MoodOptions {
  /** Minutes after getting bored before falling asleep; 0 = never. */
  sleepAfterMin: number;
}

export function useNimiMood({ sleepAfterMin }: MoodOptions) {
  const [mood, setMood] = useState<Mood>("idle");

  const base = useRef<Base>("idle");
  const lastInteraction = useRef(Date.now());
  const near = useRef(false);
  const hovering = useRef(false);
  const reaction = useRef<{ mood: Mood; until: number } | null>(null);
  const dragging = useRef(false);
  const dizzy = useRef(false);
  const dizzyUntil = useRef(0);
  const clicks = useRef<number[]>([]);
  const hidden = useRef(false);
  const sleepAfter = useRef(sleepAfterMin);
  sleepAfter.current = sleepAfterMin;

  const compute = useCallback((): Mood => {
    const now = Date.now();
    if (override && (override.until === null || override.until > now)) return override.mood;
    if (dragging.current) return dizzy.current ? "dizzy" : "grabbed";
    if (dizzyUntil.current > now) return "dizzy";
    if (reaction.current && reaction.current.until > now) return reaction.current.mood;
    if (base.current === "sleeping") return "sleeping";
    if (near.current || hovering.current) return "curious";
    return base.current;
  }, []);

  const refresh = useCallback(() => setMood(compute()), [compute]);

  const touch = useCallback(() => {
    lastInteraction.current = Date.now();
    base.current = "idle";
  }, []);

  // Inactivity timers: idle → bored → sleeping (late night shortens the wait).
  useEffect(() => {
    const tick = window.setInterval(() => {
      if (hidden.current) return;
      const idleFor = Date.now() - lastInteraction.current;
      const hour = new Date().getHours();
      const lateNight = hour >= 23 || hour < 6;
      const sleepDelay = sleepAfter.current > 0 ? sleepAfter.current * 60_000 : Infinity;
      let next: Base = "idle";
      if (idleFor > BORED_AFTER_MS) next = "bored";
      if (idleFor > BORED_AFTER_MS + (lateNight ? Math.min(sleepDelay, 60_000) : sleepDelay)) next = "sleeping";
      if (next !== base.current) {
        base.current = next;
        refresh();
      }
      // Expire timed reactions without waiting for the next event.
      if ((reaction.current && reaction.current.until <= Date.now()) || (override?.until && override.until <= Date.now())) {
        if (override?.until && override.until <= Date.now()) override = null;
        refresh();
      }
    }, 1000);
    return () => window.clearInterval(tick);
  }, [refresh]);

  useEffect(() => {
    overrideListeners.add(refresh);
    return () => {
      overrideListeners.delete(refresh);
    };
  }, [refresh]);

  // Cursor approaching (from the Rust hit-test loop) — also what wakes a sleeping NIMI.
  useEffect(
    () =>
      onEvent<CursorProximity>(Events.overlayCursor, (p) => {
        near.current = p.near;
        if (p.near && base.current !== "idle") touch();
        if (p.inside) lastInteraction.current = Date.now();
        refresh();
      }),
    [refresh, touch],
  );

  useEffect(
    () =>
      onEvent<OverlayVisibility>(Events.overlayVisibility, (v) => {
        hidden.current = !v.visible;
        if (v.visible) touch();
      }),
    [touch],
  );

  // Dragging: grabbed, and dizzy when shaken (direction reversals in quick succession).
  useEffect(() => {
    let lastX = 0;
    let lastDir = 0;
    let reversals: number[] = [];
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      const dir = Math.sign(e.screenX - lastX);
      if (dir !== 0 && lastDir !== 0 && dir !== lastDir) {
        const now = Date.now();
        reversals = [...reversals.filter((t) => now - t < 700), now];
        if (reversals.length >= 4 && !dizzy.current) {
          dizzy.current = true;
          refresh();
        }
      }
      if (dir !== 0) lastDir = dir;
      lastX = e.screenX;
    };
    window.addEventListener("pointermove", onMove);
    const off = onEvent<OverlayDragEvent>(Events.overlayDrag, (d) => {
      if (d.phase === "move" && !dragging.current) {
        dragging.current = true;
        dizzy.current = false;
        reversals = [];
        touch();
        refresh();
      }
      if (d.phase === "end" && dragging.current) {
        dragging.current = false;
        if (dizzy.current) dizzyUntil.current = Date.now() + DIZZY_LINGER_MS;
        dizzy.current = false;
        touch();
        refresh();
        window.setTimeout(refresh, DIZZY_LINGER_MS + 20);
      }
    });
    return () => {
      window.removeEventListener("pointermove", onMove);
      off();
    };
  }, [refresh, touch]);

  const onClick = useCallback(() => {
    const now = Date.now();
    clicks.current = [...clicks.current.filter((t) => now - t < SHY_WINDOW_MS), now];
    touch();
    if (clicks.current.length >= SHY_CLICKS) {
      clicks.current = [];
      reaction.current = { mood: "shy", until: now + SHY_MS };
      window.setTimeout(refresh, SHY_MS + 20);
    } else {
      reaction.current = { mood: "happy", until: now + HAPPY_MS };
      window.setTimeout(refresh, HAPPY_MS + 20);
    }
    refresh();
  }, [refresh, touch]);

  const onPointerEnter = useCallback(() => {
    hovering.current = true;
    if (base.current !== "idle") touch();
    refresh();
  }, [refresh, touch]);

  const onPointerLeave = useCallback(() => {
    hovering.current = false;
    refresh();
  }, [refresh]);

  return { mood, onClick, onPointerEnter, onPointerLeave };
}

if (import.meta.env.DEV) {
  // Test hook for scripts/cdp.py: window.__nimi.setMood('happy', 3000)
  (window as unknown as { __nimi: object }).__nimi = {
    setMood: (mood: Mood | null, ttl?: number) => setMoodOverride(mood, ttl),
  };
}
