import { useSyncExternalStore } from "react";
import { getScan, getSystemStats, startScan } from "@/ipc/commands";
import { Events, onEvent } from "@/ipc/events";
import type { AppCategory } from "@/ipc/generated/AppCategory";
import type { ScanProgress } from "@/ipc/generated/ScanProgress";
import type { ScanResult } from "@/ipc/generated/ScanResult";
import type { SystemStats } from "@/ipc/generated/SystemStats";
import type { Lang, TKey } from "@/i18n";
import { fmtNumber } from "@/lib/format";

/**
 * System data mirrored from Rust (phase 5): the latest sample, a 60 s history for the
 * sparklines, and the largest-files scan per drive. One store per window; Rust samples every
 * 2 s while the panel is open and every 10 s when compact (spec §15).
 */

export const HISTORY_MS = 60_000;

export interface Point {
  at: number;
  cpu: number;
  ram: number;
  gpu: number | null;
}

interface Store {
  stats: SystemStats | null;
  history: Point[];
  scans: Record<string, { progress: ScanProgress | null; result: ScanResult | null }>;
}

let store: Store = { stats: null, history: [], scans: {} };
const listeners = new Set<() => void>();
let started = false;

function set(patch: Partial<Store>) {
  store = { ...store, ...patch };
  listeners.forEach((fn) => fn());
}

function addStats(stats: SystemStats) {
  const at = stats.atMs;
  const point: Point = { at, cpu: stats.cpu.usage, ram: stats.ram.usage, gpu: stats.gpu?.usage ?? null };
  const history = [...store.history.filter((p) => at - p.at <= HISTORY_MS), point];
  set({ stats, history });
}

function setScan(drive: string, patch: Partial<Store["scans"][string]>) {
  const prev = store.scans[drive] ?? { progress: null, result: null };
  set({ scans: { ...store.scans, [drive]: { ...prev, ...patch } } });
}

function start() {
  if (started) return;
  started = true;
  onEvent<SystemStats>(Events.systemStats, addStats);
  onEvent<ScanProgress>(Events.systemScan, (progress) => {
    setScan(progress.drive, { progress });
    if (progress.phase === "done") void refreshScan(progress.drive);
  });
  getSystemStats()
    .then((s) => s && addStats(s))
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

export function useSystem() {
  return useStore();
}

/** The current scan state of a drive, outside render. */
export function scanState(drive: string) {
  return store.scans[drive];
}

/** Re-reads one drive's scan state from Rust (after a scan or a move / recycle). */
export async function refreshScan(drive: string) {
  const [progress, result] = await getScan(drive);
  setScan(drive, { progress, result });
}

export async function scanDrive(drive: string) {
  setScan(drive, { progress: { drive, phase: "running", files: 0, bytes: 0, bytesTotal: 0, current: "" } });
  await startScan(drive);
}

// --- formatting --------------------------------------------------------------------------------

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** «12 GB», «410 MB» — Latin digits and units, as on board 12. */
export function fmtBytes(bytes: number, digits = 1): string {
  let v = Math.max(0, bytes);
  let u = 0;
  while (v >= 1000 && u < UNITS.length - 1) {
    v /= 1024;
    u++;
  }
  const shown = v >= 100 || u === 0 ? Math.round(v).toString() : v.toFixed(digits).replace(/\.0$/, "");
  return `${shown} ${UNITS[u]}`;
}

export function fmtPct(value: number): string {
  return `${Math.round(value)}%`;
}

/** «قبل شهر» / «a month ago». */
export function relTime(ms: number, lang: Lang, t: (k: TKey) => string): string {
  if (!ms) return "";
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  const n = (v: number) => fmtNumber(v, lang);
  if (days < 1) return t("sys.time.today");
  if (days < 2) return t("sys.time.yesterday");
  if (days < 7) return t("sys.time.days").replace("{n}", n(days));
  if (days < 14) return t("sys.time.week");
  if (days < 30) return t("sys.time.weeks").replace("{n}", n(Math.floor(days / 7)));
  if (days < 60) return t("sys.time.month");
  if (days < 365) {
    const months = Math.floor(days / 30);
    // Arabic counts 3–10 with the plural, 11 and up with the singular («١٢ شهر»).
    return t(months >= 11 ? "sys.time.monthsMany" : "sys.time.months").replace("{n}", n(months));
  }
  return t("sys.time.long");
}

/** «المتصفح» for any browser, «مشغّل الألعاب» for launchers, else the app's own name. */
export function appLabel(app: { name: string; category: AppCategory | null }, t: (k: TKey) => string): string {
  if (app.category === "browser") return t("sys.app.browser");
  if (app.category === "launcher") return t("sys.app.launcher");
  return app.name;
}
