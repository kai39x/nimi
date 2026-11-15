import { useEffect, useState, useSyncExternalStore } from "react";
import { getMediaArt, getMediaState, getVolume, mediaCommand, setVolume } from "@/ipc/commands";
import { Events, onEvent } from "@/ipc/events";
import type { MediaArt } from "@/ipc/generated/MediaArt";
import type { MediaCommand } from "@/ipc/generated/MediaCommand";
import type { MediaState } from "@/ipc/generated/MediaState";
import type { VolumeState } from "@/ipc/generated/VolumeState";

/**
 * The current media session (SMTC) and the system volume, mirrored from Rust events
 * (docs/PLAN.md §3). One store per window; components read it with the hooks below.
 */

const EMPTY: MediaState = {
  status: "none",
  title: "",
  artist: "",
  album: "",
  sourceApp: "",
  sourceName: "",
  positionMs: 0,
  durationMs: 0,
  lastUpdatedMs: 0,
  rate: 1,
  canPlayPause: false,
  canNext: false,
  canPrev: false,
  canSeek: false,
  artId: null,
};

/** A paused song keeps the capsule in its music look this long, then it goes back to normal. */
const PAUSED_LINGER_MS = 60_000;

interface Store {
  media: MediaState;
  art: MediaArt | null;
  volume: VolumeState;
  /** When playback last stopped being "playing" (for the paused linger). */
  pausedAt: number;
  /** Bumped by the linger timer so subscribers re-evaluate `isMusicActive`. */
  tick: number;
}

let store: Store = {
  media: EMPTY,
  art: null,
  volume: { level: 0, muted: false, available: false },
  pausedAt: 0,
  tick: 0,
};
const listeners = new Set<() => void>();
let started = false;
let lingerTimer = 0;

function set(patch: Partial<Store>) {
  store = { ...store, ...patch };
  listeners.forEach((fn) => fn());
}

function setMedia(media: MediaState) {
  const wasPlaying = store.media.status === "playing";
  const pausedAt = media.status === "playing" ? 0 : wasPlaying ? Date.now() : store.pausedAt;
  set({ media, pausedAt });
  window.clearTimeout(lingerTimer);
  if (pausedAt) lingerTimer = window.setTimeout(() => set({ tick: store.tick + 1 }), PAUSED_LINGER_MS + 50);
}

function start() {
  if (started) return;
  started = true;
  onEvent<MediaState>(Events.mediaState, setMedia);
  onEvent<MediaArt>(Events.mediaArt, (art) => set({ art }));
  onEvent<VolumeState>(Events.mediaVolume, (volume) => set({ volume }));
  getMediaState().then(setMedia).catch(console.error);
  getMediaArt()
    .then((art) => set({ art }))
    .catch(console.error);
  getVolume()
    .then((volume) => set({ volume }))
    .catch(console.error);
}

function useStore(): Store {
  start();
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => store,
  );
}

/** A session that has a song (playing, paused or loading). */
export function hasSong(m: MediaState): boolean {
  return m.status !== "none" && m.status !== "stopped" && (m.title !== "" || m.artist !== "");
}

export function useMedia(): MediaState {
  return useStore().media;
}

/** Album art for the current song, or null (the music-note placeholder shows). */
export function useMediaArt(): string | null {
  const { media, art } = useStore();
  return art && media.artId === art.id ? art.dataUrl : null;
}

export function useVolume(): VolumeState {
  return useStore().volume;
}

/**
 * The capsule shows its music look (art · NIMI · equalizer · time) while a song plays, and for a
 * minute after it is paused.
 */
export function useMusicActive(): boolean {
  const { media, pausedAt } = useStore();
  if (!hasSong(media)) return false;
  if (media.status === "playing" || media.status === "changing") return true;
  return pausedAt === 0 || Date.now() - pausedAt < PAUSED_LINGER_MS;
}

/** Position in ms, interpolated while playing (apps only push it every few seconds). */
export function positionAt(m: MediaState, now = Date.now()): number {
  const base = m.positionMs + (m.status === "playing" ? Math.max(0, now - m.lastUpdatedMs) * m.rate : 0);
  return m.durationMs > 0 ? Math.min(base, m.durationMs) : base;
}

/** The interpolated position, refreshed every `everyMs` while `active` and playing. */
export function usePosition(m: MediaState, active: boolean, everyMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active || m.status !== "playing") return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setNow(Date.now());
    }, everyMs);
    return () => window.clearInterval(id);
  }, [active, m.status, m.positionMs, m.lastUpdatedMs, everyMs]);
  return positionAt(m, now);
}

export function fmtTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export const media = {
  command: (cmd: MediaCommand) => void mediaCommand(cmd).catch(console.error),
  playPause: () => media.command({ kind: "playPause" }),
  next: () => media.command({ kind: "next" }),
  previous: () => media.command({ kind: "previous" }),
  seekTo: (ms: number) => media.command({ kind: "seekTo", ms: Math.round(ms) }),
  seekBy: (ms: number) => media.command({ kind: "seekBy", ms }),
  /** Sets the system volume at once in the store (the slider stays smooth) and in Windows. */
  setVolume: (level: number) => {
    const clamped = Math.max(0, Math.min(1, level));
    set({ volume: { ...store.volume, level: clamped } });
    void setVolume(clamped).catch(console.error);
  },
  volume: () => store.volume,
};
