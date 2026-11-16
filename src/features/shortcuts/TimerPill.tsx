import { Icon } from "@/components/Icon";
import type { TimerInfo } from "@/ipc/generated/TimerInfo";
import { CapsulePill } from "@/features/shell/CapsuleMenu";
import { fmtClock, leftMs, useClock } from "./timer";

/** «نيمي بس» has no capsule to widen: the time left sits in a small pill under him. */
export function TimerPill({ timer }: { timer: TimerInfo }) {
  const now = useClock(timer.pausedLeftMs == null);
  return (
    <CapsulePill tone="butter">
      <Icon name={timer.pausedLeftMs != null ? "pause" : "timer"} size={14} className="capsule-pill__icon" />
      <bdi dir="ltr">{fmtClock(leftMs(timer, now))}</bdi>
    </CapsulePill>
  );
}
