import { useEffect, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import nimiIdle from "@design/character/svg/nimi_idle.svg";
import { Icon, type IconName } from "@/components/Icon";
import { Segmented, Toggle } from "@/components/controls";
import { useT, type TKey } from "@/i18n";
import { listMonitors } from "@/ipc/commands";
import type { MonitorInfo } from "@/ipc/generated/MonitorInfo";
import { updateSettings, useSettings } from "@/lib/settings";
import { DropDiagnostics } from "@/features/overlay/DropDiagnostics";
import "./settings.css";

const SECTIONS: ReadonlyArray<{ id: string; icon: IconName; label: TKey; ready: boolean }> = [
  { id: "general", icon: "gear", label: "settings.section.general", ready: true },
  { id: "character", icon: "star4", label: "settings.section.character", ready: false },
  { id: "capsule", icon: "capsule", label: "settings.section.capsule", ready: false },
  { id: "notifications", icon: "bell", label: "settings.section.notifications", ready: false },
  { id: "feed", icon: "pocket", label: "settings.section.feed", ready: false },
  { id: "sounds", icon: "speaker", label: "settings.section.sounds", ready: false },
  { id: "shortcuts", icon: "keyboard", label: "settings.section.shortcuts", ready: false },
  { id: "privacy", icon: "shield", label: "settings.section.privacy", ready: false },
  { id: "about", icon: "info", label: "settings.section.about", ready: false },
];

function Row({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="row">
      <div className="row__text">
        <div className="row__title">{title}</div>
        {sub && <div className="row__sub">{sub}</div>}
      </div>
      <div className="row__control">{children}</div>
    </div>
  );
}

/**
 * Settings window (board 16). Phase 1 ships the shell and the «عام» section only; the other
 * sections arrive with their features and the full window in phase 10.
 */
export function SettingsWindow() {
  const settings = useSettings();
  const t = useT();
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);

  useEffect(() => {
    listMonitors().then(setMonitors).catch(console.error);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void getCurrentWindow().close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!settings) return null;

  const displayOptions = [
    { value: "primary", label: t("settings.display.primary") },
    ...monitors.map((m) => ({
      value: m.name,
      label: `${m.name.replace(/^\\\\\.\\/, "")} · ${m.width}×${m.height}`,
    })),
  ];

  return (
    <div className="settings-window">
      <div className="settings n-glass">
        <aside className="settings__side">
          <div className="settings__brand" data-tauri-drag-region>
            <img className="settings__avatar" src={nimiIdle} alt="" draggable={false} />
            <span data-tauri-drag-region>{t("settings.title")}</span>
          </div>
          <nav className="settings__nav">
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={"nav-item" + (section.id === "general" ? " is-active" : "")}
                disabled={!section.ready}
                title={section.ready ? undefined : t("settings.soon")}
              >
                <Icon name={section.icon} size={18} />
                <span>{t(section.label)}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="settings__main">
          <header className="settings__header" data-tauri-drag-region>
            <h1 data-tauri-drag-region>{t("settings.section.general")}</h1>
            <button
              type="button"
              className="icon-btn"
              aria-label={t("settings.close")}
              onClick={() => void getCurrentWindow().close()}
            >
              <Icon name="x" size={18} />
            </button>
          </header>

          <section className="settings__content">
            <Row title={t("settings.language")}>
              <Segmented
                label={t("settings.language")}
                value={settings.language}
                options={[
                  { value: "ar", label: t("settings.language.ar") },
                  { value: "en", label: t("settings.language.en") },
                ]}
                onChange={(language) => void updateSettings({ language })}
              />
            </Row>
            <Row title={t("settings.autostart")} sub={t("settings.autostart.sub")}>
              <Toggle
                label={t("settings.autostart")}
                checked={settings.autostart}
                onChange={(autostart) => void updateSettings({ autostart })}
              />
            </Row>
            <Row title={t("settings.display")} sub={t("settings.display.sub")}>
              <Segmented
                label={t("settings.display")}
                value={displayOptions.some((o) => o.value === settings.display) ? settings.display : "primary"}
                options={displayOptions}
                onChange={(display) => void updateSettings({ display })}
              />
            </Row>
          </section>
        </main>
      </div>
      {import.meta.env.DEV && <DropDiagnostics />}
    </div>
  );
}
