import { useSyncExternalStore } from "react";
import type { IconName } from "@/components/Icon";
import type { Lang, TKey } from "@/i18n";
import { launch, notifyList, openFolder, openSettingsPage } from "@/ipc/commands";
import { Events, onEvent } from "@/ipc/events";
import type { Notification } from "@/ipc/generated/Notification";
import type { NotifyLevel } from "@/ipc/generated/NotifyLevel";
import type { Mood } from "@/features/character/rig/moods";
import { shellActions } from "@/features/shell/actions";
import { timers } from "@/features/shortcuts/timer";
import { fmtBytes } from "@/features/system/system";
import { fmtNumber, fmtPercent } from "@/lib/format";

/**
 * Notifications (spec §5 «تنبيهات», board 14). Rust keeps the list and the watchers; this mirrors
 * the list and turns each fact into a sentence, an icon and one action button.
 */

let list: Notification[] = [];
let started = false;
const listeners = new Set<() => void>();
const newListeners = new Set<(n: Notification) => void>();

function publish(next: Notification[]) {
  list = next;
  listeners.forEach((fn) => fn());
}

function ensure() {
  if (started) return;
  started = true;
  onEvent<Notification[]>(Events.notifyList, publish);
  onEvent<Notification>(Events.notifyNew, (n) => newListeners.forEach((fn) => fn(n)));
  void notifyList().then(publish);
}

export function useNotifications(): Notification[] {
  ensure();
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => list,
  );
}

export function onNotifyNew(fn: (n: Notification) => void): () => void {
  ensure();
  newListeners.add(fn);
  return () => newListeners.delete(fn);
}

export const levelOf = (n: Notification): NotifyLevel => n.level ?? "normal";

/** The most important unread one (for Home's alert card and the status pill). */
export function topUnread(items: Notification[]): Notification | null {
  const rank = { important: 0, normal: 1, calm: 2 } as const;
  return [...items].filter((n) => !n.read).sort((a, b) => rank[levelOf(a)] - rank[levelOf(b)] || b.atMs - a.atMs)[0] ?? null;
}

export type Described = {
  icon: IconName;
  title: string;
  sub: string;
  /** Shorter line for the capsule (board 06: «12 GB متبقية · اضغط للتفاصيل»). */
  capsuleSub: string;
  action?: { label: string; run: () => void };
};

/** Keeps «71 GB» in order inside an Arabic sentence. */
const iso = (s: string) => `⁨${s}⁩`;

const RUNNABLE = /\.(exe|msi|msix|appx|bat|cmd|ps1|vbs|js|jar|scr|com)$/i;

/** NIMI's face for a calm («هادي») notification: an expression and nothing else. */
export function moodFor(n: Notification): Mood {
  switch (n.kind) {
    case "download":
    case "netBack":
    case "powerIn":
      return "happy";
    case "usbIn":
      return "curious";
    case "usbOut":
    case "powerOut":
      return "surprised";
    case "diskLow":
    case "batteryLow":
      return "scared";
    case "timerDone":
    case "pomodoroDone":
      return "celebrate";
    default:
      return "attention";
  }
}

export function describe(n: Notification, t: (k: TKey) => string, lang: Lang): Described {
  const num = (v: number) => fmtNumber(v, lang);
  const sub = (s: string) => s;
  const r = (k: TKey) =>
    t(k)
      .replace("{s}", n.kind === "diskLow" ? (n.name ?? "").replace(/:$/, "") : (n.name ?? ""))
      .replace("{r}", num(n.round ?? 1))
      .replace("{n}", num(n.rounds ?? 4))
      .replace("{p}", n.percent != null ? fmtPercent(n.percent / 100, lang) : "")
      .replace("{free}", n.size != null ? iso(fmtBytes(n.size)) : "")
      .replace("{total}", n.total != null ? iso(fmtBytes(n.total)) : "")
      .replace("{size}", n.size != null ? iso(fmtBytes(n.size)) : "");
  const timerTab = { label: t("notify.act.timer"), run: () => shellActions.openTab("shortcuts") };
  switch (n.kind) {
    case "diskLow":
      return {
        icon: "disk",
        title: r("notify.diskLow"),
        sub: r("notify.diskLow.sub"),
        capsuleSub: r("notify.diskLow.capsule"),
        action: { label: t("notify.act.largest"), run: () => shellActions.openTab("system", { largestFiles: n.name ?? undefined }) },
      };
    case "cpuHigh":
    case "ramHigh": {
      const key = (n.kind === "cpuHigh" ? "notify.cpuHigh" : "notify.ramHigh") as TKey;
      const line = n.name ? r("notify.load.subApp") : r("notify.load.sub");
      return {
        icon: n.kind === "cpuHigh" ? "cpu" : "ram",
        title: r(key),
        sub: line,
        capsuleSub: line,
        action: { label: t("notify.act.apps"), run: () => shellActions.openTab("system") },
      };
    }
    case "timerDone":
      return {
        icon: "timer",
        title: t("notify.timerDone"),
        sub: n.name ?? t("notify.timerDone.sub"),
        capsuleSub: n.name ?? t("notify.timerDone.sub"),
        action: { label: t("notify.act.newTimer"), run: () => shellActions.openCommand(lang === "ar" ? "مؤقت " : "timer ") },
      };
    case "pomodoroBreak":
      return { icon: "timer", title: t("notify.pomoBreak"), sub: r("notify.pomo.sub"), capsuleSub: r("notify.pomo.sub"), action: timerTab };
    case "pomodoroWork":
      return { icon: "timer", title: r("notify.pomoWork"), sub: r("notify.pomo.sub"), capsuleSub: r("notify.pomo.sub"), action: timerTab };
    case "pomodoroDone":
      return {
        icon: "trophy",
        title: t("notify.pomoDone"),
        sub: r("notify.pomoDone.sub"),
        capsuleSub: r("notify.pomoDone.sub"),
        action: { label: t("notify.act.again"), run: () => void timers.startPomodoro() },
      };
    case "reminder":
      return { icon: "bell", title: t("notify.reminder"), sub: n.name ?? "", capsuleSub: n.name ?? "" };
    case "download": {
      const path = n.path ?? "";
      return {
        icon: "dl",
        title: t("notify.download"),
        sub: sub(`${iso(n.name ?? "")} · ${n.size != null ? iso(fmtBytes(n.size)) : ""}`),
        capsuleSub: `⁨${n.name ?? ""}⁩`,
        // Never run an installer from a notification: show it in its folder instead.
        action: path ? { label: t("notify.act.open"), run: () => void (RUNNABLE.test(path) ? openFolder(path) : launch(path).catch(() => openFolder(path))) } : undefined,
      };
    }
    case "usbIn":
      return {
        icon: "usb",
        title: t("notify.usbIn"),
        sub: `⁨${n.name ?? ""}⁩`,
        capsuleSub: `⁨${n.name ?? ""}⁩`,
        action: n.path ? { label: t("notify.act.open"), run: () => void launch(n.path!) } : undefined,
      };
    case "usbOut":
      return { icon: "usb", title: t("notify.usbOut"), sub: `⁨${n.name ?? ""}⁩`, capsuleSub: `⁨${n.name ?? ""}⁩` };
    case "netLost":
      return {
        icon: "wifi",
        title: t("notify.netLost"),
        sub: t("notify.netLost.sub"),
        capsuleSub: t("notify.netLost.sub"),
        action: { label: t("notify.act.network"), run: () => void openSettingsPage("ms-settings:network-status") },
      };
    case "netBack":
      return { icon: "wifi", title: t("notify.netBack"), sub: t("notify.netBack.sub"), capsuleSub: t("notify.netBack.sub") };
    case "batteryLow":
      return {
        icon: "battery",
        title: t("notify.batteryLow"),
        sub: r("notify.batteryLow.sub"),
        capsuleSub: r("notify.batteryLow.sub"),
        action: { label: t("notify.act.battery"), run: () => void openSettingsPage("ms-settings:batterysaver") },
      };
    case "powerIn":
    case "powerOut":
      return { icon: "battery", title: t(n.kind === "powerIn" ? "notify.powerIn" : "notify.powerOut"), sub: r("notify.power.sub"), capsuleSub: r("notify.power.sub") };
    default:
      return { icon: "bell", title: "", sub: "", capsuleSub: "" };
  }
}
