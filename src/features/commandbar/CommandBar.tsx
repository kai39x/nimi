import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { useT, type Lang, type TKey } from "@/i18n";
import {
  appsSearch,
  clipCopy,
  commandBarOpened,
  copyText,
  filesSearch,
  launch,
  micState,
  micToggle,
  openFolder,
  openKnownFolder,
  openSettingsWindow,
  runUserShortcut,
  setVolumeMuted,
  toolRun,
  zipExplorerSelection,
} from "@/ipc/commands";
import type { AppHit } from "@/ipc/generated/AppHit";
import type { FileHit } from "@/ipc/generated/FileHit";
import type { KnownFolder } from "@/ipc/generated/KnownFolder";
import type { MicState } from "@/ipc/generated/MicState";
import { fmtNumber, fmtPercent } from "@/lib/format";
import { useSettings } from "@/lib/settings";
import { useVolume } from "@/features/music/media";
import { useClips } from "@/features/shortcuts/clipboard";
import { timers } from "@/features/shortcuts/timer";
import { fmtBytes } from "@/features/system/system";
import { fold } from "./calc";
import { COMMANDS, didYouMean, parse, parseReminder } from "./commands";
import "./commandbar.css";

/** What a finished command tells the shell: a pill to flash, NIMI's mood. */
export type Outcome = {
  toast: string;
  tone?: "butter";
  /** NIMI looks pleased (else neutral; an error sentence makes him sorry). */
  ok?: boolean;
  /** Run after the bar has closed, so it never shows in the snip / under the picker. */
  tool?: "screenshot" | "colorPicker";
};

type Row = {
  key: string;
  icon: IconName;
  title: string;
  sub?: string;
  /** LTR content (file names, app names, results) inside Arabic UI. */
  ltr?: boolean;
  /** Tab (and Enter when there is no `run`) puts this in the input. */
  fill?: string;
  run?: (mods: { ctrl: boolean }) => Promise<Outcome | null> | Outcome | null;
};

const FOLDERS: Array<{ id: KnownFolder; key: TKey; words: string[] }> = [
  { id: "downloads", key: "folder.downloads", words: ["downloads", "التنزيلات", "تنزيلات", "التحميلات"] },
  { id: "documents", key: "folder.documents", words: ["documents", "المستندات", "مستندات"] },
  { id: "desktop", key: "folder.desktop", words: ["desktop", "سطح المكتب"] },
  { id: "pictures", key: "folder.pictures", words: ["pictures", "photos", "الصور", "صور"] },
  { id: "videos", key: "folder.videos", words: ["videos", "الفيديوهات", "فيديو"] },
  { id: "music", key: "folder.music", words: ["music", "الموسيقى", "موسيقى"] },
];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** «دقيقة / دقيقتين / ١٠ دقايق / ٢٥ دقيقة» — Gulf Arabic counts; «5 min» in English. */
function plural(t: (k: TKey) => string, n: number, lang: Lang): string {
  const v = Math.round(n * 10) / 10;
  if (lang === "ar") {
    if (v === 1) return t("cmd.minute.one");
    if (v === 2) return t("cmd.minute.two");
    if (Number.isInteger(v) && v >= 3 && v <= 10) return t("cmd.minute.few").replace("{n}", fmtNumber(v, lang));
  }
  return t("cmd.minutes").replace("{n}", fmtNumber(v, lang));
}

/**
 * Command bar (spec §8, board 10): a glass bar under NIMI, opened by double Ctrl. Arabic or
 * English commands; ↑↓ move, Enter runs, Tab completes, Esc closes. User shortcuts are commands.
 */
export function CommandBar({
  open,
  prefill,
  onDone,
  onHeight,
}: {
  open: boolean;
  prefill: string;
  onDone: (outcome: Outcome | null) => void;
  onHeight: (px: number) => void;
}) {
  const t = useT();
  const settings = useSettings();
  const lang: Lang = settings?.language ?? "ar";
  const volume = useVolume();
  const clips = useClips();
  const [text, setText] = useState(prefill);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [mic, setMic] = useState<MicState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Fresh every time it opens.
  useEffect(() => {
    if (!open) return;
    setText(prefill);
    setActive(0);
    setBusy(false);
    void commandBarOpened();
    void micState().then(setMic);
    // The window gets OS focus a moment after the bar opens (the hotkey path takes longest):
    // focus the input then, and again on the window's own focus event.
    const focus = () => {
      const el = inputRef.current;
      if (!el || document.activeElement === el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    };
    const ids = [60, 200, 450].map((ms) => window.setTimeout(focus, ms));
    window.addEventListener("focus", focus);
    return () => {
      ids.forEach((id) => window.clearTimeout(id));
      window.removeEventListener("focus", focus);
    };
  }, [open, prefill]);

  // Double Ctrl again closes the bar. Windows doesn't hand our own keys to the low-level hook
  // while NIMI has focus, so the bar watches for the second double tap itself.
  const hotkey = settings?.commandHotkey ?? "doubleCtrl";
  useEffect(() => {
    if (!open || hotkey === "off") return;
    const key = hotkey === "doubleAlt" ? "Alt" : hotkey === "doubleShift" ? "Shift" : "Control";
    let downAt = 0;
    let dirty = false;
    let lastTap = 0;
    const down = (e: globalThis.KeyboardEvent) => {
      if (e.key === key) {
        if (!e.repeat) {
          downAt = performance.now();
          dirty = false;
        }
      } else {
        dirty = true;
        lastTap = 0;
      }
    };
    const up = (e: globalThis.KeyboardEvent) => {
      if (e.key !== key) return;
      const now = performance.now();
      if (!dirty && now - downAt <= 300) {
        if (now - lastTap <= 400) {
          lastTap = 0;
          onDone(null);
        } else lastTap = now;
      } else lastTap = 0;
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
    };
  }, [open, hotkey, onDone]);

  const parsed = useMemo(() => parse(text), [text]);

  // --- async results: apps («افتح», plain search) and files («دوّر») ---------------------------
  const appQuery = parsed.kind === "command" && parsed.id === "open" ? parsed.args : parsed.kind === "search" ? parsed.query : "";
  const fileQuery = parsed.kind === "command" && parsed.id === "find" ? parsed.args : "";
  const dApp = useDebounced(appQuery, 90);
  const dFile = useDebounced(fileQuery, 160);
  const [apps, setApps] = useState<{ q: string; hits: AppHit[] }>({ q: "", hits: [] });
  const [files, setFiles] = useState<{ q: string; hits: FileHit[] | null }>({ q: "", hits: [] });
  useEffect(() => {
    if (!open || !dApp.trim()) return setApps({ q: "", hits: [] });
    let live = true;
    void appsSearch(dApp, 5).then((hits) => live && setApps({ q: dApp, hits }));
    return () => {
      live = false;
    };
  }, [dApp, open]);
  useEffect(() => {
    if (!open || fold(dFile).trim().length < 2) return setFiles({ q: "", hits: [] });
    let live = true;
    setFiles({ q: dFile, hits: null });
    void filesSearch(dFile, 6).then((hits) => live && setFiles({ q: dFile, hits }));
    return () => {
      live = false;
    };
  }, [dFile, open]);

  const minutes = (n: number) => plural(t, n, lang);
  /** «التنزيلات › nimi»: the user folder, then the folder the file sits in. */
  const where = (f: FileHit) => {
    const parent = f.path.split("\\").slice(-2, -1)[0] ?? "";
    const top = f.folder ? t(`folder.${f.folder}` as TKey) : null;
    return top && parent && fold(parent) !== fold(top) && !["downloads", "documents", "desktop", "pictures", "videos", "music"].includes(parent.toLowerCase())
      ? `${top} › ${parent}`
      : (top ?? parent);
  };

  // --- rows ------------------------------------------------------------------------------------
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    const appRows = (q: string) =>
      apps.q === q
        ? apps.hits.map<Row>((a) => ({
            key: `app:${a.target}`,
            icon: "open",
            title: a.name,
            sub: t("cmd.app"),
            ltr: !/[؀-ۿ]/.test(a.name),
            run: async () => {
              await launch(a.target);
              return { toast: t("cmd.done.opened").replace("{s}", a.name), ok: true };
            },
          }))
        : [];
    const folderRows = (q: string) => {
      const f = fold(q.trim());
      if (!f) return [];
      return FOLDERS.filter((d) => d.words.some((w) => fold(w).startsWith(f))).map<Row>((d) => ({
        key: `folder:${d.id}`,
        icon: "folder",
        title: t(d.key),
        sub: t("cmd.folder"),
        run: async () => {
          await openKnownFolder(d.id);
          return { toast: t("cmd.done.opened").replace("{s}", t(d.key)), ok: true };
        },
      }));
    };
    const shortcutRows = (q: string) => {
      const f = fold(q.trim());
      return (settings?.userShortcuts ?? [])
        .filter((s) => f && fold(s.name).includes(f))
        .map<Row>((s) => ({
          key: `us:${s.id}`,
          icon: s.kind === "folder" ? "folder" : s.kind === "url" ? "link" : "terminal",
          title: s.name,
          sub: t(`shortcuts.kind.${s.kind}` as TKey),
          run: async () => {
            await runUserShortcut(s);
            return { toast: t("cmd.done.ran").replace("{s}", s.name), ok: true };
          },
        }));
    };

    switch (parsed.kind) {
      case "empty":
        for (const c of COMMANDS)
          out.push({
            key: `list:${c.id}`,
            icon: c.icon,
            title: t(c.label),
            sub: c.words.join(" · "),
            fill: `${lang === "ar" ? c.words[c.words.length - 1] : c.words[0]} `.replace("= ", "="),
          });
        break;

      case "calc":
        out.push({
          key: "calc",
          icon: "calc",
          title: parsed.text,
          ltr: true,
          sub: t("cmd.copyResult"),
          run: async () => {
            await copyText(parsed.text);
            return { toast: t("cmd.done.copied").replace("{s}", parsed.text), tone: "butter" };
          },
        });
        break;

      case "convert": {
        const label = `${parsed.text} ${lang === "ar" ? parsed.unitAr : parsed.unitEn}`;
        out.push({
          key: "convert",
          icon: "convert",
          title: label,
          sub: t("cmd.copyResult"),
          run: async () => {
            await copyText(parsed.text);
            return { toast: t("cmd.done.copied").replace("{s}", label), tone: "butter" };
          },
        });
        break;
      }

      case "command": {
        const { id, args } = parsed;
        if (id === "timer" || id === "pomodoro") {
          const d = parseReminder(args);
          const n = d.minutes ?? 25;
          if (id === "timer")
            out.push({
              key: "timer",
              icon: "timer",
              title: t("cmd.timer").replace("{m}", minutes(n)),
              sub: t("cmd.timer.sub"),
              run: async () => {
                await timers.startTimer(n, d.label || null);
                return { toast: t("cmd.done.timer").replace("{m}", minutes(n)), ok: true };
              },
            });
          out.push({
            key: "pomodoro",
            icon: "timer",
            title: t("cmd.pomodoro"),
            sub: t("cmd.pomodoro.sub"),
            run: async () => {
              await timers.startPomodoro();
              return { toast: t("cmd.done.pomodoro"), ok: true };
            },
          });
          if (id === "timer")
            out.push({
              key: "remind-fill",
              icon: "bell",
              title: t("cmd.remind.fill").replace("{m}", minutes(n)),
              sub: t("cmd.remind.fill.sub"),
              fill: `${lang === "ar" ? "ذكرني" : "remind"} ${fmtNumber(n, "en")} `,
            });
        } else if (id === "remind") {
          const d = parseReminder(args);
          if (d.minutes && d.label) {
            const n = d.minutes;
            out.push({
              key: "remind",
              icon: "bell",
              title: t("cmd.remind").replace("{m}", minutes(n)).replace("{s}", d.label),
              sub: t("cmd.remind.sub"),
              run: async () => {
                await timers.remind(n, d.label);
                return { toast: t("cmd.done.remind").replace("{m}", minutes(n)), ok: true };
              },
            });
          } else {
            const n = d.minutes ?? 10;
            out.push({
              key: "remind-fill",
              icon: "bell",
              title: t("cmd.remind.fill").replace("{m}", minutes(n)),
              sub: d.minutes ? t("cmd.remind.fill.sub") : t("cmd.remind.how"),
              fill: `${parsed.word} ${fmtNumber(n, "en")} `,
            });
          }
        } else if (id === "zip") {
          out.push({
            key: "zip",
            icon: "zip",
            title: t("cmd.zip"),
            sub: t("cmd.zip.sub"),
            run: async () => {
              try {
                const r = await zipExplorerSelection();
                return { toast: t("cmd.done.zip").replace("{s}", (r.outputs[0] ?? "").split("\\").pop() ?? ""), ok: true };
              } catch (e) {
                const code = String(e);
                return { toast: t(code.includes("no-selection") ? "cmd.err.noSelection" : code.includes("no-explorer") ? "cmd.err.noExplorer" : "cmd.err.generic") };
              }
            },
          });
        } else if (id === "shot") {
          out.push({ key: "shot", icon: "shot", title: t("cmd.shot"), sub: t("cmd.shot.sub"), run: () => ({ toast: "", ok: true, tool: "screenshot" }) });
        } else if (id === "color") {
          out.push({ key: "color", icon: "pick", title: t("cmd.color"), sub: t("cmd.color.sub"), run: () => ({ toast: "", ok: true, tool: "colorPicker" }) });
        } else if (id === "mute") {
          const muted = volume.muted;
          out.push({
            key: "mute-sound",
            icon: muted ? "speaker" : "mute",
            title: t(muted ? "cmd.unmuteSound" : "cmd.muteSound"),
            sub: volume.available ? t("cmd.now").replace("{s}", fmtPercent(volume.level, lang)) : undefined,
            run: async () => {
              await setVolumeMuted(!muted);
              return { toast: t(muted ? "cmd.done.unmuted" : "cmd.done.muted"), ok: true };
            },
          });
          out.push({
            key: "mute-mic",
            icon: "micoff",
            title: t(mic?.muted ? "cmd.unmuteMic" : "cmd.muteMic"),
            sub: mic && !mic.available ? t("cmd.err.noMic") : undefined,
            run: async () => {
              try {
                const s = await micToggle();
                return { toast: t(s.muted ? "cmd.done.micMuted" : "cmd.done.micOn"), ok: true };
              } catch {
                return { toast: t("cmd.err.noMic") };
              }
            },
          });
        } else if (id === "lock") {
          out.push({
            key: "lock",
            icon: "lock",
            title: t("cmd.lock"),
            run: async () => {
              await toolRun("lock");
              return null;
            },
          });
        } else if (id === "open") {
          out.push(...shortcutRows(args), ...folderRows(args), ...appRows(args));
          if (!args.trim()) out.push({ key: "open-hint", icon: "open", title: t("cmd.open.hint"), sub: t("cmd.open.hint.sub") });
        } else if (id === "find") {
          if (fold(args).trim().length < 2) {
            out.push({ key: "find-hint", icon: "search", title: t("cmd.find.hint"), sub: t("cmd.find.hint.sub") });
          } else if (files.q !== args || files.hits === null) {
            out.push({ key: "find-busy", icon: "search", title: t("cmd.find.busy") });
          } else {
            for (const f of files.hits)
              out.push({
                key: `file:${f.path}`,
                icon: f.isDir ? "folder" : "layers",
                title: f.name,
                ltr: !/[؀-ۿ]/.test(f.name),
                sub: [f.isDir ? null : fmtBytes(f.size), where(f)].filter(Boolean).join(" · "),
                run: async ({ ctrl }) => {
                  await (ctrl ? openFolder(f.path) : launch(f.path));
                  return { toast: t("cmd.done.opened").replace("{s}", f.name), ok: true };
                },
              });
          }
        } else if (id === "calc") {
          out.push({ key: "calc-hint", icon: "calc", title: t("cmd.calc.hint"), sub: t("cmd.calc.hint.sub") });
        } else if (id === "clipboard") {
          const f = fold(args.trim());
          const list = clips.filter((c) => !f || fold(c.text).includes(f)).slice(0, 6);
          if (!settings?.clipboardHistory) out.push({ key: "clip-off", icon: "clip", title: t("clip.off") });
          else if (!list.length) out.push({ key: "clip-empty", icon: "clip", title: t("clip.empty") });
          for (const c of list)
            out.push({
              key: `clip:${c.id}`,
              icon: "clip",
              title: c.text.replace(/\s+/g, " ").slice(0, 90),
              ltr: !/[؀-ۿ]/.test(c.text),
              sub: t("cmd.clip.sub"),
              run: async () => {
                await clipCopy(c.id);
                return { toast: t("cmd.done.clip"), tone: "butter" };
              },
            });
        } else if (id === "settings") {
          out.push({
            key: "settings",
            icon: "gear",
            title: t("cmd.settings"),
            run: async () => {
              await openSettingsWindow();
              return null;
            },
          });
        }
        break;
      }

      case "search": {
        for (const c of parsed.prefixOf.slice(0, 3)) {
          const word = c.words.find((w) => fold(w).startsWith(fold(parsed.query))) ?? c.words[0];
          out.push({ key: `pre:${c.id}`, icon: c.icon, title: t(c.label), sub: c.words.join(" · "), fill: `${word} ` });
        }
        out.push(...shortcutRows(parsed.query), ...folderRows(parsed.query), ...appRows(parsed.query));
        // A typo of a command («tmier»): say so and offer it on Tab (board_states), no file row.
        if (out.length === 0 && apps.q === parsed.query && didYouMean(parsed.query)) break;
        if (fold(parsed.query).trim().length >= 2 && out.length < 6) {
          out.push({
            key: "find-fill",
            icon: "search",
            title: t("cmd.find.row").replace("{s}", parsed.query.trim()),
            fill: `${lang === "ar" ? "دوّر" : "find"} ${parsed.query.trim()}`,
          });
        }
        break;
      }
    }
    return out;
  }, [parsed, apps, files, settings, clips, volume, mic, lang, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchPending = (parsed.kind === "search" || (parsed.kind === "command" && parsed.id === "open")) && fold(appQuery).trim() !== "" && apps.q !== appQuery;
  const nothing = rows.length === 0 && !searchPending;
  const hint = nothing ? didYouMean(text) : null;

  useEffect(() => setActive(0), [text]);
  useEffect(() => setActive((a) => Math.min(a, Math.max(0, rows.length - 1))), [rows.length]);

  // The shell sizes itself to the bar.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const report = () => onHeight(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeight]);

  const runRow = useCallback(
    async (row: Row | undefined, ctrl = false) => {
      if (!row || busy) return;
      if (!row.run) {
        if (row.fill) setText(row.fill);
        inputRef.current?.focus();
        return;
      }
      setBusy(true);
      try {
        onDone(await row.run({ ctrl }));
      } catch {
        onDone({ toast: t("cmd.err.generic") });
      } finally {
        setBusy(false);
      }
    },
    [busy, onDone, t],
  );

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (rows.length ? (a + 1) % rows.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (rows.length ? (a - 1 + rows.length) % rows.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void runRow(rows[active], e.ctrlKey);
    } else if (e.key === "Tab") {
      e.preventDefault();
      const row = rows[active];
      if (row?.fill) setText(row.fill);
      else if (hint) setText(`${hint} ${text.trim().split(/\s+/).slice(1).join(" ")}`.trimEnd() + " ");
      else if (row && (parsed.kind === "search" || (parsed.kind === "command" && parsed.id === "open")) && row.title) setText(`${lang === "ar" ? "افتح" : "open"} ${row.title}`);
    }
  };

  return (
    <div ref={rootRef} className={"cmd" + (open ? " is-open" : "")} aria-hidden={!open} inert={!open}>
      <label className="cmd__field">
        <Icon name="search" size={20} className="cmd__glass" />
        <input
          ref={inputRef}
          className="cmd__input"
          dir="auto"
          value={text}
          spellCheck={false}
          autoComplete="off"
          placeholder={t("cmd.placeholder")}
          aria-label={t("cmd.title")}
          aria-controls="cmd-rows"
          aria-activedescendant={rows[active] ? `cmd-row-${active}` : undefined}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        <span className="kbd">Esc</span>
      </label>

      {nothing ? (
        <div className="cmd__none">
          <div className="cmd__none-title">{t("cmd.none")}</div>
          {hint && (
            <div className="cmd__none-sub">
              {t("cmd.didYouMean").split("{s}")[0]}
              <bdi className="cmd__hint-word">{hint}</bdi>
              {t("cmd.didYouMean").split("{s}")[1]}
            </div>
          )}
        </div>
      ) : (
        <div className="cmd__rows" id="cmd-rows" role="listbox">
          {rows.map((row, i) => (
            <div
              key={row.key}
              id={`cmd-row-${i}`}
              role="option"
              aria-selected={i === active}
              className={"cmd__row" + (i === active ? " is-active" : "") + (row.run || row.fill ? "" : " is-info")}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => void runRow(row, e.ctrlKey)}
            >
              <span className="cmd__icon">
                <Icon name={row.icon} size={18} />
              </span>
              <span className="cmd__text">
                <span className="cmd__title">{row.ltr ? <bdi dir="ltr">{row.title}</bdi> : row.title}</span>
                {row.sub && <span className="cmd__sub">{row.sub}</span>}
              </span>
              {i === active && (row.run || row.fill) && (
                <span className="kbd kbd--enter" aria-hidden="true">
                  <Icon name="enter" size={14} />
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="cmd__hints" aria-hidden="true">
        <span>↑↓ {t("cmd.hint.move")}</span>
        <span>Enter {t("cmd.hint.run")}</span>
        <span>Tab {t("cmd.hint.complete")}</span>
      </div>
    </div>
  );
}
