import { ACTION_LABEL, recordMeal } from "./today";
import { play, type SoundId } from "@/lib/sounds";
import { useEffect, useSyncExternalStore } from "react";
import { feedInfo, feedRun, feedUndo, focusOverlay, pocketAdd, setOverlayExpanded } from "@/ipc/commands";
import { Events, onEvent } from "@/ipc/events";
import type { DropEvent } from "@/ipc/generated/DropEvent";
import type { FeedAction } from "@/ipc/generated/FeedAction";
import type { FeedResult } from "@/ipc/generated/FeedResult";
import type { Meal } from "@/ipc/generated/Meal";
import type { Mood } from "@/features/character/rig/moods";
import { setMoodOverride } from "@/features/character/useNimiMood";

/**
 * Feeding NIMI (design spec §6, board 08 option B): the overlay's own drop target
 * (src-tauri/src/files/drop.rs) sends files, links and text, and this store walks the flow —
 * near → hungry (two drop zones: mouth / Nuri) → chomp → chew → bubbles → result (or error).
 * Dropping a file on Nuri puts it in the pocket (§7).
 *
 * A long job (a 6 GB ZIP) keeps going when the user clicks away: the stage closes, NIMI keeps
 * his working face on the capsule (`bg`), and the result waits there until it is clicked.
 */

export type Zone = "mouth" | "pocket" | null;
export type Phase = "idle" | "near" | "hungry" | "chomp" | "chew" | "menu" | "working" | "result" | "error" | "pocketed";
/** A second round of bubbles: the formats for «تحويل», or the page picker for a PDF. */
export type Sub = "convert" | "pages" | null;

export interface FeedState {
  phase: Phase;
  zone: Zone;
  /** Logical px in the overlay window, for the file flying into the mouth. */
  dropAt: { x: number; y: number } | null;
  paths: string[];
  /** A dropped link or text (no files). */
  text: string | null;
  meal: Meal | null;
  result: FeedResult | null;
  error: string | null;
  lastAction: FeedAction | null;
  sub: Sub;
  /** The stage is closed but the job (or its result) is still his: shown on the capsule. */
  bg: boolean;
}

const IDLE: FeedState = {
  phase: "idle",
  zone: null,
  dropAt: null,
  paths: [],
  text: null,
  meal: null,
  result: null,
  error: null,
  lastAction: null,
  sub: null,
  bg: false,
};

let state: FeedState = IDLE;
const listeners = new Set<() => void>();
const timers: number[] = [];

/** The overlay never takes keyboard focus on its own; the page picker needs it to type. */
let typing = false;
function syncKeyboard() {
  const want = state.phase === "menu" && state.sub === "pages" && !state.bg;
  if (want !== typing) {
    typing = want;
    void focusOverlay(want);
  }
}

const PHASE_SOUND: Partial<Record<Phase, SoundId>> = {
  chomp: "nimi_chomp",
  menu: "nimi_gulp",
  working: "bubble_pop",
  result: "done_success",
  error: "error_soft",
  pocketed: "pocket_in",
};

function set(patch: Partial<FeedState>) {
  const before = state.phase;
  state = { ...state, ...patch };
  if (patch.phase && patch.phase !== before) {
    const sound = PHASE_SOUND[patch.phase];
    // A job finishing behind the capsule still says so; the others are part of the show.
    if (sound) play(sound);
  }
  listeners.forEach((fn) => fn());
  syncKeyboard();
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
  setMoodOverride(MOOD[phase] ?? null);
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

/** Back to the plain capsule. While a job runs this only closes the stage (see `background`). */
export function dismiss() {
  if (state.phase === "working") return background();
  clearTimers();
  state = IDLE;
  listeners.forEach((fn) => fn());
  syncKeyboard();
  setMoodOverride(null);
  void setOverlayExpanded(false);
}

/** Click outside mid-job: close the stage, keep the working face, finish quietly. */
export function background() {
  if (state.bg) return;
  set({ bg: true, sub: null });
  void setOverlayExpanded(false);
}

/** A click on the capsule while a job (or its result) waits there: open the stage again. */
export function reopen() {
  if (!state.bg) return;
  clearTimers();
  set({ bg: false });
  void setOverlayExpanded(true);
}

async function eat(paths: string[], text: string | null, at: { x: number; y: number } | null) {
  clearTimers();
  set({ ...IDLE, phase: "chomp", dropAt: at, paths, text });
  mood("chomp");
  let meal: Meal | null = null;
  try {
    meal = await feedInfo(paths, text);
  } catch (err) {
    fail(String(err));
    return;
  }
  set({ meal, text: meal.text ?? text });
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
  if (state.bg) later(30_000, () => state.bg && state.phase === "error" && dismiss());
  else void setOverlayExpanded(true);
}

export async function runAction(action: FeedAction, target: string | null = null) {
  if ((!state.paths.length && !state.text) || busy()) return;
  set({ phase: "working", lastAction: action, sub: null });
  mood("working");
  try {
    const result = await feedRun(action, state.paths, state.text, target);
    recordMeal(state.paths.length, ACTION_LABEL[action]);
    set({ phase: "result", result });
    setMoodOverride("happy", 2200);
    if (state.bg) {
      // Finished behind the capsule: the pill says so; a click opens the full result.
      later(30_000, () => state.bg && state.phase === "result" && dismiss());
    } else if (!result.text && !result.counts) {
      // Text results (OCR, listing, word count) stay until clicked away; the rest fade.
      later(7000, () => state.phase === "result" && dismiss());
    }
  } catch (err) {
    const msg = String(err);
    if (msg === "cancelled") {
      set({ phase: "menu", bg: false });
      mood("menu");
      return;
    }
    fail(msg);
  }
}

/** Second round of bubbles («تحويل» formats, PDF pages) or back to the first. */
export function openSub(sub: Sub) {
  if (state.phase !== "menu") return;
  set({ sub });
}

/** «حطّه في الجيب» from the bubbles (or a drop on Nuri). */
export async function toPocket(paths = state.paths) {
  if (!paths.length) return;
  clearTimers();
  await pocketAdd(paths);
  recordMeal(paths.length, "feed.pocket");
  set({ phase: "pocketed", paths, result: null });
  setMoodOverride("happy", 1800);
  void setOverlayExpanded(true);
  later(2600, () => state.phase === "pocketed" && dismiss());
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
  if (!state.paths.length && !state.text) return dismiss();
  set({ phase: "menu", error: null, bg: false });
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

/** Wires the overlay's drop events (`nimi://drop`) to the flow. Mount once (in the Shell). */
export function useFeedDrops() {
  useEffect(
    () =>
      onEvent<DropEvent>(Events.drop, (e) => {
        const dpr = window.devicePixelRatio || 1;
        const at = { x: e.x / dpr, y: e.y / dpr };
        if (busy() || !enabled || state.bg) return;
        switch (e.kind) {
          case "enter": {
            clearTimers();
            const over = nearOf(at.x, at.y);
            set({ ...IDLE, phase: over ? "hungry" : "near", paths: e.paths, text: e.text, zone: zoneOf(at.x, at.y) });
            mood(over ? "hungry" : "near");
            break;
          }
          case "over": {
            if (state.phase !== "near" && state.phase !== "hungry") break;
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
            const zone = zoneOf(at.x, at.y);
            const paths = e.paths.length ? e.paths : state.paths;
            const text = e.text ?? state.text;
            // The pocket keeps files only; a link or text dropped on Nuri is eaten instead.
            if (zone === "pocket" && paths.length) void toPocket(paths);
            else if (zone || nearOf(at.x, at.y)) void eat(paths, paths.length ? null : text, at);
            else dismiss();
            break;
          }
          case "leave":
            if (state.phase === "near" || state.phase === "hungry") dismiss();
            break;
        }
      }),
    [],
  );
}
