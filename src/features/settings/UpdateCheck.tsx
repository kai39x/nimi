import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useT } from "@/i18n";
import { checkUpdate, openUpdatePage, updateInstall } from "@/ipc/commands";
import { Events, onEvent } from "@/ipc/events";
import type { UpdateInfo } from "@/ipc/generated/UpdateInfo";
import type { UpdateProgress } from "@/ipc/generated/UpdateProgress";

type State =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "done"; info: UpdateInfo }
  | { kind: "installing"; info: UpdateInfo; percent: number | null }
  | { kind: "installFailed"; info: UpdateInfo }
  | { kind: "failed" };

/**
 * About → «تحقق من التحديثات». GitHub is asked only when this is pressed. A newer version offers
 * «حدّث الحين»: the installer is downloaded, its signature checked against NIMI's public key,
 * and installed (NIMI closes and comes back). «صفحة التحميل» stays as the manual way.
 */
export function UpdateCheck() {
  const t = useT();
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(
    () =>
      onEvent<UpdateProgress>(Events.updateProgress, (p) =>
        setState((s) => (s.kind === "installing" ? { ...s, percent: p.total ? Math.min(100, Math.round((p.downloaded / p.total) * 100)) : null } : s)),
      ),
    [],
  );

  const run = () => {
    setState({ kind: "checking" });
    checkUpdate()
      .then((info) => setState({ kind: "done", info }))
      .catch(() => setState({ kind: "failed" }));
  };

  const install = (info: UpdateInfo) => {
    setState({ kind: "installing", info, percent: 0 });
    // On success NIMI exits while the installer runs, so only a failure comes back here.
    updateInstall().catch(() => setState({ kind: "installFailed", info }));
  };

  const page = (info: UpdateInfo) => (
    <button type="button" className="btn-ghost update__btn" onClick={() => void openUpdatePage(info.url)}>
      {t("settings.about.update.open")}
    </button>
  );

  if (state.kind === "done" && state.info.newer) {
    const info = state.info;
    return (
      <div className="update" aria-live="polite">
        <div className="update__row">
          <button type="button" className="btn-ghost update__btn update__btn--go" onClick={() => install(info)}>
            {t("settings.about.update.install")}
          </button>
          {page(info)}
        </div>
        <span className="update__found">
          <Icon name="dl" size={14} />
          <bdi>{t("settings.about.update.found").replace("{v}", info.latest)}</bdi>
        </span>
      </div>
    );
  }

  if (state.kind === "installing") {
    return (
      <div className="update" aria-live="polite">
        <button type="button" className="btn-ghost update__btn update__btn--go" disabled>
          {state.percent != null && state.percent < 100
            ? t("settings.about.update.downloading").replace("{p}", String(state.percent))
            : t("settings.about.update.installing")}
        </button>
        <span className="update__note">{t("settings.about.update.restart")}</span>
      </div>
    );
  }

  if (state.kind === "installFailed") {
    return (
      <div className="update" aria-live="polite">
        {page(state.info)}
        <span className="update__failed">{t("settings.about.update.installFailed")}</span>
      </div>
    );
  }

  let line: React.ReactNode = <span className="update__note">{t("settings.about.update.note")}</span>;
  if (state.kind === "done") {
    line = (
      <span className="update__ok">
        <Icon name="check" size={14} />
        {t("settings.about.update.latest")}
      </span>
    );
  } else if (state.kind === "failed") {
    line = <span className="update__failed">{t("settings.about.update.failed")}</span>;
  }
  return (
    <div className="update" aria-live="polite">
      <button type="button" className="btn-ghost update__btn" disabled={state.kind === "checking"} onClick={run}>
        {state.kind === "checking" ? t("settings.about.update.checking") : t("settings.about.update.check")}
      </button>
      {line}
    </div>
  );
}
