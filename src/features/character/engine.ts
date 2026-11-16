/**
 * NIMI's motion engine — a port of the inline script in `design/character/animation-lab.html`
 * (the source of truth, see ANIMATION.md): damped springs for the soft body, a mood "program"
 * per mood, expression swaps behind a blink, a morphing mouth, Nuri gliding on an arc, and
 * random idle behaviors.
 *
 * Differences from the lab, all for the desktop app:
 *  - Output goes to CSS transforms on HTML wrappers (unit px on the 208 px stage), not SVG
 *    attributes, so per-frame motion stays on the compositor (docs/PLAN.md "phase 2").
 *  - One shared requestAnimationFrame loop drives every live NIMI and stops while the overlay
 *    is hidden (`setNimiPaused`).
 *  - Dragging moves the overlay window, not the body inside it, so drag feeds the lean/stretch
 *    from the pointer velocity and a release drops the body from a small lift.
 *  - Ring sparkle (stroke-dashoffset) is stepped at ~15 fps instead of a per-frame CSS animation.
 */
import {
  BLINKABLE,
  BLUSH,
  EXTRAS,
  EYES,
  MOOD_DATA,
  MOON_FACES,
  MOUTHS,
  ORBITS,
  type Mood,
  type MoonPlacement,
} from "./rig/rigData";

// --- geometry (rig units; unit px on the stage = svg coords + (4, -24)) ------------------------
const CX = 100;
const CY = 146;
const RX = 92;
const RY = 24;
const TILT = (-14 * Math.PI) / 180;
const FEET: [number, number] = [100, 206];
const OX = 4;
const OY = -24;
/** Window drag speed (CSS px/s) → lab stage units/s, so lean and stretch feel like the lab. */
const DRAG_UNITS_PER_PX = 0.4;
const TAU = Math.PI * 2;
const SVG_NS = "http://www.w3.org/2000/svg";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const easeInOut = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
/** Fixed-point text without "-0.00" (so a value resting at zero writes the same text every frame). */
const fix = (n: number, digits: number) => {
  const t = n.toFixed(digits);
  return /^-0\.?0*$/.test(t) ? t.slice(1) : t;
};
const px = (n: number) => `${fix(n, 2)}px`;

class Spring {
  x: number;
  v = 0;
  t: number;
  constructor(
    v: number,
    private k: number,
    private c: number,
  ) {
    this.x = v;
    this.t = v;
  }
  step(dt: number) {
    const a = this.k * (this.t - this.x) - this.c * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
  }
}

type Targets = {
  x: number;
  y: number;
  sx: number;
  sy: number;
  rot: number;
  fx: number;
  fy: number;
};
type Face = { e: string; m: string; b: string };

/** Hop with anticipation, air time and a wobbly landing (lab `hop`). */
function hop(t: number, P: number, h: number, pre = 0.14, air = 0.42) {
  const p = (t % P) / P;
  if (p < pre) {
    const q = p / pre;
    return { y: 0, sq: -0.09 * Math.sin(Math.PI * q) };
  }
  if (p < pre + air) {
    const q = (p - pre) / air;
    return { y: -h * 4 * q * (1 - q), sq: 0.07 * (1 - 2 * q) };
  }
  const q = (p - pre - air) / (1 - pre - air);
  return { y: 0, sq: -0.1 * Math.exp(-q * 9) * Math.cos(q * 12) };
}

/** Body targets for a mood as a function of time (lab `program`). */
function program(m: Mood, t: number): Targets {
  const o: Targets = { x: 0, y: 0, sx: 1, sy: 1, rot: 0, fx: 0, fy: 0 };
  const sq = (v: number) => {
    o.sy = 1 + v;
    o.sx = 1 - v * 0.7;
  };
  const b = (P: number) => 0.5 + 0.5 * Math.sin((TAU * t) / P);
  switch (m) {
    case "idle":
      o.sy = 1 - 0.02 * b(3.4);
      o.sx = 1 + 0.013 * b(3.4);
      break;
    case "sleeping":
      o.sy = 1 - 0.045 * b(4.6);
      o.sx = 1 + 0.03 * b(4.6);
      o.rot = -2 * b(4.6);
      o.fy = 2 * b(4.6);
      break;
    case "happy": {
      const h = hop(t, 1.5, 20);
      o.y = h.y;
      sq(h.sq);
      break;
    }
    case "excited": {
      const h = hop(t, 0.9, 26);
      o.y = h.y;
      sq(h.sq);
      o.rot = (Math.floor(t / 0.9) % 2 ? 6 : -6) * (-h.y / 26);
      break;
    }
    case "celebrate": {
      const h = hop(t, 1.0, 32);
      o.y = h.y;
      sq(h.sq);
      o.rot = (Math.floor(t / 1.0) % 2 ? 9 : -9) * (-h.y / 32);
      break;
    }
    case "laugh": {
      const h = hop(t, 0.46, 7, 0.1, 0.5);
      o.y = h.y;
      sq(h.sq * 0.8);
      o.rot = 2.5 * Math.sin((TAU * t) / 0.46);
      o.fy = 1;
      break;
    }
    case "music":
      o.rot = 5 * Math.sin((TAU * t) / 1.2);
      o.y = -4 * Math.abs(Math.sin((TAU * t) / 1.2));
      sq(0.035 * Math.cos((TAU * t) / 0.6));
      break;
    case "love":
      o.y = -6 * b(2.6);
      o.rot = 2.5 * Math.sin((TAU * t) / 2.6 + 1);
      sq(0.02 * Math.sin((TAU * t) / 2.6));
      break;
    case "sad":
      o.sx = 1.04;
      o.sy = 0.945;
      o.rot = -2 + 1.2 * Math.sin((TAU * t) / 4.6);
      o.fy = 3;
      break;
    case "angry": {
      const burst = t % 1.6 < 0.32;
      o.x = burst ? 2.2 * Math.sin(TAU * t * 15) : 0;
      o.sx = 1.05 + (burst ? 0.03 : 0);
      o.sy = 0.95 - (burst ? 0.02 : 0);
      o.fy = 1;
      break;
    }
    case "scared":
      o.x = 1.4 * Math.sin(TAU * t * 9);
      o.sx = 0.94;
      o.sy = 0.94;
      break;
    case "cold":
      o.x = 0.9 * Math.sin(TAU * t * 12);
      o.sx = 0.97;
      o.sy = 0.98;
      break;
    case "curious":
      o.rot = 9 + 2 * Math.sin((TAU * t) / 3.4);
      o.x = 4;
      o.fx = 3;
      o.fy = -2;
      break;
    case "surprised":
      o.sx = 1.02;
      o.sy = 1.02;
      break;
    case "working":
      o.y = -1.5 * (1 + Math.sin((TAU * t) / 2.4));
      o.fx = -3 + 6 * ((t % 2.4) / 2.4);
      o.fy = t % 4.8 < 2.4 ? -1 : 1;
      break;
    case "error": {
      const burst = t % 3 < 0.36;
      o.x = burst ? 2 * Math.sin(TAU * t * 14) : 0;
      o.sx = 1.03;
      o.sy = 0.96;
      o.fy = 2;
      break;
    }
    case "attention":
      if (t < 1.25) {
        const h = hop(t, 0.62, 12);
        o.y = h.y;
        sq(h.sq);
      } else {
        o.sx = 1.045;
        o.sy = 1.045;
      }
      break;
    case "bored":
      o.rot = -3 + 1.4 * Math.sin((TAU * t) / 7);
      o.sx = 1.035;
      o.sy = 0.95;
      o.fx = 3 * Math.sin((TAU * t) / 9);
      break;
    case "dizzy":
      o.rot = 8 * Math.sin((TAU * t) / 1.3);
      o.x = 3 * Math.sin((TAU * t) / 1.3 + 0.6);
      sq(0.03 * Math.sin((TAU * t) / 0.65));
      o.fx = 2 * Math.sin((TAU * t) / 1.3 - 0.6);
      break;
    case "shy":
      o.sx = 0.95;
      o.sy = 0.94;
      o.rot = -5 + 1.2 * Math.sin((TAU * t) / 3.6);
      o.fx = -3;
      o.fy = 3;
      break;
    case "hungry":
      o.sy = 1.05;
      o.sx = 0.97;
      o.x = 0.7 * Math.sin(TAU * t * 7);
      o.y = -2;
      break;
    case "chomp": {
      const h = hop(t, 1.4, 7);
      o.y = h.y;
      sq(h.sq * 1.4);
      break;
    }
    case "chew":
      sq(-0.035 * Math.sin((TAU * t) / 0.8));
      break;
    case "grabbed":
      break;
  }
  return o;
}

function orbitPt(th: number): [number, number] {
  const x = RX * Math.cos(th);
  const y = RY * Math.sin(th);
  return [
    CX + x * Math.cos(TILT) - y * Math.sin(TILT),
    CY + x * Math.sin(TILT) + y * Math.cos(TILT),
  ];
}

/** Looping animations inside the lab's markup (notes, z's, twinkles, dots, spins, rings, extras). */
const LIFT_SELECTOR = ".note, .zfloat, .twinkle, .dot, .spin, .pring, .sigh, .L-x1, .L-x2";

/**
 * A CSS animation on an element *inside* an SVG repaints that whole SVG on the main thread every
 * frame (~20 % of a core for the music notes at 143 Hz). This moves each animated group of a slot
 * into its own small HTML box — same geometry, same classes, so the same keyframes — where the
 * transform runs on the compositor. The parent's transform (translate, the small variant's scale,
 * the dizzy squash) is kept as a matrix on a static wrapper, so nothing looks different.
 */
function liftAnimations(slot: SVGGElement, host: HTMLElement) {
  host.replaceChildren();
  const svg = slot.ownerSVGElement;
  const rootCtm = svg?.getScreenCTM();
  if (!svg || !rootCtm) return; // not rendered (hidden window): the SVG animations stay as they are
  const toRoot = rootCtm.inverse();
  const vb = svg.viewBox.baseVal;
  const found = Array.from(slot.querySelectorAll<SVGGraphicsElement>(LIFT_SELECTOR));
  for (const el of found) {
    if (el.parentElement?.closest(LIFT_SELECTOR) || el.hasAttribute("transform")) continue;
    const parentCtm = (el.parentNode as SVGGraphicsElement).getScreenCTM?.();
    if (!parentCtm) continue;
    let box: DOMRect;
    try {
      box = el.getBBox();
    } catch {
      continue;
    }
    if (!box.width && !box.height) continue;
    // transform-box: fill-box → the computed origin is relative to the element's bbox.
    const [ox = 0, oy = 0] = getComputedStyle(el).transformOrigin.split(" ").map(parseFloat);
    const m = toRoot.multiply(parentCtm); // parent user space → root user space
    const outer = document.createElement("div");
    outer.className = "n-lift";
    outer.style.transform = `matrix(${m.a}, ${m.b}, ${m.c}, ${m.d}, ${m.e - vb.x}, ${m.f - vb.y})`;
    const inner = document.createElement("div");
    inner.setAttribute("class", `${el.getAttribute("class") ?? ""} n-lift__anim`);
    inner.setAttribute("style", el.getAttribute("style") ?? "");
    inner.style.left = `${box.x}px`;
    inner.style.top = `${box.y}px`;
    inner.style.width = `${box.width}px`;
    inner.style.height = `${box.height}px`;
    inner.style.transformOrigin = `${ox}px ${oy}px`;
    const art = document.createElementNS(SVG_NS, "svg");
    art.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
    const clone = el.cloneNode(true) as SVGElement;
    clone.removeAttribute("class");
    clone.removeAttribute("style");
    art.appendChild(clone);
    inner.appendChild(art);
    outer.appendChild(inner);
    host.appendChild(outer);
    el.remove();
  }
}

/** Moods whose program moves quickly (hops, shakes, grooves) and needs the full step rate. */
const FAST_MOODS = new Set<Mood>([
  "happy",
  "excited",
  "celebrate",
  "laugh",
  "music",
  "angry",
  "scared",
  "cold",
  "error",
  "attention",
  "dizzy",
  "hungry",
  "chomp",
  "chew",
  "working",
]);

// --- shared frame loop -------------------------------------------------------------------------
const live = new Set<NimiEngine>();
let raf = 0;
let pace = 0;
let paused = false;
let inLoop = false;
/**
 * Engine steps per second. On a 143 Hz display every requested animation frame is a full
 * main-frame pass (style, paint, commit) even when nothing changes, so the loop sleeps on a
 * timer between steps instead of asking for every vsync. 60 steps look the same for a soft body.
 */
const MAX_FPS = 60;
/** Slow drifts (breathing, sleeping, sulking) step at this rate; nothing visible is lost. */
const CALM_FPS = 30;

function loop(now: number) {
  raf = 0;
  if (paused) return;
  let fast = false;
  // Tweens, mood switches and behaviors started inside a frame call kick(); without this flag
  // each of them would start a second loop chain next to this one (they multiplied to ~400
  // steps/s on a 143 Hz display before this guard).
  inLoop = true;
  for (const engine of live) {
    try {
      fast = engine.frame(now) || fast;
    } catch (err) {
      // One broken frame must not stop every NIMI on screen; log it and keep the loop alive.
      console.error("nimi engine frame failed", err);
    }
  }
  inLoop = false;
  if (!live.size || pace || raf) return; // another chain is already scheduled: let it run alone
  const spent = performance.now() - now;
  // Wake a touch early so the next requestAnimationFrame lands on the following vsync.
  pace = window.setTimeout(
    () => {
      pace = 0;
      if (!paused && live.size && !raf) raf = requestAnimationFrame(loop);
    },
    Math.max(0, 1000 / (fast ? MAX_FPS : CALM_FPS) - 3 - spent),
  );
}

/** Last text written per element and property (the style getter normalizes, so cache our own). */
const written = new WeakMap<HTMLElement, Record<string, string>>();

/** Writes a style property only when its text changes (most layers sit still most frames). */
function put(el: HTMLElement, prop: "transform" | "opacity" | "zIndex", value: string) {
  let w = written.get(el);
  if (!w) written.set(el, (w = {}));
  if (w[prop] === value) return;
  w[prop] = value;
  el.style[prop] = value;
}

function kick() {
  if (!raf && !pace && !inLoop && !paused && live.size) raf = requestAnimationFrame(loop);
}

/** Stops every NIMI's frame loop and timers while the overlay is hidden (fullscreen / snoozed). */
export function setNimiPaused(next: boolean) {
  paused = next;
  if (paused) {
    cancelAnimationFrame(raf);
    window.clearTimeout(pace);
    raf = 0;
    pace = 0;
  } else kick();
}

// Vite hot reload swaps this module; stop the old loop so two never run side by side.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    live.clear();
    setNimiPaused(true);
  });
}

const awake = () => !paused && document.visibilityState === "visible";

// --- the engine ----------------------------------------------------------------------------------
export interface NimiElements {
  shadow: HTMLElement;
  root: HTMLElement;
  /** Back ring, front ring, Nuri and satellite frames: all follow the orbit lag + tilt. */
  orbB: HTMLElement;
  orbF: HTMLElement;
  nuriFrame: HTMLElement;
  nuri: HTMLElement;
  sats: HTMLElement[];
  /** Nuri's glow (opacity pulse) and moon (roll), and each satellite's roll: driven here, not by
   *  CSS keyframes — a CSS animation makes the compositor redraw the whole transparent window on
   *  every vsync (144/s on a 143 Hz display) even when nothing else moves. */
  glow: HTMLElement;
  moonRoll: HTMLElement;
  satRolls: HTMLElement[];
  satFrames: HTMLElement[];
  body: HTMLElement;
  face: HTMLElement;
  eyesLayer: HTMLElement;
  /** SVG slots the engine fills with the lab's markup. */
  eyes: SVGGElement;
  mouth: SVGGElement;
  blush: SVGGElement;
  extras: SVGGElement;
  /** HTML hosts for animated groups lifted out of the eyes / extras SVG (see `liftAnimations`). */
  eyesLift: HTMLElement;
  extrasLift: HTMLElement;
  ringB: SVGGElement;
  ringF: SVGGElement;
  moonArt: SVGGElement;
}

export interface EngineOptions {
  reduceMotion: boolean;
  winter: boolean;
  nuriPace: number;
  idleBehaviors: boolean;
}

type Tween = {
  t0: number;
  dur: number;
  fn: (p: number) => void;
  ease: (t: number) => number;
  done: () => void;
};

export class NimiEngine {
  private S = {
    x: new Spring(0, 70, 14),
    y: new Spring(0, 520, 34),
    sx: new Spring(1, 300, 11),
    sy: new Spring(1, 300, 11),
    rot: new Spring(0, 220, 15),
    fx: new Spring(0, 160, 17),
    fy: new Spring(0, 160, 17),
    orbY: new Spring(0, 70, 9),
    orbX: new Spring(0, 70, 9),
  };
  private es = 1;
  private mood: Mood;
  private target: Mood;
  private switching = false;
  private moodT0 = performance.now();
  private face: Face;
  private ovr: Partial<Targets> | null = null;
  private busy = false;
  private behSeq = 0;
  private lastInteract = performance.now();
  private nextBeh = performance.now() + rnd(4000, 7000);
  private dragging = false;
  private dragVel = { vx: 0, vy: 0 };
  private falling = false;
  private vyFall = 0;
  private blinkLock = false;
  private curMouth: SVGGElement | null = null;
  private curMouthKind: string | null = null;
  private tweens: Tween[] = [];
  private timers = new Set<number>();
  private last = performance.now();
  private lastDash = 0;
  private disposed = false;
  private moon = {
    th: 0.75,
    perS: new Spring(9, 6, 5),
    x: 176,
    y: 140,
    from: null as [number, number] | null,
    t0: 0,
    mode: "orbit" as "orbit" | "head" | "anchor" | "free",
    anchor: [176, 140] as [number, number],
    layer: "front" as "front" | "back",
    faceKey: "",
  };

  constructor(
    private els: NimiElements,
    private opts: EngineOptions,
    initial: Mood,
  ) {
    this.mood = initial;
    this.target = initial;
    const c = MOOD_DATA[initial];
    this.face = { e: c.e, m: c.m, b: c.b };
    this.setMoon(c.moon, true);
    this.applyOrbit(c.o);
    this.applyFace(this.face, true);
    this.applyExtras(initial);
    this.blinkLoop();
    live.add(this);
    kick();
  }

  dispose() {
    this.disposed = true;
    live.delete(this);
    this.timers.forEach((t) => window.clearTimeout(t));
    this.timers.clear();
    this.tweens = [];
  }

  setOptions(opts: EngineOptions) {
    const nuriChanged = opts.nuriPace !== this.opts.nuriPace;
    this.opts = opts;
    if (nuriChanged) {
      const m = MOOD_DATA[this.mood].moon;
      if (m.mode === "orbit") this.moon.perS.t = m.period * opts.nuriPace;
    }
  }

  // --- timers & tweens (tweens run inside the frame loop) --------------------------------------
  private sleep(ms: number) {
    return new Promise<void>((res) => {
      const id = window.setTimeout(() => {
        this.timers.delete(id);
        res();
      }, ms);
      this.timers.add(id);
    });
  }

  private tween(
    dur: number,
    fn: (p: number) => void,
    ease: (t: number) => number = (t) => t,
  ) {
    return new Promise<void>((done) => {
      this.tweens.push({ t0: performance.now(), dur, fn, ease, done });
      kick();
    });
  }

  // --- face composition ----------------------------------------------------------------------
  private setMouth(kind: string, instant = false) {
    if (kind === this.curMouthKind) return;
    this.curMouthKind = kind;
    const g = document.createElementNS(SVG_NS, "g");
    g.innerHTML = MOUTHS[kind] ?? "";
    this.els.mouth.appendChild(g);
    const old = this.curMouth;
    this.curMouth = g;
    const T = (el: SVGGElement, sc: number, op: number) => {
      el.setAttribute(
        "transform",
        `translate(100 160) scale(${sc.toFixed(3)}) translate(-100 -160)`,
      );
      el.setAttribute("opacity", op.toFixed(3));
    };
    if (instant || !old || this.opts.reduceMotion) {
      old?.remove();
      // A previous morph may still be fading another mouth: drop everything but the new one.
      for (const child of Array.from(this.els.mouth.children))
        if (child !== g) child.remove();
      T(g, 1, 1);
      return;
    }
    T(g, 0.5, 0);
    void this.tween(120, (p) => T(old, 1 - 0.45 * p, 1 - p)).then(() =>
      old.remove(),
    );
    void this.tween(
      210,
      (p) => T(g, lerp(0.5, 1, p), Math.min(1, p * 1.7)),
      easeOutBack,
    );
  }

  private applyFace(f: Face, instant = false) {
    this.face = f;
    this.els.eyes.innerHTML = EYES[f.e] ?? "";
    liftAnimations(this.els.eyes, this.els.eyesLift);
    this.setMouth(f.m, instant);
    this.els.blush.innerHTML = BLUSH[f.b] ?? "";
  }

  private applyExtras(m: Mood | "music") {
    this.els.extras.innerHTML = EXTRAS[m] ?? "";
    liftAnimations(this.els.extras, this.els.extrasLift);
  }

  private applyOrbit(style: string) {
    const o = ORBITS[style] ?? ORBITS.none;
    this.els.ringB.innerHTML = o.back;
    this.els.ringF.innerHTML = o.front;
  }

  private moodFace(): Face {
    const c = MOOD_DATA[this.mood];
    return { e: c.e, m: c.m, b: c.b };
  }

  private async blinkSwap(swap?: () => void) {
    this.blinkLock = true;
    await this.tween(85, (p) => (this.es = lerp(1, 0.06, p)));
    swap?.();
    await this.tween(170, (p) => (this.es = lerp(0.06, 1, p)), easeOutBack);
    this.blinkLock = false;
  }

  private async blink(double: boolean) {
    if (this.blinkLock || !BLINKABLE[this.face.e]) return;
    this.blinkLock = true;
    for (let i = 0; i < (double ? 2 : 1); i++) {
      await this.tween(70, (p) => (this.es = lerp(1, 0.06, p)));
      await this.tween(110, (p) => (this.es = lerp(0.06, 1, p)));
      if (double) await this.sleep(70);
    }
    this.blinkLock = false;
  }

  private blinkLoop() {
    const id = window.setTimeout(
      () => {
        this.timers.delete(id);
        if (this.disposed) return;
        if (awake()) void this.blink(Math.random() < 0.22);
        this.blinkLoop();
      },
      rnd(2400, 5600),
    );
    this.timers.add(id);
  }

  // --- Nuri ----------------------------------------------------------------------------------
  private setMoon(cfg: MoonPlacement, instant = false) {
    const m = this.moon;
    m.from = instant ? null : [m.x, m.y];
    m.t0 = performance.now();
    m.mode = cfg.mode;
    if (cfg.mode === "orbit") m.perS.t = cfg.period * this.opts.nuriPace;
    else {
      m.anchor = [cfg.x, cfg.y];
      m.layer = cfg.layer ?? "front";
    }
    if (instant && cfg.mode === "orbit") m.perS.x = m.perS.t;
    if (cfg.face !== m.faceKey) {
      m.faceKey = cfg.face;
      this.els.moonArt.innerHTML = MOON_FACES[cfg.face] ?? "";
    }
  }

  /** A point on the body mapped through the current squash and rotation (lab `headPoint`). */
  private headPoint(px0: number, py0: number): [number, number] {
    const r = (this.S.rot.x * Math.PI) / 180;
    const dx = (px0 - FEET[0]) * this.S.sx.x;
    const dy = (py0 - FEET[1]) * this.S.sy.x;
    return [
      FEET[0] + dx * Math.cos(r) - dy * Math.sin(r),
      FEET[1] + dx * Math.sin(r) + dy * Math.cos(r),
    ];
  }

  private headY() {
    return this.headPoint(100, 58)[1] - 14;
  }

  // --- moods -----------------------------------------------------------------------------------
  /** Requests a mood; transitions run one at a time and always land on the latest request. */
  setMood(m: Mood) {
    if (!(m in MOOD_DATA)) return; // unknown mood (e.g. a typo from a dev hook): keep the current one
    this.target = m;
    if (!this.switching) void this.runSwitches();
  }

  private async runSwitches() {
    this.switching = true;
    while (!this.disposed && this.target !== this.mood)
      await this.switchTo(this.target);
    this.switching = false;
  }

  private async switchTo(m: Mood) {
    const prev = this.mood;
    this.cancelBehavior();
    if (m === "sleeping" && prev !== "sleeping") await this.yawn(true);
    if (prev === "sleeping" && m !== "sleeping") await this.wake();
    if (this.disposed) return;
    this.mood = m;
    this.moodT0 = performance.now();
    const c = MOOD_DATA[m];
    if (!this.opts.reduceMotion) {
      this.S.sy.v -= 1.6;
      this.S.sx.v += 1.1;
    }
    this.setMoon(c.moon);
    this.applyOrbit(c.o);
    await this.blinkSwap(() => {
      this.applyFace({ e: c.e, m: c.m, b: c.b });
      this.applyExtras(m);
    });
  }

  // --- idle behaviors ------------------------------------------------------------------------
  private cancelBehavior() {
    this.behSeq++;
    this.ovr = null;
    this.busy = false;
  }

  /** Runs a behavior; it stops quietly when a mood change (or another behavior) cancels it. */
  private async behave(run: (alive: () => boolean) => Promise<void>) {
    const token = ++this.behSeq;
    const alive = () => token === this.behSeq && !this.disposed;
    this.busy = true;
    try {
      await run(alive);
    } finally {
      if (alive()) {
        this.ovr = null;
        this.busy = false;
      }
    }
  }

  /** Part of a mood switch (into sleep) or an idle behavior (`alive` stops it when cancelled). */
  private async yawn(
    toSleep: boolean,
    alive: () => boolean = () => !this.disposed,
  ) {
    this.busy = true;
    await this.blinkSwap(() =>
      this.applyFace({ e: "squint", m: "yawn", b: this.face.b }),
    );
    if (!alive()) return;
    this.ovr = { sy: 1.09, sx: 0.94, rot: -2 };
    await this.sleep(900);
    if (!alive()) return;
    this.ovr = { sy: 1.0, sx: 1.0 };
    await this.sleep(250);
    if (!alive()) return;
    if (!toSleep) await this.blinkSwap(() => this.applyFace(this.moodFace()));
    this.ovr = null;
    this.busy = false;
  }

  private async wake() {
    this.busy = true;
    this.ovr = { sy: 1.16, sx: 0.88, rot: 0 };
    await this.blinkSwap(() =>
      this.applyFace({ e: "happy", m: "open", b: "warm" }),
    );
    await this.sleep(650);
    this.ovr = null;
    if (!this.opts.reduceMotion) {
      this.S.sy.v -= 3;
      this.S.sx.v += 2;
    }
    await this.sleep(200);
    this.busy = false;
  }

  private stretch = () =>
    this.behave(async (alive) => {
      await this.blinkSwap(() =>
        this.applyFace({ e: "happy", m: "smile", b: "warm" }),
      );
      if (!alive()) return;
      this.ovr = { sy: 1.17, sx: 0.87 };
      await this.sleep(750);
      if (!alive()) return;
      this.ovr = null;
      this.S.sy.v -= 3.4;
      this.S.sx.v += 2.4;
      await this.sleep(500);
      if (!alive()) return;
      await this.blinkSwap(() => this.applyFace(this.moodFace()));
    });

  private look = () =>
    this.behave(async (alive) => {
      this.ovr = { fx: -5, fy: -1 };
      await this.sleep(800);
      if (!alive()) return;
      this.ovr = { fx: 5, fy: -1 };
      await this.sleep(900);
      if (!alive()) return;
      this.ovr = { fx: 0, fy: 0 };
      await this.sleep(300);
    });

  private playNuri = () =>
    this.behave(async (alive) => {
      this.setMoon({
        mode: "anchor",
        x: 100,
        y: 26,
        layer: "front",
        face: "happy",
      });
      this.ovr = { fy: -3 };
      await this.sleep(700);
      for (const h of [0, 1, 2]) {
        if (!alive()) return; // the mood switch that cancelled us has placed Nuri already
        const top = 26 + h * 14;
        const dur = 380 - h * 60;
        await this.tween(dur, (p) => {
          if (!alive()) return;
          this.moon.mode = "free";
          this.moon.x = 100;
          this.moon.y = lerp(top, this.headY(), p * p);
        });
        if (!alive()) return;
        this.S.sy.v -= 2.4 + (2 - h) * 0.8;
        this.S.sx.v += 1.6;
        if (h === 0) this.applyFace({ e: "happy", m: "open", b: "warm" });
        await this.tween(dur * 0.9, (p) => {
          if (alive())
            this.moon.y = lerp(this.headY(), top + 14, 1 - (1 - p) * (1 - p));
        });
      }
      if (!alive()) return;
      this.setMoon(MOOD_DATA[this.mood].moon);
      this.ovr = null;
      await this.sleep(500);
      if (alive()) this.applyFace(this.moodFace());
    });

  private hum = () =>
    this.behave(async (alive) => {
      await this.blinkSwap(() =>
        this.applyFace({ e: "music", m: "sing", b: "warm" }),
      );
      if (!alive()) return;
      this.applyExtras("music");
      const t0 = performance.now();
      while (alive() && performance.now() - t0 < 3000) {
        this.ovr = {
          rot: 5 * Math.sin((TAU * (performance.now() - t0)) / 1200),
        };
        await this.sleep(30);
      }
      this.applyExtras(this.mood);
      if (alive()) await this.blinkSwap(() => this.applyFace(this.moodFace()));
    });

  /** Winter only: "ah… ah…" lean back → "choo!" jolt, Nuri flung away, a puff of snow. */
  private sneeze = () =>
    this.behave(async (alive) => {
      await this.blinkSwap(() =>
        this.applyFace({ e: "squint", m: "o", b: "warm" }),
      );
      if (!alive()) return;
      this.ovr = { rot: -7, sy: 1.07, sx: 0.95 };
      await this.sleep(750);
      if (!alive()) return;
      this.applyFace({ e: "squeeze", m: "O", b: "hot" });
      this.ovr = { rot: 9, sy: 0.9, sx: 1.08 };
      this.S.rot.v += 160;
      this.S.y.v -= 160;
      this.setMoon({
        mode: "anchor",
        x: 200,
        y: 40,
        layer: "front",
        face: "wow",
      });
      this.snowPuff();
      await this.sleep(450);
      this.ovr = null;
      await this.sleep(500);
      this.setMoon(MOOD_DATA[this.mood].moon);
      if (alive()) await this.blinkSwap(() => this.applyFace(this.moodFace()));
    });

  private snowPuff() {
    const g = document.createElementNS(SVG_NS, "g");
    for (let i = 0; i < 9; i++) {
      const c = document.createElementNS(SVG_NS, "circle");
      const a = -Math.PI / 2 + rnd(-1.1, 1.1);
      const d = rnd(40, 80);
      c.setAttribute("r", rnd(2, 4.5).toFixed(2));
      c.setAttribute("fill", "#F7F8FF");
      c.setAttribute("cx", "100");
      c.setAttribute("cy", "150");
      g.appendChild(c);
      void this.tween(700, (p) => {
        c.setAttribute("cx", (100 + Math.cos(a) * d * p).toFixed(2));
        c.setAttribute(
          "cy",
          (150 + Math.sin(a) * d * p + 40 * p * p).toFixed(2),
        );
        c.setAttribute("opacity", (1 - p).toFixed(3));
      });
    }
    this.els.extras.appendChild(g);
    void this.sleep(720).then(() => g.remove());
  }

  private maybeIdle(now: number) {
    if (
      !this.opts.idleBehaviors ||
      this.busy ||
      this.switching ||
      this.dragging ||
      this.falling
    )
      return;
    if (
      this.mood !== "idle" ||
      now < this.nextBeh ||
      now - this.lastInteract < 3500
    )
      return;
    const pool = [
      this.yawnBehavior,
      this.stretch,
      this.look,
      this.look,
      this.playNuri,
      this.hum,
    ];
    if (this.opts.winter) pool.push(this.sneeze);
    void pool[Math.floor(Math.random() * pool.length)]();
    this.nextBeh = now + rnd(7000, 12000);
  }

  private yawnBehavior = () => this.behave((alive) => this.yawn(false, alive));

  // --- interaction -----------------------------------------------------------------------------
  /** Any interaction: postpones idle behaviors and cuts a running one short. */
  touch() {
    this.lastInteract = performance.now();
    if (!this.busy || this.switching) return;
    this.cancelBehavior();
    // Put back what the behavior had borrowed: face, extras, Nuri's place.
    const f = this.moodFace();
    if (f.e !== this.face.e || f.m !== this.face.m || f.b !== this.face.b)
      void this.blinkSwap(() => this.applyFace(f));
    this.applyExtras(this.mood);
    this.setMoon(MOOD_DATA[this.mood].moon);
  }

  /** Click: a jelly impulse and a small hop (the mood change comes from the mood machine). */
  poke() {
    this.touch();
    if (this.opts.reduceMotion) return;
    this.S.sy.v -= 4;
    this.S.sx.v += 3;
    this.S.y.v -= 260;
    kick();
  }

  /** The overlay window is being dragged: pointer velocity in CSS px/s. */
  drag(vx: number, vy: number) {
    if (!this.dragging) this.touch();
    this.dragging = true;
    this.falling = false;
    this.dragVel = { vx: vx * DRAG_UNITS_PER_PX, vy: vy * DRAG_UNITS_PER_PX };
  }

  /** Drag ended: the body drops from its lift with the throw speed and bounces. */
  release(vx: number, vy: number) {
    if (!this.dragging) return;
    this.dragging = false;
    this.lastInteract = performance.now();
    if (this.opts.reduceMotion) return;
    this.falling = true;
    this.vyFall = clamp(vy * DRAG_UNITS_PER_PX, -900, 900);
    this.S.x.v = clamp(vx * DRAG_UNITS_PER_PX, -900, 900) * 0.6;
  }

  // --- frame -----------------------------------------------------------------------------------
  /** Advances and renders one step; returns true while something moves fast enough to need 60 fps. */
  frame(now: number): boolean {
    const S = this.S;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    // tweens
    if (this.tweens.length) {
      const due = this.tweens;
      this.tweens = [];
      for (const tw of due) {
        const p = clamp((now - tw.t0) / tw.dur, 0, 1);
        tw.fn(tw.ease(p));
        if (p < 1) this.tweens.push(tw);
        else tw.done();
      }
    }

    // targets: mood program, behavior override, drag
    const t = (now - this.moodT0) / 1000;
    const P = program(this.mood, t);
    const O = this.ovr ?? {};
    const tg: Targets = {
      x: O.x ?? P.x,
      y: O.y ?? P.y,
      sx: O.sx ?? P.sx,
      sy: O.sy ?? P.sy,
      rot: O.rot ?? P.rot,
      fx: O.fx ?? P.fx,
      fy: O.fy ?? P.fy,
    };
    if (this.dragging) {
      const { vx, vy } = this.dragVel;
      const sp = Math.min(Math.hypot(vx, vy) * 0.00025, 0.14);
      tg.rot = clamp(-vx * 0.025, -24, 24);
      tg.sy = 1 + sp + 0.04;
      tg.sx = 1 - sp * 0.8 - 0.03;
      tg.y = -10; // held up while the capsule is carried
      tg.x = 0;
      // velocity decays between pointer events so a pause straightens him up
      this.dragVel.vx *= Math.pow(0.02, dt);
      this.dragVel.vy *= Math.pow(0.02, dt);
    }
    if (this.opts.reduceMotion) {
      tg.y = 0;
      tg.x = 0;
      tg.sx = 1;
      tg.sy = 1;
      tg.rot = clamp(tg.rot, -3, 3);
    }
    if (!this.falling) S.y.t = tg.y;
    S.x.t = tg.x;
    S.rot.t = tg.rot;
    S.sx.t = tg.sx;
    S.sy.t = tg.sy;
    S.fx.t = tg.fx;
    S.fy.t = tg.fy;

    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      for (const k in S) {
        if (this.falling && k === "y") continue;
        S[k as keyof typeof S].step(h);
      }
      if (this.falling) {
        this.vyFall += 2600 * h;
        S.y.x += this.vyFall * h;
        if (S.y.x >= 0) {
          S.y.x = 0;
          const imp = this.vyFall;
          if (imp > 160) {
            this.vyFall = -imp * 0.36;
            S.sy.v -= imp * 0.0075;
            S.sx.v += imp * 0.006;
          } else {
            this.falling = false;
            this.vyFall = 0;
            S.y.v = 0;
          }
        }
      }
    }
    S.orbY.t = S.y.x;
    S.orbX.t = S.x.x;

    // render (unit px == rig units on the 208 px stage)
    const e = this.els;
    const x = S.x.x;
    const y = S.y.x;
    put(e.root, "transform", `translate(${px(x)}, ${px(y)})`);
    const lift = Math.max(0, -y);
    const sh = clamp(1 - lift / 140, 0.45, 1);
    put(
      e.shadow,
      "transform",
      `translate(${px(104 + x)}, 202px) scale(${fix(sh, 3)}) translate(-104px, -202px)`,
    );
    put(e.shadow, "opacity", fix(0.18 * sh + 0.04, 3));
    put(
      e.body,
      "transform",
      `translate(104px, 182px) rotate(${fix(S.rot.x, 2)}deg) scale(${fix(S.sx.x, 4)}, ${fix(S.sy.x, 4)}) translate(-104px, -182px)`,
    );
    put(e.face, "transform", `translate(${px(S.fx.x)}, ${px(S.fy.x)})`);
    put(
      e.eyesLayer,
      "transform",
      `translate(0, 116px) scale(1, ${fix(this.es, 3)}) translate(0, -116px)`,
    );
    const dx = S.orbX.x - x;
    const dy = S.orbY.x - y;
    const ol = `translate(${px(dx)}, ${px(dy)}) translate(104px, 122px) rotate(${fix(S.rot.x * 0.35, 2)}deg) translate(-104px, -122px)`;
    put(e.orbB, "transform", ol);
    put(e.orbF, "transform", ol);
    put(e.nuriFrame, "transform", ol);
    for (const f of e.satFrames) put(f, "transform", ol);

    // Nuri
    const m = this.moon;
    m.perS.step(dt);
    m.th += (TAU / Math.max(0.6, m.perS.x)) * dt;
    let target: [number, number];
    let layer: "front" | "back" = "front";
    let depth = 0;
    if (m.mode === "orbit") {
      target = orbitPt(m.th);
      depth = Math.sin(m.th);
      layer = depth > 0 ? "front" : "back";
    } else if (m.mode === "head") {
      target = this.opts.winter
        ? this.headPoint(138, 50)
        : this.headPoint(m.anchor[0], m.anchor[1]);
    } else {
      target = m.anchor;
      layer = m.layer;
    }
    if (m.mode !== "free") {
      const p = clamp((now - m.t0) / 650, 0, 1);
      const ez = easeInOut(p);
      if (p < 1 && m.from) {
        m.x = lerp(m.from[0], target[0], ez);
        m.y = lerp(m.from[1], target[1], ez) - Math.sin(Math.PI * p) * 14;
      } else {
        m.x = target[0];
        m.y = target[1];
      }
    }
    const sc = m.mode === "orbit" ? 1 + 0.13 * depth : 1;
    put(e.nuriFrame, "zIndex", layer === "front" ? "5" : "2");
    put(
      e.nuri,
      "transform",
      `translate(${px(m.x + OX - dx)}, ${px(m.y + OY - dy)}) scale(${fix(sc, 3)})`,
    );
    put(
      e.nuri,
      "opacity",
      layer === "back" && m.mode === "orbit" ? "0.82" : "1",
    );

    // Nuri's roll (±12°, 3.2 s) and glow pulse (.35–.8, 2.8 s): the reference's nRoll / nGlow
    // keyframes as functions of time, stepped with the rest of the engine.
    const secs = now / 1000;
    const roll = this.opts.reduceMotion ? 0 : -12 * Math.cos((TAU * secs) / 3.2);
    put(e.moonRoll, "transform", `rotate(${fix(roll, 1)}deg)`);
    put(e.glow, "opacity", fix(0.575 - 0.225 * Math.cos((TAU * secs) / 2.8), 2));
    for (const r of e.satRolls) put(r, "transform", `rotate(${fix(roll, 1)}deg)`);

    // Pocket satellites share the orbit with Nuri, evenly spaced after it.
    const n = e.sats.length;
    for (let i = 0; i < n; i++) {
      const th = m.th + (TAU * (i + 1)) / (n + 1);
      const [sx0, sy0] = orbitPt(th);
      const d = Math.sin(th);
      put(e.satFrames[i], "zIndex", d > 0 ? "5" : "2");
      put(
        e.sats[i],
        "transform",
        `translate(${px(sx0 + OX - dx)}, ${px(sy0 + OY - dy)}) scale(${fix(1 + 0.13 * d, 3)})`,
      );
      put(e.sats[i], "opacity", d > 0 ? "1" : "0.82");
    }

    // Ring sparkle at ~15 fps (stroke-dashoffset repaints; the lab animates it every frame).
    if (now - this.lastDash > 66) {
      this.lastDash = now;
      for (const ring of [e.ringB, e.ringF]) {
        ring.querySelectorAll<SVGElement>(".dashB, .dashF").forEach((el) => {
          const dur = parseFloat(el.style.animationDuration) || 4;
          const off = (((now / 1000) % dur) / dur) * 24;
          el.style.strokeDashoffset = (
            el.classList.contains("dashF") ? off : -off
          ).toFixed(2);
        });
      }
    }

    this.maybeIdle(now);

    // Fast: hops, shakes and grooves, a drag or a fall, tweens (blinks, mouth morph, Nuri's arc),
    // or any spring still ringing from an impulse. Breathing-speed moods step at the calm rate.
    const ringing =
      Math.abs(S.y.v) > 20 ||
      Math.abs(S.sy.v) > 0.15 ||
      Math.abs(S.sx.v) > 0.15 ||
      Math.abs(S.rot.v) > 8;
    return (
      FAST_MOODS.has(this.mood) ||
      this.dragging ||
      this.falling ||
      this.busy ||
      this.tweens.length > 0 ||
      now - this.moon.t0 < 700 ||
      ringing
    );
  }
}
