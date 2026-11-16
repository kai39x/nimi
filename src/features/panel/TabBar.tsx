import { Icon, type IconName } from "@/components/Icon";
import { useT, type TKey } from "@/i18n";

export type TabId = "home" | "music" | "system" | "shortcuts" | "notifications" | "games";

export const TABS: ReadonlyArray<{ id: TabId; icon: IconName; label: TKey }> = [
  { id: "home", icon: "home", label: "panel.tab.home" },
  { id: "music", icon: "music", label: "panel.tab.music" },
  { id: "system", icon: "cpu", label: "panel.tab.system" },
  { id: "shortcuts", icon: "bolt", label: "panel.tab.shortcuts" },
  { id: "notifications", icon: "bell", label: "panel.tab.notifications" },
  { id: "games", icon: "game", label: "panel.tab.games" },
];

/** Six tabs in a pill (board 11); the notifications tab carries a count badge. */
export function TabBar({
  active,
  onChange,
  badges,
}: {
  active: TabId;
  onChange: (tab: TabId) => void;
  badges?: Partial<Record<TabId, number>>;
}) {
  const t = useT();
  return (
    <div className="tabbar" role="tablist">
      {TABS.map((tab) => {
        const count = badges?.[tab.id] ?? 0;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === active}
            className={"tabbar__tab" + (tab.id === active ? " is-active" : "")}
            onClick={() => onChange(tab.id)}
          >
            <Icon name={tab.icon} size={18} />
            <span>{t(tab.label)}</span>
            {count > 0 && <span className="tabbar__badge">{new Intl.NumberFormat(document.documentElement.lang === "ar" ? "ar-EG" : "en-US").format(count)}</span>}
          </button>
        );
      })}
    </div>
  );
}
