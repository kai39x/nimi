import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Events, onEvent } from "@/ipc/events";
import type { CursorProximity } from "@/ipc/generated/CursorProximity";
import type { OverlayDragEvent } from "@/ipc/generated/OverlayDragEvent";
import type { OverlayVisibility } from "@/ipc/generated/OverlayVisibility";
import { setNimiPaused } from "./engine";
import type { NimiHandle } from "./Nimi";
import type { Mood } from "./rig/moods";

/**
 * Mood state machine (design spec §2 / board 19, interaction rules from ANIMATION.md §1):
 *   idle → bored (no interaction) → sleeping (setting: 10/20/30 min, never) → wakes when the
 *   cursor comes near · near / hover → curious · hover 1.8 s → love · click → happy 1.8 s ·
 *   3 clicks in 1.5 s → shy · drag → grabbed · release → surprised, or dizzy when shaken
 *   (≥ 4 direction flips).
 * The yawn into sleep and the stretch out of it are played by the engine on the mood change.
 * Other features set moods through `setMoodOverride` (music, working, error, hungry, …).
 */

const BORED_AFTER_MS = 3 * 60_000;
const HAPPY_MS = 1800;
const SHY_MS = 2600;
const SHY_CLICKS = 3;
const SHY_WINDOW_MS = 1500;
const LOVE_AFTER_MS = 1800;
const LOVE_LINGER_MS = 600;
const DIZZY_MS = 3200;
const SURPRISED_MS = 1400;
const SHAKE_FLIPS = 4;
const SHAKE_WINDOW_MS = 1200;

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

let ambient: Mood | null = null;

/**
 * A background mood that lasts while something goes on (music playing): it beats idle, bored,
 * sleeping and hover, but clicks, drags and `setMoodOverride` still show through. While it is
 * set NIMI does not get bored.
 */
export function setAmbientMood(mood: Mood | null) {
  if (ambient === mood) return;
  ambient = mood;
  overrideListeners.forEach((fn) => fn());
}

export interface MoodOptions {
  /** Minutes after getting bored before falling asleep; 0 = never. */
  sleepAfterMin: number;
  /** The character, for the physical side of interactions (drag lean, throw, idle cut-off). */
  nimi?: RefObject<NimiHandle | null>;
}

export function useNimiMood({ sleepAfterMin, nimi }: MoodOptions) {
  const [mood, setMood] = useState<Mood>("idle");

  const base = useRef<Base>("idle");
  const lastInteraction = useRef(Date.now());
  const near = useRef(false);
  const hovering = useRef(false);
  const loved = useRef(false);
  const loveTimer = useRef(0);
  const reaction = useRef<{ mood: Mood; until: number } | null>(null);
  const dragging = useRef(false);
  const clicks = useRef<number[]>([]);
  const hidden = useRef(false);
  const sleepAfter = useRef(sleepAfterMin);
  sleepAfter.current = sleepAfterMin;
  const handle = useRef(nimi);
  handle.current = nimi;

  const compute = useCallback((): Mood => {
    const now = Date.now();
    if (override && (override.until === null || override.until > now)) return override.mood;
    if (dragging.current) return "grabbed";
    if (reaction.current && reaction.current.until > now) return reaction.current.mood;
    if (ambient) return ambient;
    if (base.current === "sleeping") return "sleeping";
    if (loved.current) return "love";
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
      if (ambient) lastInteraction.current = Date.now();
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

  const react = useCallback(
    (next: Mood, ms: number) => {
      reaction.current = { mood: next, until: Date.now() + ms };
      window.setTimeout(refresh, ms + 20);
      refresh();
    },
    [refresh],
  );

  // Dragging the capsule: grabbed, leaning with the pointer speed; on release surprised, or
  // dizzy when shaken (≥ 4 horizontal direction flips in the last 1.2 s).
  useEffect(() => {
    let samples: Array<[number, number, number]> = [];
    let flips: number[] = [];
    let lastSign = 0;
    const velocity = () => {
      const n = samples.length;
      if (n < 2) return { vx: 0, vy: 0 };
      const a = samples[Math.max(0, n - 5)];
      const b = samples[n - 1];
      const dt = (b[0] - a[0]) / 1000 || 0.016;
      return { vx: (b[1] - a[1]) / dt, vy: (b[2] - a[2]) / dt };
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      const now = performance.now();
      const prev = samples[samples.length - 1];
      samples.push([now, e.screenX, e.screenY]);
      samples = samples.filter((s) => now - s[0] < 200);
      if (prev) {
        const dx = e.screenX - prev[1];
        const sign = Math.sign(dx);
        if (Math.abs(dx) > 4 && sign !== 0) {
          if (lastSign && sign !== lastSign) flips = [...flips.filter((t) => now - t < SHAKE_WINDOW_MS), now];
          lastSign = sign;
        }
      }
      const { vx, vy } = velocity();
      handle.current?.current?.drag(vx, vy);
    };
    window.addEventListener("pointermove", onMove);
    const off = onEvent<OverlayDragEvent>(Events.overlayDrag, (d) => {
      if (d.phase === "move" && !dragging.current) {
        dragging.current = true;
        samples = [];
        flips = [];
        lastSign = 0;
        reaction.current = null;
        handle.current?.current?.drag(0, 0);
        touch();
        refresh();
      }
      if (d.phase === "end" && dragging.current) {
        dragging.current = false;
        const { vx, vy } = velocity();
        handle.current?.current?.release(vx, vy);
        const shaken = flips.filter((t) => performance.now() - t < SHAKE_WINDOW_MS).length >= SHAKE_FLIPS;
        touch();
        react(shaken ? "dizzy" : "surprised", shaken ? DIZZY_MS : SURPRISED_MS);
      }
    });
    return () => {
      window.removeEventListener("pointermove", onMove);
      off();
    };
  }, [refresh, touch, react]);

  const onClick = useCallback(() => {
    const now = Date.now();
    clicks.current = [...clicks.current.filter((t) => now - t < SHY_WINDOW_MS), now];
    touch();
    handle.current?.current?.poke();
    if (clicks.current.length >= SHY_CLICKS) {
      clicks.current = [];
      react("shy", SHY_MS);
    } else if (!reaction.current || reaction.current.until <= now || reaction.current.mood === "happy") {
      react("happy", HAPPY_MS);
    }
  }, [touch, react]);

  // Hover: curious at once, love after 1.8 s of the mouse resting on him (ANIMATION.md §1).
  const onPointerEnter = useCallback(
    (e?: { pointerType?: string }) => {
      hovering.current = true;
      if (base.current !== "idle") touch();
      handle.current?.current?.touch();
      window.clearTimeout(loveTimer.current);
      if (!e?.pointerType || e.pointerType === "mouse") {
        loveTimer.current = window.setTimeout(() => {
          if (!hovering.current || dragging.current) return;
          loved.current = true;
          refresh();
        }, LOVE_AFTER_MS);
      }
      refresh();
    },
    [refresh, touch],
  );

  const onPointerLeave = useCallback(() => {
    hovering.current = false;
    window.clearTimeout(loveTimer.current);
    if (loved.current) {
      loveTimer.current = window.setTimeout(() => {
        loved.current = false;
        refresh();
      }, LOVE_LINGER_MS);
    }
    refresh();
  }, [refresh]);

  useEffect(() => () => window.clearTimeout(loveTimer.current), []);

  return { mood, onClick, onPointerEnter, onPointerLeave };
}

if (import.meta.env.DEV) {
  // Test hooks for scripts/cdp.py: window.__nimi.setMood('happy', 3000) · window.__nimi.pause(true)
  (window as unknown as { __nimi: object }).__nimi = {
    setMood: (mood: Mood | null, ttl?: number) => setMoodOverride(mood, ttl),
    pause: (paused: boolean) => setNimiPaused(paused),
  };
}
