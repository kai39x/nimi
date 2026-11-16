import { useEffect, useSyncExternalStore } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { feedInfo, feedRun, feedUndo, pocketAdd, setOverlayExpanded } from "@/ipc/commands";
import type { FeedAction } from "@/ipc/generated/FeedAction";
import type { FeedResult } from "@/ipc/generated/FeedResult";
import type { Meal } from "@/ipc/generated/Meal";
import type { Mood } from "@/features/character/rig/moods";
import { setMoodOverride } from "@/features/character/useNimiMood";

/**
 * Feeding NIMI (design spec §6, board 08 option B): the OS drag reaches the overlay (docs/PLAN.md
 * §2), and this store walks the flow — near → hungry (two drop zones: mouth / Nuri) → chomp →
 * chew → bubbles → result (or error). Dropping on Nuri puts the file in the pocket (§7).
 */

export type Zone = "mouth" | "pocket" | null;
export type Phase = "idle" | "near" | "hungry" | "chomp" | "chew" | "menu" | "working" | "result" | "error" | "pocketed";

export interface FeedState {
  phase: Phase;
  zone: Zone;
  /** Logical px in the overlay window, for the file flying into the mouth. */
  dropAt: { x: number; y: number } | null;
  paths: string[];
  meal: Meal | null;
  result: FeedResult | null;
  error: string | null;
  lastAction: FeedAction | null;
}

const IDLE: FeedState = { phase: "idle", zone: null, dropAt: null, paths: [], meal: null, result: null, error: null, lastAction: null };

let state: FeedState = IDLE;
const listeners = new Set<() => void>();
const timers: number[] = [];

function set(patch: Partial<FeedState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

function later(ms: number, fn: () => void) {
  timers.push(window.setTimeout(fn, ms));
}

function clearTimers() {
  timers.splice(0).forEach((t) => window.clearTimeout(t));
}

const MOOD: Partial<Record<Phase, Mood>> = {
  near: "curious",
  hungry: "hungry",
  chomp: "chomp",
  chew: "chew",
  menu: "attention",
  working: "working",
};

function mood(phase: Phase) {
  const m = MOOD[phase];
  setMoodOverride(m ?? null);
}

/** Where the zones are, measured from NIMI's frame in the overlay (set by the Feed layer). */
let zoneOf: (x: number, y: number) => Zone = () => null;
export function registerZones(fn: (x: number, y: number) => Zone) {
  zoneOf = fn;
}

/** How far from NIMI the drag still counts as "over him" (logical px). */
let nearOf: (x: number, y: number) => boolean = () => false;
export function registerNear(fn: (x: number, y: number) => boolean) {
  nearOf = fn;
}

/** Feeding only happens on the compact capsule (not over the open panel or island). */
let enabled = true;
export function setFeedEnabled(on: boolean) {
  enabled = on;
}

function busy() {
  return ["chomp", "chew", "working"].includes(state.phase);
}

/** Back to the plain capsule. */
export function dismiss() {
  clearTimers();
  state = IDLE;
  listeners.forEach((fn) => fn());
  setMoodOverride(null);
  void setOverlayExpanded(false);
}

async function eat(paths: string[], at: { x: number; y: number } | null) {
  clearTimers();
  set({ phase: "chomp", zone: null, dropAt: at, paths, result: null, error: null });
  mood("chomp");
  let meal: Meal | null = null;
  try {
    meal = await feedInfo(paths);
  } catch (err) {
    fail(String(err));
    return;
  }
  set({ meal });
  later(650, () => {
    set({ phase: "chew" });
    mood("chew");
    later(550, () => {
      set({ phase: "menu" });
      mood("menu");
      // Click outside closes the bubbles (the hit-test loop reports it while "expanded").
      void setOverlayExpanded(true);
    });
  });
}

function fail(error: string) {
  set({ phase: "error", error });
  setMoodOverride("error", 2500);
  void setOverlayExpanded(true);
}

export async function runAction(action: FeedAction) {
  if (!state.paths.length || busy()) return;
  set({ phase: "working", lastAction: action });
  mood("working");
  try {
    const result = await feedRun(action, state.paths);
    set({ phase: "result", result });
    setMoodOverride("happy", 2200);
    // Text results (OCR, archive listing) stay until clicked away; the rest fade after 7 s.
    if (!result.text) {
      later(7000, () => {
        if (state.phase === "result") dismiss();
      });
    }
  } catch (err) {
    const msg = String(err);
    if (msg === "cancelled") {
      set({ phase: "menu" });
      mood("menu");
      return;
    }
    fail(msg);
  }
}

/** «حطّه في الجيب» from the bubbles (or a drop on Nuri). */
export async function toPocket(paths = state.paths) {
  clearTimers();
  await pocketAdd(paths);
  set({ phase: "pocketed", paths, result: null });
  setMoodOverride("happy", 1800);
  void setOverlayExpanded(true);
  later(2600, () => {
    if (state.phase === "pocketed") dismiss();
  });
}

export async function undo() {
  const token = state.result?.undo;
  if (!token) return;
  try {
    await feedUndo(token);
    dismiss();
  } catch (err) {
    fail(String(err));
  }
}

/** «حاول مرة ثانية»: back to the bubbles with the same meal. */
export function retry() {
  if (!state.paths.length) return dismiss();
  set({ phase: "menu", error: null });
  mood("menu");
}

export function useFeed(): FeedState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}

/** Wires the overlay's OS drag-and-drop events to the flow. Mount once (in the Shell). */
export function useFeedDrops() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        const dpr = window.devicePixelRatio || 1;
        const at = "position" in p ? { x: p.position.x / dpr, y: p.position.y / dpr } : null;
        if (busy() || !enabled) return;
        switch (p.type) {
          case "enter": {
            clearTimers();
            const over = at ? nearOf(at.x, at.y) : false;
            set({ ...IDLE, phase: over ? "hungry" : "near", paths: p.paths, zone: at ? zoneOf(at.x, at.y) : null });
            mood(over ? "hungry" : "near");
            break;
          }
          case "over": {
            if (!at || (state.phase !== "near" && state.phase !== "hungry")) break;
            const over = nearOf(at.x, at.y);
            const zone = over ? zoneOf(at.x, at.y) : null;
            const phase: Phase = over ? "hungry" : "near";
            if (phase !== state.phase || zone !== state.zone) {
              set({ phase, zone });
              mood(phase);
            }
            break;
          }
          case "drop": {
            const zone = at ? zoneOf(at.x, at.y) : state.zone;
            const paths = p.paths.length ? p.paths : state.paths;
            if (zone === "pocket") void toPocket(paths);
            else if (zone === "mouth" || (at && nearOf(at.x, at.y))) void eat(paths, at);
            else dismiss();
            break;
          }
          case "leave":
            if (state.phase === "near" || state.phase === "hungry") dismiss();
            break;
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
