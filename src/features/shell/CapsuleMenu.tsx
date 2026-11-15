import { useRef, type ReactNode } from "react";
import { useT } from "@/i18n";
import { hideOverlayFor } from "@/ipc/commands";
import { updateSettings, useSettings } from "@/lib/settings";
import { useHitRect } from "@/features/overlay/hitRects";
import { hasSong, media, useMedia } from "@/features/music/media";

/** A small glass pill under the capsule (board 07 gestures): song name, volume %, play/pause. */
export function CapsulePill({ children, tone }: { children: ReactNode; tone?: "butter" }) {
  return (
    <div className={"capsule-pill n-glass" + (tone ? ` capsule-pill--${tone}` : "")} role="status" aria-live="polite">
      {children}
    </div>
  );
}

/**
 * Right-click menu (spec §4, board 07): next, previous, mute NIMI sounds, hide NIMI for an hour.
 * It is its own hit rect; clicks inside never reach the capsule underneath.
 */
export function CapsuleMenu({ onClose }: { onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const settings = useSettings();
  const m = useMedia();
  const song = hasSong(m);
  const muted = settings?.soundsMuted ?? false;
  useHitRect(ref, "menu");

  const item = (label: string, run: () => void, disabled = false) => (
    <button
      type="button"
      role="menuitem"
      className="capsule-menu__item"
      disabled={disabled}
      onClick={() => {
        run();
        onClose();
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={ref}
      className="capsule-menu n-glass"
      role="menu"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {item(t("menu.next"), media.next, !song || !m.canNext)}
      {item(t("menu.prev"), media.previous, !song || !m.canPrev)}
      {item(t(muted ? "menu.unmute" : "menu.mute"), () => void updateSettings({ soundsMuted: !muted }))}
      {item(t("menu.hide"), () => void hideOverlayFor(3600))}
    </div>
  );
}
