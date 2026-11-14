import { getCurrentWindow } from "@tauri-apps/api/window";
import { OverlayRoot } from "@/features/overlay/OverlayRoot";
import { SettingsWindow } from "@/features/settings/SettingsWindow";

/** One bundle, several windows: the window label decides what to render. */
export function App() {
  switch (getCurrentWindow().label) {
    case "settings":
      return <SettingsWindow />;
    default:
      return <OverlayRoot />;
  }
}
