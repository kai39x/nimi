import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Shared bits of the three games (spec §5 «ألعاب», board 15): a frame loop that only runs while
 * a game is being played, the «NIMI يلعب معك» flag, and small drawing helpers.
 */

let playing = false;
const listeners = new Set<() => void>();

export function setPlaying(next: boolean) {
  if (playing === next) return;
  playing = next;
  listeners.forEach((fn) => fn());
}

export function usePlaying(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => playing,
  );
}

/** Calls `tick(dtSeconds)` every frame while `running`; dt is capped so a hiccup never teleports. */
export function useLoop(running: boolean, tick: (dt: number) => void) {
  const tickRef = useRef(tick);
  tickRef.current = tick;
  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    let id = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      tickRef.current(dt);
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [running]);
}

/** Keeps a canvas at its CSS size × devicePixelRatio and returns the 2D context scaled to CSS px. */
export function fitCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext("2d");
  g?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

export const BUTTER = "#FFE7A0";
export const CORAL = "#FF9B9B";
export const CRATER = "#F2CF73";

/** The four-point star of the boards (design/icons/ui/star4). */
export function drawStar(g: CanvasRenderingContext2D, x: number, y: number, r: number, rot = 0, color = BUTTER) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.fillStyle = color;
  g.shadowColor = "rgba(255, 231, 160, 0.55)";
  g.shadowBlur = r * 0.9;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const rr = i % 2 === 0 ? r : r * 0.32;
    g.lineTo(Math.sin(a) * rr, -Math.cos(a) * rr);
  }
  g.closePath();
  g.fill();
  g.restore();
}

/** A red meteor with a short glowing tail (pointing up: they fall). */
export function drawMeteor(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.save();
  const tail = g.createLinearGradient(x, y - r * 4, x, y);
  tail.addColorStop(0, "rgba(255, 155, 155, 0)");
  tail.addColorStop(1, "rgba(255, 155, 155, 0.35)");
  g.fillStyle = tail;
  g.beginPath();
  g.moveTo(x - r * 0.7, y);
  g.lineTo(x, y - r * 4);
  g.lineTo(x + r * 0.7, y);
  g.fill();
  g.fillStyle = CORAL;
  g.shadowColor = "rgba(255, 155, 155, 0.6)";
  g.shadowBlur = r;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Nuri: a butter moon with two craters and a tiny face (board 01). */
export function drawNuri(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.save();
  g.fillStyle = BUTTER;
  g.shadowColor = "rgba(255, 231, 160, 0.6)";
  g.shadowBlur = r;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = CRATER;
  g.beginPath();
  g.arc(x - r * 0.38, y - r * 0.3, r * 0.22, 0, Math.PI * 2);
  g.arc(x + r * 0.42, y + r * 0.35, r * 0.16, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#2A2340";
  g.beginPath();
  g.arc(x - r * 0.25, y + r * 0.02, r * 0.09, 0, Math.PI * 2);
  g.arc(x + r * 0.22, y + r * 0.02, r * 0.09, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Faint fixed sky dots (seeded so they don't jump between frames). */
export function sky(w: number, h: number, n = 40): Array<{ x: number; y: number; r: number; a: number }> {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, () => ({ x: rnd() * w, y: rnd() * h, r: 0.6 + rnd() * 0.9, a: 0.25 + rnd() * 0.45 }));
}

export function drawSky(g: CanvasRenderingContext2D, dots: ReturnType<typeof sky>) {
  g.save();
  g.fillStyle = "#ffffff";
  for (const d of dots) {
    g.globalAlpha = d.a;
    g.beginPath();
    g.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}
