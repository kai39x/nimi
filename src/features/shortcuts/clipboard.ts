import { useSyncExternalStore } from "react";
import { clipList } from "@/ipc/commands";
import { Events, onEvent } from "@/ipc/events";
import type { ClipItem } from "@/ipc/generated/ClipItem";

/** «سجل الحافظة»: Rust keeps the last copied texts in memory; this mirrors them. */

let items: ClipItem[] = [];
let started = false;
const listeners = new Set<() => void>();

function publish(next: ClipItem[]) {
  items = next;
  listeners.forEach((fn) => fn());
}

export function useClips(): ClipItem[] {
  if (!started) {
    started = true;
    onEvent<ClipItem[]>(Events.clipboardChanged, publish);
    void clipList().then(publish);
  }
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => items,
  );
}
