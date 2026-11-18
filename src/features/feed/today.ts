import { useSyncExternalStore } from "react";
import type { TKey } from "@/i18n";
import type { FeedAction } from "@/ipc/generated/FeedAction";

/**
 * Home's «أكلات اليوم» and «آخر شي سواه»: files fed to NIMI today and the last thing he did with
 * them. Kept on this device (localStorage) and reset on a new local day.
 */
type Today = { day: string; meals: number; last: TKey | null };

const KEY = "nimi.today";

/** Short names of what he did, as on the bubbles. */
export const ACTION_LABEL: Record<FeedAction, TKey> = {
  copy: "feed.copy",
  cut: "feed.cut",
  copyPath: "feed.path",
  zip: "feed.zip",
  move: "feed.move",
  convert: "feed.convert",
  shrink: "feed.shrink",
  ocrText: "feed.ocr",
  stripMeta: "feed.strip",
  extractHere: "feed.extractHere",
  extractTo: "feed.extractTo",
  listArchive: "feed.list",
  folderSize: "feed.size",
  terminal: "feed.terminal",
  pdfMerge: "feed.merge",
  pdfPages: "feed.pages",
  pdfCompress: "feed.compress",
  imagesToPdf: "feed.toOnePdf",
  openLink: "feed.open",
  linkShortcut: "feed.shortcut",
  copyText: "feed.copy",
  saveNote: "feed.saveNote",
  wordCount: "feed.count",
};

function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function load(): Today {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const t = JSON.parse(raw) as Today;
      if (t.day === localDay() && Number.isFinite(t.meals)) return t;
    }
  } catch {
    /* storage unavailable or old data: start the day fresh */
  }
  return { day: localDay(), meals: 0, last: null };
}

let today = load();
const listeners = new Set<() => void>();

/** NIMI ate `files` file(s) (or a dropped text / link) and did `what` with them. */
export function recordMeal(files: number, what: TKey) {
  const base = today.day === localDay() ? today : { day: localDay(), meals: 0, last: null };
  today = { day: base.day, meals: base.meals + Math.max(1, files), last: what };
  try {
    localStorage.setItem(KEY, JSON.stringify(today));
  } catch {
    /* not saved: the count still shows until NIMI restarts */
  }
  listeners.forEach((l) => l());
}

function snapshot(): Today {
  if (today.day !== localDay()) today = { day: localDay(), meals: 0, last: null };
  return today;
}

export function useToday(): Today {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    snapshot,
  );
}
