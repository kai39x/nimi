/**
 * Requests other features make of the shell (the one surface): open the command bar, close the
 * panel and run a screen tool, flash a pill under the capsule, open the panel on a tab. The shell
 * subscribes once.
 */

export type ShellTab = "home" | "music" | "system" | "shortcuts" | "notifications" | "games";

export type ShellRequest =
  | { kind: "command"; prefill?: string }
  | { kind: "tool"; tool: "screenshot" | "colorPicker" | "lock" }
  | { kind: "toast"; text: string; tone?: "butter" }
  | { kind: "tab"; tab: ShellTab };

const listeners = new Set<(r: ShellRequest) => void>();

/** One-shot hand-over to the tab being opened (the system tab's largest-files view). */
let pendingLargest: string | null = null;

export function onShellRequest(fn: (r: ShellRequest) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The system tab asks once, when it mounts, whether it should open «أكبر الملفات» for a drive. */
export function takeLargestFilesRequest(): string | null {
  const d = pendingLargest;
  pendingLargest = null;
  return d;
}

export const shellActions = {
  openCommand: (prefill = "") => listeners.forEach((fn) => fn({ kind: "command", prefill })),
  runTool: (tool: "screenshot" | "colorPicker" | "lock") => listeners.forEach((fn) => fn({ kind: "tool", tool })),
  toast: (text: string, tone?: "butter") => listeners.forEach((fn) => fn({ kind: "toast", text, tone })),
  openTab: (tab: ShellTab, opts?: { largestFiles?: string }) => {
    pendingLargest = opts?.largestFiles ?? null;
    listeners.forEach((fn) => fn({ kind: "tab", tab }));
  },
};
