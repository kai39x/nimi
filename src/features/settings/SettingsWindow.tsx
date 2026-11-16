import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import nimiIdle from "@design/character/svg/nimi_idle.svg";
import { Icon, type IconName } from "@/components/Icon";
import { Segmented, Slider, Toggle } from "@/components/controls";
import { useT, type TKey } from "@/i18n";
import { appInfo, clipClear, clipList, listMonitors, pickScreenshotFolder, screenshotDefaultFolder } from "@/ipc/commands";
import type { AppInfo } from "@/ipc/generated/AppInfo";
import { play } from "@/lib/sounds";
import { fmtNumber } from "@/lib/format";
import type { TileId } from "@/ipc/generated/TileId";
import type { CapsuleStyle } from "@/ipc/generated/CapsuleStyle";
import type { MonitorInfo } from "@/ipc/generated/MonitorInfo";
import type { Settings } from "@/ipc/generated/Settings";
import { updateSettings, useSettings } from "@/lib/settings";
import { isWinter, nuriPace } from "@/lib/winter";
import { Nimi } from "@/features/character/Nimi";
import { DEFAULT_NIMI_SIZE } from "@/features/shell/constants";
import { ALL_TILES } from "@/features/shortcuts/ShortcutsTab";
import "./settings.css";

type SectionId = "general" | "character" | "capsule" | "notifications" | "feed" | "sounds" | "shortcuts" | "privacy" | "about";

const SECTIONS: ReadonlyArray<{ id: string; icon: IconName; label: TKey; ready: boolean }> = [
  { id: "general", icon: "gear", label: "settings.section.general", ready: true },
  { id: "character", icon: "star4", label: "settings.section.character", ready: true },
  { id: "capsule", icon: "capsule", label: "settings.section.capsule", ready: true },
  { id: "notifications", icon: "bell", label: "settings.section.notifications", ready: true },
  { id: "feed", icon: "pocket", label: "settings.section.feed", ready: true },
  { id: "sounds", icon: "speaker", label: "settings.section.sounds", ready: true },
  { id: "shortcuts", icon: "keyboard", label: "settings.section.shortcuts", ready: true },
  { id: "privacy", icon: "shield", label: "settings.section.privacy", ready: true },
  { id: "about", icon: "info", label: "settings.section.about", ready: true },
];

/** Live preview of the compact state: the capsule as it looks with the current settings. */
function CapsulePreview({ settings, capsuleStyle, caption }: { settings: Settings; capsuleStyle: CapsuleStyle; caption: string }) {
  const glass = capsuleStyle !== "nimiOnly";
  return (
    <div className="preview">
      <div
        className={"preview__capsule preview__capsule--" + capsuleStyle + (glass ? " n-glass" : "")}
        style={{ "--nimi-scale": settings.nimiSize / DEFAULT_NIMI_SIZE } as CSSProperties}
      >
        {capsuleStyle !== "capsuleOnly" && (
          <Nimi
            className="capsule__nimi"
            mood="idle"
            size={settings.nimiSize}
            winter={isWinter(settings)}
            reducedMotion={settings.reduceMotion}
            nuriPace={nuriPace(settings.nuriActivity)}
          />
        )}
      </div>
      <div className="preview__caption">{caption}</div>
    </div>
  );
}

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
 * Settings window (board 16). Sections arrive with their features; the full window lands in
 * phase 10. Changes apply instantly — there is no save button.
 */
export function SettingsWindow() {
  const settings = useSettings();
  const t = useT();
  const [section, setSection] = useState<SectionId>("general");
  const [shotDefault, setShotDefault] = useState<string | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [clips, setClips] = useState(0);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => void appInfo().then(setInfo), []);
  useEffect(() => {
    if (section === "privacy") void clipList().then((l) => setClips(l.length));
    setDone(null);
  }, [section]);
  useEffect(() => void screenshotDefaultFolder().then(setShotDefault), []);
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

  const sectionTitle = t(SECTIONS.find((s) => s.id === section)?.label ?? "settings.section.general");

  return (
    <div className="settings-window">
      <div className="settings n-glass">
        <aside className="settings__side">
          <div className="settings__brand" data-tauri-drag-region>
            <img className="settings__avatar" src={nimiIdle} alt="" draggable={false} />
            <span data-tauri-drag-region>{t("settings.title")}</span>
          </div>
          <nav className="settings__nav">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={"nav-item" + (s.id === section ? " is-active" : "")}
                disabled={!s.ready}
                title={s.ready ? undefined : t("settings.soon")}
                onClick={() => setSection(s.id as SectionId)}
              >
                <Icon name={s.icon} size={18} />
                <span>{t(s.label)}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="settings__main">
          <header className="settings__header" data-tauri-drag-region>
            <h1 data-tauri-drag-region>{sectionTitle}</h1>
            <button type="button" className="icon-btn" aria-label={t("settings.close")} onClick={() => void getCurrentWindow().close()}>
              <Icon name="x" size={18} />
            </button>
          </header>

          {section === "general" && (
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
                <Toggle label={t("settings.autostart")} checked={settings.autostart} onChange={(autostart) => void updateSettings({ autostart })} />
              </Row>
              <Row title={t("settings.display")} sub={t("settings.display.sub")}>
                <Segmented
                  label={t("settings.display")}
                  value={displayOptions.some((o) => o.value === settings.display) ? settings.display : "primary"}
                  options={displayOptions}
                  onChange={(display) => void updateSettings({ display })}
                />
              </Row>
              <Row title={t("settings.winter")} sub={t("settings.winter.sub")}>
                <Segmented
                  label={t("settings.winter")}
                  value={settings.winter}
                  options={[
                    { value: "auto", label: t("settings.winter.auto") },
                    { value: "always", label: t("settings.winter.always") },
                    { value: "off", label: t("settings.winter.off") },
                  ]}
                  onChange={(winter) => void updateSettings({ winter })}
                />
              </Row>
              <Row title={t("settings.snow")} sub={t("settings.snow.sub")}>
                <Toggle label={t("settings.snow")} checked={settings.snow} onChange={(snow) => void updateSettings({ snow })} />
              </Row>
            </section>
          )}

          {section === "character" && (
            <section className="settings__content">
              {/* NIMI's own settings are previewed in the capsule, whatever the capsule style. */}
              <CapsulePreview settings={settings} capsuleStyle="nimiInCapsule" caption={t("settings.preview")} />
              <Row title={t("settings.size")} sub={t("settings.size.sub")}>
                <Slider
                  label={t("settings.size")}
                  min={48}
                  max={96}
                  step={2}
                  value={settings.nimiSize}
                  format={(v) => `${v}px`}
                  onChange={(nimiSize) => void updateSettings({ nimiSize })}
                />
              </Row>
              <Row title={t("settings.sleepAfter")} sub={t("settings.sleepAfter.sub")}>
                <Segmented
                  label={t("settings.sleepAfter")}
                  value={String(settings.sleepAfterMin)}
                  options={[
                    { value: "10", label: t("settings.minutes.10") },
                    { value: "20", label: t("settings.minutes.20") },
                    { value: "30", label: t("settings.minutes.30") },
                    { value: "0", label: t("settings.never") },
                  ]}
                  onChange={(v) => void updateSettings({ sleepAfterMin: Number(v) })}
                />
              </Row>
              <Row title={t("settings.nuri")} sub={t("settings.nuri.sub")}>
                <Segmented
                  label={t("settings.nuri")}
                  value={settings.nuriActivity}
                  options={[
                    { value: "calm", label: t("settings.nuri.calm") },
                    { value: "normal", label: t("settings.nuri.normal") },
                    { value: "active", label: t("settings.nuri.active") },
                  ]}
                  onChange={(nuriActivity) => void updateSettings({ nuriActivity })}
                />
              </Row>
              <Row title={t("settings.talk")} sub={t("settings.talk.sub")}>
                <Segmented
                  label={t("settings.talk")}
                  value={settings.talk}
                  options={[
                    { value: "silent", label: t("settings.talk.silent") },
                    { value: "few", label: t("settings.talk.few") },
                    { value: "chatty", label: t("settings.talk.chatty") },
                  ]}
                  onChange={(talk) => void updateSettings({ talk })}
                />
              </Row>
              <Row title={t("settings.reduceMotion")} sub={t("settings.reduceMotion.sub")}>
                <Toggle label={t("settings.reduceMotion")} checked={settings.reduceMotion} onChange={(reduceMotion) => void updateSettings({ reduceMotion })} />
              </Row>
              <Row title={t("settings.homeStatus")} sub={t("settings.homeStatus.sub")}>
                <Toggle label={t("settings.homeStatus")} checked={settings.showHomeStatus} onChange={(showHomeStatus) => void updateSettings({ showHomeStatus })} />
              </Row>
            </section>
          )}

          {section === "sounds" && (
            <section className="settings__content">
              <Row title={t("settings.sounds")} sub={t("settings.sounds.sub")}>
                <Toggle label={t("settings.sounds")} checked={!settings.soundsMuted} onChange={(on) => void updateSettings({ soundsMuted: !on })} />
              </Row>
              <Row title={t("settings.soundVolume")} sub={t("settings.soundVolume.sub")}>
                <span className="row__buttons">
                  <Slider
                    label={t("settings.soundVolume")}
                    value={Math.round(settings.soundVolume * 100)}
                    min={0}
                    max={100}
                    step={5}
                    format={(v) => `${v}%`}
                    onChange={(v) => void updateSettings({ soundVolume: v / 100 })}
                  />
                  <button type="button" className="icon-btn icon-btn--round" aria-label={t("settings.soundTry")} title={t("settings.soundTry")} onClick={() => play("done_success", { force: true })}>
                    <Icon name="play" size={14} />
                  </button>
                </span>
              </Row>
              <Row title={t("settings.soundFeed")}>
                <Toggle label={t("settings.soundFeed")} checked={settings.soundFeed} onChange={(soundFeed) => void updateSettings({ soundFeed })} />
              </Row>
              <Row title={t("settings.muteFullscreen")} sub={t("settings.muteFullscreen.sub")}>
                <Toggle label={t("settings.muteFullscreen")} checked={settings.muteFullscreen} onChange={(muteFullscreen) => void updateSettings({ muteFullscreen })} />
              </Row>
            </section>
          )}

          {section === "privacy" && (
            <section className="settings__content">
              <div className="privacy-banner">
                <Icon name="check" size={16} />
                <span>{t("settings.privacy.banner")}</span>
              </div>
              <Row title={t("settings.clipboard")} sub={t("settings.privacy.clips").replace("{n}", fmtNumber(clips, settings.language))}>
                <button type="button" className="btn-ghost btn-ghost--danger" onClick={() => void clipClear().then(() => (setClips(0), setDone("clips")))}>
                  {done === "clips" ? t("settings.privacy.done") : t("settings.privacy.erase")}
                </button>
              </Row>
              <Row title={t("settings.privacy.stats")} sub={t("settings.privacy.stats.sub")}>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() =>
                    void updateSettings({ games: { starCatch: 0, moonToss: 0, memoryMs: 0 }, firstRunMs: Date.now() }).then(() => setDone("stats"))
                  }
                >
                  {done === "stats" ? t("settings.privacy.done") : t("settings.privacy.reset")}
                </button>
              </Row>
              <Row title={t("settings.privacy.tour")} sub={t("settings.privacy.tour.sub")}>
                <button type="button" className="btn-ghost" onClick={() => void updateSettings({ onboarded: false }).then(() => setDone("tour"))}>
                  {done === "tour" ? t("settings.privacy.tour.started") : t("settings.privacy.tour.again")}
                </button>
              </Row>
            </section>
          )}

          {section === "about" && (
            <section className="settings__content about">
              <img src={nimiIdle} alt="" className="about__nimi" draggable={false} />
              <div className="about__name">NIMI</div>
              <div className="about__ver">
                {t("settings.about.version").replace("{v}", info?.version ?? "…")}
                {info?.debug ? ` · ${t("settings.about.dev")}` : ""}
              </div>
              <p className="about__line">{t("settings.about.line")}</p>
              <ul className="about__facts">
                <li>{t("settings.about.local")}</li>
                <li>{t("settings.about.os")}</li>
                <li>{t("settings.about.credits").replace("{tauri}", info?.tauriVersion ?? "2")}</li>
              </ul>
            </section>
          )}

          {section === "capsule" && (
            <section className="settings__content">
              <CapsulePreview settings={settings} capsuleStyle={settings.capsuleStyle} caption={t("settings.preview")} />
              <Row title={t("settings.capsuleStyle")} sub={t("settings.capsuleStyle.sub")}>
                <Segmented
                  label={t("settings.capsuleStyle")}
                  value={settings.capsuleStyle}
                  options={[
                    { value: "nimiInCapsule", label: t("settings.capsuleStyle.nimiInCapsule") },
                    { value: "capsuleOnly", label: t("settings.capsuleStyle.capsuleOnly") },
                    { value: "nimiOnly", label: t("settings.capsuleStyle.nimiOnly") },
                  ]}
                  onChange={(capsuleStyle) => void updateSettings({ capsuleStyle })}
                />
              </Row>
              <Row title={t("settings.peek")} sub={t("settings.peek.sub")}>
                <Toggle label={t("settings.peek")} checked={settings.peekOverMaximized} onChange={(peekOverMaximized) => void updateSettings({ peekOverMaximized })} />
              </Row>
            </section>
          )}

          {section === "feed" && (
            <section className="settings__content">
              <Row title={t("settings.results")} sub={t("settings.results.sub")}>
                <Segmented
                  label={t("settings.results")}
                  value={settings.resultsLocation}
                  options={[
                    { value: "nextToOriginal", label: t("settings.results.next") },
                    { value: "downloads", label: t("settings.results.downloads") },
                    { value: "ask", label: t("settings.results.ask") },
                  ]}
                  onChange={(resultsLocation) => void updateSettings({ resultsLocation })}
                />
              </Row>
              <Row title={t("settings.pocketEmpty")} sub={t("settings.pocketEmpty.sub")}>
                <Segmented
                  label={t("settings.pocketEmpty")}
                  value={settings.pocketEmpty}
                  options={[
                    { value: "day", label: t("settings.pocketEmpty.day") },
                    { value: "week", label: t("settings.pocketEmpty.week") },
                    { value: "never", label: t("settings.never") },
                  ]}
                  onChange={(pocketEmpty) => void updateSettings({ pocketEmpty })}
                />
              </Row>
              <Row title={t("settings.phishFeed")} sub={t("settings.phishFeed.sub")}>
                <Toggle label={t("settings.phishFeed")} checked={settings.phishFeed} onChange={(phishFeed) => void updateSettings({ phishFeed })} />
              </Row>
              <Row title={t("settings.deleteTo")} sub={t("settings.deleteTo.sub")}>
                <Toggle label={t("settings.deleteTo")} checked disabled onChange={() => {}} />
              </Row>
            </section>
          )}
          {section === "notifications" && (
            <section className="settings__content">
              <Row title={t("notify.dnd")} sub={t("settings.dnd.sub")}>
                <Toggle label={t("notify.dnd")} checked={settings.dnd} onChange={(dnd) => void updateSettings({ dnd })} />
              </Row>
              <div className="settings__group-title">{t("settings.watch")}</div>
              {(
                [
                  ["disk", "settings.watch.disk"],
                  ["load", "settings.watch.load"],
                  ["timer", "settings.watch.timer"],
                  ["downloads", "settings.watch.downloads"],
                  ["usb", "settings.watch.usb"],
                  ["network", "settings.watch.network"],
                  ["battery", "settings.watch.battery"],
                ] as const
              ).map(([key, label]) => (
                <Row key={key} title={t(label)} sub={key === "battery" ? t("settings.watch.battery.sub") : undefined}>
                  <Toggle
                    label={t(label)}
                    checked={settings.notifyWatch[key]}
                    onChange={(on) => void updateSettings({ notifyWatch: { ...settings.notifyWatch, [key]: on } })}
                  />
                </Row>
              ))}
            </section>
          )}

          {section === "shortcuts" && (
            <section className="settings__content">
              <Row title={t("settings.hotkey")} sub={t("settings.hotkey.sub")}>
                <Segmented
                  label={t("settings.hotkey")}
                  value={settings.commandHotkey}
                  options={[
                    { value: "doubleCtrl", label: "Ctrl ×2" },
                    { value: "doubleAlt", label: "Alt ×2" },
                    { value: "doubleShift", label: "Shift ×2" },
                    { value: "off", label: t("settings.off") },
                  ]}
                  onChange={(commandHotkey) => void updateSettings({ commandHotkey })}
                />
              </Row>
              <Row title={t("settings.tiles")} sub={t("settings.tiles.sub")}>
                <div className="tile-toggles">
                  {ALL_TILES.map((id: TileId) => {
                    const on = settings.tiles.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        className={"tile-toggle" + (on ? " is-on" : "")}
                        aria-pressed={on}
                        onClick={() =>
                          void updateSettings({
                            // Shown again at its board position among the visible ones.
                            tiles: on ? settings.tiles.filter((x) => x !== id) : ALL_TILES.filter((x) => x === id || settings.tiles.includes(x)),
                          })
                        }
                      >
                        {t(`tile.${id}` as TKey)}
                      </button>
                    );
                  })}
                </div>
              </Row>
              <Row title={t("settings.shotSave")} sub={t("settings.shotSave.sub")}>
                <Segmented
                  label={t("settings.shotSave")}
                  value={settings.screenshotSave}
                  options={[
                    { value: "ask", label: t("settings.shotSave.ask") },
                    { value: "folder", label: t("settings.shotSave.folder") },
                    { value: "clipboardOnly", label: t("settings.shotSave.clipboard") },
                  ]}
                  onChange={(screenshotSave) => void updateSettings({ screenshotSave })}
                />
              </Row>
              {settings.screenshotSave !== "clipboardOnly" && (
                <Row title={t("settings.shotFolder")} sub={settings.screenshotFolder || shotDefault || ""}>
                  <span className="row__buttons">
                    {settings.screenshotFolder && (
                      <button type="button" className="btn-ghost" onClick={() => void updateSettings({ screenshotFolder: "" })}>
                        {t("settings.shotFolder.reset")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() =>
                        void pickScreenshotFolder().then((dir) => (dir ? updateSettings({ screenshotFolder: dir }) : undefined))
                      }
                    >
                      {t("settings.shotFolder.pick")}
                    </button>
                  </span>
                </Row>
              )}
              <Row title={t("settings.clipboard")} sub={t("settings.clipboard.sub")}>
                <Toggle label={t("settings.clipboard")} checked={settings.clipboardHistory} onChange={(clipboardHistory) => void updateSettings({ clipboardHistory })} />
              </Row>
              <Row title={t("settings.clipboard.clear")} sub={t("settings.clipboard.clear.sub")}>
                <button type="button" className="btn-ghost" onClick={() => void clipClear()}>
                  {t("clip.clear")}
                </button>
              </Row>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
