import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import { startOverlayDrag } from "@/ipc/commands";
import { Events, onEvent } from "@/ipc/events";
import type { OverlayDragEvent } from "@/ipc/generated/OverlayDragEvent";

/**
 * Dragging the capsule along the top edge. The webview only reports the press; Rust follows the
 * cursor and moves the window (robust even though the window moves under the pointer), and tells
 * us whether the press turned into a drag so a click after a drag can be ignored.
 */
export function useOverlayDrag() {
  const moved = useRef(false);

  useEffect(
    () =>
      onEvent<OverlayDragEvent>(Events.overlayDrag, (event) => {
        if (event.phase === "start") moved.current = false;
        if (event.phase === "move") moved.current = true;
      }),
    [],
  );

  const onPointerDown = useCallback((event: PointerEvent) => {
    if (event.button !== 0) return;
    moved.current = false;
    void startOverlayDrag();
  }, []);

  /** True when the last press moved the window; such a press is not a click. */
  const wasDragged = useCallback(() => moved.current, []);

  return { onPointerDown, wasDragged };
}
