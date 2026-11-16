/**
 * Requests other features make of the shell (the one surface): open the command bar, close the
 * panel and run a screen tool, flash a pill under the capsule. The shell subscribes once.
 */

export type ShellRequest =
  | { kind: "command"; prefill?: string }
  | { kind: "tool"; tool: "screenshot" | "colorPicker" | "lock" }
  | { kind: "toast"; text: string; tone?: "butter" };

const listeners = new Set<(r: ShellRequest) => void>();

export function onShellRequest(fn: (r: ShellRequest) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const shellActions = {
  openCommand: (prefill = "") => listeners.forEach((fn) => fn({ kind: "command", prefill })),
  runTool: (tool: "screenshot" | "colorPicker" | "lock") => listeners.forEach((fn) => fn({ kind: "tool", tool })),
  toast: (text: string, tone?: "butter") => listeners.forEach((fn) => fn({ kind: "toast", text, tone })),
};
