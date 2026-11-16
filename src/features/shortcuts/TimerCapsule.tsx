import { Icon } from "@/components/Icon";
import type { TimerInfo } from "@/ipc/generated/TimerInfo";
import { fmtClock, leftMs, progress, useClock } from "./timer";

const R = 12;
const C = 2 * Math.PI * R;

/**
 * The capsule while a timer runs (board 13: «المؤقت الشغال يطلع … في الكبسولة»): a small ring
 * at the start, NIMI, the time left at the end — the same layout as the music capsule.
 */
export function TimerCapsule({ timer }: { timer: TimerInfo }) {
  const now = useClock(timer.pausedLeftMs == null);
  const share = 1 - progress(timer, now);
  return (
    <div className={"timer-capsule" + (timer.pausedLeftMs != null ? " is-paused" : "") + (timer.phase === "break" ? " is-break" : "")}>
      <span className="timer-capsule__ring">
        <svg viewBox="0 0 28 28" aria-hidden="true">
          <circle cx="14" cy="14" r={R} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="2.5" />
          <circle cx="14" cy="14" r={R} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - share)} />
        </svg>
        <Icon name={timer.pausedLeftMs != null ? "pause" : "timer"} size={12} />
      </span>
      <span className="timer-capsule__time">{fmtClock(leftMs(timer, now))}</span>
    </div>
  );
}
