import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import nimiIdle from "@design/character/svg-small/nimi_idle_small.svg";
import nimiWorking from "@design/character/svg-small/nimi_working_small.svg";
import { Icon, type IconName } from "@/components/Icon";
import { useT, type TKey } from "@/i18n";
import type { DriveInfo } from "@/ipc/generated/DriveInfo";
import type { SystemStats } from "@/ipc/generated/SystemStats";
import { useSettings } from "@/lib/settings";
import { BoostCard, BoostSheet } from "./Boost";
import { LargestFiles } from "./LargestFiles";
import { takeLargestFilesRequest } from "@/features/shell/actions";
import { appLabel, fmtBytes, fmtPct, HISTORY_MS, useSystem, type Point } from "./system";
import "./system.css";

/**
 * «النظام» (design spec §5, board 12): CPU / RAM / GPU cards with a 60 s sparkline, the storage
 * card with its drive switcher, Boost, and NIMI's one-line comment when something matters.
 * «أكبر الملفات» and the Boost checklist open over the tab.
 */
export function SystemTab() {
  const t = useT();
  const { stats, history } = useSystem();
  // A notification («أكبر الملفات» on «مساحة C قربت تخلص») can open the tab straight on a drive.
  const [view, setView] = useState<{ kind: "main" } | { kind: "files"; drive: string } | { kind: "boost" }>(() => {
    const drive = takeLargestFilesRequest();
    return drive ? { kind: "files", drive } : { kind: "main" };
  });
  const [drive, setDrive] = useState<string | null>(null);

  if (view.kind === "files") {
    return <LargestFiles drive={view.drive} drives={stats?.drives ?? []} onDrive={(d) => setView({ kind: "files", drive: d })} onBack={() => setView({ kind: "main" })} />;
  }

  const drives = stats?.drives ?? [];
  const active = drives.find((d) => d.letter === drive) ?? drives.find((d) => d.system) ?? drives[0] ?? null;

  return (
    <div className="sys">
      <div className="sys__cards">
        <CpuCard stats={stats} history={history} />
        <RamCard stats={stats} history={history} />
        <GpuCard stats={stats} history={history} />
      </div>
      <div className="sys__row">
        <StorageCard drives={drives} active={active} onPick={setDrive} onFiles={(d) => setView({ kind: "files", drive: d })} />
        <BoostCard onOpen={() => setView({ kind: "boost" })} />
      </div>
      <Comment stats={stats} onShow={(d) => setView({ kind: "files", drive: d })} />
      <div className="sys__foot">{t("sys.foot")}</div>
      {view.kind === "boost" && <BoostSheet onClose={() => setView({ kind: "main" })} />}
    </div>
  );
}

// --- stat cards --------------------------------------------------------------------------------

function StatCard({
  title,
  icon,
  tone,
  value,
  points,
  rows,
}: {
  title: string;
  icon: IconName;
  tone: "mint" | "peri" | "rose";
  value: number | null;
  points: Array<{ at: number; v: number }>;
  rows: Array<[string, string | null]>;
}) {
  return (
    <section className={`card stat stat--${tone}`}>
      <header className="stat__head">
        <span className="stat__icon">
          <Icon name={icon} size={16} />
        </span>
        <span className="stat__title">{title}</span>
        <span className="stat__value">{value == null ? "—" : fmtPct(value)}</span>
      </header>
      <Sparkline points={points} />
      <dl className="stat__rows">
        {rows
          .filter(([, v]) => v != null)
          .map(([k, v]) => (
            <div key={k} className="stat__row">
              <dt>{k}</dt>
              <dd>
                <bdi>{v}</bdi>
              </dd>
            </div>
          ))}
      </dl>
    </section>
  );
}

/** Last 60 s, time running left to right; area under a 2 px line. */
function Sparkline({ points }: { points: Array<{ at: number; v: number }> }) {
  const d = useMemo(() => {
    if (points.length < 2) return null;
    const end = points[points.length - 1].at;
    const start = end - HISTORY_MS;
    const xy = points.map((p) => [((p.at - start) / HISTORY_MS) * 100, 30 - (Math.min(100, Math.max(0, p.v)) / 100) * 26 - 2] as const);
    const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
    return { line, area: `${line} L${xy[xy.length - 1][0].toFixed(2)} 30 L${xy[0][0].toFixed(2)} 30 Z` };
  }, [points]);
  return (
    <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      {d && (
        <>
          <path className="spark__area" d={d.area} />
          <path className="spark__line" d={d.line} vectorEffect="non-scaling-stroke" />
        </>
      )}
    </svg>
  );
}

function series(history: Point[], key: "cpu" | "ram" | "gpu") {
  return history.filter((p) => p[key] != null).map((p) => ({ at: p.at, v: p[key] as number }));
}

function CpuCard({ stats, history }: { stats: SystemStats | null; history: Point[] }) {
  const t = useT();
  const cpu = stats?.cpu;
  return (
    <StatCard
      title={t("sys.cpu")}
      icon="cpu"
      tone="mint"
      value={cpu?.usage ?? null}
      points={series(history, "cpu")}
      rows={[
        [t("sys.cpu.cores"), cpu ? t("sys.cpu.coresValue").replace("{c}", String(cpu.cores)).replace("{t}", String(cpu.threads)) : "—"],
        [t("sys.top"), cpu?.top ? `${appLabel(cpu.top, t)} · ${fmtPct(cpu.top.value)}` : "—"],
      ]}
    />
  );
}

function RamCard({ stats, history }: { stats: SystemStats | null; history: Point[] }) {
  const t = useT();
  const ram = stats?.ram;
  return (
    <StatCard
      title={t("sys.ram")}
      icon="ram"
      tone="peri"
      value={ram?.usage ?? null}
      points={series(history, "ram")}
      rows={[
        [t("sys.ram.used"), ram ? `${fmtBytes(ram.used).replace(" GB", "")} / ${fmtBytes(ram.total)}` : "—"],
        [t("sys.top"), ram?.top ? `${appLabel(ram.top, t)} · ${fmtBytes(ram.top.value)}` : "—"],
      ]}
    />
  );
}

function GpuCard({ stats, history }: { stats: SystemStats | null; history: Point[] }) {
  const t = useT();
  const gpu = stats?.gpu;
  return (
    <StatCard
      title={t("sys.gpu")}
      icon="gpu"
      tone="rose"
      value={gpu?.usage ?? null}
      points={series(history, "gpu")}
      rows={[
        [t("sys.gpu.memory"), gpu ? `${fmtBytes(gpu.vramUsed).replace(" GB", "")} / ${fmtBytes(gpu.vramTotal)}` : "—"],
        // Temperature only when Windows exposes it without admin (spec §5): else the line hides.
        [t("sys.gpu.temp"), gpu?.tempC != null ? `${Math.round(gpu.tempC)}°` : null],
      ]}
    />
  );
}

// --- storage -----------------------------------------------------------------------------------

const STATE_KEY: Record<DriveInfo["state"], TKey> = {
  ok: "sys.drive.ok",
  warn: "sys.drive.warn",
  full: "sys.drive.full",
};

function StorageCard({
  drives,
  active,
  onPick,
  onFiles,
}: {
  drives: DriveInfo[];
  active: DriveInfo | null;
  onPick: (letter: string) => void;
  onFiles: (letter: string) => void;
}) {
  const t = useT();
  const swipe = useRef<number | null>(null);
  const index = active ? drives.findIndex((d) => d.letter === active.letter) : -1;
  const step = (dir: number) => {
    if (drives.length < 2 || index < 0) return;
    onPick(drives[(index + dir + drives.length) % drives.length].letter);
  };
  const onDown = (e: ReactPointerEvent) => {
    swipe.current = e.clientX;
  };
  const onUp = (e: ReactPointerEvent) => {
    if (swipe.current == null) return;
    const dx = e.clientX - swipe.current;
    swipe.current = null;
    if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
  };
  return (
    <section className="card storage" onPointerDown={onDown} onPointerUp={onUp}>
      <header className="storage__head">
        <span className="stat__icon stat__icon--butter">
          <Icon name="disk" size={16} />
        </span>
        <span className="stat__title">{t("sys.storage")}</span>
        <DriveChips drives={drives} active={active?.letter ?? null} onPick={onPick} />
      </header>
      {active ? (
        <div className="storage__body">
          <Donut drive={active} />
          <div className="storage__info">
            <div className="storage__name">
              <span>{active.system ? t("sys.drive.system") : active.label || active.letter}</span>
              {active.ssd != null && <span className="badge">{active.ssd ? "SSD" : "HDD"}</span>}
            </div>
            <dl className="stat__rows">
              <div className="stat__row">
                <dt>{t("sys.drive.free")}</dt>
                <dd className={`tone-${active.state}`}>
                  <bdi>{fmtBytes(active.free)}</bdi>
                </dd>
              </div>
              <div className="stat__row">
                <dt>{t("sys.drive.used")}</dt>
                <dd>
                  {/* each number isolated, or the bidi algorithm reorders them around «من» */}
                  {t("sys.drive.usedOf")
                    .split(/(\{used\}|\{total\})/)
                    .map((part, i) =>
                      part === "{used}" ? (
                        <bdi key={i}>{fmtBytes(active.total - active.free)}</bdi>
                      ) : part === "{total}" ? (
                        <bdi key={i}>{fmtBytes(active.total)}</bdi>
                      ) : (
                        part
                      ),
                    )}
                </dd>
              </div>
              <div className="stat__row">
                <dt>{t("sys.drive.state")}</dt>
                <dd>{t(STATE_KEY[active.state])}</dd>
              </div>
            </dl>
            <button type="button" className="pill-btn pill-btn--ghost" onClick={() => onFiles(active.letter)}>
              <Icon name="search" size={14} />
              {t("sys.files.title")}
            </button>
          </div>
        </div>
      ) : (
        <div className="storage__empty">—</div>
      )}
      {drives.length > 1 && (
        <div className="dots" aria-hidden="true">
          {drives.map((d) => (
            <i key={d.letter} className={d.letter === active?.letter ? "is-on" : ""} />
          ))}
        </div>
      )}
    </section>
  );
}

export function DriveChips({ drives, active, onPick }: { drives: DriveInfo[]; active: string | null; onPick: (letter: string) => void }) {
  return (
    <div className="drive-chips" role="tablist">
      {drives.map((d) => (
        <button
          key={d.letter}
          type="button"
          role="tab"
          aria-selected={d.letter === active}
          className={"drive-chip" + (d.letter === active ? " is-active" : "")}
          onClick={(e) => {
            e.stopPropagation();
            onPick(d.letter);
          }}
        >
          <span className={`drive-chip__bar tone-bg-${d.state}`} style={{ width: `${Math.max(12, (1 - d.free / d.total) * 22)}px` }} />
          <span className="drive-chip__letter">{d.letter}</span>
        </button>
      ))}
    </div>
  );
}

function Donut({ drive }: { drive: DriveInfo }) {
  const used = drive.total > 0 ? 1 - drive.free / drive.total : 0;
  const r = 40;
  const c = 2 * Math.PI * r;
  return (
    <div className={`donut tone-${drive.state}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={r} className="donut__track" />
        <circle cx="50" cy="50" r={r} className="donut__fill" strokeDasharray={`${(used * c).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 50 50)" />
      </svg>
      <div className="donut__label">
        <strong>{drive.letter}</strong>
        <span>{fmtPct(used * 100)}</span>
      </div>
    </div>
  );
}

// --- NIMI's comment ----------------------------------------------------------------------------

/** One line, only when something matters (spec §5): a nearly full drive, a busy CPU or RAM. */
function Comment({ stats, onShow }: { stats: SystemStats | null; onShow: (drive: string) => void }) {
  const t = useT();
  const lang = useSettings()?.language ?? "ar";
  if (!stats) return null;
  const full = stats.drives.find((d) => d.state === "full");
  const cpuBusy = stats.cpu.usage >= 85;
  const ramBusy = stats.ram.usage >= 85;
  let text: string | null = null;
  if (full) {
    const calm = !cpuBusy && !ramBusy ? `${t("sys.say.calm")} ` : "";
    text = calm + t("sys.say.diskFull").replace("{d}", full.letter.replace(":", ""));
  } else if (cpuBusy) {
    text = t("sys.say.cpuBusy").replace("{app}", stats.cpu.top ? appLabel(stats.cpu.top, t) : "—");
  } else if (ramBusy) {
    text = t("sys.say.ramBusy").replace("{app}", stats.ram.top ? appLabel(stats.ram.top, t) : "—");
  }
  if (!text) return null;
  return (
    <section className="card say" lang={lang}>
      <img className="say__nimi" src={cpuBusy || ramBusy ? nimiWorking : nimiIdle} alt="" draggable={false} />
      <span className="say__text">{text}</span>
      {full && (
        <button type="button" className="pill-btn pill-btn--coral" onClick={() => onShow(full.letter)}>
          {t("sys.say.show")}
        </button>
      )}
    </section>
  );
}
