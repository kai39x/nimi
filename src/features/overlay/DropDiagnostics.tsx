import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/**
 * Dev-only readout of OS drag-and-drop events reaching the overlay (proof for the
 * click-through + drop design). Visible only while a file is being dragged and for a moment
 * after it lands or leaves. Replaced by the real feeding flow in phase 6.
 */
export function DropDiagnostics() {
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    let hideTimer = 0;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        const dpr = window.devicePixelRatio || 1;
        const at = "position" in p ? ` @ ${Math.round(p.position.x / dpr)},${Math.round(p.position.y / dpr)}` : "";
        const files = "paths" in p ? ` · ${p.paths.map((f) => f.split(/[\\/]/).pop()).join(", ")}` : "";
        setLine(`${p.type}${at}${files}`);
        window.clearTimeout(hideTimer);
        if (p.type === "drop" || p.type === "leave") {
          hideTimer = window.setTimeout(() => setLine(null), 2000);
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      window.clearTimeout(hideTimer);
      unlisten?.();
    };
  }, []);

  if (!line) return null;
  return (
    <div className="diag n-glass" aria-hidden="true">
      {line}
    </div>
  );
}
