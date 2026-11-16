import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { useT, type TKey } from "@/i18n";
import { pocketCopy, pocketDrag, pocketList, pocketRemove, pocketRun } from "@/ipc/commands";
import { Events, onEvent } from "@/ipc/events";
import type { PocketItem } from "@/ipc/generated/PocketItem";
import { fmtBytes } from "@/features/system/system";
import "./pocket.css";

/**
 * NIMI's pocket (design spec §7, board 09): files dropped on Nuri, kept as paths. They orbit as
 * satellites; the tray shows cards with checkbox, name, size, source and time, and lets the user
 * drag the selection out to any app, ZIP / copy / move it, or empty the pocket.
 */

let items: PocketItem[] = [];
const listeners = new Set<() => void>();
let started = false;

function set(next: PocketItem[]) {
  items = next;
  listeners.forEach((fn) => fn());
}

function start() {
  if (started) return;
  started = true;
  onEvent<PocketItem[]>(Events.pocketChanged, set);
  pocketList().then(set).catch(console.error);
}

export function usePocket(): PocketItem[] {
  start();
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => items,
  );
}

const EXT_ICON: Array<[RegExp, IconName, string]> = [
  [/\.(png|jpe?g|gif|webp|bmp|heic|tiff?)$/i, "image", "rose"],
  [/\.(zip|7z|rar|tar|gz|iso)$/i, "zip", "butter"],
  [/\.(pdf|docx?|xlsx?|pptx?|txt|md)$/i, "layers", "peri"],
];

function look(item: PocketItem): [IconName, string] {
  if (item.isDir) return ["folder", "mint"];
  const hit = EXT_ICON.find(([re]) => re.test(item.name));
  return hit ? [hit[1], hit[2]] : ["copy", "mist"];
}

function ago(ms: number, t: (k: TKey) => string): string {
  const min = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (min < 1) return t("pocket.now");
  if (min < 60) return t("pocket.min").replace("{n}", String(min));
  const h = Math.round(min / 60);
  if (h < 24) return t("pocket.hour").replace("{n}", String(h));
  return t("pocket.day").replace("{n}", String(Math.round(h / 24)));
}

export function PocketTray({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const list = usePocket();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const down = useRef<{ x: number; y: number; ids: string[] } | null>(null);

  useEffect(() => {
    if (!open) {
      setPicked(new Set());
      setNote(null);
    }
  }, [open]);

  if (!open) return null;

  const live = list.filter((i) => !i.missing);
  const sel = picked.size ? [...picked].filter((id) => live.some((i) => i.id === id)) : [];
  const target = sel.length ? sel : live.map((i) => i.id);
  const allPicked = live.length > 0 && sel.length === live.length;

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  // Drag out: press on a card (or the handle) and move a few px → a real OS drag of the selection.
  const onDown = (e: ReactPointerEvent, ids: string[]) => {
    if (e.button !== 0) return;
    down.current = { x: e.clientX, y: e.clientY, ids };
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = down.current;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    down.current = null;
    void pocketDrag(d.ids);
  };

  const act = async (kind: "zip" | "copy" | "move" | "empty") => {
    if (busy) return;
    setBusy(true);
    try {
      if (kind === "copy") {
        await pocketCopy(target);
        setNote(t("pocket.copied"));
      } else if (kind === "empty") {
        await pocketRemove([]);
        setPicked(new Set());
        onClose();
      } else {
        const r = await pocketRun(kind === "zip" ? "zip" : "move", target);
        setNote(kind === "zip" ? t("pocket.zipped").replace("{name}", `⁨${r.outputs[0]?.split(/[\\/]/).pop() ?? ""}⁩`) : t("pocket.moved"));
      }
    } catch (err) {
      if (String(err) !== "cancelled") setNote(t("feed.err.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pocket" onPointerMove={onMove} onPointerUp={() => (down.current = null)}>
      <header className="pocket__head">
        <h3>{t("pocket.title")}</h3>
        <span className="pocket__count">{live.length === 1 ? t("pocket.count.one") : live.length === 2 ? t("pocket.count.two") : t("pocket.count").replace("{n}", String(live.length))}</span>
        {live.length > 0 && (
          <button type="button" className="pill-btn pill-btn--ghost pocket__all" onClick={() => setPicked(allPicked ? new Set() : new Set(live.map((i) => i.id)))}>
            {t(allPicked ? "pocket.none" : "pocket.all")}
          </button>
        )}
      </header>

      {list.length === 0 ? (
        <div className="pocket__empty">
          <strong>{t("pocket.empty")}</strong>
          <span>{t("pocket.emptyHint")}</span>
        </div>
      ) : (
        <ul className="pocket__cards">
          {list.map((item) => {
            const [icon, tone] = look(item);
            const on = picked.has(item.id);
            return (
              <li
                key={item.id}
                className={"pcard" + (on ? " is-on" : "") + (item.missing ? " is-missing" : "")}
                onPointerDown={(e) => !item.missing && onDown(e, on && sel.length ? sel : [item.id])}
                onClick={() => !item.missing && toggle(item.id)}
                title={item.path}
              >
                <span className="pcard__check" aria-hidden="true">
                  <Icon name="check" size={13} />
                </span>
                <span className={`pcard__icon tone-${tone}`}>
                  <Icon name={icon} size={20} />
                </span>
                <bdi className="pcard__name">{item.name}</bdi>
                <span className="pcard__size">{item.missing ? t("pocket.missing") : item.isDir ? t("pocket.folder") : <bdi dir="ltr">{fmtBytes(item.size)}</bdi>}</span>
                <span className="pcard__from">
                  <bdi>{item.folder}</bdi> · {ago(item.addedMs, t)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {live.length > 0 && (
        <footer className="pocket__foot">
          <span className="pocket__drag" onPointerDown={(e) => onDown(e, target)}>
            <Icon name="grip" size={14} />
            {t("pocket.dragHint")}
          </span>
          {note && <span className="pocket__note">{note}</span>}
          <button type="button" className="pill-btn pill-btn--ghost" disabled={busy} onClick={() => void act("zip")}>
            <Icon name="zip" size={14} /> ZIP
          </button>
          <button type="button" className="pill-btn pill-btn--ghost" disabled={busy} onClick={() => void act("copy")}>
            <Icon name="copy" size={14} /> {t("pocket.copy")}
          </button>
          <button type="button" className="pill-btn pill-btn--ghost" disabled={busy} onClick={() => void act("move")}>
            <Icon name="move" size={14} /> {t("pocket.move")}
          </button>
          <button type="button" className="pill-btn pill-btn--coral" disabled={busy} onClick={() => void act("empty")}>
            <Icon name="x" size={14} /> {t("pocket.emptyAll")}
          </button>
        </footer>
      )}
    </div>
  );
}
