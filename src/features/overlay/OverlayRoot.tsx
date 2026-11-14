import { useEffect, useState } from "react";
import { getOverlayVisibility } from "@/ipc/commands";
import { Events, onEvent } from "@/ipc/events";
import type { OverlayVisibility } from "@/ipc/generated/OverlayVisibility";
import { Capsule } from "@/features/capsule/Capsule";
import { DropDiagnostics } from "./DropDiagnostics";
import "./overlay.css";

function useOverlayVisibility(): OverlayVisibility {
  const [visibility, setVisibility] = useState<OverlayVisibility>({ visible: true, reason: null });
  useEffect(() => {
    getOverlayVisibility().then(setVisibility).catch(console.error);
    return onEvent<OverlayVisibility>(Events.overlayVisibility, setVisibility);
  }, []);
  return visibility;
}

/** Root of the overlay window: transparent everywhere, the capsule parked at the top-center. */
export function OverlayRoot() {
  const visibility = useOverlayVisibility();
  return (
    <div className={"overlay" + (visibility.visible ? "" : " overlay--hidden")}>
      <Capsule />
      {import.meta.env.DEV && <DropDiagnostics />}
    </div>
  );
}
