import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useT } from "@/i18n";
import { appsSearch, launch, openKnownFolder } from "@/ipc/commands";
import type { AppHit } from "@/ipc/generated/AppHit";
import type { Favorite } from "@/ipc/generated/Favorite";
import { getSettingsNow, updateSettings, useSettings } from "@/lib/settings";
import { shellActions } from "@/features/shell/actions";
import { SheetFrame } from "./Sheet";

/** Pastel letter tiles, as on boards 11 and 13 (V · B · S · G · P). */
const TONES = ["peri", "mint", "rose", "butter", "mist"] as const;
const MAX_FAVORITES = 10;

function letter(name: string): string {
  const ch = [...name.trim()].find((c) => /[\p{L}\p{N}]/u.test(c)) ?? "?";
  return ch.toUpperCase();
}

function newId() {
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function nameOf(path: string): string {
  const base = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;
  return base.replace(/\.(lnk|exe|url|appref-ms)$/i, "");
}

export async function addFavorite(f: Omit<Favorite, "id">) {
  const list = getSettingsNow()?.favorites ?? [];
  if (list.some((x) => x.target.toLowerCase() === f.target.toLowerCase())) return;
  await updateSettings({ favorites: [...list, { ...f, id: newId() }].slice(-MAX_FAVORITES) });
}

/** Files dropped on the favorites row: apps (.exe / .lnk), files or folders. */
export async function addFavoritePaths(paths: string[]) {
  const list = getSettingsNow()?.favorites ?? [];
  const known = new Set(list.map((x) => x.target.toLowerCase()));
  const added = paths.filter((p) => !known.has(p.toLowerCase())).map<Favorite>((p) => ({ id: newId(), name: nameOf(p), target: p }));
  if (added.length) await updateSettings({ favorites: [...list, ...added].slice(-MAX_FAVORITES) });
}

/**
 * The favorites row (boards 11 and 13): one pastel letter tile per app, a «+» that opens the app
 * picker, optionally Downloads first (Home). Right-click a tile to take it off.
 */
export function Favorites({ onAdd, downloads = false }: { onAdd: () => void; downloads?: boolean }) {
  const t = useT();
  const settings = useSettings();
  const favs = settings?.favorites ?? [];
  const [menu, setMenu] = useState<string | null>(null);

  return (
    <div className="favs">
      {favs.map((f, i) => (
        <span key={f.id} className="favs__slot">
          <button
            type="button"
            className={`fav-tile fav-tile--${TONES[i % TONES.length]}`}
            title={f.name}
            aria-label={f.name}
            onClick={() => void launch(f.target).catch(() => shellActions.toast(t("fav.missing")))}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(f.id);
            }}
          >
            {letter(f.name)}
          </button>
          {menu === f.id && (
            <span className="sc-tile__menu n-glass favs__menu" role="menu">
              <span
                role="menuitem"
                className="sc-tile__menu-item"
                onClick={() => {
                  setMenu(null);
                  void updateSettings({ favorites: favs.filter((x) => x.id !== f.id) });
                }}
              >
                {t("fav.remove")}
              </span>
              <span role="menuitem" className="sc-tile__menu-item" onClick={() => setMenu(null)}>
                {t("common.cancel")}
              </span>
            </span>
          )}
        </span>
      ))}
      {downloads && (
        <button type="button" className="tile" title={t("folder.downloads")} aria-label={t("folder.downloads")} onClick={() => void openKnownFolder("downloads")}>
          <Icon name="dl" size={18} />
        </button>
      )}
      <button type="button" className="tile tile--add" title={t("fav.add")} aria-label={t("fav.add")} onClick={onAdd}>
        <Icon name="plus" size={18} />
      </button>
      {menu && <div className="sc__scrim sc__scrim--clear" onClick={() => setMenu(null)} />}
    </div>
  );
}

/** Searchable list of installed apps; picking one pins it. */
Favorites.Picker = function Picker({ onPicked }: { onPicked: () => void }) {
  const t = useT();
  const settings = useSettings();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<AppHit[] | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  useEffect(() => {
    let live = true;
    const id = window.setTimeout(() => void appsSearch(q, 60).then((h) => live && setHits(h)), q ? 90 : 0);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, [q]);
  const pinned = new Set((settings?.favorites ?? []).map((f) => f.target.toLowerCase()));
  return (
    <div className="apps-picker">
      <label className="cmd__field apps-picker__field">
        <Icon name="search" size={18} className="cmd__glass" />
        <input ref={ref} className="cmd__input apps-picker__input" dir="auto" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("fav.search")} />
      </label>
      <ul className="apps-picker__list">
        {hits === null ? (
          <li className="sc-sheet__empty">{t("fav.loading")}</li>
        ) : hits.length === 0 ? (
          <li className="sc-sheet__empty">{t("fav.none")}</li>
        ) : (
          hits.map((a) => {
            const on = pinned.has(a.target.toLowerCase());
            return (
              <li key={a.target}>
                <button
                  type="button"
                  className={"apps-picker__row" + (on ? " is-on" : "")}
                  disabled={on}
                  onClick={() => {
                    void addFavorite({ name: a.name, target: a.target });
                    onPicked();
                  }}
                >
                  <span className="fav-tile fav-tile--sm fav-tile--peri">{letter(a.name)}</span>
                  <bdi dir="auto" className="apps-picker__name">
                    {a.name}
                  </bdi>
                  {on && <Icon name="check" size={16} />}
                </button>
              </li>
            );
          })
        )}
      </ul>
      <div className="sc-sheet__note">{t("fav.dropHint")}</div>
    </div>
  );
};

export function AppsSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <SheetFrame title={t("fav.add")} onClose={onClose}>
      <Favorites.Picker onPicked={onClose} />
    </SheetFrame>
  );
}
