import { useT, type Lang } from "@/i18n";
import { notifyReadAll } from "@/ipc/commands";
import type { Notification } from "@/ipc/generated/Notification";
import { useSettings } from "@/lib/settings";
import { describe, levelOf } from "./notify";
import "./notifications.css";

/**
 * The capsule showing a notification (board 06 «تنبيه»): «فتح» (the action) at the start, the
 * title and one line, NIMI at the end. The shell handles a click anywhere else (opens the list).
 */
export function NoticeCapsule({ n, onDone }: { n: Notification; onDone: () => void }) {
  const t = useT();
  const lang: Lang = useSettings()?.language ?? "ar";
  const d = describe(n, t, lang);
  return (
    <div className={`notice notice--${levelOf(n)}`} role="status" aria-live="polite">
      {d.action && (
        <button
          type="button"
          className="notice__act"
          onClick={(e) => {
            e.stopPropagation();
            d.action!.run();
            void notifyReadAll();
            onDone();
          }}
        >
          {d.action.label}
        </button>
      )}
      <span className="notice__text">
        <span className="notice__title">{d.title}</span>
        <span className="notice__sub">{d.capsuleSub}</span>
      </span>
    </div>
  );
}
