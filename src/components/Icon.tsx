import "./Icon.css";

/**
 * Inline UI icons from the approved set (`design/icons/ui`, 24 grid, 1.8 stroke, currentColor).
 * Inlined so they take the surrounding text color.
 */
const files = import.meta.glob("@design/icons/ui/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const byName = new Map<string, string>();
for (const [path, svg] of Object.entries(files)) {
  // The exported assets carry C2PA provenance blocks; they are dead weight once inlined.
  const clean = svg.replace(/<metadata[\s\S]*?<\/metadata>/gi, "").replace(/\s+xmlns:c2pa="[^"]*"/g, "");
  byName.set(path.split("/").pop()!.replace(/\.svg$/, ""), clean);
}

export type IconName =
  | "back10" | "battery" | "bell" | "bolt" | "cal" | "calc" | "capsule" | "check" | "chev"
  | "clip" | "convert" | "copy" | "cpu" | "cut" | "disk" | "dl" | "dnd" | "enter" | "erase"
  | "folder" | "fwd10" | "game" | "gear" | "globe" | "gpu" | "grip" | "home" | "image" | "info"
  | "keyboard" | "layers" | "link" | "lock" | "micoff" | "monitor" | "move" | "music" | "mute"
  | "next" | "ocr" | "open" | "pause" | "pick" | "play" | "plus" | "pocket" | "prev" | "ram"
  | "rename" | "search" | "shield" | "shot" | "shrink" | "smile" | "speaker" | "star4" | "stop"
  | "terminal" | "timer" | "trash" | "trophy" | "undo" | "up" | "usb" | "vol" | "wifi" | "x"
  | "zip";

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  const svg = byName.get(name);
  if (!svg) {
    if (import.meta.env.DEV) console.warn(`unknown icon: ${name}`);
    return null;
  }
  return (
    <span
      className={"icon" + (className ? ` ${className}` : "")}
      style={{ width: size, height: size }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
