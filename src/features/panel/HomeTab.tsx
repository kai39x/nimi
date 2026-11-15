import nimiIdle from "@design/character/svg/nimi_idle.svg";
import { Icon } from "@/components/Icon";
import { useT, type Lang } from "@/i18n";
import { daysBetween, fmtNumber, fmtPercent } from "@/lib/format";
import { useSettings } from "@/lib/settings";
import type { Mood } from "@/features/character/rig/moods";
import { NowPlayingCard } from "@/features/music/Music";
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
 * The status card is live; the other cards show their approved empty states until their phases
 * (music 4, system 5, timer/favorites 7, alerts 8) feed them.
 */
export function HomeTab({ mood }: { mood: Mood }) {
  const t = useT();
  const settings = useSettings();
  const lang: Lang = settings?.language ?? "ar";
  const energy = useEnergy(mood);
  const days = settings?.firstRunMs ? daysBetween(settings.firstRunMs) : 0;
  const meals = 0; // phase 6
  const lastAction: string | null = null; // phase 6/7

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
              ["home.sys.cpu", "mint"],
              ["home.sys.ram", "peri"],
              ["home.sys.disk", "coral"],
            ] as const
          ).map(([key, tone]) => (
            <div key={key} className="minisys__item">
              <div className="minisys__head">
                <span>{t(key)}</span>
                <span className={`minisys__value tone-${tone}`}>—</span>
              </div>
              <Bar value={0} tone={tone} />
            </div>
          ))}
        </section>

        <section className="card timer">
          <span className="timer__icon">
            <Icon name="timer" size={18} />
          </span>
          <div className="timer__text">
            <div className="card__title">{t("home.timer.none")}</div>
            <div className="card__sub">{t("home.timer.hint")}</div>
          </div>
          <span className="chip chip--butter is-inert">{t("home.timer.start")}</span>
        </section>

        <section className="card favorites">
          <span className="card__title">{t("home.favorites")}</span>
          <div className="favorites__tiles">
            <span className="tile is-inert">
              <Icon name="dl" size={18} />
            </span>
            <span className="tile tile--add is-inert">
              <Icon name="plus" size={18} />
            </span>
          </div>
        </section>
      </div>

      <section className="card alert">
        <span className="alert__icon">
          <Icon name="check" size={16} />
        </span>
        <span className="alert__text">{t("home.alert.none")}</span>
      </section>
    </div>
  );
}
