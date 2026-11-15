import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import "@design/character/nimi.css";
import "./nimi.css";
import { DEFAULT_ORBIT_SECONDS, MOOD_SPECS, type Mood } from "./rig/moods";
import {
  BODY,
  BODY_D,
  Beanie,
  Blush,
  CORAL,
  DEEP,
  FRAME_UNITS,
  MIST,
  MOON,
  MoonArt,
  Mouth,
  Note,
  OrbitLine,
  PERIM,
  ROSE,
  SAT_ART,
  Scarf,
  Star,
  VIEW_BOX,
  VolumeArc,
  eyes,
  orbitPoint,
  type MoonFace,
} from "./rig/parts";

/** Frame pixels per nominal size unit: size 64 draws the 208-unit frame at 78 px (board 06). */
const FRAME_PER_SIZE = 78 / 64;
/** viewBox origin: unit (x, y) sits at left = x + 4, top = y - 24 inside the 208 px stage. */
const OX = 4;
const OY = -24;

export interface NimiProps {
  mood: Mood;
  /** Nominal size (the «حجمه في الكبسولة» setting, 48–96). Default 64. */
  size?: number;
  /** Pocket satellites orbiting with Nuri (0–8 drawn). */
  satellites?: number;
  /** 0..1 draws the orbit ring as a volume meter; null hides it. */
  volume?: number | null;
  /** The eaten file shows faintly in the belly (chew). */
  belly?: boolean;
  winter?: boolean;
  /** No hops / squash / stretch; blinks and fades stay. */
  reducedMotion?: boolean;
  /** Multiplier on Nuri's orbit period (calm 1.4 · normal 1 · active 0.7). */
  nuriPace?: number;
  className?: string;
  style?: CSSProperties;
}

type OrbitRegistry = Map<Element, { phase: number; durMs: number; ready: boolean }>;

/** A full-frame SVG layer: same viewBox as the reference, drawn in rig units. */
function Layer({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg className={"nimi-svg" + (className ? ` ${className}` : "")} viewBox={VIEW_BOX} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {children}
    </svg>
  );
}

/**
 * NIMI — the character (design spec §2, `design/character/nimi-reference.html`).
 *
 * Same geometry and the same approved keyframes as the reference, but the layers that move
 * every frame (shadow, lift, squash, orbit, Nuri, glow, face) are HTML wrappers sized in rig
 * units (a 208 px stage scaled to the frame), so their transforms run on the compositor and
 * the SVG is only re-rasterized when something inside it really changes. The orbit nodes stay
 * mounted across moods and their animation time is rescaled on change, so Nuri never jumps.
 */
export function Nimi({
  mood,
  size = 64,
  satellites = 0,
  volume = null,
  belly = false,
  winter = false,
  reducedMotion = false,
  nuriPace = 1,
  className,
  style,
}: NimiProps) {
  const spec = MOOD_SPECS[mood];
  const gid = useId().replace(/:/g, "");
  const frame = size * FRAME_PER_SIZE;
  const lifted = mood === "grabbed";
  const orbitDur = (spec.moon.kind === "orbit" ? spec.moon.dur : DEFAULT_ORBIT_SECONDS) * nuriPace;
  const moonPhase = spec.moon.kind === "orbit" ? spec.moon.phase : 0.1;
  const moonFace: MoonFace = spec.moon.face;
  const satCount = Math.min(satellites, 8);
  const moonOrbiting = spec.moon.kind === "orbit";
  const tint = mood === "error" ? CORAL : undefined;

  // --- orbit time continuity -----------------------------------------------------------------
  const registry = useRef<OrbitRegistry>(new Map());
  const register = (phase: number) => (el: HTMLDivElement | null) => {
    if (!el) return;
    const entry = registry.current.get(el);
    if (entry) entry.phase = phase;
    else registry.current.set(el, { phase, durMs: orbitDur * 1000, ready: false });
  };

  useLayoutEffect(() => {
    const durMs = orbitDur * 1000;
    for (const [el, entry] of registry.current) {
      if (!el.isConnected) {
        registry.current.delete(el);
        continue;
      }
      for (const anim of el.getAnimations()) {
        const now = typeof anim.currentTime === "number" ? anim.currentTime : 0;
        const progress = entry.ready ? (((now / entry.durMs) % 1) + 1) % 1 : entry.phase;
        anim.currentTime = progress * durMs;
      }
      entry.durMs = durMs;
      entry.ready = true;
    }
  }, [orbitDur, mood, satCount]);

  // --- mood transition squash ----------------------------------------------------------------
  const [switching, setSwitching] = useState(false);
  const firstMood = useRef(true);
  useEffect(() => {
    if (firstMood.current) {
      firstMood.current = false;
      return;
    }
    setSwitching(true);
    const t = window.setTimeout(() => setSwitching(false), 320);
    return () => window.clearTimeout(t);
  }, [mood]);

  // --- randomized blinks (4–7 s, sometimes double) and glances ---------------------------------
  const eyeSpec = eyes(spec.eyes);
  const [blinking, setBlinking] = useState(false);
  const [glance, setGlance] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!eyeSpec.blinkable) return;
    let timer = 0;
    let inner = 0;
    const schedule = () => {
      timer = window.setTimeout(
        () => {
          if (document.visibilityState === "visible") {
            setBlinking(true);
            inner = window.setTimeout(() => setBlinking(false), 230);
            if (Math.random() < 0.3) {
              inner = window.setTimeout(() => {
                setBlinking(true);
                inner = window.setTimeout(() => setBlinking(false), 200);
              }, 330);
            }
          }
          schedule();
        },
        4000 + Math.random() * 3000,
      );
    };
    schedule();
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(inner);
    };
  }, [eyeSpec.blinkable]);

  useEffect(() => {
    if (reducedMotion) {
      setGlance({ x: 0, y: 0 });
      return;
    }
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(
        () => {
          if (document.visibilityState === "visible") {
            setGlance(Math.random() < 0.35 ? { x: 0, y: 0 } : { x: (Math.random() - 0.5) * 7, y: (Math.random() - 0.4) * 3 });
          }
          schedule();
        },
        3000 + Math.random() * 6000,
      );
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [reducedMotion]);

  // --- ring sparkle ----------------------------------------------------------------------------
  // stroke-dashoffset cannot run on the compositor; a CSS animation would make the main thread
  // tick every display frame. A 15 fps timer moving the offset is visually identical and lets
  // the main thread sleep between updates.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (spec.orbit !== "normal") return;
    const root = rootRef.current;
    if (!root) return;
    const pdur = (24 * orbitDur * 2) / PERIM; // seconds per 24-unit dash cycle (reference)
    const start = performance.now();
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      const cycles = ((performance.now() - start) / 1000) / pdur;
      const offset = (cycles % 1) * 24;
      root.querySelectorAll<SVGElement>(".dashB").forEach((el) => {
        el.style.strokeDashoffset = `${offset.toFixed(2)}`;
      });
      root.querySelectorAll<SVGElement>(".dashF").forEach((el) => {
        el.style.strokeDashoffset = `${(-offset).toFixed(2)}`;
      });
    };
    const id = window.setInterval(tick, 66);
    return () => window.clearInterval(id);
  }, [spec.orbit, orbitDur]);

  // --- Nuri ------------------------------------------------------------------------------------
  /** One orbiting thing (Nuri, a trail ghost or a satellite) as compositor layers. */
  const orbiter = (
    key: string,
    layer: "back" | "front",
    phase: number,
    content: ReactNode,
    opacity = 1,
    hidden = false,
  ) => {
    const p = orbitPoint(phase);
    const orb = (
      <div
        className="orb"
        ref={register(phase)}
        style={{
          animationDuration: `${orbitDur}s`,
          transform: `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(${p.s.toFixed(3)})`,
        }}
      >
        <div className="orb__upright">{content}</div>
      </div>
    );
    return (
      <div key={key} className={"orbit-frame" + (hidden ? " is-parked" : "")} style={{ opacity: layer === "back" ? opacity * 0.82 : opacity }}>
        {layer === "front" ? (
          <div className="orbF" ref={register(phase)} style={{ animationDuration: `${orbitDur}s`, opacity: p.front ? 1 : 0 }}>
            {orb}
          </div>
        ) : (
          orb
        )}
      </div>
    );
  };

  const nuri = (halo: boolean) => (
    <>
      {halo && (
        <div className="L-glow glow">
          <svg viewBox="-24 -24 48 48" aria-hidden="true">
            <circle r={24} fill={`url(#${gid})`} />
          </svg>
        </div>
      )}
      <div className="L-roll moon">
        <svg viewBox="-16 -16 32 32" aria-hidden="true">
          <MoonArt face={moonFace} />
        </svg>
      </div>
    </>
  );

  const satellite = (i: number) => (
    <div className="sat">
      <svg viewBox="-10 -10 20 20" aria-hidden="true">
        <g className="L-roll">{SAT_ART[i % SAT_ART.length]}</g>
      </svg>
    </div>
  );

  const orbitLayer = (layer: "back" | "front") => (
    <div className={"L-orb orbit-layer orbit-layer--" + layer}>
      <Layer className="ring">
        <defs>
          <radialGradient id={gid}>
            <stop offset="0" stopColor={MOON} stopOpacity=".55" />
            <stop offset="1" stopColor={MOON} stopOpacity="0" />
          </radialGradient>
        </defs>
        <OrbitLine part={layer} style={spec.orbit} speed={orbitDur} />
        {layer === "front" && volume != null && <VolumeArc volume={Math.max(0, Math.min(1, volume))} />}
      </Layer>
      <div className="orbit-tilt">
        {orbiter(`${layer}-nuri`, layer, moonPhase, nuri(true), 1, !moonOrbiting)}
        {mood === "working" && orbiter(`${layer}-trail1`, layer, moonPhase - 0.035, nuri(false), 0.35)}
        {mood === "working" && orbiter(`${layer}-trail2`, layer, moonPhase - 0.07, nuri(false), 0.15)}
        {Array.from({ length: satCount }, (_, i) =>
          orbiter(`${layer}-sat-${i}`, layer, (moonPhase + (i + 1) / (satCount + 1)) % 1, satellite(i), layer === "back" ? 0.98 : 1),
        )}
      </div>
    </div>
  );

  /** Nuri parked somewhere (peeking, hiding, fallen, asleep on the head). */
  const parkedMoon = (x: number, y: number, halo = false, extra?: ReactNode) => (
    <div key={`parked-${mood}`} className="parked" style={{ left: x + OX, top: y + OY }}>
      {extra}
      {halo && (
        <div className="L-glow glow">
          <svg viewBox="-22 -22 44 44" aria-hidden="true">
            <circle r={22} fill={`url(#${gid})`} />
          </svg>
        </div>
      )}
      <div className="L-moon">
        <div className="L-roll moon">
          <svg viewBox="-16 -16 32 32" aria-hidden="true">
            <MoonArt face={moonFace} tint={tint} />
          </svg>
        </div>
      </div>
    </div>
  );

  // --- mood extras (rare, so they stay plain SVG) ------------------------------------------------
  const extras: ReactNode = (() => {
    switch (mood) {
      case "sleeping":
        return (
          [
            [140, 74, 20, 0, 1],
            [154, 60, 15, -1, 0.8],
            [166, 48, 11, -2, 0.6],
          ] as const
        ).map(([x, y, fs, dl, op]) => (
          <text key={x} className="zfloat" style={{ animationDelay: `${dl}s` }} x={x} y={y} fontFamily="Rubik, sans-serif" fontWeight={700} fontSize={fs} fill={MIST} opacity={op}>
            z
          </text>
        ));
      case "curious":
        return (
          <g transform="translate(152 66)">
            <g className="L-x1">
              <text x={-6} y={8} fontFamily="Rubik, sans-serif" fontWeight={700} fontSize={24} fill={MOON}>
                ?
              </text>
            </g>
          </g>
        );
      case "surprised":
        return (
          <g className="L-x1">
            <path d="M70 62 L64 52 M100 56 L100 44 M130 62 L136 52" stroke="#fff" strokeWidth={3} strokeLinecap="round" />
          </g>
        );
      case "excited":
        return (
          [
            [26, 82, 6, 0],
            [178, 74, 5, -0.5],
            [186, 176, 4, -1],
            [18, 160, 3.5, -0.8],
            [100, 52, 4, -0.3],
          ] as const
        ).map(([sx, sy, ss, dl]) => <Star key={`${sx}-${sy}`} x={sx} y={sy} s={ss} fill="#fff" className="twinkle" style={{ animationDelay: `${dl}s` }} />);
      case "working":
        return [0, 10, 20].map((dx, i) => (
          <circle key={dx} className="dot" style={{ animationDelay: `${(i * 0.18).toFixed(2)}s` }} cx={136 + dx} cy={66} r={3.2} fill={MIST} />
        ));
      case "error":
        return (
          <>
            <g transform="translate(160 80)">
              <g className="L-x1">
                <circle r={11} fill={CORAL} />
                <rect x={-1.6} y={-7.5} width={3.2} height={9} rx={1.6} fill="#fff" />
                <circle cy={6} r={1.8} fill="#fff" />
              </g>
            </g>
            <g className="L-x2">
              <path d="M52 98 Q58 108 52 113 Q46 108 52 98 Z" fill="#A9E4FF" />
            </g>
          </>
        );
      case "music":
        return (
          <>
            <Note x={150} y={76} fill={MOON} delay={0} />
            <Note x={36} y={92} fill={ROSE} delay={-1.2} />
            <Note x={168} y={112} fill={ROSE} delay={-0.6} />
          </>
        );
      case "bored":
        return (
          <g className="L-x1">
            <circle cx={114} cy={164} r={3} fill={MIST} opacity=".7" />
            <circle cx={122} cy={161} r={4.5} fill={MIST} opacity=".5" />
          </g>
        );
      case "dizzy":
        return (
          <g transform="translate(100 62) scale(1 .32)">
            <g className="spin">
              {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((a) => (
                <Star key={a} x={30 * Math.cos(a)} y={30 * Math.sin(a)} s={5} fill={MOON} />
              ))}
            </g>
          </g>
        );
      case "grabbed":
        return <path d="M100 72 L100 30" stroke={MIST} strokeWidth={2} strokeDasharray="3 5" opacity=".5" />;
      default:
        return null;
    }
  })();

  const feetY = lifted ? 210 : 204;
  const headMoon = spec.moon.kind === "head" ? (winter ? { x: 138, y: 50 } : { x: spec.moon.x, y: spec.moon.y }) : null;
  const attentionRings =
    mood === "attention"
      ? [0, -0.75].map((dl) => (
          <div key={dl} className="pring ring-pulse" style={{ animationDelay: `${dl}s` }}>
            <svg viewBox="-16 -16 32 32" aria-hidden="true">
              <circle r={14} fill="none" stroke={MOON} strokeWidth={2} />
            </svg>
          </div>
        ))
      : null;

  const classes = ["nimi", `m-${mood}`, reducedMotion && "nimi--still", switching && "is-switching", className].filter(Boolean).join(" ");

  return (
    <div
      ref={rootRef}
      className={classes}
      role="img"
      aria-label={`NIMI — ${mood}`}
      style={{ width: frame, height: frame, ...style }}
      data-frame-units={FRAME_UNITS}
    >
      <div className="nimi-stage">
        <div className="nimi-units" style={{ transform: `scale(${(frame / FRAME_UNITS).toFixed(4)})` }}>
          {/* ground shadow: stays on the ground, shrinks when NIMI is in the air */}
          <div className="L-sh shadow">
            <Layer>
              <ellipse cx={100} cy={226} rx={lifted ? 26 : 40} ry={lifted ? 3.5 : 5} fill={BODY} opacity={lifted ? 0.08 : 0.18} />
            </Layer>
          </div>

          <div className="L-lift lift">
            {orbitLayer("back")}
            {spec.moon.kind === "static" && spec.moon.layer === "back" && parkedMoon(spec.moon.x, spec.moon.y)}

            {/* body: squash & stretch from the feet */}
            <div className="L-sq squash">
              <div className="L-switch switch">
                <Layer className="body">
                  <g className="L-fl">
                    <ellipse cx={82} cy={feetY} rx={12} ry={6.5} fill={DEEP} />
                  </g>
                  <g className="L-fr">
                    <ellipse cx={118} cy={feetY} rx={12} ry={6.5} fill={DEEP} />
                  </g>
                  <path d={BODY_D} fill={BODY} />
                  <ellipse cx={74} cy={104} rx={11} ry={16} transform="rotate(38 74 104)" fill="#fff" opacity=".35" />
                  <ellipse cx={100} cy={180} rx={38} ry={18} fill={MIST} opacity=".7" />
                  {belly && (
                    <g opacity=".55">
                      <path d="M92 170 h12 l5 5 v14 h-17 z" fill={DEEP} />
                      <path d="M104 170 v5 h5" fill="none" stroke={MIST} strokeWidth={1.2} />
                    </g>
                  )}
                </Layer>

                <div className="L-face face">
                  <div className="L-glance" style={{ transform: `translate(${glance.x}px, ${glance.y}px)` }}>
                    <Layer>
                      <g className={mood === "shy" ? "L-x2" : undefined}>
                        <Blush level={spec.blush} />
                      </g>
                      <Star x={58} y={156} s={4.5} fill={MOON} />
                      <Star x={142} y={156} s={4.5} fill={MOON} />
                      <g className="L-eyes">
                        <g className={"L-blink" + (blinking ? " is-blinking" : "")}>{eyeSpec.shapes}</g>
                      </g>
                      <Mouth kind={spec.mouth} />
                    </Layer>
                  </div>
                </div>

                {winter && (
                  <Layer className="winter">
                    <Scarf />
                    <Beanie />
                  </Layer>
                )}
                {headMoon && parkedMoon(headMoon.x, headMoon.y, true)}
              </div>
            </div>

            {orbitLayer("front")}
            {spec.moon.kind === "static" && spec.moon.layer === "front" && parkedMoon(spec.moon.x, spec.moon.y, mood === "attention", attentionRings)}

            {extras && <Layer className="extras">{extras}</Layer>}
          </div>
        </div>
      </div>
    </div>
  );
}
