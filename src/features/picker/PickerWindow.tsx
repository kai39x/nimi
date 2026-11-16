import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n";
import { pickerCancel, pickerFollow, pickerPick, pickerSample } from "@/ipc/commands";
import { Events, onEvent } from "@/ipc/events";
import type { PickerSample } from "@/ipc/generated/PickerSample";
import "./picker.css";

const ZOOM = 11; // px per sampled pixel in the loupe
const OFFSET = 26; // loupe distance from the cursor

/**
 * «لاقط ألوان» (spec §5 tiles, §8 «لون»): a nearly invisible window over one monitor. The loupe
 * follows the cursor with the 11×11 pixels under it (sampled by Rust); a click copies the hex,
 * Esc or a right-click cancels.
 */
export function PickerWindow() {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [sample, setSample] = useState<PickerSample | null>(null);
  const pending = useRef(false);

  useEffect(() => {
    document.documentElement.classList.add("picker-root");
    return () => document.documentElement.classList.remove("picker-root");
  }, []);

  // Each opening starts clean.
  useEffect(() => onEvent(Events.pickerOpen, () => (setSample(null), setAt(null))), []);

  const refresh = useCallback(() => {
    if (pending.current) return;
    pending.current = true;
    requestAnimationFrame(() => {
      void pickerSample()
        .then((s) => s && setSample(s))
        .finally(() => (pending.current = false));
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void pickerCancel();
      if (e.key === "Enter" || e.key === " ") void pickerPick();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Draw the loupe: pixels, a faint grid, the center pixel outlined.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !sample) return;
    const n = sample.size;
    const g = c.getContext("2d");
    if (!g) return;
    c.width = n * ZOOM;
    c.height = n * ZOOM;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = (y * n + x) * 3;
        g.fillStyle = `rgb(${sample.rgb[i]},${sample.rgb[i + 1]},${sample.rgb[i + 2]})`;
        g.fillRect(x * ZOOM, y * ZOOM, ZOOM, ZOOM);
      }
    g.strokeStyle = "rgba(0,0,0,.12)";
    g.lineWidth = 1;
    for (let k = 1; k < n; k++) {
      g.beginPath();
      g.moveTo(k * ZOOM + 0.5, 0);
      g.lineTo(k * ZOOM + 0.5, n * ZOOM);
      g.moveTo(0, k * ZOOM + 0.5);
      g.lineTo(n * ZOOM, k * ZOOM + 0.5);
      g.stroke();
    }
    const m = Math.floor(n / 2) * ZOOM;
    g.lineWidth = 2;
    g.strokeStyle = "#000";
    g.strokeRect(m - 1, m - 1, ZOOM + 2, ZOOM + 2);
    g.strokeStyle = "#fff";
    g.strokeRect(m + 0.5, m + 0.5, ZOOM - 1, ZOOM - 1);
  }, [sample]);

  const size = (sample?.size ?? 11) * ZOOM;
  const w = window.innerWidth;
  const h = window.innerHeight;
  // Keep the loupe on screen: flip to the other side near the right / bottom edges.
  const left = at ? (at.x + OFFSET + size > w ? at.x - OFFSET - size : at.x + OFFSET) : -9999;
  const top = at ? (at.y + OFFSET + size + 40 > h ? at.y - OFFSET - size - 40 : at.y + OFFSET) : -9999;

  return (
    <div
      className="picker"
      onPointerMove={(e) => {
        setAt({ x: e.clientX, y: e.clientY });
        refresh();
      }}
      onPointerLeave={() => void pickerFollow()}
      onClick={() => void pickerPick()}
      onContextMenu={(e) => {
        e.preventDefault();
        void pickerCancel();
      }}
    >
      <div className="picker__hint n-glass">{t("picker.hint")}</div>
      {at && sample && (
        <div className="picker__loupe" style={{ left, top }}>
          <canvas ref={canvas} className="picker__canvas" style={{ width: size, height: size }} />
          <div className="picker__chip n-glass">
            <span className="picker__swatch" style={{ background: sample.hex }} />
            <span className="picker__hex">{sample.hex}</span>
          </div>
        </div>
      )}
    </div>
  );
}
