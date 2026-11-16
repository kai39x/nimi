import { useSyncExternalStore } from "react";
import { getSettings, setSettings } from "@/ipc/commands";
import { Events, onEvent } from "@/ipc/events";
import type { Settings } from "@/ipc/generated/Settings";

/**
 * Settings store shared by every window. Rust owns the file; this mirrors it, applies the
 * language to the document, and keeps all windows in sync through `nimi://settings/changed`.
 */

let current: Settings | null = null;
let started = false;
const listeners = new Set<() => void>();

function publish(next: Settings) {
  current = next;
  applyToDocument(next);
  listeners.forEach((fn) => fn());
}

function applyToDocument(settings: Settings) {
  const html = document.documentElement;
  html.lang = settings.language;
  html.dir = settings.language === "ar" ? "rtl" : "ltr";
}

/** Loads settings once and subscribes to changes from Rust. Safe to call more than once. */
export async function initSettings(): Promise<Settings> {
  if (!started) {
    started = true;
    onEvent<Settings>(Events.settingsChanged, publish);
  }
  if (!current) publish(await getSettings());
  return current!;
}

export function useSettings(): Settings | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
    () => current,
  );
}

/** Optimistically applies a partial change, then persists it through Rust. */
export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  if (!current) return;
  publish({ ...current, ...patch });
  publish(await setSettings(current));
}

/** The current settings outside React (null before the first load). */
export function getSettingsNow(): Settings | null {
  return current;
}
