import { useMemo, type CSSProperties } from "react";
import "./snow.css";

const FLAKES = 16;

/**
 * Light snowfall only around the capsule (spec §2): at most 16 flakes, click-through, never
 * full-screen. Pure CSS motion; the parent decides when it shows (winter + snow setting, and
 * not with reduce-motion).
 */
export function Snow({ width, height }: { width: number; height: number }) {
  const flakes = useMemo(
    () =>
      Array.from({ length: FLAKES }, (_, i) => ({
        id: i,
        x: 4 + Math.random() * 92,
        size: 2 + Math.random() * 2.5,
        duration: 7 + Math.random() * 6,
        delay: -Math.random() * 13,
        drift: (Math.random() - 0.5) * 24,
        opacity: 0.35 + Math.random() * 0.5,
      })),
    [],
  );
  return (
    <div className="snow" style={{ width, height }} aria-hidden="true">
      {flakes.map((f) => (
        <span
          key={f.id}
          className="snow__flake"
          style={
            {
              left: `${f.x}%`,
              width: f.size,
              height: f.size,
              opacity: f.opacity,
              "--drift": `${f.drift}px`,
              animationDuration: `${f.duration}s`,
              animationDelay: `${f.delay}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
