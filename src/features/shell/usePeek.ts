import { useEffect, useRef, useState } from "react";
import { getOverlayCovered } from "@/ipc/commands";
import { Events, onEvent } from "@/ipc/events";
import type { CursorProximity } from "@/ipc/generated/CursorProximity";

/**
 * Peek mode «يطل» (design/character/REFINEMENTS.md §1, board_refinements.png panel 1): over a
 * maximized window whose title bar / tab strip lies under the capsule, the capsule slides up
 * and only a 12 px strip stays (NIMI's eyes peek). The cursor coming within 60 px — or a file
 * drag approaching — brings it down; 1 s after the cursor leaves, it peeks again.
 *
 * Rust reports `covered` (the maximized window) and `reveal` (cursor proximity); this hook only
 * combines them with the setting and the panel state.
 */

/** How long the capsule stays down after the cursor leaves its 60 px zone. */
const REPEEK_AFTER_MS = 1000;

let holdUntil = 0;
const holdListeners = new Set<() => void>();

/**
 * Brings a peeking capsule down for `ms` (a notification shows its bubble, spec: 5 s), then lets
 * it peek again. Safe to call when not peeking.
 */
export function revealCapsule(ms = 5000) {
  holdUntil = Math.max(holdUntil, Date.now() + ms);
  holdListeners.forEach((fn) => fn());
}

export function usePeek({ enabled, expanded }: { enabled: boolean; expanded: boolean }): boolean {
  const [covered, setCovered] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [held, setHeld] = useState(false);
  const leaveTimer = useRef(0);

  useEffect(() => {
    getOverlayCovered().then(setCovered).catch(console.error);
    return onEvent<boolean>(Events.overlayCovered, setCovered);
  }, []);

  useEffect(
    () =>
      onEvent<CursorProximity>(Events.overlayCursor, (p) => {
        window.clearTimeout(leaveTimer.current);
        if (p.reveal) setRevealed(true);
        else leaveTimer.current = window.setTimeout(() => setRevealed(false), REPEEK_AFTER_MS);
      }),
    [],
  );

  useEffect(() => {
    let timer = 0;
    const sync = () => {
      window.clearTimeout(timer);
      const left = holdUntil - Date.now();
      setHeld(left > 0);
      if (left > 0) timer = window.setTimeout(sync, left + 20);
    };
    holdListeners.add(sync);
    return () => {
      holdListeners.delete(sync);
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  return enabled && covered && !expanded && !revealed && !held;
}
