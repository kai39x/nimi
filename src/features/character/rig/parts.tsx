/**
 * The few rig pieces the animation lab does not carry: the pocket satellites and the volume
 * meter on the ring. Both are ports of `design/character/nimi_rig_generator.py` (never redrawn).
 * Everything else (body, eyes, mouths, blush, extras, Nuri, rings, winter) comes verbatim from
 * the lab through the generated `rigData.ts`.
 */
import type { ReactNode } from "react";

export const DEEP = "#9DABF5";
export const MIST = "#E3E8FF";
export const MOON = "#FFE7A0";
export const CRATER = "#F2CF73";
export const ROSE = "#FFB6C9";

/** The rig's viewBox: 208 units square, origin at (-4, 24). */
export const VIEW_BOX = "-4 24 208 208";
export const FRAME_UNITS = 208;
/** Orbit ellipse (center, radii, tilt in degrees). */
export const CX = 100;
export const CY = 146;
export const RX = 92;
export const RY = 24;
export const TILT = -14;
export const PERIM = 2 * Math.PI * Math.sqrt((RX * RX + RY * RY) / 2);

/** The three pocket satellite looks (document, image, archive), drawn in a 20-unit box. */
export const SAT_ART: ReactNode[] = [
  <>
    <rect x={-6} y={-7.5} width={12} height={15} rx={2.5} fill={MIST} />
    <rect x={-3.5} y={-2} width={7} height={1.6} rx={0.8} fill={DEEP} />
    <rect x={-3.5} y={1.5} width={5} height={1.6} rx={0.8} fill={DEEP} />
  </>,
  <>
    <rect x={-6} y={-7.5} width={12} height={15} rx={2.5} fill={ROSE} />
    <circle cx={-1.5} cy={-2} r={1.8} fill="#fff" />
    <path d="M-4.5 4.5 l3 -3 l2 2 l2 -2 l2 3 z" fill="#fff" />
  </>,
  <>
    <rect x={-6} y={-7.5} width={12} height={15} rx={2.5} fill={MOON} />
    <rect x={-1} y={-7.5} width={2} height={9} fill={CRATER} />
    <rect x={-2} y={1.5} width={4} height={3} rx={1} fill={CRATER} />
  </>,
];

/** Volume meter drawn on the near half of the ring (0..1). */
export function VolumeArc({ volume }: { volume: number }) {
  const half = PERIM / 2;
  return (
    <g transform={`rotate(${TILT} ${CX} ${CY})`}>
      <path
        d={`M${CX - RX} ${CY} A${RX} ${RY} 0 0 0 ${CX + RX} ${CY}`}
        fill="none"
        stroke={MOON}
        strokeWidth={6}
        strokeLinecap="round"
        strokeDasharray={`${(volume * half).toFixed(1)} ${half.toFixed(1)}`}
      />
    </g>
  );
}
