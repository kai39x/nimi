import { useRef, type CSSProperties } from "react";
import { recenterOverlay } from "@/ipc/commands";
import { useT } from "@/i18n";
import { useSettings } from "@/lib/settings";
import { isWinter, nuriPace } from "@/lib/winter";
import { useHitRect } from "@/features/overlay/hitRects";
import { useOverlayDrag } from "@/features/overlay/useOverlayDrag";
import { Nimi } from "@/features/character/Nimi";
import { useNimiMood } from "@/features/character/useNimiMood";
import "./capsule.css";

/** The capsule is 148×52 at the default size 64; both scale together with the size setting. */
export const DEFAULT_NIMI_SIZE = 64;

/**
 * Compact mode, option A (design spec §3, board 06): a dark glass capsule at the top-center
 * with NIMI sitting inside and poking out slightly. The capsule rect is the only
 * mouse-interactive region in compact mode.
 */
export function Capsule() {
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  const settings = useSettings();
  const drag = useOverlayDrag();
  useHitRect(ref, "capsule");

  const size = settings?.nimiSize ?? DEFAULT_NIMI_SIZE;
  const winter = isWinter(settings);
  const { mood, onClick, onPointerEnter, onPointerLeave } = useNimiMood({
    sleepAfterMin: settings?.sleepAfterMin ?? 10,
  });

  return (
    <div
      ref={ref}
      className={"capsule n-glass" + (winter ? " capsule--winter" : "")}
      style={{ "--nimi-scale": size / DEFAULT_NIMI_SIZE } as CSSProperties}
      role="button"
      aria-label={t("app.name")}
      onPointerDown={drag.onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onClick={() => {
        if (!drag.wasDragged()) onClick();
      }}
      onDoubleClick={() => {
        if (!drag.wasDragged()) void recenterOverlay();
      }}
    >
      <Nimi
        className="capsule__nimi"
        mood={mood}
        size={size}
        winter={winter}
        reducedMotion={settings?.reduceMotion ?? false}
        nuriPace={nuriPace(settings?.nuriActivity)}
      />
    </div>
  );
}
