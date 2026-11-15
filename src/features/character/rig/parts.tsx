/**
 * NIMI rig geometry — a line-for-line port of `design/character/nimi_rig_generator.py`.
 * Every number here comes from the approved generator; nothing is redrawn. Motion lives in
 * `design/character/nimi.css` (imported as-is) and is addressed through the `L-*` layer classes.
 */
import type { CSSProperties, ReactNode } from "react";

export const INK = "#2A2340";
export const MOUTH = "#5A2A44";
export const TONGUE = "#FF9FB4";
export const BODY = "#B4C0FF";
export const DEEP = "#9DABF5";
export const MIST = "#E3E8FF";
export const MOON = "#FFE7A0";
export const CRATER = "#F2CF73";
export const ROSE = "#FFB6C9";
export const CORAL = "#FF9B9B";
export const CORAL_D = "#F07C7C";
export const SCARF = "#FF9DB5";
export const SCARF_D = "#F07F9C";
export const SCARF_S = "#FFE7A0";

export const VIEW_BOX = "-4 24 208 208";
/** Frame is 208 units; the body spans 136 of them (y 72 → 204). */
export const FRAME_UNITS = 208;
export const CX = 100;
export const CY = 146;
export const RX = 92;
export const RY = 24;
export const TILT = -14;
export const BODY_D =
  "M100 72 C146 72 168 112 168 150 C168 186 140 204 100 204 C60 204 32 186 32 150 C32 112 54 72 100 72 Z";
export const PERIM = 2 * Math.PI * Math.sqrt((RX * RX + RY * RY) / 2);

const L = 80;
const R = 120;
const EY = 140;
const MX = 100;
const MY = 160;

export function starPath(x: number, y: number, s: number): string {
  return (
    `M${x} ${y - s} Q${x + s * 0.22} ${y - s * 0.22} ${x + s} ${y} Q${x + s * 0.22} ${y + s * 0.22} ${x} ${y + s} ` +
    `Q${x - s * 0.22} ${y + s * 0.22} ${x - s} ${y} Q${x - s * 0.22} ${y - s * 0.22} ${x} ${y - s} Z`
  );
}

export function Star({
  x,
  y,
  s,
  fill,
  className,
  style,
}: {
  x: number;
  y: number;
  s: number;
  fill: string;
  className?: string;
  style?: CSSProperties;
}) {
  return <path className={className} style={style} d={starPath(x, y, s)} fill={fill} />;
}

// ---------------------------------------------------------------------------------------------
// Nuri

export type MoonFace = "sleep" | "happy" | "open" | "wow" | "worried";

export function MoonArt({ face, r = 13, tint }: { face: MoonFace; r?: number; tint?: string }) {
  const s = r / 13;
  const fill = tint ?? MOON;
  const crater = tint ? CORAL_D : CRATER;
  const w = 1.8 * s;
  return (
    <>
      <circle cx={0} cy={0} r={r} fill={fill} />
      <circle cx={5 * s} cy={-5 * s} r={2.6 * s} fill={crater} />
      <circle cx={-6 * s} cy={5 * s} r={1.8 * s} fill={crater} />
      <ellipse
        cx={-4.5 * s}
        cy={-6.5 * s}
        rx={3 * s}
        ry={1.8 * s}
        transform={`rotate(-35 ${-4.5 * s} ${-6.5 * s})`}
        fill="#fff"
        opacity=".55"
      />
      {face === "sleep" && (
        <path
          d={`M${-6 * s} 0 q${2.5 * s} ${2.5 * s} ${5 * s} 0 M${1 * s} 0 q${2.5 * s} ${2.5 * s} ${5 * s} 0`}
          stroke={INK}
          strokeWidth={w}
          fill="none"
          strokeLinecap="round"
        />
      )}
      {face === "happy" && (
        <path
          d={`M${-6 * s} ${1 * s} q${2.5 * s} ${-3 * s} ${5 * s} 0 M${1 * s} ${1 * s} q${2.5 * s} ${-3 * s} ${5 * s} 0`}
          stroke={INK}
          strokeWidth={w}
          fill="none"
          strokeLinecap="round"
        />
      )}
      {face === "open" && (
        <>
          <circle cx={-3.5 * s} cy={-0.5 * s} r={1.8 * s} fill={INK} />
          <circle cx={3.5 * s} cy={-0.5 * s} r={1.8 * s} fill={INK} />
        </>
      )}
      {face === "wow" && (
        <>
          <circle cx={-3.5 * s} cy={-1.5 * s} r={2 * s} fill={INK} />
          <circle cx={3.5 * s} cy={-1.5 * s} r={2 * s} fill={INK} />
          <ellipse cx={0} cy={4 * s} rx={1.6 * s} ry={2 * s} fill={INK} />
        </>
      )}
      {face === "worried" && (
        <>
          <circle cx={-3.5 * s} cy={-1 * s} r={1.7 * s} fill={INK} />
          <circle cx={3.5 * s} cy={-1 * s} r={1.7 * s} fill={INK} />
          <path
            d={`M${-4 * s} ${5 * s} q${2 * s} ${-2 * s} ${4 * s} 0 t${4 * s} 0`}
            stroke={INK}
            strokeWidth={1.5 * s}
            fill="none"
            strokeLinecap="round"
          />
        </>
      )}
    </>
  );
}

export function Glow({ r, gradientId }: { r: number; gradientId: string }) {
  return <circle className="L-glow" cx={0} cy={0} r={r} fill={`url(#${gradientId})`} />;
}

/** Position on the tilted ellipse at `phase` (0..1), in the orbit's local frame. */
export function orbitPoint(phase: number) {
  const t = 2 * Math.PI * phase;
  return { x: RX * Math.cos(t), y: RY * Math.sin(t), s: 1 + 0.13 * Math.sin(t), front: Math.sin(t) > 0 };
}

/** The three pocket satellite looks (document, image, archive). */
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

export type OrbitStyle = "normal" | "faint" | "error" | "loose" | "none";

/** The orbit ring: `back` is the full ellipse behind the body, `front` the near half-arc. */
export function OrbitLine({ part, style, speed }: { part: "back" | "front"; style: OrbitStyle; speed: number }) {
  if (style === "none") return null;
  let col = MOON;
  let dash: string | undefined;
  let ob = ".35";
  let of = ".9";
  if (style === "faint") {
    ob = ".12";
    of = ".28";
  }
  if (style === "error") {
    col = CORAL;
    dash = "6 9";
    ob = ".4";
    of = ".85";
  }
  if (style === "loose") {
    dash = "3 8";
    ob = ".2";
    of = ".4";
  }
  const sparkle = style === "normal";
  // particle speed: half the moon's speed along the path
  const pdur = speed ? (24 * speed * 2) / PERIM : 4;
  const rot = `rotate(${TILT} ${CX} ${CY})`;
  if (part === "back") {
    return (
      <g transform={rot}>
        <ellipse cx={CX} cy={CY} rx={RX} ry={RY} fill="none" stroke={col} strokeWidth={2.5} opacity={ob} strokeDasharray={dash} />
        {sparkle && (
          <ellipse
            className="dashB"
            style={{ animationDuration: `${pdur.toFixed(2)}s` }}
            cx={CX}
            cy={CY}
            rx={RX}
            ry={RY}
            fill="none"
            stroke="#fff"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeDasharray="0.1 23.9"
            opacity=".35"
          />
        )}
      </g>
    );
  }
  const d = `M${CX - RX} ${CY} A${RX} ${RY} 0 0 0 ${CX + RX} ${CY}`;
  return (
    <g transform={rot}>
      <path d={d} fill="none" stroke={col} strokeWidth={3} opacity={of} strokeLinecap="round" strokeDasharray={dash} />
      {sparkle && (
        <path
          className="dashF"
          style={{ animationDuration: `${pdur.toFixed(2)}s` }}
          d={d}
          fill="none"
          stroke="#fff"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray="0.1 23.9"
          opacity=".75"
        />
      )}
    </g>
  );
}

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

// ---------------------------------------------------------------------------------------------
// Face

export type EyeKind =
  | "star"
  | "sparkle"
  | "big"
  | "attention"
  | "curious"
  | "focus"
  | "worried"
  | "bored"
  | "happy"
  | "music"
  | "closed"
  | "squeeze"
  | "spiral"
  | "shy";

/** Returns the eye shapes and whether they blink. */
export function eyes(kind: EyeKind): { shapes: ReactNode; blinkable: boolean } {
  const both = (f: (x: number) => ReactNode) => (
    <>
      {f(L)}
      {f(R)}
    </>
  );
  switch (kind) {
    case "star":
      return {
        blinkable: true,
        shapes: both((x) => (
          <>
            <ellipse cx={x} cy={EY} rx={9} ry={11.5} fill={INK} />
            <Star x={x - 2.6} y={EY - 4.2} s={4.6} fill="#fff" />
            <circle cx={x + 3.2} cy={EY + 4.5} r={1.5} fill="#fff" opacity=".85" />
          </>
        )),
      };
    case "sparkle":
      return {
        blinkable: false,
        shapes: both((x) => (
          <>
            <ellipse cx={x} cy={EY - 1} rx={10.5} ry={13} fill={INK} />
            <g className="twinkle" style={{ animationDuration: ".9s" }}>
              <Star x={x - 2.4} y={EY - 5} s={6.2} fill="#fff" />
            </g>
            <Star x={x + 4} y={EY + 5} s={2.6} fill="#fff" />
            <circle cx={x - 4} cy={EY + 6} r={1.2} fill="#fff" />
          </>
        )),
      };
    case "big":
      return {
        blinkable: false,
        shapes: both((x) => (
          <>
            <ellipse cx={x} cy={EY - 2} rx={10.5} ry={13.5} fill={INK} />
            <circle cx={x - 3} cy={EY - 7} r={3.8} fill="#fff" />
            <circle cx={x + 3.4} cy={EY + 3} r={1.8} fill="#fff" opacity=".85" />
          </>
        )),
      };
    case "attention":
      return {
        blinkable: true,
        shapes: both((x) => (
          <>
            <ellipse cx={x} cy={EY} rx={10} ry={12.5} fill={INK} />
            <circle cx={x - 2.8} cy={EY - 5} r={4.2} fill="#fff" />
            <circle cx={x + 3.4} cy={EY + 4} r={2} fill="#fff" />
            <path
              d={`M${x - 8} ${EY - 19} Q${x} ${EY - 24} ${x + 8} ${EY - 19}`}
              stroke={INK}
              strokeWidth={2.6}
              fill="none"
              strokeLinecap="round"
              opacity=".65"
            />
          </>
        )),
      };
    case "curious":
      return {
        blinkable: true,
        shapes: (
          <>
            <ellipse cx={L} cy={EY + 1} rx={8} ry={10} fill={INK} />
            <Star x={L - 1} y={EY - 3} s={4} fill="#fff" />
            <ellipse cx={R} cy={EY - 1} rx={10.5} ry={13} fill={INK} />
            <Star x={R + 0.5} y={EY - 5.5} s={5.4} fill="#fff" />
            <circle cx={R + 4.5} cy={EY + 5} r={1.6} fill="#fff" />
            <path
              d={`M${R - 9} ${EY - 21} Q${R} ${EY - 27} ${R + 9} ${EY - 20}`}
              stroke={INK}
              strokeWidth={2.8}
              fill="none"
              strokeLinecap="round"
              opacity=".7"
            />
          </>
        ),
      };
    case "focus":
      return {
        blinkable: true,
        shapes: (
          <>
            {both((x) => (
              <>
                <ellipse cx={x + 1.5} cy={EY + 2} rx={8.5} ry={7.5} fill={INK} />
                <circle cx={x - 1} cy={EY - 0.5} r={2.4} fill="#fff" />
              </>
            ))}
            <path d={`M${L - 9} ${EY - 11} L${L + 6} ${EY - 9.5}`} stroke={INK} strokeWidth={3} strokeLinecap="round" opacity=".6" />
            <path d={`M${R + 9} ${EY - 11} L${R - 6} ${EY - 9.5}`} stroke={INK} strokeWidth={3} strokeLinecap="round" opacity=".6" />
          </>
        ),
      };
    case "worried":
      return {
        blinkable: true,
        shapes: (
          <>
            {both((x) => (
              <>
                <ellipse cx={x} cy={EY + 1} rx={7.5} ry={9.5} fill={INK} />
                <circle cx={x - 2} cy={EY - 2.5} r={2.6} fill="#fff" />
                <circle cx={x + 2.4} cy={EY + 4} r={1.2} fill="#fff" />
              </>
            ))}
            <path d={`M${L - 9} ${EY - 11} L${L + 6} ${EY - 17}`} stroke={INK} strokeWidth={3} strokeLinecap="round" opacity=".7" />
            <path d={`M${R + 9} ${EY - 11} L${R - 6} ${EY - 17}`} stroke={INK} strokeWidth={3} strokeLinecap="round" opacity=".7" />
          </>
        ),
      };
    case "bored":
      return {
        blinkable: true,
        shapes: both((x) => (
          <>
            <ellipse cx={x + 2.5} cy={EY + 1} rx={8.5} ry={10.5} fill={INK} />
            <rect x={x - 9} y={EY - 12} width={22} height={11} fill={BODY} />
            <path d={`M${x - 8} ${EY - 1} L${x + 12} ${EY - 1}`} stroke={INK} strokeWidth={2.8} strokeLinecap="round" />
            <circle cx={x + 1} cy={EY + 3} r={2} fill="#fff" />
          </>
        )),
      };
    case "happy":
    case "music": {
      const w = kind === "happy" ? 4.2 : 3.6;
      return {
        blinkable: false,
        shapes: both((x) => (
          <path d={`M${x - 8.5} ${EY + 3} Q${x} ${EY - 10} ${x + 8.5} ${EY + 3}`} fill="none" stroke={INK} strokeWidth={w} strokeLinecap="round" />
        )),
      };
    }
    case "closed":
      return {
        blinkable: false,
        shapes: both((x) => (
          <path d={`M${x - 8.5} ${EY} Q${x} ${EY + 8} ${x + 8.5} ${EY}`} fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" />
        )),
      };
    case "squeeze":
      return {
        blinkable: false,
        shapes: (
          <>
            <path d={`M${L - 7} ${EY - 7} L${L + 5} ${EY} L${L - 7} ${EY + 7}`} fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
            <path d={`M${R + 7} ${EY - 7} L${R - 5} ${EY} L${R + 7} ${EY + 7}`} fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
          </>
        ),
      };
    case "spiral":
      return {
        blinkable: false,
        shapes: both((x) => (
          <g className="spin">
            <path
              d={`M${x} ${EY} m-1 0 a1.5 1.5 0 1 1 3 0 a3 3 0 1 1 -6 0 a4.5 4.5 0 1 1 9 0 a6 6 0 1 1 -12 0 a7.5 7.5 0 1 1 15 0`}
              fill="none"
              stroke={INK}
              strokeWidth={2.6}
              strokeLinecap="round"
            />
          </g>
        )),
      };
    case "shy":
      return {
        blinkable: true,
        shapes: both((x) => (
          <>
            <ellipse cx={x - 3} cy={EY + 4} rx={6.5} ry={8} fill={INK} />
            <circle cx={x - 5} cy={EY + 1.5} r={2.2} fill="#fff" />
          </>
        )),
      };
  }
}

export type MouthKind =
  | "smile"
  | "open"
  | "big"
  | "o"
  | "side-o"
  | "O"
  | "side"
  | "wavy"
  | "sing"
  | "small-open"
  | "flat"
  | "grab"
  | "shy"
  | "wide"
  | "puff"
  | "munch";

export function Mouth({ kind }: { kind: MouthKind }) {
  const x = MX;
  const y = MY;
  switch (kind) {
    case "munch":
      return (
        <>
          <g className="munchA">
            <path d={`M${x - 6} ${y + 1} q3 3 6 0 t6 0`} fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
          </g>
          <g className="munchB">
            <ellipse cx={x} cy={y + 2} rx={4.5} ry={3.6} fill={MOUTH} />
          </g>
        </>
      );
    case "smile":
      return <path d={`M${x - 5} ${y} Q${x} ${y + 5} ${x + 5} ${y}`} fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />;
    case "open":
      return (
        <>
          <path d={`M${x - 9} ${y - 2} Q${x} ${y + 13} ${x + 9} ${y - 2} Z`} fill={MOUTH} />
          <ellipse cx={x} cy={y + 5.5} rx={4.5} ry={2.6} fill={TONGUE} />
        </>
      );
    case "big":
      return (
        <>
          <path d={`M${x - 12} ${y - 3} Q${x} ${y + 18} ${x + 12} ${y - 3} Z`} fill={MOUTH} />
          <ellipse cx={x} cy={y + 8} rx={6} ry={3.2} fill={TONGUE} />
        </>
      );
    case "o":
      return <ellipse cx={x} cy={y + 1} rx={3.2} ry={2.6} fill={MOUTH} />;
    case "side-o":
      return <ellipse cx={x + 5} cy={y + 1} rx={3.4} ry={3.8} fill={MOUTH} />;
    case "O":
      return <ellipse cx={x} cy={y + 2} rx={5.2} ry={6.8} fill={MOUTH} />;
    case "side":
      return <path d={`M${x - 4} ${y + 1} Q${x + 1} ${y + 4} ${x + 6} ${y - 1}`} fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />;
    case "wavy":
      return <path d={`M${x - 8} ${y + 2} q2 -3 4 0 t4 0 t4 0 t4 0`} fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />;
    case "sing":
      return (
        <>
          <ellipse cx={x} cy={y + 2} rx={4.2} ry={4.6} fill={MOUTH} />
          <ellipse cx={x} cy={y + 4.2} rx={2.4} ry={1.4} fill={TONGUE} />
        </>
      );
    case "small-open":
      return <path d={`M${x - 6} ${y - 1} Q${x} ${y + 9} ${x + 6} ${y - 1} Z`} fill={MOUTH} />;
    case "flat":
      return <path d={`M${x - 4} ${y + 2} L${x + 7} ${y + 1}`} stroke={INK} strokeWidth={3} strokeLinecap="round" />;
    case "grab":
      return <ellipse cx={x} cy={y + 2} rx={4} ry={5} fill={MOUTH} />;
    case "shy":
      return <path d={`M${x - 6} ${y + 3} q2 -2 4 0 t4 0`} fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" />;
    case "wide":
      return (
        <>
          <ellipse cx={x} cy={y + 3} rx={11} ry={12} fill={MOUTH} />
          <ellipse cx={x} cy={y + 10} rx={6.5} ry={3.6} fill={TONGUE} />
        </>
      );
    case "puff":
      return (
        <>
          <circle cx={38} cy={160} r={17} fill={BODY} />
          <circle cx={162} cy={160} r={17} fill={BODY} />
          <ellipse cx={42} cy={163} rx={9} ry={5} fill={ROSE} opacity=".85" />
          <ellipse cx={158} cy={163} rx={9} ry={5} fill={ROSE} opacity=".85" />
          <path d={`M${x - 6} ${y + 1} Q${x} ${y + 4} ${x + 6} ${y + 1}`} fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
        </>
      );
  }
}

export type BlushLevel = "soft" | "warm" | "faint" | "hot";

export function Blush({ level }: { level: BlushLevel }) {
  const op = { soft: ".5", warm: ".8", faint: ".3", hot: ".95" }[level];
  return (
    <>
      <ellipse cx={L - 14} cy={EY + 13} rx={8.5} ry={4.8} fill={ROSE} opacity={op} />
      <ellipse cx={R + 14} cy={EY + 13} rx={8.5} ry={4.8} fill={ROSE} opacity={op} />
      {level === "hot" &&
        [L - 14, R + 14].map((bx) => (
          <path
            key={bx}
            d={`M${bx - 5} ${EY + 16} l3 -5 M${bx} ${EY + 16} l3 -5 M${bx + 5} ${EY + 16} l3 -5`}
            stroke="#F27FA0"
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        ))}
    </>
  );
}

export function Note({ x, y, fill, delay }: { x: number; y: number; fill: string; delay: number }) {
  return (
    <g className="note" style={{ animationDelay: `${delay}s` }}>
      <ellipse cx={x} cy={y} rx={5} ry={4} transform={`rotate(-20 ${x} ${y})`} fill={fill} />
      <path d={`M${x + 4.5} ${y - 1} L${x + 4.5} ${y - 17} Q${x + 11} ${y - 14} ${x + 11} ${y - 8}`} stroke={fill} strokeWidth={2.4} fill="none" strokeLinecap="round" />
    </g>
  );
}

// ---------------------------------------------------------------------------------------------
// Winter outfit

/** Knitted winter scarf wrapped under NIMI's mouth, with a swaying tail. */
export function Scarf() {
  const knots: Array<[number, number]> = [
    [56, 181],
    [72, 185],
    [88, 187.5],
    [104, 188],
    [120, 186.5],
    [136, 184],
    [150, 180],
  ];
  return (
    <>
      <path d="M40 186 Q100 203 160 186 L158 191 Q100 208 42 191 Z" fill={INK} opacity=".12" />
      <path d="M36 167 Q100 183 164 167 L160 186 Q100 203 40 186 Z" fill={SCARF} />
      <path d="M38 175 Q100 191 162 175" fill="none" stroke={SCARF_S} strokeWidth={3.2} strokeLinecap="round" />
      {knots.map(([x, y]) => (
        <path key={x} d={`M${x} ${y} l2 4 l2 -4`} fill="none" stroke={SCARF_D} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" opacity=".7" />
      ))}
      <ellipse cx={128} cy={183} rx={11} ry={8} fill={SCARF_D} />
      <g transform="translate(126 182)">
        <g className="L-scarf">
          <path d="M0 0 L20 0 L25 33 L5 35 Z" fill={SCARF_D} />
          <path d="M2.2 11 L21.6 10.4 M3.6 21 L23 20.4" stroke={SCARF_S} strokeWidth={3} strokeLinecap="round" />
          <path d="M7 35 v6 M12 34.6 v6 M17 34.2 v6 M22 33.8 v6" stroke={SCARF_D} strokeWidth={2.4} strokeLinecap="round" />
        </g>
      </g>
    </>
  );
}

/** Knitted winter hat with a fluffy pom-pom. */
export function Beanie() {
  const ribs: number[] = [];
  for (let x = 48; x < 156; x += 9) ribs.push(x);
  const puffs = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);
  return (
    <>
      <path d="M44 100 C40 46 160 46 156 100 Z" fill={SCARF} />
      <path d="M60 64 C80 52 120 52 140 64" fill="none" stroke={SCARF_D} strokeWidth={3} strokeLinecap="round" opacity=".55" />
      <path d="M47 80 Q100 64 153 80" fill="none" stroke={SCARF_S} strokeWidth={4} strokeLinecap="round" />
      <path d="M38 94 Q100 80 162 94 L161 110 Q100 96 39 110 Z" fill={SCARF_D} />
      {ribs.map((x) => (
        <path
          key={x}
          d={`M${x} ${(95 - 13 * (1 - ((x - 100) / 62) ** 2)).toFixed(1)} v13`}
          stroke={SCARF}
          strokeWidth={2.2}
          strokeLinecap="round"
          opacity=".55"
        />
      ))}
      <g className="L-pom">
        {puffs.map((a) => (
          <circle key={a} cx={(100 + 9 * Math.cos(a)).toFixed(1)} cy={(44 + 9 * Math.sin(a)).toFixed(1)} r={6} fill="#F7F8FF" />
        ))}
        <circle cx={100} cy={44} r={10} fill="#FFFFFF" />
        <circle cx={96} cy={40} r={3} fill="#fff" opacity=".9" />
      </g>
    </>
  );
}
