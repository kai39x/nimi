import { useEffect, useState } from "react";
import { Nimi } from "@/features/character/Nimi";
import { MusicTab } from "@/features/music/Music";
import { SystemTab } from "@/features/system/SystemTab";
import { ShortcutsTab } from "@/features/shortcuts/ShortcutsTab";
import { NotificationsTab } from "@/features/notifications/NotificationsTab";
import { GamesTab } from "@/features/games/GamesTab";
import { usePlaying } from "@/features/games/engine";
import { useNotifications } from "@/features/notifications/notify";
import { fmtNumber } from "@/lib/format";
import { Icon } from "@/components/Icon";
import { useT } from "@/i18n";
import { openSettingsWindow } from "@/ipc/commands";
import { updateSettings, useSettings } from "@/lib/settings";
import type { Mood } from "@/features/character/rig/moods";
import { HomeTab } from "./HomeTab";
import { moodLabel } from "./moodLabels";
import { TabBar, type TabId } from "./TabBar";
import "./panel.css";


/**
 * Expanded panel (design spec §5, board 11): header with the status pill and
 * mute / settings / collapse, six tabs, and the tab content. Mounted inside the shell; it fades
 * in 120 ms after the morph starts and is inert while the shell is compact.
 */
export function Panel({
  open,
  mood,
  tab,
  onTab,
  onCollapse,
}: {
  open: boolean;
  mood: Mood;
  tab: TabId;
  onTab: (tab: TabId) => void;
  onCollapse: () => void;
}) {
  const t = useT();
  const settings = useSettings();
  const lang = settings?.language ?? "ar";
  const muted = settings?.soundsMuted ?? false;
  const unread = useNotifications().filter((n) => !n.read).length;
  const playing = usePlaying();

  // Keep the content mounted only while open (plus the fade-out), so a closed panel costs nothing.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = window.setTimeout(() => setMounted(false), 320);
    return () => window.clearTimeout(t);
  }, [open]);
  if (!mounted) return <div className="panel" aria-hidden="true" />;

  return (
    <div className={"panel" + (open ? " is-open" : "")} aria-hidden={!open} inert={!open}>
      <header className="panel__header">
        {/* Board 14: «NIMI عنده ٣ تنبيهات» while some are unread. */}
        <span className={"status-pill" + (unread && !playing ? " status-pill--alert" : "")}>
          <span className="status-pill__dot" />
          {t("app.name.latin")}{" "}
          {playing ? t("games.pill") : unread ? t("notify.pill").replace("{n}", fmtNumber(unread, lang)) : moodLabel(mood, lang)}
        </span>
        <div className="panel__actions">
          <button type="button" className={"icon-btn icon-btn--round" + (muted ? " is-on" : "")} aria-label={t(muted ? "panel.unmute" : "panel.mute")} title={t(muted ? "panel.unmute" : "panel.mute")} onClick={() => void updateSettings({ soundsMuted: !muted })}>
            <Icon name={muted ? "mute" : "speaker"} size={18} />
          </button>
          <button type="button" className="icon-btn icon-btn--round" aria-label={t("settings.title")} title={t("settings.title")} onClick={() => void openSettingsWindow()}>
            <Icon name="gear" size={18} />
          </button>
          <button type="button" className="icon-btn icon-btn--round" aria-label={t("panel.collapse")} title={t("panel.collapse")} onClick={onCollapse}>
            <Icon name="up" size={18} />
          </button>
        </div>
      </header>

      <TabBar active={tab} onChange={onTab} badges={{ notifications: unread }} />

      <div className="panel__body">
        {tab === "home" ? (
          <HomeTab mood={mood} />
        ) : tab === "system" ? (
          <SystemTab />
        ) : tab === "shortcuts" ? (
          <ShortcutsTab />
        ) : tab === "notifications" ? (
          <NotificationsTab />
        ) : tab === "music" ? (
          <MusicTab nimi={<Nimi mood="bored" size={56} idleBehaviors={false} reducedMotion={settings?.reduceMotion ?? false} />} />
        ) : (
          <GamesTab />
        )}
      </div>
    </div>
  );
}
