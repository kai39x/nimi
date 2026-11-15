import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { focusOverlay, recenterOverlay, setOverlayExpanded } from "@/ipc/commands";
import { Events, onEvent } from "@/ipc/events";
import { useT } from "@/i18n";
import { useSettings } from "@/lib/settings";
import { isWinter, nuriPace } from "@/lib/winter";
import { refreshHitRects, useHitRect } from "@/features/overlay/hitRects";
import { useOverlayDrag } from "@/features/overlay/useOverlayDrag";
import { Nimi } from "@/features/character/Nimi";
import { useNimiMood } from "@/features/character/useNimiMood";
import { Panel } from "@/features/panel/Panel";
import { CAPSULE_TOP, DEFAULT_NIMI_SIZE, PANEL_NIMI_SIZE, PANEL_TOP } from "./constants";
import "./shell.css";

/** Time to wait for a second click before treating a click as a single click. */
const DOUBLE_CLICK_MS = 260;

/**
 * The one glass surface NIMI lives in. Compact it is the 148×52 capsule (board 06); a click
 * morphs it into the 880 px panel (board 11, 420 ms spring, content fades in after 120 ms).
 * Esc or a click outside brings the capsule back. The shell is the only mouse-interactive region.
 */
export function Shell() {
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  const settings = useSettings();
  const drag = useOverlayDrag();
  const [expanded, setExpanded] = useState(false);
  useHitRect(ref, "shell");

  const size = settings?.nimiSize ?? DEFAULT_NIMI_SIZE;
  const scale = size / DEFAULT_NIMI_SIZE;
  const winter = isWinter(settings);
  const { mood, onClick: moodClick, onPointerEnter, onPointerLeave } = useNimiMood({
    sleepAfterMin: settings?.sleepAfterMin ?? 10,
  });

  // The hit rect must follow the morph frame by frame.
  const morphing = useRef(0);
  const trackMorph = useCallback(() => {
    const until = performance.now() + 520;
    const step = () => {
      refreshHitRects();
      if (performance.now() < until) morphing.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(morphing.current);
    morphing.current = requestAnimationFrame(step);
  }, []);

  const open = useCallback(() => {
    setExpanded(true);
    void setOverlayExpanded(true);
    void focusOverlay(true);
    trackMorph();
  }, [trackMorph]);

  const close = useCallback(() => {
    setExpanded(false);
    void setOverlayExpanded(false);
    void focusOverlay(false);
    trackMorph();
  }, [trackMorph]);

  const pendingOpen = useRef(0);
  useEffect(() => () => window.clearTimeout(pendingOpen.current), []);

  useEffect(() => onEvent(Events.overlayClickOutside, close), [close]);
  useEffect(() => onEvent(Events.trayOpen, open), [open]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, close]);

  const nimiSize = expanded ? PANEL_NIMI_SIZE : size;

  return (
    <div
      ref={ref}
      className={["shell", "n-glass", expanded ? "shell--panel" : "shell--capsule", winter && "shell--winter"]
        .filter(Boolean)
        .join(" ")}
      style={
        {
          "--nimi-scale": scale,
          "--capsule-top": `${CAPSULE_TOP}px`,
          "--panel-top": `${PANEL_TOP}px`,
        } as CSSProperties
      }
      role={expanded ? "dialog" : "button"}
      aria-label={t("app.name")}
      aria-expanded={expanded}
      onPointerDown={expanded ? undefined : drag.onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onClick={(e) => {
        if (expanded || drag.wasDragged()) return;
        // Wait out the double-click interval before morphing: once the panel opens, a second
        // click would land outside the old capsule rect. Two clicks = double-click (recenter;
        // phase 4 makes it play/pause while music plays).
        window.clearTimeout(pendingOpen.current);
        if (e.detail === 1) {
          moodClick();
          pendingOpen.current = window.setTimeout(open, DOUBLE_CLICK_MS);
        } else if (e.detail === 2) {
          void recenterOverlay();
        }
      }}
    >
      <div className="shell__nimi" onClick={expanded ? moodClick : undefined}>
        <Nimi
          mood={mood}
          size={nimiSize}
          winter={winter}
          reducedMotion={settings?.reduceMotion ?? false}
          nuriPace={nuriPace(settings?.nuriActivity)}
        />
      </div>
      <Panel open={expanded} mood={mood} onCollapse={close} />
    </div>
  );
}
