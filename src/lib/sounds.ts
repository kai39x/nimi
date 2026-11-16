import boost from "@design/sounds/boost.wav";
import bubblePop from "@design/sounds/bubble_pop.wav";
import doneSuccess from "@design/sounds/done_success.wav";
import errorSoft from "@design/sounds/error_soft.wav";
import nimiChomp from "@design/sounds/nimi_chomp.wav";
import nimiGulp from "@design/sounds/nimi_gulp.wav";
import nimiHop from "@design/sounds/nimi_hop.wav";
import nimiSleep from "@design/sounds/nimi_sleep.wav";
import nimiWake from "@design/sounds/nimi_wake.wav";
import notifyImportant from "@design/sounds/notify_important.wav";
import notifySoft from "@design/sounds/notify_soft.wav";
import nuriTwinkle from "@design/sounds/nuri_twinkle.wav";
import pocketIn from "@design/sounds/pocket_in.wav";
import timerDone from "@design/sounds/timer_done.wav";
import { Events, onEvent } from "@/ipc/events";
import type { OverlayVisibility } from "@/ipc/generated/OverlayVisibility";
import { getSettingsNow } from "./settings";

/**
 * The 14 sounds (spec §11, board 05, `design/sounds/`). Rules: one tap mutes all (panel header,
 * right-click menu, Settings, tray — they all flip `soundsMuted`); 40 % by default, independent of
 * the system volume; quiet in fullscreen and «لا تزعجني»; never two at once — a sound that is at
 * least as important as the one playing wins, a less important one is dropped. No loops.
 */

export type SoundId =
  | "nimi_chomp"
  | "nimi_gulp"
  | "bubble_pop"
  | "pocket_in"
  | "done_success"
  | "error_soft"
  | "notify_soft"
  | "notify_important"
  | "timer_done"
  | "nimi_hop"
  | "nimi_wake"
  | "nimi_sleep"
  | "boost"
  | "nuri_twinkle";

const FILES: Record<SoundId, string> = {
  nimi_chomp: nimiChomp,
  nimi_gulp: nimiGulp,
  bubble_pop: bubblePop,
  pocket_in: pocketIn,
  done_success: doneSuccess,
  error_soft: errorSoft,
  notify_soft: notifySoft,
  notify_important: notifyImportant,
  timer_done: timerDone,
  nimi_hop: nimiHop,
  nimi_wake: nimiWake,
  nimi_sleep: nimiSleep,
  boost: boost,
  nuri_twinkle: nuriTwinkle,
};

/** Higher wins when two would overlap. */
const PRIORITY: Record<SoundId, number> = {
  notify_important: 6,
  timer_done: 5,
  error_soft: 4,
  done_success: 3,
  notify_soft: 3,
  boost: 3,
  nimi_chomp: 2,
  nimi_gulp: 2,
  pocket_in: 2,
  nimi_wake: 2,
  nimi_sleep: 2,
  bubble_pop: 1,
  nimi_hop: 1,
  nuri_twinkle: 1,
};

/** «أصوات الأكل والفقاعات» covers these. */
const FEED: ReadonlySet<SoundId> = new Set(["nimi_chomp", "nimi_gulp", "bubble_pop", "pocket_in"]);

let current: { id: SoundId; audio: HTMLAudioElement } | null = null;
let hiddenForFullscreen = false;
let started = false;
const pool = new Map<SoundId, HTMLAudioElement>();

function ensure() {
  if (started) return;
  started = true;
  onEvent<OverlayVisibility>(Events.overlayVisibility, (v) => {
    hiddenForFullscreen = !v.visible && v.reason === "fullscreen";
  });
}

function audioFor(id: SoundId): HTMLAudioElement {
  let a = pool.get(id);
  if (!a) {
    a = new Audio(FILES[id]);
    a.preload = "auto";
    pool.set(id, a);
  }
  return a;
}

/** Plays `id` if the settings and the moment allow it. `force` skips the mute checks (preview). */
export function play(id: SoundId, opts: { force?: boolean } = {}) {
  ensure();
  const s = getSettingsNow();
  if (!s) return;
  if (!opts.force) {
    if (s.soundsMuted || s.dnd) return;
    if (s.muteFullscreen && hiddenForFullscreen) return;
    if (!s.soundFeed && FEED.has(id)) return;
  }
  if (current && !current.audio.ended && !current.audio.paused) {
    if (PRIORITY[current.id] > PRIORITY[id]) return; // never two at once: the lesser one is dropped
    current.audio.pause();
  }
  const audio = audioFor(id);
  audio.volume = Math.max(0, Math.min(1, s.soundVolume ?? 0.4));
  audio.currentTime = 0;
  current = { id, audio };
  void audio.play().catch(() => {
    if (current?.audio === audio) current = null;
  });
}

/** Warms the files so the first sound is not late (call once from the overlay). */
export function preloadSounds() {
  ensure();
  (Object.keys(FILES) as SoundId[]).forEach(audioFor);
}
