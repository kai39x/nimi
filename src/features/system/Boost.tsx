import { useEffect, useState } from "react";
import nimiHappy from "@design/character/svg-small/nimi_happy_small.svg";
import nimiIdle from "@design/character/svg-small/nimi_idle_small.svg";
import nimiWorking from "@design/character/svg-small/nimi_working_small.svg";
import { Icon } from "@/components/Icon";
import { useT, type TKey } from "@/i18n";
import { boostPreview, restorePower, runBoost } from "@/ipc/commands";
import type { BoostPreview } from "@/ipc/generated/BoostPreview";
import type { BoostResult } from "@/ipc/generated/BoostResult";
import { useSettings } from "@/lib/settings";
import { setMoodOverride } from "@/features/character/useNimiMood";
import { appLabel, fmtBytes, relTime } from "./system";

/** The Boost card on the System tab (board 12): what it does, the button, the last run. */
export function BoostCard({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  const lang = useSettings()?.language ?? "ar";
  const [preview, setPreview] = useState<BoostPreview | null>(null);
  useEffect(() => {
    boostPreview().then(setPreview).catch(console.error);
  }, []);
  const until = preview?.power.boostedUntilMs;
  return (
    <section className="card boost">
      <header className="storage__head">
        <span className="stat__icon stat__icon--butter">
          <Icon name="bolt" size={16} />
        </span>
        <span className="stat__title">Boost</span>
      </header>
      <p className="boost__text">{t("sys.boost.text")}</p>
      <button type="button" className="boost__btn" onClick={onOpen}>
        Boost <Icon name="bolt" size={18} />
      </button>
      <div className="boost__last">
        {until
          ? t("sys.boost.powerUntil").replace("{time}", new Date(until).toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-US", { hour: "numeric", minute: "2-digit" }))
          : preview?.lastRunMs
            ? t("sys.boost.last").replace("{when}", relTime(preview.lastRunMs, lang, t)).replace("{bytes}", fmtBytes(preview.lastFreed))
            : t("sys.boost.never")}
      </div>
    </section>
  );
}

type Plan = { temp: boolean; recycle: boolean; apps: Record<string, boolean>; power: boolean };

/**
 * «وش بيسوي الـ Boost» (board 12 ج): the checklist first — nothing runs until «ابدأ» — then
 * the result «خلصت! حرّرت 4.7 GB». Only what is ticked runs; apps with a window are asked to
 * close, never forced.
 */
export function BoostSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [preview, setPreview] = useState<BoostPreview | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BoostResult | null>(null);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    boostPreview()
      .then((p) => {
        setPreview(p);
        setPlan({
          temp: p.tempBytes > 0,
          recycle: p.recycleItems > 0,
          apps: Object.fromEntries(p.apps.map((a) => [a.exe, a.suggested])),
          power: p.power.available,
        });
      })
      .catch(console.error);
  }, []);

  const start = async () => {
    if (!plan || running) return;
    setRunning(true);
    setMoodOverride("working");
    try {
      const r = await runBoost({
        temp: plan.temp,
        recycle: plan.recycle,
        apps: Object.entries(plan.apps)
          .filter(([, on]) => on)
          .map(([exe]) => exe),
        power: plan.power,
      });
      setResult(r);
      setMoodOverride("happy", 2500);
    } catch (err) {
      console.error(err);
      setMoodOverride("error", 2500);
    } finally {
      setRunning(false);
    }
  };

  const anything = plan && (plan.temp || plan.recycle || plan.power || Object.values(plan.apps).some(Boolean));

  return (
    <div className="sheet" role="dialog" aria-label={t("sys.boost.title")}>
      <div className="sheet__card card">
        <button type="button" className="icon-btn icon-btn--round sheet__close" aria-label={t("sys.close")} onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
        {result ? (
          <div className="boost-result">
            <img src={nimiHappy} alt="" draggable={false} />
            <div>
              <div className="boost-result__title">{t("sys.boost.done").replace("{bytes}", fmtBytes(result.freedBytes))}</div>
              <div className="boost-result__sub">{summary(result, t)}</div>
            </div>
            {result.powerUntilMs && !restored && (
              <button
                type="button"
                className="pill-btn pill-btn--ghost"
                onClick={() => {
                  restorePower()
                    .then(() => setRestored(true))
                    .catch(console.error);
                }}
              >
                {t("sys.boost.restore")}
              </button>
            )}
          </div>
        ) : (
          <>
            <header className="sheet__head">
              <img src={running ? nimiWorking : nimiIdle} alt="" draggable={false} />
              <h3>{t("sys.boost.title")}</h3>
            </header>
            {!preview || !plan ? (
              <div className="sheet__loading">{t("sys.boost.loading")}</div>
            ) : (
              <ul className="checklist">
                <Check
                  on={plan.temp}
                  disabled={preview.tempBytes === 0}
                  onChange={(v) => setPlan({ ...plan, temp: v })}
                  title={t("sys.boost.temp")}
                  sub={t("sys.boost.tempSub")}
                  value={fmtBytes(preview.tempBytes)}
                />
                <Check
                  on={plan.recycle}
                  disabled={preview.recycleItems === 0}
                  onChange={(v) => setPlan({ ...plan, recycle: v })}
                  title={t("sys.boost.recycle")}
                  sub={t("sys.boost.recycleSub").replace("{n}", String(preview.recycleItems))}
                  value={fmtBytes(preview.recycleBytes)}
                />
                {preview.apps.map((a) => (
                  <Check
                    key={a.exe}
                    on={plan.apps[a.exe] ?? false}
                    onChange={(v) => setPlan({ ...plan, apps: { ...plan.apps, [a.exe]: v } })}
                    title={t("sys.boost.close").replace("{app}", appLabel(a, t))}
                    sub={`${t("sys.ram")} · ${t(a.windowed ? "sys.boost.windowed" : "sys.boost.background")}${a.category ? ` · ${a.name}` : ""}`}
                    value={fmtBytes(a.bytes)}
                  />
                ))}
                {preview.power.available && (
                  <Check
                    on={plan.power}
                    onChange={(v) => setPlan({ ...plan, power: v })}
                    title={t("sys.boost.power")}
                    sub={t("sys.boost.powerSub")}
                    value=""
                  />
                )}
              </ul>
            )}
            <button type="button" className="boost__btn" disabled={!anything || running} onClick={() => void start()}>
              {running ? t("sys.boost.running") : t("sys.boost.start")} <Icon name="bolt" size={18} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function summary(r: BoostResult, t: (k: TKey) => string): string {
  const parts: string[] = [];
  if (r.closed.length) parts.push(t("sys.boost.closedN").replace("{n}", String(r.closed.length)));
  if (r.powerUntilMs) parts.push(t("sys.boost.powerOn"));
  if (r.leftOpen.length) parts.push(t("sys.boost.leftOpen").replace("{apps}", r.leftOpen.join("، ")));
  return parts.length ? parts.join(t("sys.and")) : t("sys.boost.cleaned");
}

function Check({
  on,
  onChange,
  title,
  sub,
  value,
  disabled = false,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  title: string;
  sub: string;
  value: string;
  disabled?: boolean;
}) {
  return (
    <li className={"check" + (disabled ? " is-disabled" : "")}>
      <label>
        <input type="checkbox" checked={on && !disabled} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} />
        <span className="check__box" aria-hidden="true">
          <Icon name="check" size={14} />
        </span>
        <span className="check__text">
          <span className="check__title">
            <bdi>{title}</bdi>
          </span>
          <span className="check__sub">
            <bdi>{sub}</bdi>
          </span>
        </span>
        <span className="check__value">{value}</span>
      </label>
    </li>
  );
}
