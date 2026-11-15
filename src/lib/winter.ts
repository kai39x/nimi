import type { Settings } from "@/ipc/generated/Settings";

/** Winter decoration (spec §2): auto = Dec 1 → end of Feb by the device date. */
export function isWinter(settings: Pick<Settings, "winter"> | null | undefined, now = new Date()): boolean {
  switch (settings?.winter ?? "auto") {
    case "always":
      return true;
    case "off":
      return false;
    default: {
      const month = now.getMonth(); // 0 = January
      return month === 11 || month === 0 || month === 1;
    }
  }
}

/** Nuri's orbit period multiplier for the activity setting. */
export function nuriPace(activity: Settings["nuriActivity"] | undefined): number {
  switch (activity) {
    case "calm":
      return 1.4;
    case "active":
      return 0.7;
    default:
      return 1;
  }
}
