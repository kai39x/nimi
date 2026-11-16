import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { useT, type TKey } from "@/i18n";
import { openFolder } from "@/ipc/commands";
import type { FeedAction } from "@/ipc/generated/FeedAction";
import type { Meal } from "@/ipc/generated/Meal";
import { useSettings } from "@/lib/settings";
import { fmtBytes } from "@/features/system/system";
import { dismiss, registerNear, registerZones, retry, runAction, toPocket, undo, useFeed, type Zone } from "./feed";
import "./feed.css";

/**
 * The feeding layer (board 08 option B), drawn inside the shell while a file is dragged near
 * NIMI or he is digesting one: drop zones, the file flying into his mouth, the soap-bubble arc
 * with «المزيد», the result toast with «افتح المجلد» / «تراجع», and the error card.
 */

type Bubble = { action: FeedAction | "pocket"; icon: IconName; label: TKey };

/** Board order from the left in Arabic (copy … pocket); English mirrors it. */
function bubblesFor(meal: Meal | null): Bubble[] {
  const list: Bubble[] = [
    { action: "copy", icon: "copy", label: "feed.copy" },
    { action: "cut", icon: "cut", label: "feed.cut" },
    { action: "copyPath", icon: "link", label: "feed.path" },
    { action: "zip", icon: "zip", label: "feed.zip" },
    { action: "move", icon: "move", label: "feed.move" },
  ];
  const kind = meal?.kind;
  if (kind === "image") list.push({ action: isPng(meal) ? "toJpg" : "toPng", icon: "convert", label: "feed.convert" });
  if (kind === "archive") list.push({ action: "extractHere", icon: "open", label: "feed.extract" });
  if (kind === "folder") list.push({ action: "terminal", icon: "terminal", label: "feed.terminal" });
  list.push({ action: "pocket", icon: "pocket", label: "feed.pocket" });
  return list;
}

function isPng(meal: Meal | null) {
  return /\.png$/i.test(meal?.name ?? "");
}

function moreFor(meal: Meal | null): Bubble[] {
  switch (meal?.kind) {
    case "image":
      return [
        isPng(meal) ? { action: "toJpg", icon: "convert", label: "feed.toJpg" } : { action: "toPng", icon: "convert", label: "feed.toPng" },
        { action: "shrink", icon: "shrink", label: "feed.shrink" },
        { action: "ocrText", icon: "ocr", label: "feed.ocr" },
        { action: "stripMeta", icon: "erase", label: "feed.strip" },
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
    const a = (((n === 1 ? 90 : from + ((to - from) * i) / (n - 1)) * Math.PI) / 180);
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
  toPng: "feed.done.convert",
  toJpg: "feed.done.convert",
  shrink: "feed.done.shrink",
  ocrText: "feed.done.ocr",
  stripMeta: "feed.done.strip",
  extractHere: "feed.done.extract",
  extractTo: "feed.done.extract",
  listArchive: "feed.done.list",
  folderSize: "feed.done.size",
  terminal: "feed.done.terminal",
};

const ERRORS: Record<string, TKey> = {
  missing: "feed.err.missing",
  system: "feed.err.system",
  "no-text": "feed.err.noText",
  "no-ocr-language": "feed.err.noOcr",
  "nothing-new": "feed.err.nothingNew",
  expired: "feed.err.expired",
};

export function FeedLayer({ nimiCenter }: { nimiCenter: { x: number; y: number } }) {
  const t = useT();
  const settings = useSettings();
  const rtl = (settings?.language ?? "ar") === "ar";
  const s = useFeed();
  const [more, setMore] = useState(false);
  const [popped, setPopped] = useState<string | null>(null);

  useEffect(() => {
    if (s.phase !== "menu") setMore(false);
  }, [s.phase]);

  const bubbles = useMemo(() => bubblesFor(s.meal), [s.meal]);
  const extras = useMemo(() => moreFor(s.meal), [s.meal]);
  const spots = useMemo(() => arc(bubbles.length, rtl), [bubbles.length, rtl]);
  const showBubbles = s.phase === "menu" || s.phase === "working";

  const choose = (b: Bubble) => {
    setPopped(b.action);
    window.setTimeout(() => setPopped(null), 260);
    if (b.action === "pocket") void toPocket();
    else void runAction(b.action);
  };

  const r = s.result;
  const out = r?.outputs[0] ?? null;
  const outName = out?.split(/[\\/]/).pop() ?? "";
  const outExt = outName.includes(".") ? outName.split(".").pop()!.toUpperCase().slice(0, 4) : "";
  const nextToOriginal = settings?.resultsLocation !== "downloads";

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
          {s.phase === "hungry" && (
            <div className={"feed-zone feed-zone--pocket" + (s.zone === "pocket" ? " is-hot" : "")}>
              <span>{t("feed.pocket")}</span>
            </div>
          )}
        </>
      )}

      {s.phase === "chomp" && s.dropAt && <FlyingFile from={s.dropAt} to={nimiCenter} name={s.meal?.name ?? ""} />}

      {showBubbles && (
        <div className={"bubbles" + (s.phase === "working" ? " is-busy" : "")} role="menu">
          {bubbles.map((b, i) => (
            <button
              key={b.action}
              type="button"
              role="menuitem"
              className={"bubble" + (popped === b.action ? " is-pop" : "")}
              style={{ "--bx": `${spots[i].x}px`, "--by": `${spots[i].y}px`, "--delay": `${i * 35}ms` } as CSSProperties}
              disabled={s.phase === "working"}
              onClick={() => choose(b)}
            >
              <span className="bubble__ball">
                <Icon name={b.icon} size={22} />
              </span>
              <span className="bubble__label">{t(b.label)}</span>
            </button>
          ))}
          <div className="feed-pill" dir="ltr">
            <bdi>{s.meal?.count && s.meal.count > 1 ? t("feed.many").replace("{n}", String(s.meal.count)) : s.meal?.name}</bdi>
            {s.meal && s.meal.bytes > 0 && (
              <>
                {" · "}
                <bdi dir="ltr">{fmtBytes(s.meal.bytes)}</bdi>
              </>
            )}
          </div>
          {extras.length > 0 && (
            <button type="button" className="feed-more" onClick={() => setMore((v) => !v)} aria-expanded={more}>
              {t("feed.more")} <Icon name="chev" size={14} className={more ? "is-open" : ""} />
            </button>
          )}
          {more && (
            <div className="feed-sheet n-glass" role="menu">
              {extras.map((b) => (
                <button key={b.action} type="button" role="menuitem" className="feed-sheet__item" onClick={() => choose(b)}>
                  <Icon name={b.icon} size={16} />
                  <span>{t(b.label)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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
              <strong>{t(RESULT_TITLE[r.action]).replace("{where}", t(nextToOriginal ? "feed.where.next" : "feed.where.downloads"))}</strong>
              <small>
                {r.action === "folderSize" ? (
                  <bdi dir="ltr">{fmtBytes(r.bytes)}</bdi>
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
          {r.text && (r.action === "ocrText" || r.action === "listArchive") && (
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

/** The dropped file shrinking into his mouth (board 08 ③). */
function FlyingFile({ from, to, name }: { from: { x: number; y: number }; to: { x: number; y: number }; name: string }) {
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
  const ext = name.includes(".") ? name.split(".").pop()!.toUpperCase().slice(0, 4) : "";
  const f = origin ?? to;
  return (
    <div
      ref={el}
      className={"flying-file" + (go ? " is-gone" : "")}
      style={{ "--fx": `${f.x}px`, "--fy": `${f.y}px`, "--tx": `${to.x}px`, "--ty": `${to.y + 18}px` } as CSSProperties}
      aria-hidden="true"
    >
      <span>{ext}</span>
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
