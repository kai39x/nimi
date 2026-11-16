import { useState } from "react";
import nimiIdle from "@design/character/svg/nimi_idle.svg";
import { Icon } from "@/components/Icon";
import { useT, type Lang } from "@/i18n";
import { daysBetween, fmtNumber, fmtPercent } from "@/lib/format";
import { useSettings } from "@/lib/settings";
import type { Mood } from "@/features/character/rig/moods";
import { NowPlayingCard } from "@/features/music/Music";
import { useSystem } from "@/features/system/system";
import { AppsSheet, Favorites } from "@/features/shortcuts/Favorites";
import { timerSubtitle } from "@/features/shortcuts/PomodoroCard";
import { fmtClock, leftMs, timers, useClock, useTimers } from "@/features/shortcuts/timer";
import { describe, levelOf, topUnread, useNotifications } from "@/features/notifications/notify";
import { shellActions } from "@/features/shell/actions";
import { moodLabel, moodLevel } from "./moodLabels";
import { useEnergy } from "./useEnergy";

function Bar({ value, tone }: { value: number; tone: "butter" | "rose" | "peri" | "mint" | "coral" }) {
  return (
    <div className={`bar bar--${tone}`}>
      <span style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}

/**
 * Home (board 11): NIMI status card, now playing, mini system bars, timer, favorites, top alert.
 * The alerts card shows its approved empty state until phase 8 feeds it.
 */
export function HomeTab({ mood }: { mood: Mood }) {
  const t = useT();
  const settings = useSettings();
  const lang: Lang = settings?.language ?? "ar";
  const sys = useSystem();
  const systemDrive = sys.stats?.drives.find((d) => d.system) ?? sys.stats?.drives[0] ?? null;
  const energy = useEnergy(mood);
  const days = settings?.firstRunMs ? daysBetween(settings.firstRunMs) : 0;
  const meals = 0; // phase 6
  const lastAction: string | null = null; // phase 6/7
  const { main } = useTimers();
  const running = !!main && main.pausedLeftMs == null;
  const now = useClock(running);
  const [picking, setPicking] = useState(false);
  const notes = useNotifications();
  const top = topUnread(notes);
  const others = notes.filter((n) => !n.read).length - (top ? 1 : 0);

  return (
    <div className="home">
      <section className="card status">
        <header className="status__head">
          <div>
            <h3 className="card__title">
              {t("app.name.latin")} {moodLabel(mood, lang)} {t("home.today")}
            </h3>
            <div className="card__sub">{days === 0 ? t("home.days.first") : t("home.days").replace("{n}", fmtNumber(days, lang))}</div>
          </div>
          <img className="status__avatar" src={nimiIdle} alt="" draggable={false} />
        </header>
        <div className="status__row">
          <span className="status__label">
            <Icon name="bolt" size={16} /> {t("home.energy")}
          </span>
          <span className="status__value">{fmtPercent(energy, lang)}</span>
        </div>
        <Bar value={energy} tone="butter" />
        <div className="status__row">
          <span className="status__label">
            <Icon name="smile" size={16} /> {t("home.mood")}
          </span>
          <span className="status__value">{moodLabel(mood, lang)}</span>
        </div>
        <Bar value={moodLevel(mood)} tone="rose" />
        <div className="status__row">
          <span className="status__label">
            <Icon name="pocket" size={16} /> {t("home.meals")}
          </span>
          <span className="status__value">{t("home.meals.count").replace("{n}", fmtNumber(meals, lang))}</span>
        </div>
        <Bar value={Math.min(1, meals / 10)} tone="peri" />
        <div className="status__last">{lastAction ? t("home.last").replace("{s}", lastAction) : t("home.last.none")}</div>
      </section>

      <div className="home__stack">
        <NowPlayingCard />

        <section className="card minisys">
          {(
            [
              ["home.sys.cpu", "mint", sys.stats ? sys.stats.cpu.usage / 100 : null],
              ["home.sys.ram", "peri", sys.stats ? sys.stats.ram.usage / 100 : null],
              ["home.sys.disk", "coral", systemDrive ? 1 - systemDrive.free / systemDrive.total : null],
            ] as const
          ).map(([key, tone, value]) => (
            <div key={key} className="minisys__item">
              <div className="minisys__head">
                <span>{key === "home.sys.disk" && systemDrive ? t(key).replace("C", systemDrive.letter.replace(":", "")) : t(key)}</span>
                <span className={`minisys__value tone-${tone}`}>{value == null ? "—" : fmtPercent(value, lang)}</span>
              </div>
              <Bar value={value ?? 0} tone={tone} />
            </div>
          ))}
        </section>

        <section className="card timer">
          <span className="timer__icon">
            <Icon name="timer" size={18} />
          </span>
          {main ? (
            <>
              <div className="timer__text">
                <div className="card__title">
                  {t(main.kind === "pomodoro" ? "timer.pomodoro" : "timer.title")} · <bdi dir="ltr">{fmtClock(leftMs(main, now))}</bdi>
                </div>
                <div className="card__sub">{timerSubtitle(main, t, lang)}</div>
              </div>
              <button type="button" className="chip chip--butter home__chip" onClick={() => void timers.toggle(main)}>
                <Icon name={running ? "pause" : "play"} size={14} /> {t(running ? "timer.pause" : "timer.resume")}
              </button>
            </>
          ) : (
            <>
              <div className="timer__text">
                <div className="card__title">{t("home.timer.none")}</div>
                <div className="card__sub">{t("home.timer.hint")}</div>
              </div>
              <button type="button" className="chip chip--butter home__chip" onClick={() => void timers.startPomodoro()}>
                {t("home.timer.start")}
              </button>
            </>
          )}
        </section>

        <section className="card favorites">
          <span className="card__title">{t("home.favorites")}</span>
          <Favorites downloads onAdd={() => setPicking(true)} />
        </section>
      </div>

      {picking && (
        <div className="home__sheet">
          <AppsSheet onClose={() => setPicking(false)} />
        </div>
      )}

      {top ? (
        (() => {
          const d = describe(top, t, lang);
          return (
            <button type="button" className="card alert" onClick={() => shellActions.openTab("notifications")}>
              <span className={`alert__icon alert__icon--${levelOf(top)}`}>
                <Icon name={d.icon} size={16} />
              </span>
              <span className="alert__text">
                {d.title} · {d.capsuleSub.split(" · ")[0]}
              </span>
              {others > 0 && <span className="alert__more">{t("home.alert.more").replace("{n}", fmtNumber(others, lang))}</span>}
            </button>
          );
        })()
      ) : (
        <section className="card alert">
          <span className="alert__icon">
            <Icon name="check" size={16} />
          </span>
          <span className="alert__text">{t("home.alert.none")}</span>
        </section>
      )}
    </div>
  );
}
