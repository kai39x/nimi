/**
 * The 17 moods (design spec §2, board 02): which eyes, mouth, blush, orbit style and Nuri
 * behaviour each one uses. Mirrors `MOODS` in `nimi_rig_generator.py`.
 */
import type { BlushLevel, EyeKind, MoonFace, MouthKind, OrbitStyle } from "./parts";

export const MOODS = [
  "idle",
  "sleeping",
  "happy",
  "curious",
  "surprised",
  "excited",
  "working",
  "error",
  "music",
  "attention",
  "bored",
  "grabbed",
  "dizzy",
  "shy",
  "hungry",
  "chomp",
  "chew",
] as const;

export type Mood = (typeof MOODS)[number];

export type MoonSpec =
  /** Nuri orbits: one revolution every `dur` seconds, starting at `phase` (0..1). */
  | { kind: "orbit"; face: MoonFace; dur: number; phase: number }
  /** Nuri parks somewhere (peeks, hides, falls…), in front of or behind the body. */
  | { kind: "static"; face: MoonFace; x: number; y: number; layer: "front" | "back" }
  /** Nuri sleeps on NIMI's head (on the beanie in winter). */
  | { kind: "head"; face: MoonFace; x: number; y: number };

export interface MoodSpec {
  eyes: EyeKind;
  mouth: MouthKind;
  blush: BlushLevel;
  moon: MoonSpec;
  orbit: OrbitStyle;
}

const orbit = (face: MoonFace, dur: number, phase: number): MoonSpec => ({ kind: "orbit", face, dur, phase });
const parked = (face: MoonFace, x: number, y: number, layer: "front" | "back"): MoonSpec => ({
  kind: "static",
  face,
  x,
  y,
  layer,
});

export const MOOD_SPECS: Record<Mood, MoodSpec> = {
  idle: { eyes: "star", mouth: "smile", blush: "soft", moon: orbit("sleep", 9, 0.12), orbit: "normal" },
  sleeping: { eyes: "closed", mouth: "o", blush: "soft", moon: { kind: "head", face: "sleep", x: 112, y: 59 }, orbit: "faint" },
  happy: { eyes: "happy", mouth: "open", blush: "warm", moon: orbit("happy", 4.5, 0.15), orbit: "normal" },
  curious: { eyes: "curious", mouth: "side-o", blush: "soft", moon: parked("open", 168, 108, "front"), orbit: "normal" },
  surprised: { eyes: "big", mouth: "O", blush: "soft", moon: parked("wow", 190, 54, "front"), orbit: "loose" },
  excited: { eyes: "sparkle", mouth: "big", blush: "warm", moon: orbit("happy", 2.2, 0.1), orbit: "normal" },
  working: { eyes: "focus", mouth: "side", blush: "faint", moon: orbit("open", 1.3, 0.2), orbit: "normal" },
  error: { eyes: "worried", mouth: "wavy", blush: "faint", moon: parked("worried", 38, 200, "front"), orbit: "error" },
  music: { eyes: "music", mouth: "sing", blush: "warm", moon: orbit("happy", 2.4, 0.1), orbit: "normal" },
  attention: { eyes: "attention", mouth: "small-open", blush: "soft", moon: parked("wow", 176, 100, "front"), orbit: "normal" },
  bored: { eyes: "bored", mouth: "flat", blush: "faint", moon: orbit("sleep", 16, 0.46), orbit: "normal" },
  grabbed: { eyes: "squeeze", mouth: "grab", blush: "warm", moon: parked("wow", 30, 86, "front"), orbit: "none" },
  dizzy: { eyes: "spiral", mouth: "wavy", blush: "soft", moon: orbit("worried", 1.5, 0.05), orbit: "loose" },
  shy: { eyes: "shy", mouth: "shy", blush: "hot", moon: parked("open", 150, 90, "back"), orbit: "normal" },
  hungry: { eyes: "sparkle", mouth: "wide", blush: "warm", moon: parked("wow", 188, 98, "front"), orbit: "loose" },
  chomp: { eyes: "happy", mouth: "puff", blush: "warm", moon: orbit("wow", 3, 0.15), orbit: "normal" },
  chew: { eyes: "music", mouth: "munch", blush: "warm", moon: orbit("happy", 1.5, 0.1), orbit: "normal" },
};

/** Orbit period used for ring particles and satellites when Nuri itself is parked. */
export const DEFAULT_ORBIT_SECONDS = 9;
