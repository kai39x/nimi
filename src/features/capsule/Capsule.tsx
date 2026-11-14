import { useRef } from "react";
import nimiIdle from "@design/character/svg/nimi_idle.svg";
import { recenterOverlay } from "@/ipc/commands";
import { useT } from "@/i18n";
import { useHitRect } from "@/features/overlay/hitRects";
import { useOverlayDrag } from "@/features/overlay/useOverlayDrag";
import "./capsule.css";

/**
 * Compact mode, option A (design spec §3, board 06): a 148×52 dark glass capsule at the
 * top-center with NIMI sitting inside and poking out slightly. The capsule rect is the only
 * mouse-interactive region in compact mode.
 *
 * The character is the static idle SVG until phase 2 ports the animated rig.
 */
export function Capsule() {
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  const drag = useOverlayDrag();
  useHitRect(ref, "capsule");

  return (
    <div
      ref={ref}
      className="capsule n-glass"
      role="button"
      aria-label={t("app.name")}
      onPointerDown={drag.onPointerDown}
      onDoubleClick={() => {
        if (!drag.wasDragged()) void recenterOverlay();
      }}
    >
      <img className="capsule__nimi" src={nimiIdle} alt="" draggable={false} />
    </div>
  );
}
