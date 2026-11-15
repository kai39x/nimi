import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Event names emitted by Rust. Mirror of `events` in `src-tauri/src/ipc.rs`. */
export const Events = {
  overlayVisibility: "nimi://overlay/visibility",
  overlayDrag: "nimi://overlay/drag",
  overlayCursor: "nimi://overlay/cursor",
  overlayClickOutside: "nimi://overlay/click-outside",
  overlayCovered: "nimi://overlay/covered",
  settingsChanged: "nimi://settings/changed",
  trayOpen: "nimi://tray/open",
  mediaState: "nimi://media/state",
  mediaArt: "nimi://media/art",
  mediaVolume: "nimi://media/volume",
} as const;

export type EventName = (typeof Events)[keyof typeof Events];

/**
 * Subscribes to a Rust event and returns a synchronous cleanup function, so it can be used
 * directly as a React effect body. Handles the unlisten promise resolving after cleanup.
 */
export function onEvent<T>(name: EventName, handler: (payload: T) => void): () => void {
  let unlisten: UnlistenFn | undefined;
  let cancelled = false;
  void listen<T>(name, (event) => handler(event.payload)).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}
