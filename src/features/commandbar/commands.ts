import type { IconName } from "@/components/Icon";
import type { TKey } from "@/i18n";
import { calc, convert, fmtResult, fold, looksLikeMath, readDuration } from "./calc";

/**
 * The command bar's vocabulary (spec §8, board 10). Every command has Arabic and English words;
 * the first word of the input picks the command, the rest are its arguments. Anything else is a
 * search: user shortcuts, apps, folders («افتح» without the word), and a «دوّر» row for files.
 */

export type CommandId =
  | "timer"
  | "pomodoro"
  | "remind"
  | "zip"
  | "shot"
  | "color"
  | "mute"
  | "lock"
  | "open"
  | "find"
  | "calc"
  | "clipboard"
  | "settings";

export type CommandDef = { id: CommandId; words: string[]; icon: IconName; label: TKey };

/** Order = the list shown on an empty bar (board 10, «الأوامر الأساسية»). */
export const COMMANDS: CommandDef[] = [
  { id: "timer", words: ["timer", "مؤقت"], icon: "timer", label: "cmd.list.timer" },
  { id: "remind", words: ["remind", "ذكرني"], icon: "bell", label: "cmd.list.remind" },
  { id: "zip", words: ["zip", "ضغط"], icon: "zip", label: "cmd.list.zip" },
  { id: "shot", words: ["shot", "لقطة"], icon: "shot", label: "cmd.list.shot" },
  { id: "color", words: ["color", "لون"], icon: "pick", label: "cmd.list.color" },
  { id: "mute", words: ["mute", "كتم"], icon: "mute", label: "cmd.list.mute" },
  { id: "lock", words: ["lock", "قفل"], icon: "lock", label: "cmd.list.lock" },
  { id: "open", words: ["open", "افتح"], icon: "open", label: "cmd.list.open" },
  { id: "find", words: ["find", "دوّر"], icon: "search", label: "cmd.list.find" },
  { id: "calc", words: ["="], icon: "calc", label: "cmd.list.calc" },
  { id: "pomodoro", words: ["pomodoro", "بومودورو"], icon: "timer", label: "cmd.list.pomodoro" },
  { id: "clipboard", words: ["clipboard", "الحافظة"], icon: "clip", label: "cmd.list.clipboard" },
  { id: "settings", words: ["settings", "الإعدادات"], icon: "gear", label: "cmd.list.settings" },
];

/** Extra spellings people type («دور», «ذكّرني», «screenshot»…), folded. */
const ALIASES: Record<string, CommandId> = {
  دور: "find",
  ابحث: "find",
  search: "find",
  ذكرني: "remind",
  reminder: "remind",
  screenshot: "shot",
  snip: "shot",
  لقطه: "shot",
  colour: "color",
  picker: "color",
  الوان: "color",
  مؤقت: "timer",
  تايمر: "timer",
  calc: "calc",
  حاسبه: "calc",
  clip: "clipboard",
  حافظه: "clipboard",
  الحافظه: "clipboard",
  اعدادات: "settings",
  الاعدادات: "settings",
  run: "open",
  شغل: "open",
};

const WORDS = new Map<string, CommandId>();
for (const c of COMMANDS) for (const w of c.words) WORDS.set(fold(w), c.id);
for (const [w, id] of Object.entries(ALIASES)) WORDS.set(fold(w), id);

export type Parsed =
  | { kind: "empty" }
  | { kind: "command"; id: CommandId; args: string; word: string }
  | { kind: "calc"; value: number; text: string }
  | { kind: "convert"; text: string; unitAr: string; unitEn: string }
  | { kind: "search"; query: string; prefixOf: CommandDef[] };

export function parse(input: string): Parsed {
  const raw = input.trim();
  if (!raw) return { kind: "empty" };

  const conversion = convert(raw);
  if (conversion) return { kind: "convert", ...conversion };

  if (raw.startsWith("=")) {
    const v = calc(raw.slice(1));
    return v == null ? { kind: "command", id: "calc", args: raw.slice(1).trim(), word: "=" } : { kind: "calc", value: v, text: fmtResult(v) };
  }
  if (looksLikeMath(raw)) {
    const v = calc(raw);
    if (v != null) return { kind: "calc", value: v, text: fmtResult(v) };
  }

  const space = raw.search(/\s/);
  const first = space < 0 ? raw : raw.slice(0, space);
  const args = space < 0 ? "" : raw.slice(space + 1).trim();
  const id = WORDS.get(fold(first));
  if (id) return { kind: "command", id, args, word: first };

  // Still typing a command word («تا», «ti»): offer those commands first.
  const f = fold(raw);
  const prefixOf = COMMANDS.filter((c) => c.words.some((w) => fold(w).startsWith(f) && f.length >= 1 && w !== "="));
  return { kind: "search", query: raw, prefixOf };
}

/** «ذكرني بعد ١٠ دقايق أشرب موية» → { minutes: 10, label: "أشرب موية" }. */
export function parseReminder(args: string): { minutes: number | null; label: string } {
  const s = args.replace(/^(me\s+)?(in\s+|after\s+|بعد\s+)?/i, "");
  const d = readDuration(s);
  if (!d) return { minutes: null, label: s.trim() };
  const label = d.rest.replace(/^(to\s+|that\s+|ب\s*|ان\s+|اني\s+|إني\s+)/i, "").trim();
  return { minutes: d.minutes, label };
}

/** Edit distance where swapping two neighbours counts once («tmier» → «timer» is 1). */
function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
    }
  return dp[a.length][b.length];
}

/** «ما لقيت شي… تقصد timer؟»: the closest command word to the first word typed. */
export function didYouMean(input: string): string | null {
  const first = fold(input.trim().split(/\s+/)[0] ?? "");
  if (first.length < 2) return null;
  let best: { word: string; d: number } | null = null;
  for (const c of COMMANDS)
    for (const w of c.words) {
      if (w === "=") continue;
      const d = distance(first, fold(w));
      if (!best || d < best.d) best = { word: w, d };
    }
  return best && best.d <= Math.max(1, Math.floor(first.length / 3)) ? best.word : null;
}
