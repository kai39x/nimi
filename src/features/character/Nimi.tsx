import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, type CSSProperties, type ReactNode, type Ref } from "react";
import "@design/character/nimi.css";
import "./nimi.css";
import { NimiEngine, type NimiElements } from "./engine";
import type { Mood } from "./rig/moods";
import { FRAME_UNITS, SAT_ART, VIEW_BOX, VolumeArc } from "./rig/parts";
import { BODY_SVG, FRECKLES_SVG, RIM_SVG, WINTER_SVG } from "./rig/rigData";

/** Frame pixels per nominal size unit: size 64 draws the 208-unit frame at 78 px (board 06). */
const FRAME_PER_SIZE = 78 / 64;
/** At this nominal size and below NIMI uses the small variant (REFINEMENTS.md §2). */
const SMALL_MAX_SIZE = 72;

/** What the shell can do to NIMI besides changing his mood. */
export interface NimiHandle {
  /** Click: jelly impulse + small hop. */
  poke(): void;
  /** Any interaction (hover, press): postpones idle behaviors and cuts a running one short. */
  touch(): void;
  /** The capsule is being dragged; pointer velocity in CSS px/s. */
  drag(vx: number, vy: number): void;
  /** The drag ended with this pointer velocity (CSS px/s). */
  release(vx: number, vy: number): void;
}

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
  /** Random yawns, stretches, hums… while idle (ANIMATION.md §4). Default on. */
  idleBehaviors?: boolean;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<NimiHandle>;
}

/** A full-frame SVG in rig units (same viewBox as the reference). */
function Frame({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <svg className={"nimi-svg" + (className ? ` ${className}` : "")} viewBox={VIEW_BOX} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {children}
    </svg>
  );
}

/**
 * NIMI — the character (`design/character/animation-lab.html`, ANIMATION.md, REFINEMENTS.md).
 *
 * React renders a fixed skeleton of HTML layers on a 208 px unit stage; `NimiEngine` fills the
 * SVG slots with the lab's markup (eyes, mouth, blush, extras, rings, Nuri's face) and moves the
 * layers with springs every frame. React re-renders only when props change.
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
  idleBehaviors = true,
  className,
  style,
  ref,
}: NimiProps) {
  const gid = useId().replace(/:/g, "");
  const frame = size * FRAME_PER_SIZE;
  const small = size <= SMALL_MAX_SIZE;
  const satCount = Math.min(satellites, 8);

  const rootRef = useRef<HTMLDivElement>(null);
  const els = useRef<Partial<NimiElements>>({ sats: [], satFrames: [], satRolls: [] });
  const engine = useRef<NimiEngine | null>(null);
  const slot = <K extends keyof NimiElements>(key: K) => (el: NimiElements[K] | null) => {
    if (el) els.current[key] = el;
  };

  const opts = { reduceMotion: reducedMotion, winter, nuriPace, idleBehaviors };
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Satellites come and go with the pocket; the engine reads these arrays every frame.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    els.current.sats = Array.from(root.querySelectorAll<HTMLElement>(".n-sat"));
    els.current.satFrames = Array.from(root.querySelectorAll<HTMLElement>(".n-sat-frame"));
    els.current.satRolls = Array.from(root.querySelectorAll<HTMLElement>(".n-sat-roll"));
  }, [satCount]);

  useLayoutEffect(() => {
    const e = new NimiEngine(els.current as NimiElements, optsRef.current, mood);
    engine.current = e;
    return () => {
      e.dispose();
      engine.current = null;
    };
    // The engine lives as long as the component; mood and options are pushed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => engine.current?.setMood(mood), [mood]);
  useEffect(() => engine.current?.setOptions(opts), [reducedMotion, winter, nuriPace, idleBehaviors]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(
    ref,
    () => ({
      poke: () => engine.current?.poke(),
      touch: () => engine.current?.touch(),
      drag: (vx, vy) => engine.current?.drag(vx, vy),
      release: (vx, vy) => engine.current?.release(vx, vy),
    }),
    [],
  );

  const scaleAbout = (cx: number, cy: number, s: number) => `translate(${cx} ${cy}) scale(${s}) translate(${-cx} ${-cy})`;
  const classes = ["nimi", `m-${mood}`, small && "nimi--small", reducedMotion && "nimi--still", className].filter(Boolean).join(" ");

  return (
    <div ref={rootRef} className={classes} role="img" aria-label={`NIMI — ${mood}`} style={{ width: frame, height: frame, ...style }}>
      <div className="nimi-stage">
        <div className="nimi-units" style={{ transform: `scale(${(frame / FRAME_UNITS).toFixed(4)})` }}>
          {/* ground shadow: stays on the ground, shrinks and fades when NIMI is in the air */}
          <div className="n-layer n-shadow" ref={slot("shadow")}>
            <Frame>
              <ellipse cx={100} cy={226} rx={40} ry={5} fill="#B4C0FF" />
            </Frame>
          </div>

          <div className="n-layer n-root" ref={slot("root")}>
            <div className="n-layer n-orb n-orb--back" ref={slot("orbB")}>
              <Frame>
                <g ref={slot("ringB")} />
              </Frame>
            </div>

            {/* body: rotation and squash pivot at the feet */}
            <div className="n-layer n-body" ref={slot("body")}>
              <Frame>
                <defs>
                  <radialGradient id={`${gid}b`} cx=".36" cy=".26" r=".85">
                    <stop offset="0" stopColor="#D3DBFF" />
                    <stop offset=".55" stopColor="#B4C0FF" />
                    <stop offset="1" stopColor="#97A5F0" />
                  </radialGradient>
                </defs>
                <g dangerouslySetInnerHTML={{ __html: BODY_SVG.replace("url(#nbb)", `url(#${gid}b)`) + (small ? "" : RIM_SVG) }} />
                {belly && (
                  <g opacity=".55">
                    <path d="M92 170 h12 l5 5 v14 h-17 z" fill="#9DABF5" />
                    <path d="M104 170 v5 h5" fill="none" stroke="#E3E8FF" strokeWidth={1.2} />
                  </g>
                )}
              </Frame>

              {/* face: trails the body a little */}
              <div className="n-layer n-face" ref={slot("face")}>
                <Frame>
                  <g ref={slot("blush")} />
                  {!small && <g dangerouslySetInnerHTML={{ __html: FRECKLES_SVG }} />}
                </Frame>
                <div className="n-layer n-eyes" ref={slot("eyesLayer")}>
                  <Frame>
                    <g transform={small ? scaleAbout(100, 140, 1.28) : undefined}>
                      <g ref={slot("eyes")} />
                    </g>
                  </Frame>
                  <div className="n-lift-host" ref={slot("eyesLift")} />
                </div>
                <Frame className="n-mouth">
                  <g transform={small ? scaleAbout(100, 160, 1.3) : undefined}>
                    <g ref={slot("mouth")} />
                  </g>
                </Frame>
              </div>

              {winter && <Frame className="n-winter">{<g dangerouslySetInnerHTML={{ __html: WINTER_SVG }} />}</Frame>}
            </div>

            <div className="n-layer n-orb n-orb--front" ref={slot("orbF")}>
              <Frame>
                <g ref={slot("ringF")} />
                {volume != null && <VolumeArc volume={Math.max(0, Math.min(1, volume))} />}
              </Frame>
            </div>

            {/* Nuri: the engine moves him and switches him in front of / behind the body */}
            <div className="n-layer n-nuri-frame" ref={slot("nuriFrame")}>
              {/* glow pulse and roll are on HTML wrappers so they run on the compositor */}
              <div className="n-nuri" ref={slot("nuri")}>
                <div className="n-glow" ref={slot("glow")}>
                  <svg viewBox="-24 -24 48 48" aria-hidden="true">
                    <defs>
                      <radialGradient id={`${gid}g`}>
                        <stop offset="0" stopColor="#FFE7A0" stopOpacity=".55" />
                        <stop offset="1" stopColor="#FFE7A0" stopOpacity="0" />
                      </radialGradient>
                    </defs>
                    <circle r={24} fill={`url(#${gid}g)`} />
                  </svg>
                </div>
                <div className="n-moon" ref={slot("moonRoll")}>
                  <svg viewBox="-16 -16 32 32" aria-hidden="true">
                    <g ref={slot("moonArt")} />
                  </svg>
                </div>
              </div>
            </div>

            {Array.from({ length: satCount }, (_, i) => (
              <div key={i} className="n-layer n-sat-frame">
                <div className="n-sat">
                  <div className="n-sat-roll">
                    <svg viewBox="-10 -10 20 20" aria-hidden="true">
                      {SAT_ART[i % SAT_ART.length]}
                    </svg>
                  </div>
                </div>
              </div>
            ))}

            <Frame className="n-extras">
              <g ref={slot("extras")} />
            </Frame>
            <div className="n-lift-host n-extras-lift" ref={slot("extrasLift")} />
          </div>
        </div>
      </div>
    </div>
  );
}
