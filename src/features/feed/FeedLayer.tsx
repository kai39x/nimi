import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { useT, type TKey } from "@/i18n";
import { copyText, openFolder } from "@/ipc/commands";
import type { FeedAction } from "@/ipc/generated/FeedAction";
import type { LinkSafety } from "@/ipc/generated/LinkSafety";
import type { Meal } from "@/ipc/generated/Meal";
import { useSettings } from "@/lib/settings";
import { fmtBytes } from "@/features/system/system";
import { setMoodOverride } from "@/features/character/useNimiMood";
import { shellActions } from "@/features/shell/actions";
import { addFavoritePaths } from "@/features/shortcuts/Favorites";
import { dismiss, openSub, registerNear, registerZones, retry, runAction, toPocket, undo, useFeed, type Zone } from "./feed";
import "./feed.css";

/**
 * The feeding layer (board 08 option B), drawn inside the shell while something is dragged near
 * NIMI or he is digesting it: drop zones, the file flying into his mouth, the soap-bubble arc
 * with «المزيد», a second arc for «تحويل» formats, the PDF page picker, the link safety card,
 * the result toast with «افتح المجلد» / «تراجع» / «نسخ النص», and the error card.
 */

type Bubble = {
  /** `pocket`, `favorite`, `sub:convert`, `sub:pages`, `back`, or a FeedAction (`target` for formats). */
  action: FeedAction | "pocket" | "favorite" | "sub:convert" | "sub:pages" | "back";
  icon?: IconName;
  /** A format name drawn in the ball instead of an icon («PNG»). */
  badge?: string;
  label: TKey | string;
  target?: string;
  key?: string;
};

const ext = (p: string) => (p.split(/[\\/]/).pop() ?? "").split(".").pop()?.toLowerCase() ?? "";
const IMAGE_EXT = ["png", "jpg", "jpeg", "bmp", "gif", "tif", "tiff", "webp", "heic", "jxr", "ico"];
const allOf = (meal: Meal, list: string[]) => meal.paths.length > 1 && meal.paths.every((p) => list.includes(ext(p)));
/** An app dropped on NIMI can be pinned to the favorites (phase 7: «اسحب البرنامج وحطه»). */
const APP_EXT = ["exe", "lnk", "appref-ms"];
const isApp = (meal: Meal | null) => !!meal && meal.paths.length === 1 && APP_EXT.includes(ext(meal.paths[0]));

/** Board order from the left in Arabic (copy … pocket); English mirrors it. */
function bubblesFor(meal: Meal | null): Bubble[] {
  const kind = meal?.kind;
  if (kind === "link")
    return [
      { action: "openLink", icon: "globe", label: "feed.open" },
      { action: "copyText", icon: "copy", label: "feed.copy" },
      { action: "linkShortcut", icon: "star4", label: "feed.shortcut" },
    ];
  if (kind === "note")
    return [
      { action: "copyText", icon: "copy", label: "feed.copy" },
      { action: "saveNote", icon: "dl", label: "feed.saveNote" },
      { action: "wordCount", icon: "calc", label: "feed.count" },
    ];
  const list: Bubble[] = [
    { action: "copy", icon: "copy", label: "feed.copy" },
    { action: "cut", icon: "cut", label: "feed.cut" },
    { action: "copyPath", icon: "link", label: "feed.path" },
    { action: "zip", icon: "zip", label: "feed.zip" },
    { action: "move", icon: "move", label: "feed.move" },
  ];
  if (kind === "image" || kind === "pdf") list.push({ action: "sub:convert", icon: "convert", label: "feed.convert" });
  if (kind === "archive") list.push({ action: "extractHere", icon: "open", label: "feed.extract" });
  if (kind === "folder") list.push({ action: "terminal", icon: "terminal", label: "feed.terminal" });
  if (meal && kind === "many" && allOf(meal, IMAGE_EXT)) list.push({ action: "imagesToPdf", badge: "PDF", label: "feed.toOnePdf" });
  if (meal && kind === "many" && allOf(meal, ["pdf"])) list.push({ action: "pdfMerge", icon: "layers", label: "feed.merge" });
  if (isApp(meal)) list.push({ action: "favorite", icon: "star4", label: "feed.favorite" });
  list.push({ action: "pocket", icon: "pocket", label: "feed.pocket" });
  return list;
}

/** «تحويل»: what this meal can become (mirrors imaging::targets_for / the PDF branch in Rust). */
function formatsFor(meal: Meal | null): Bubble[] {
  if (!meal) return [];
  const own = ext(meal.name).replace("jpeg", "jpg").replace(/^tif$/, "tiff");
  const targets = meal.kind === "pdf" ? ["txt", "png"] : ["png", "jpg", "webp", "pdf", "ico", "bmp", "tiff"].filter((f) => f !== own);
  // Image formats speak for themselves in the ball; PDF targets need a word («نص», «صور»).
  const label = (f: string) => (meal.kind === "pdf" ? (f === "txt" ? "feed.fmt.text" : "feed.fmt.pages") : "");
  return [
    ...targets.map((f): Bubble => ({ action: "convert", target: f, badge: f === "tiff" ? "TIF" : f.toUpperCase(), label: label(f), key: f })),
    { action: "back", icon: "undo", label: "feed.back" },
  ];
}

function moreFor(meal: Meal | null): Bubble[] {
  switch (meal?.kind) {
    case "image":
      return [
        { action: "shrink", icon: "shrink", label: "feed.shrink" },
        { action: "ocrText", icon: "ocr", label: "feed.ocr" },
        { action: "stripMeta", icon: "erase", label: "feed.strip" },
      ];
    case "pdf":
      return [
        { action: "pdfCompress", icon: "shrink", label: "feed.compress" },
        { action: "sub:pages", icon: "layers", label: "feed.pages" },
        { action: "convert", target: "txt", icon: "ocr", label: "feed.pdfText" },
        { action: "convert", target: "png", icon: "image", label: "feed.pdfImages" },
      ];
    case "archive":
      return [
        { action: "extractHere", icon: "open", label: "feed.extractHere" },
        { action: "extractTo", icon: "folder", label: "feed.extractTo" },
        { action: "listArchive", icon: "layers", label: "feed.list" },
      ];
    case "folder":
      return [
        { action: "folderSize", icon: "disk", label: "feed.size" },
        { action: "terminal", icon: "terminal", label: "feed.terminal" },
      ];
    default:
      return [];
  }
}

/** Arc under NIMI: 157° (left) → 23° (right), radius 220 px around his body center (board 08 B). */
function arc(n: number, rtl: boolean) {
  const from = 157;
  const to = 23;
  return Array.from({ length: n }, (_, i) => {
    const a = ((n === 1 ? 90 : from + ((to - from) * i) / (n - 1)) * Math.PI) / 180;
    const x = Math.cos(a) * 220;
    return { x: rtl ? x : -x, y: Math.sin(a) * 200 };
  });
}

const RESULT_TITLE: Record<FeedAction, TKey> = {
  copy: "feed.done.copy",
  cut: "feed.done.cut",
  copyPath: "feed.done.path",
  zip: "feed.done.zip",
  move: "feed.done.move",
  convert: "feed.done.convert",
  shrink: "feed.done.shrink",
  ocrText: "feed.done.ocr",
  stripMeta: "feed.done.strip",
  extractHere: "feed.done.extract",
  extractTo: "feed.done.extract",
  listArchive: "feed.done.list",
  folderSize: "feed.done.size",
  terminal: "feed.done.terminal",
  pdfMerge: "feed.done.merge",
  pdfPages: "feed.done.pages",
  pdfCompress: "feed.done.compress",
  imagesToPdf: "feed.done.pdf",
  openLink: "feed.done.open",
  linkShortcut: "feed.done.shortcut",
  copyText: "feed.done.copyText",
  saveNote: "feed.done.note",
  wordCount: "feed.done.count",
};

const ERRORS: Record<string, TKey> = {
  missing: "feed.err.missing",
  system: "feed.err.system",
  "no-text": "feed.err.noText",
  "no-ocr-language": "feed.err.noOcr",
  "nothing-new": "feed.err.nothingNew",
  expired: "feed.err.expired",
  "pdf-locked": "feed.err.locked",
  "already-small": "feed.err.small",
  "bad-pages": "feed.err.pages",
  "bad-link": "feed.err.link",
};

export function FeedLayer({ nimiCenter }: { nimiCenter: { x: number; y: number } }) {
  const t = useT();
  const settings = useSettings();
  const rtl = (settings?.language ?? "ar") === "ar";
  const s = useFeed();
  const [more, setMore] = useState(false);
  const [popped, setPopped] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (s.phase !== "menu") setMore(false);
    setArmed(false);
  }, [s.phase, s.sub]);
  useEffect(() => setCopied(false), [s.result]);

  const bubbles = useMemo(() => (s.sub === "convert" ? formatsFor(s.meal) : bubblesFor(s.meal)), [s.meal, s.sub]);
  const extras = useMemo(() => moreFor(s.meal), [s.meal]);
  const spots = useMemo(() => arc(bubbles.length, rtl), [bubbles.length, rtl]);
  const showBubbles = (s.phase === "menu" && s.sub !== "pages") || s.phase === "working";
  const danger = s.meal?.safety?.level === "danger";

  const choose = (b: Bubble) => {
    const id = b.key ?? b.action;
    setPopped(id);
    window.setTimeout(() => setPopped(null), 260);
    setMore(false);
    if (b.action === "pocket") void toPocket();
    else if (b.action === "favorite") {
      void addFavoritePaths(s.paths);
      setMoodOverride("happy", 1800);
      dismiss();
      shellActions.toast(t("feed.done.favorite"), "butter");
    }
    else if (b.action === "back") openSub(null);
    else if (b.action === "sub:convert") openSub("convert");
    else if (b.action === "sub:pages") openSub("pages");
    else if (b.action === "openLink" && danger && !armed) setArmed(true);
    else void runAction(b.action, b.target ?? null);
  };
  const label = (b: Bubble) => (b.action === "openLink" && armed ? t("feed.openAnyway") : b.label.includes(".") ? t(b.label as TKey) : b.label);

  const r = s.result;
  const out = r?.outputs[0] ?? null;
  const outName = out?.split(/[\\/]/).pop() ?? "";
  const outExt = outName.includes(".") ? outName.split(".").pop()!.toUpperCase().slice(0, 4) : "";
  const where = r?.action === "saveNote" || settings?.resultsLocation === "downloads" ? "feed.where.downloads" : "feed.where.next";
  const copyable = !!r?.text && (r.action === "ocrText" || r.action === "convert" || r.action === "listArchive");

  return (
    <div
      className="feed"
      style={{ "--cx": `${nimiCenter.x}px`, "--cy": `${nimiCenter.y}px` } as CSSProperties}
      onClick={(e) => {
        if (e.target === e.currentTarget && ["menu", "result", "error", "pocketed"].includes(s.phase)) dismiss();
      }}
    >
      {(s.phase === "near" || s.phase === "hungry") && (
        <>
          <div className={"feed-zone feed-zone--mouth" + (s.zone === "mouth" ? " is-hot" : "")} />
          {s.phase === "hungry" && s.paths.length > 0 && (
            <div className={"feed-zone feed-zone--pocket" + (s.zone === "pocket" ? " is-hot" : "")}>
              <span>{t("feed.pocket")}</span>
            </div>
          )}
        </>
      )}

      {s.phase === "chomp" && s.dropAt && (
        <FlyingFile from={s.dropAt} to={nimiCenter} name={s.paths[0] ?? ""} tag={s.paths.length ? null : /^(https?:|www\.)/i.test(s.text ?? "") ? "URL" : "TXT"} />
      )}

      {showBubbles && (
        <div className={"bubbles" + (s.phase === "working" ? " is-busy" : "")} role="menu">
          {bubbles.map((b, i) => {
            const id = b.key ?? b.action;
            return (
              <button
                key={`${s.sub ?? "main"}-${id}`}
                type="button"
                role="menuitem"
                className={"bubble" + (popped === id ? " is-pop" : "") + (b.action === "openLink" && armed ? " is-armed" : "")}
                style={{ "--bx": `${spots[i].x}px`, "--by": `${spots[i].y}px`, "--delay": `${i * 35}ms` } as CSSProperties}
                disabled={s.phase === "working"}
                onClick={() => choose(b)}
              >
                <span className="bubble__ball">{b.badge ? <span className="bubble__badge">{b.badge}</span> : b.icon && <Icon name={b.icon} size={22} />}</span>
                {label(b) && <span className="bubble__label">{label(b)}</span>}
              </button>
            );
          })}
          <div className="feed-pill" dir="ltr">
            <bdi>{s.meal?.count && s.meal.count > 1 ? t("feed.many").replace("{n}", String(s.meal.count)) : s.meal?.name}</bdi>
            {s.meal && s.meal.bytes > 0 && s.meal.kind !== "link" && s.meal.kind !== "note" && (
              <>
                {" · "}
                <bdi dir="ltr">{fmtBytes(s.meal.bytes)}</bdi>
              </>
            )}
            {s.meal?.pages != null && (
              <>
                {" · "}
                <bdi>{t("feed.pageCount").replace("{n}", String(s.meal.pages))}</bdi>
              </>
            )}
          </div>
          {s.meal?.safety && !s.sub && <SafetyCard safety={s.meal.safety} />}
          {extras.length > 0 && !s.sub && (
            <button type="button" className="feed-more" onClick={() => setMore((v) => !v)} aria-expanded={more}>
              {t("feed.more")} <Icon name="chev" size={14} className={more ? "is-open" : ""} />
            </button>
          )}
          {more && (
            <div className="feed-sheet n-glass" role="menu">
              {extras.map((b) => (
                <button key={b.key ?? `${b.action}-${b.target ?? ""}`} type="button" role="menuitem" className="feed-sheet__item" onClick={() => choose(b)}>
                  {b.icon && <Icon name={b.icon} size={16} />}
                  <span>{t(b.label as TKey)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {s.phase === "menu" && s.sub === "pages" && <PagePicker pages={s.meal?.pages ?? null} />}

      {s.phase === "result" && r && (
        <>
          {outExt && (
            <div className="out-file" aria-hidden="true">
              <span>{outExt}</span>
            </div>
          )}
          <div className="feed-toast n-glass" role="status">
            <span className="feed-toast__ok">
              <Icon name="check" size={16} />
            </span>
            <span className="feed-toast__text">
              <strong>{t(RESULT_TITLE[r.action]).replace("{where}", t(where))}</strong>
              <small>
                {r.action === "folderSize" ? (
                  <bdi dir="ltr">{fmtBytes(r.bytes)}</bdi>
                ) : r.counts ? (
                  t("feed.counts").replace("{w}", String(r.counts[0])).replace("{c}", String(r.counts[1])).replace("{l}", String(r.counts[2]))
                ) : r.was != null ? (
                  <bdi dir="ltr">
                    {fmtBytes(r.was)} → {fmtBytes(r.bytes)}
                  </bdi>
                ) : outName ? (
                  <>
                    <bdi>{outName}</bdi>
                    {r.bytes > 0 && (
                      <>
                        {" · "}
                        <bdi dir="ltr">{fmtBytes(r.bytes)}</bdi>
                      </>
                    )}
                  </>
                ) : r.text ? (
                  <bdi>{r.text.split("\n")[0].slice(0, 60)}</bdi>
                ) : null}
              </small>
            </span>
            {copyable && (
              <button
                type="button"
                className={"pill-btn pill-btn--ghost" + (copied ? " is-done" : "")}
                onClick={() => void copyText(r.text!).then(() => setCopied(true))}
              >
                <Icon name={copied ? "check" : "copy"} size={14} /> {t(copied ? "feed.copiedText" : "feed.copyText")}
              </button>
            )}
            {r.folder && (
              <button type="button" className="pill-btn pill-btn--ghost" onClick={() => void openFolder(r.folder!)}>
                <Icon name="folder" size={14} /> {t("feed.openFolder")}
              </button>
            )}
            {r.undo && (
              <button type="button" className="pill-btn pill-btn--ghost" onClick={() => void undo()}>
                <Icon name="undo" size={14} /> {t("feed.undo")}
              </button>
            )}
          </div>
          {copyable && (
            <pre className="feed-text n-glass" dir="auto">
              {r.text}
            </pre>
          )}
        </>
      )}

      {s.phase === "pocketed" && (
        <div className="feed-toast n-glass" role="status">
          <span className="feed-toast__ok">
            <Icon name="pocket" size={16} />
          </span>
          <span className="feed-toast__text">
            <strong>{t("feed.done.pocket")}</strong>
          </span>
        </div>
      )}

      {s.phase === "error" && (
        <div className="feed-toast feed-toast--error n-glass" role="alert">
          <span className="feed-toast__text">
            <strong>{t("feed.err.title")}</strong>
            <small>{t(ERRORS[s.error ?? ""] ?? "feed.err.generic")}</small>
          </span>
          <button type="button" className="pill-btn pill-btn--primary" onClick={retry}>
            {t("feed.retry")}
          </button>
          <button type="button" className="pill-btn pill-btn--ghost" onClick={dismiss}>
            {t("feed.giveBack")}
          </button>
        </div>
      )}
    </div>
  );
}

const REASON: Record<string, TKey> = {
  listed: "link.r.listed",
  http: "link.r.http",
  ip: "link.r.ip",
  punycode: "link.r.punycode",
  at: "link.r.at",
  subdomains: "link.r.subdomains",
  shortener: "link.r.shortener",
  tld: "link.r.tld",
  brand: "link.r.brand",
  long: "link.r.long",
};

/** «فحص الرابط»: the verdict under the bubbles of a link meal. */
function SafetyCard({ safety }: { safety: LinkSafety }) {
  const t = useT();
  return (
    <div className={`feed-safety feed-safety--${safety.level} n-glass`} role="status">
      <span className="feed-safety__icon">
        <Icon name="shield" size={18} />
      </span>
      <span className="feed-safety__text">
        <strong>{t(`link.${safety.level}` as TKey)}</strong>
        {safety.reasons.length > 0 && (
          <span className="feed-safety__reasons">
            {safety.reasons.slice(0, 3).map((r) => (
              <span key={r}>{t(REASON[r] ?? "link.r.long")}</span>
            ))}
          </span>
        )}
        <small>{t(safety.feed ? "link.checkedFeed" : "link.checkedLocal")}</small>
      </span>
    </div>
  );
}

/** «استخراج صفحات»: which pages to keep («1-3, 5»). */
function PagePicker({ pages }: { pages: number | null }) {
  const t = useT();
  const [spec, setSpec] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const go = () => spec.trim() && void runAction("pdfPages", spec.trim());
  return (
    <div className="feed-pages n-glass">
      <label>
        <strong>{t("feed.pagesAsk")}</strong>
        {pages != null && <small>{t("feed.pagesOf").replace("{n}", String(pages)).replace("{ex}", "⁨1-3, 5⁩")}</small>}
      </label>
      <input
        ref={input}
        dir="ltr"
        value={spec}
        placeholder={pages != null && pages > 2 ? `1-2, ${pages}` : "1"}
        onChange={(e) => setSpec(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") go();
          if (e.key === "Escape") openSub(null);
        }}
      />
      <div className="feed-pages__row">
        <button type="button" className="pill-btn pill-btn--ghost" onClick={() => openSub(null)}>
          {t("feed.back")}
        </button>
        <button type="button" className="pill-btn pill-btn--primary" disabled={!spec.trim()} onClick={go}>
          {t("feed.pagesGo")}
        </button>
      </div>
    </div>
  );
}

/** The dropped file shrinking into his mouth (board 08 ③). */
function FlyingFile({ from, to, name, tag: fixed }: { from: { x: number; y: number }; to: { x: number; y: number }; name: string; tag: string | null }) {
  const el = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [go, setGo] = useState(false);
  // The drop point is in window px; the layer is positioned inside the shell.
  useLayoutEffect(() => {
    const box = el.current?.parentElement?.getBoundingClientRect();
    setOrigin(box ? { x: from.x - box.x, y: from.y - box.y } : to);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setGo(true)));
    return () => cancelAnimationFrame(id);
  }, [from, to]);
  const base = name.split(/[\\/]/).pop() ?? "";
  const tag = fixed ?? (base.includes(".") ? base.split(".").pop()!.toUpperCase().slice(0, 4) : "");
  const f = origin ?? to;
  return (
    <div
      ref={el}
      className={"flying-file" + (go ? " is-gone" : "")}
      style={{ "--fx": `${f.x}px`, "--fy": `${f.y}px`, "--tx": `${to.x}px`, "--ty": `${to.y + 18}px` } as CSSProperties}
      aria-hidden="true"
    >
      <span>{tag}</span>
    </div>
  );
}

/**
 * Hook for the Shell: measures NIMI's frame and tells the feed store where the mouth and Nuri
 * zones are (logical px in the overlay window).
 */
export function useFeedZones(frame: () => DOMRect | null, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const geo = () => {
      const r = frame();
      if (!r) return null;
      // Rig units: body center (104, 114), Nuri parked for «hungry» at (192, 74), frame 208.
      return {
        body: { x: r.x + (r.width * 104) / 208, y: r.y + (r.height * 114) / 208, r: r.width * 0.44 },
        nuri: { x: r.x + (r.width * 192) / 208, y: r.y + (r.height * 74) / 208, r: Math.max(28, r.width * 0.17) },
      };
    };
    registerZones((x, y): Zone => {
      const g = geo();
      if (!g) return null;
      if (Math.hypot(x - g.nuri.x, y - g.nuri.y) <= g.nuri.r) return "pocket";
      if (Math.hypot(x - g.body.x, y - g.body.y) <= g.body.r) return "mouth";
      return null;
    });
    registerNear((x, y) => {
      const g = geo();
      return !!g && Math.hypot(x - g.body.x, y - g.body.y) <= g.body.r * 2.1;
    });
  }, [frame, active]);
}
