import { Icon } from "@/components/Icon";
import { useT, type Lang, type TKey } from "@/i18n";
import type { TimerInfo } from "@/ipc/generated/TimerInfo";
import { fmtNumber } from "@/lib/format";
import { useSettings } from "@/lib/settings";
import { fmtClock, leftMs, progress, timers, useClock, useTimers } from "./timer";

const R = 50;
const C = 2 * Math.PI * R;

/** The ring (board 13): butter arc of time left, «18:42 · باقي» in the middle. */
export function TimerRing({ t: timer, now, size = 120 }: { t: TimerInfo | null; now: number; size?: number }) {
  const t = useT();
  const left = timer ? leftMs(timer, now) : 25 * 60_000;
  const share = timer ? 1 - progress(timer, now) : 1;
  return (
    <div className={"ring" + (timer?.pausedLeftMs != null ? " is-paused" : "") + (timer?.phase === "break" ? " is-break" : "")} style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="ring__track" cx="60" cy="60" r={R} />
        <circle className="ring__arc" cx="60" cy="60" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - share)} />
      </svg>
      <span className="ring__time">{fmtClock(left)}</span>
      <span className="ring__label">{t(timer?.pausedLeftMs != null ? "timer.paused" : timer ? "timer.left" : "timer.ready")}</span>
    </div>
  );
}

export function timerSubtitle(timer: TimerInfo, tt: (k: TKey) => string, lang: Lang): string {
  const n = (v: number) => fmtNumber(v, lang);
  if (timer.kind === "pomodoro") {
    return timer.phase === "work"
      ? tt("timer.round").replace("{r}", n(timer.round)).replace("{n}", n(timer.rounds)) +
          (timer.round < timer.rounds ? ` · ${tt("timer.breakNext").replace("{m}", n(5))}` : ` · ${tt("timer.lastRound")}`)
      : `${tt("timer.break")} · ${tt("timer.roundNext").replace("{r}", n(timer.round + 1))}`;
  }
  return timer.label ?? tt("timer.ends").replace("{s}", new Date(timer.endsAtMs).toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-US", { hour: "numeric", minute: "2-digit" }));
}

/** «بومودورو» card of the shortcuts tab: the running timer, or a start button. */
export function PomodoroCard() {
  const t = useT();
  const lang: Lang = useSettings()?.language ?? "ar";
  const { main, reminders } = useTimers();
  const running = !!main && main.pausedLeftMs == null;
  const now = useClock(running || reminders.length > 0);

  return (
    <section className="card pomo">
      <TimerRing t={main} now={now} />
      <div className="pomo__side">
        <div className="card__title">{t(main?.kind === "timer" ? "timer.title" : "timer.pomodoro")}</div>
        <div className="card__sub">{main ? timerSubtitle(main, t, lang) : t("timer.pomodoro.idle")}</div>
        {main?.kind === "pomodoro" && (
          <div className="pomo__rounds" aria-hidden="true">
            {Array.from({ length: main.rounds }, (_, i) => (
              <span key={i} className={i + 1 < main.round || (i + 1 === main.round && main.phase === "break") ? "is-done" : i + 1 === main.round ? "is-now" : ""} />
            ))}
          </div>
        )}
        <div className="pomo__controls">
          {main ? (
            <>
              <button type="button" className="icon-btn icon-btn--round icon-btn--primary pomo__play" aria-label={t(running ? "timer.pause" : "timer.resume")} title={t(running ? "timer.pause" : "timer.resume")} onClick={() => void timers.toggle(main)}>
                <Icon name={running ? "pause" : "play"} size={18} />
              </button>
              <button type="button" className="icon-btn icon-btn--round pomo__btn" aria-label={t("timer.stop")} title={t("timer.stop")} onClick={() => void timers.stop(main)}>
                <Icon name="stop" size={16} />
              </button>
              <button type="button" className="chip pomo__plus" onClick={() => void timers.extend(main, 5)}>
                {t("timer.plus5")}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="chip chip--butter" onClick={() => void timers.startPomodoro()}>
                <Icon name="play" size={14} /> {t("timer.startPomodoro")}
              </button>
              {[5, 10, 15].map((m) => (
                <button key={m} type="button" className="chip" onClick={() => void timers.startTimer(m)}>
                  {t("timer.quick").replace("{m}", fmtNumber(m, lang))}
                </button>
              ))}
            </>
          )}
        </div>
        {reminders.slice(0, 2).map((r) => (
          <div key={r.id} className="pomo__reminder">
            <Icon name="bell" size={14} />
            <bdi className="pomo__reminder-text">{r.label}</bdi>
            <span className="pomo__reminder-time">{fmtClock(leftMs(r, now))}</span>
            <button type="button" className="pomo__reminder-x" aria-label={t("timer.cancelReminder")} title={t("timer.cancelReminder")} onClick={() => void timers.stop(r)}>
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
