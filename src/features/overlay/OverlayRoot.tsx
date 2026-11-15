import { useEffect, useState } from "react";
import { getOverlayVisibility } from "@/ipc/commands";
import { Events, onEvent } from "@/ipc/events";
import type { OverlayVisibility } from "@/ipc/generated/OverlayVisibility";
import { useSettings } from "@/lib/settings";
import { isWinter } from "@/lib/winter";
import { setNimiPaused } from "@/features/character/engine";
import { Shell } from "@/features/shell/Shell";
import { DEFAULT_NIMI_SIZE } from "@/features/shell/constants";
import { DropDiagnostics } from "./DropDiagnostics";
import { Snow } from "./Snow";
import "./overlay.css";

function useOverlayVisibility(): OverlayVisibility {
  const [visibility, setVisibility] = useState<OverlayVisibility>({ visible: true, reason: null });
  useEffect(() => {
    getOverlayVisibility().then(setVisibility).catch(console.error);
    return onEvent<OverlayVisibility>(Events.overlayVisibility, setVisibility);
  }, []);
  // NIMI's frame loop and blink timers stop while the overlay is hidden (performance budget).
  useEffect(() => setNimiPaused(!visibility.visible), [visibility.visible]);
  return visibility;
}

/** Root of the overlay window: transparent everywhere, the capsule parked at the top-center. */
export function OverlayRoot() {
  const visibility = useOverlayVisibility();
  const settings = useSettings();
  const scale = (settings?.nimiSize ?? DEFAULT_NIMI_SIZE) / DEFAULT_NIMI_SIZE;
  const snowing = isWinter(settings) && (settings?.snow ?? true) && !(settings?.reduceMotion ?? false);

  return (
    <div className={"overlay" + (visibility.visible ? "" : " overlay--hidden")}>
      {snowing && <Snow width={340 * scale} height={190 * scale} />}
      <Shell />
      {import.meta.env.DEV && <DropDiagnostics />}
    </div>
  );
}
