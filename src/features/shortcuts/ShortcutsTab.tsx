import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { useT, type Lang, type TKey } from "@/i18n";
import { clipClear, clipCopy, clipRemove, micState, micToggle, openKnownFolder, runUserShortcut } from "@/ipc/commands";
import type { MicState } from "@/ipc/generated/MicState";
import type { ShortcutKind } from "@/ipc/generated/ShortcutKind";
import type { TileId } from "@/ipc/generated/TileId";
import type { UserShortcut } from "@/ipc/generated/UserShortcut";
import { fmtNumber } from "@/lib/format";
import { updateSettings, useSettings } from "@/lib/settings";
import { relTime } from "@/features/system/system";
import { shellActions } from "@/features/shell/actions";
import { useClips } from "./clipboard";
import { AppsSheet, Favorites } from "./Favorites";
import { SheetFrame } from "./Sheet";
import { PomodoroCard } from "./PomodoroCard";
import "./shortcuts.css";

const TILES: Record<TileId, { icon: IconName; label: TKey }> = {
  screenshot: { icon: "shot", label: "tile.screenshot" },
  timer: { icon: "timer", label: "tile.timer" },
  downloads: { icon: "dl", label: "tile.downloads" },
  colorPicker: { icon: "pick", label: "tile.colorPicker" },
  micMute: { icon: "micoff", label: "tile.micMute" },
  lock: { icon: "lock", label: "tile.lock" },
  clipboard: { icon: "clip", label: "tile.clipboard" },
  commandBar: { icon: "search", label: "tile.commandBar" },
};

export const ALL_TILES = Object.keys(TILES) as TileId[];

/** «Ctrl Ctrl» on the command-bar tile follows the hotkey setting. */
export function hotkeyLabel(h: string | undefined): string | null {
  return h === "doubleAlt" ? "Alt Alt" : h === "doubleShift" ? "Shift Shift" : h === "off" ? null : "Ctrl Ctrl";
}

const KIND_ICON: Record<ShortcutKind, IconName> = { folder: "folder", command: "terminal", url: "link" };

function newId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

type Sheet = "clipboard" | "apps" | { edit: UserShortcut | null } | null;

/**
 * «اختصارات» (spec §5, board 13): eight fixed tiles (drag one onto another to swap; right-click
 * hides it — Settings brings it back), favorite apps, the user's own shortcuts, and the timer /
 * Pomodoro ring.
 */
export function ShortcutsTab() {
  const t = useT();
  const settings = useSettings();
  const lang: Lang = settings?.language ?? "ar";
  const tiles = settings?.tiles ?? ALL_TILES;
  const [sheet, setSheet] = useState<Sheet>(null);
  const [mic, setMic] = useState<MicState | null>(null);
  const [dragging, setDragging] = useState<TileId | null>(null);
  const [menu, setMenu] = useState<TileId | null>(null);

  useEffect(() => void micState().then(setMic), []);

  const runTile = async (id: TileId) => {
    switch (id) {
      case "screenshot":
        return shellActions.runTool("screenshot");
      case "colorPicker":
        return shellActions.runTool("colorPicker");
      case "lock":
        return shellActions.runTool("lock");
      case "timer":
        return shellActions.openCommand(lang === "ar" ? "مؤقت " : "timer ");
      case "commandBar":
        return shellActions.openCommand("");
      case "downloads":
        return void openKnownFolder("downloads");
      case "clipboard":
        return setSheet("clipboard");
      case "micMute":
        try {
          setMic(await micToggle());
        } catch {
          shellActions.toast(t("cmd.err.noMic"));
        }
    }
  };

  const swap = (a: TileId, b: TileId) => {
    if (a === b) return;
    const next = [...tiles];
    const i = next.indexOf(a);
    const j = next.indexOf(b);
    if (i < 0 || j < 0) return;
    [next[i], next[j]] = [next[j], next[i]];
    void updateSettings({ tiles: next });
  };

  const badge = (id: TileId) => (id === "screenshot" ? "Win+Shift+S" : id === "commandBar" ? hotkeyLabel(settings?.commandHotkey) : null);
  const shortcuts = settings?.userShortcuts ?? [];

  return (
    <div className="sc">
      <div className="sc__tiles" onPointerUp={() => setDragging(null)} onPointerLeave={() => setDragging(null)}>
        {tiles.map((id) => {
          const def = TILES[id];
          const on = id === "micMute" && mic?.muted;
          const b = badge(id);
          return (
            <button
              key={id}
              type="button"
              className={"sc-tile" + (on ? " is-on" : "") + (dragging === id ? " is-dragging" : "") + (dragging && dragging !== id ? " is-target" : "")}
              onClick={() => (dragging ? undefined : void runTile(id))}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                const startX = e.clientX;
                const startY = e.clientY;
                const move = (ev: PointerEvent) => {
                  if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) {
                    setDragging(id);
                    window.removeEventListener("pointermove", move);
                  }
                };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", () => window.removeEventListener("pointermove", move), { once: true });
              }}
              onPointerUp={(e) => {
                if (dragging && dragging !== id) {
                  e.stopPropagation();
                  swap(dragging, id);
                }
                // Let the click that follows a drag do nothing.
                if (dragging) window.setTimeout(() => setDragging(null), 0);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu(id);
              }}
            >
              <Icon name={def.icon} size={20} className="sc-tile__icon" />
              {b && (
                <span className="sc-tile__badge">
                  <bdi dir="ltr">{b}</bdi>
                </span>
              )}
              <span className="sc-tile__label">{on ? t("tile.micMuted") : t(def.label)}</span>
              {menu === id && (
                <span
                  className="sc-tile__menu n-glass"
                  role="menu"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <span
                    role="menuitem"
                    className="sc-tile__menu-item"
                    onClick={() => {
                      setMenu(null);
                      void updateSettings({ tiles: tiles.filter((x) => x !== id) });
                    }}
                  >
                    {t("tile.hide")}
                  </span>
                  <span role="menuitem" className="sc-tile__menu-item" onClick={() => setMenu(null)}>
                    {t("common.cancel")}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      <section className="card sc__favs">
        <span className="card__title">{t("shortcuts.favorites")}</span>
        <Favorites onAdd={() => setSheet("apps")} />
      </section>

      <div className="sc__bottom">
        <section className="card sc__user">
          <header className="sc__user-head">
            <span className="card__title">{t("shortcuts.mine")}</span>
            <button type="button" className="chip" onClick={() => setSheet({ edit: null })}>
              <Icon name="plus" size={14} /> {t("shortcuts.new")}
            </button>
          </header>
          {shortcuts.length === 0 ? (
            <div className="sc__user-empty">{t("shortcuts.mine.empty")}</div>
          ) : (
            <ul className="sc__user-list">
              {shortcuts.map((s) => (
                <li key={s.id} className="sc__user-row">
                  <button
                    type="button"
                    className="sc__user-run"
                    onClick={() =>
                      void runUserShortcut(s).catch(() => shellActions.toast(t(s.kind === "folder" ? "shortcuts.err.folder" : "cmd.err.generic")))
                    }
                  >
                    <span className="sc__user-icon">
                      <Icon name={KIND_ICON[s.kind]} size={16} />
                    </span>
                    <span className="sc__user-name">{s.name}</span>
                  </button>
                  <span className="sc__kind">{t(`shortcuts.kind.${s.kind}` as TKey)}</span>
                  <button type="button" className="icon-btn icon-btn--round sc__edit" aria-label={t("shortcuts.edit")} title={t("shortcuts.edit")} onClick={() => setSheet({ edit: s })}>
                    <Icon name="rename" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <PomodoroCard />
      </div>

      {sheet === "clipboard" && <ClipboardSheet lang={lang} onClose={() => setSheet(null)} />}
      {sheet === "apps" && <AppsSheet onClose={() => setSheet(null)} />}
      {sheet && typeof sheet === "object" && (
        <ShortcutEditor
          value={sheet.edit}
          onClose={() => setSheet(null)}
          onSave={(s) => {
            const exists = shortcuts.some((x) => x.id === s.id);
            void updateSettings({ userShortcuts: exists ? shortcuts.map((x) => (x.id === s.id ? s : x)) : [...shortcuts, s] });
            setSheet(null);
          }}
          onDelete={(id) => {
            void updateSettings({ userShortcuts: shortcuts.filter((x) => x.id !== id) });
            setSheet(null);
          }}
        />
      )}
      {menu && <div className="sc__scrim sc__scrim--clear" onClick={() => setMenu(null)} />}
    </div>
  );
}

// --- sheets ------------------------------------------------------------------------------------

function ClipboardSheet({ lang, onClose }: { lang: Lang; onClose: () => void }) {
  const t = useT();
  const settings = useSettings();
  const clips = useClips();
  const [copied, setCopied] = useState<number | null>(null);
  return (
    <SheetFrame
      title={t("clip.title")}
      onClose={onClose}
      actions={
        clips.length > 0 && (
          <button type="button" className="chip" onClick={() => void clipClear()}>
            <Icon name="erase" size={14} /> {t("clip.clear")}
          </button>
        )
      }
    >
      {!settings?.clipboardHistory ? (
        <div className="sc-sheet__empty">
          {t("clip.off")}
          <button type="button" className="chip chip--butter" onClick={() => void updateSettings({ clipboardHistory: true })}>
            {t("clip.turnOn")}
          </button>
        </div>
      ) : clips.length === 0 ? (
        <div className="sc-sheet__empty">{t("clip.empty")}</div>
      ) : (
        <ul className="sc-clips">
          {clips.map((c) => (
            <li key={c.id} className="sc-clip">
              <button
                type="button"
                className="sc-clip__text"
                title={t("clip.copyAgain")}
                onClick={() => {
                  void clipCopy(c.id);
                  setCopied(c.id);
                  window.setTimeout(() => setCopied((x) => (x === c.id ? null : x)), 1400);
                }}
              >
                <bdi dir="auto">{c.text.length > 220 ? `${c.text.slice(0, 220)}…` : c.text}</bdi>
                <span className="sc-clip__meta">{copied === c.id ? t("clip.copied") : `${relTime(c.atMs, lang, t)}${c.text.length > 220 ? ` · ${fmtNumber(c.text.length, lang)} ${t("clip.chars")}` : ""}`}</span>
              </button>
              <button type="button" className="icon-btn icon-btn--round sc-clip__x" aria-label={t("clip.remove")} title={t("clip.remove")} onClick={() => void clipRemove(c.id)}>
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="sc-sheet__note">{t("clip.note")}</div>
    </SheetFrame>
  );
}

function ShortcutEditor({
  value,
  onClose,
  onSave,
  onDelete,
}: {
  value: UserShortcut | null;
  onClose: () => void;
  onSave: (s: UserShortcut) => void;
  onDelete: (id: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState(value?.name ?? "");
  const [kind, setKind] = useState<ShortcutKind>(value?.kind ?? "folder");
  const [target, setTarget] = useState(value?.target ?? "");
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);
  const valid = name.trim() !== "" && target.trim() !== "" && (kind !== "url" || /^(https?:\/\/)?[^\s.]+\.[^\s]{2,}/i.test(target.trim()));
  const save = () =>
    valid &&
    onSave({
      id: value?.id ?? newId(),
      name: name.trim(),
      kind,
      target: kind === "url" && !/^https?:\/\//i.test(target.trim()) ? `https://${target.trim()}` : target.trim(),
    });
  const placeholder: Record<ShortcutKind, TKey> = { folder: "shortcuts.target.folder", command: "shortcuts.target.command", url: "shortcuts.target.url" };
  return (
    <SheetFrame title={t(value ? "shortcuts.edit" : "shortcuts.new.title")} onClose={onClose}>
      <form
        className="sc-form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="sc-form__row">
          <span>{t("shortcuts.name")}</span>
          <input ref={nameRef} className="sc-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("shortcuts.name.ph")} maxLength={60} />
        </label>
        <div className="sc-form__row">
          <span>{t("shortcuts.kind")}</span>
          <div className="segmented" role="radiogroup">
            {(["folder", "command", "url"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={"segmented__option" + (kind === k ? " is-active" : "")} onClick={() => setKind(k)}>
                {t(`shortcuts.kind.${k}` as TKey)}
              </button>
            ))}
          </div>
        </div>
        <label className="sc-form__row">
          <span>{t(kind === "folder" ? "shortcuts.target.label.folder" : kind === "url" ? "shortcuts.target.label.url" : "shortcuts.target.label.command")}</span>
          <input className="sc-input" dir="ltr" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={t(placeholder[kind])} spellCheck={false} />
        </label>
        {kind === "command" && <div className="sc-form__note">{t("shortcuts.command.note")}</div>}
        <div className="sc-form__actions">
          {value && (
            <button type="button" className="chip sc-form__delete" onClick={() => onDelete(value.id)}>
              <Icon name="trash" size={14} /> {t("shortcuts.delete")}
            </button>
          )}
          <button type="submit" className="chip chip--butter" disabled={!valid} style={{ opacity: valid ? 1 : 0.5 } as CSSProperties}>
            {t("shortcuts.save")}
          </button>
        </div>
        <div className="sc-form__note">{t("shortcuts.asCommand")}</div>
      </form>
    </SheetFrame>
  );
}
