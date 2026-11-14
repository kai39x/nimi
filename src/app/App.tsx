import { useEffect, useState } from "react";
import { appInfo } from "@/ipc/commands";
import type { AppInfo } from "@/ipc/generated/AppInfo";
import "./App.css";

/**
 * Phase 0 shell: proves the transparent overlay, the bundled Rubik font, the design tokens
 * and a typed Rust→React IPC round-trip. The real capsule replaces this in phase 1.
 */
export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    appInfo().then(setInfo).catch(console.error);
  }, []);

  return (
    <div className="overlay">
      <div className="capsule n-glass" role="status">
        <span className="capsule__name">نيمي</span>
        <span className="capsule__meta">
          {info ? `v${info.version} · Tauri ${info.tauriVersion}` : "…"}
        </span>
      </div>
    </div>
  );
}
