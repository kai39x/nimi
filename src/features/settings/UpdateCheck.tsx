import { useState } from "react";
import { Icon } from "@/components/Icon";
import { useT } from "@/i18n";
import { checkUpdate, openUpdatePage } from "@/ipc/commands";
import type { UpdateInfo } from "@/ipc/generated/UpdateInfo";

type State = { kind: "idle" } | { kind: "checking" } | { kind: "done"; info: UpdateInfo } | { kind: "failed" };

/**
 * About → «تحقق من التحديثات». NIMI stays offline: GitHub is asked only when this is pressed, and a
 * newer version only offers its releases page (nothing is downloaded or installed).
 */
export function UpdateCheck() {
  const t = useT();
  const [state, setState] = useState<State>({ kind: "idle" });

  const run = () => {
    setState({ kind: "checking" });
    checkUpdate()
      .then((info) => setState({ kind: "done", info }))
      .catch(() => setState({ kind: "failed" }));
  };

  let line: React.ReactNode = <span className="update__note">{t("settings.about.update.note")}</span>;
  if (state.kind === "done" && state.info.newer) {
    line = (
      <span className="update__found">
        <Icon name="dl" size={14} />
        <bdi>{t("settings.about.update.found").replace("{v}", state.info.latest)}</bdi>
      </span>
    );
  } else if (state.kind === "done") {
    line = (
      <span className="update__ok">
        <Icon name="check" size={14} />
        {t("settings.about.update.latest")}
      </span>
    );
  } else if (state.kind === "failed") {
    line = <span className="update__failed">{t("settings.about.update.failed")}</span>;
  }

  const newer = state.kind === "done" && state.info.newer;
  return (
    <div className="update" aria-live="polite">
      {newer ? (
        <button type="button" className="btn-ghost update__btn update__btn--go" onClick={() => void openUpdatePage(state.info.url)}>
          {t("settings.about.update.open")}
        </button>
      ) : (
        <button type="button" className="btn-ghost update__btn" disabled={state.kind === "checking"} onClick={run}>
          {state.kind === "checking" ? t("settings.about.update.checking") : t("settings.about.update.check")}
        </button>
      )}
      {line}
    </div>
  );
}
