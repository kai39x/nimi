import { useEffect } from "react";
import nimiSleeping from "@design/character/svg/nimi_sleeping.svg";
import { Icon } from "@/components/Icon";
import { Toggle } from "@/components/controls";
import { useT, type Lang } from "@/i18n";
import { notifyClear, notifyDismiss, notifyReadAll } from "@/ipc/commands";
import type { Notification } from "@/ipc/generated/Notification";
import { updateSettings, useSettings } from "@/lib/settings";
import { relTime } from "@/features/system/system";
import { describe, levelOf, useNotifications } from "./notify";
import "./notifications.css";

const DAY = 86_400_000;

function dayKey(ms: number): "today" | "yesterday" | "older" {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (ms >= start.getTime()) return "today";
  if (ms >= start.getTime() - DAY) return "yesterday";
  return "older";
}

/** «قبل ٣ د», «قبل ساعتين». */
function ago(ms: number, lang: Lang, t: (k: never) => string): string {
  const min = Math.floor((Date.now() - ms) / 60_000);
  const tt = t as unknown as (k: string) => string;
  const n = (v: number) => new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-US").format(v);
  if (min < 1) return tt("notify.ago.now");
  if (min < 60) return tt("notify.ago.min").replace("{n}", n(min));
  const h = Math.floor(min / 60);
  if (h < 24) return h === 1 ? tt("notify.ago.hour") : h === 2 ? tt("notify.ago.twoHours") : tt("notify.ago.hours").replace("{n}", n(h));
  return relTime(ms, lang, tt as never);
}

function Row({ n, lang }: { n: Notification; lang: Lang }) {
  const t = useT();
  const d = describe(n, t, lang);
  const level = levelOf(n);
  return (
    <li className={`nt-row nt-row--${level}` + (n.read ? "" : " is-unread")}>
      <span className="nt-row__dot" aria-hidden="true" />
      <span className="nt-row__icon">
        {d.image ? <img className="nt-row__img" src={d.image} alt="" draggable={false} /> : <Icon name={d.icon} size={18} />}
      </span>
      <span className="nt-row__text">
        <span className="nt-row__title">{d.title}</span>
        <span className="nt-row__sub">{d.sub}</span>
      </span>
      <span className="nt-row__time">{ago(n.atMs, lang, t as never)}</span>
      {d.action && (
        <button type="button" className="chip nt-row__act" onClick={d.action.run}>
          {d.action.label}
        </button>
      )}
      <button type="button" className="icon-btn icon-btn--round nt-row__x" aria-label={t("notify.dismiss")} title={t("notify.dismiss")} onClick={() => void notifyDismiss(n.id)}>
        <Icon name="x" size={14} />
      </button>
    </li>
  );
}

/**
 * «تنبيهات» (spec §5, board 14): today's notifications with one action each, «لا تزعجني», «مسح
 * الكل». Opening the tab marks everything read.
 */
export function NotificationsTab() {
  const t = useT();
  const settings = useSettings();
  const lang: Lang = settings?.language ?? "ar";
  const items = useNotifications();
  const dnd = settings?.dnd ?? false;

  // Seen once the tab has been open for a moment.
  const unread = items.some((n) => !n.read);
  useEffect(() => {
    if (!unread) return;
    const id = window.setTimeout(() => void notifyReadAll(), 1200);
    return () => window.clearTimeout(id);
  }, [unread]);

  const groups = (["today", "yesterday", "older"] as const)
    .map((k) => ({ k, rows: items.filter((n) => dayKey(n.atMs) === k) }))
    .filter((g) => g.rows.length);

  return (
    <div className="nt">
      <header className="nt__head">
        <span className="card__title">{t(groups[0] ? (`notify.day.${groups[0].k}` as const) : "notify.day.today")}</span>
        <span className="nt__tools">
          <span className="nt__dnd">
            <Icon name="dnd" size={16} />
            <span>{t("notify.dnd")}</span>
            <Toggle label={t("notify.dnd")} checked={dnd} onChange={(v) => void updateSettings({ dnd: v })} />
          </span>
          {items.length > 0 && (
            <button type="button" className="chip nt__clear" onClick={() => void notifyClear()}>
              {t("notify.clearAll")}
            </button>
          )}
        </span>
      </header>

      {items.length === 0 ? (
        <div className="nt__empty">
          <img src={nimiSleeping} alt="" className="nt__empty-nimi" draggable={false} />
          <div className="card__title">{t("notify.empty")}</div>
          <div className="card__sub">{t(dnd ? "notify.empty.dnd" : "notify.empty.sub")}</div>
        </div>
      ) : (
        <div className="nt__scroll">
          {groups.map((g, i) => (
            <section key={g.k} className="nt__group">
              {i > 0 && <div className="nt__day">{t(`notify.day.${g.k}`)}</div>}
              <ul className="nt__list">
                {g.rows.map((n) => (
                  <Row key={n.id} n={n} lang={lang} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
