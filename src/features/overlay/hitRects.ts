import { useLayoutEffect, type RefObject } from "react";
import { setHitRects } from "@/ipc/commands";
import type { HitRect } from "@/ipc/generated/HitRect";

/**
 * The overlay window is click-through everywhere except over the elements registered here.
 * Rust polls the cursor against these rects (CSS px, window-relative) and enables mouse input
 * only while the cursor is over one of them. See docs/PLAN.md §2.
 */

const tracked = new Map<string, Element>();
let frame = 0;

/** The element's box clipped to the window: a capsule slid up off the top edge (peek mode)
 *  only reports its visible strip, and nothing outside the window can catch the mouse. */
function measure(el: Element): HitRect {
  const r = el.getBoundingClientRect();
  const x = Math.max(0, r.left);
  const y = Math.max(0, r.top);
  const right = Math.min(window.innerWidth, r.right);
  const bottom = Math.min(window.innerHeight, r.bottom);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

function flush() {
  frame = 0;
  const rects: HitRect[] = [];
  for (const el of tracked.values()) {
    if (!el.isConnected) continue;
    const rect = measure(el);
    if (rect.w > 0 && rect.h > 0) rects.push(rect);
  }
  void setHitRects(rects);
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(flush);
}

/** Re-measures every tracked element on the next frame (call after layout animations). */
export function refreshHitRects() {
  schedule();
}

/** Registers `ref`'s element as mouse-interactive while `active` is true. */
export function useHitRect(ref: RefObject<HTMLElement | null>, id: string, active = true) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) {
      tracked.delete(id);
      schedule();
      return;
    }
    tracked.set(id, el);
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      tracked.delete(id);
      schedule();
    };
  }, [ref, id, active]);
}
