import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { useT, type TKey } from "@/i18n";
import { cancelScan, moveFiles, recycleFiles } from "@/ipc/commands";
import type { BigFile } from "@/ipc/generated/BigFile";
import type { DriveInfo } from "@/ipc/generated/DriveInfo";
import { useSettings } from "@/lib/settings";
import { fmtNumber } from "@/lib/format";
import { setMoodOverride } from "@/features/character/useNimiMood";
import { DriveChips } from "./SystemTab";
import { fmtBytes, refreshScan, relTime, scanDrive, scanState, useSystem } from "./system";

type Filter = "all" | "video" | "archive" | "downloads" | "old";
const FILTERS: Array<[Filter, TKey]> = [
  ["all", "sys.files.all"],
  ["video", "sys.files.video"],
  ["archive", "sys.files.archive"],
  ["downloads", "sys.files.downloads"],
  ["old", "sys.files.old"],
];
/** «قديمة»: not modified for six months. */
const OLD_MS = 180 * 86_400_000;

/**
 * «أكبر الملفات» (spec §5, board 12 ب; scanning state from board_states): filters, select →
 * move to another drive or send to the Recycle Bin. System files show a lock and can't be
 * selected. The scan keeps running if the panel closes.
 */
export function LargestFiles({
  drive,
  drives,
  onDrive,
  onBack,
}: {
  drive: string;
  drives: DriveInfo[];
  onDrive: (d: string) => void;
  onBack: () => void;
}) {
  const t = useT();
  const lang = useSettings()?.language ?? "ar";
  const { scans } = useSystem();
  const scan = scans[drive];
  const progress = scan?.progress ?? null;
  const result = scan?.result ?? null;
  const running = progress?.phase === "running";
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // First visit to a drive: load what Rust has, scan if there is nothing yet.
  useEffect(() => {
    setPicked(new Set());
    setNote(null);
    refreshScan(drive)
      .then(() => {
        const s = scanState(drive);
        if (!s?.result && s?.progress?.phase !== "running") void scanDrive(drive);
      })
      .catch(console.error);
  }, [drive]);

  // NIMI works while the scan runs.
  useEffect(() => {
    if (!running) return;
    setMoodOverride("working");
    return () => setMoodOverride(null);
  }, [running]);

  const files = useMemo(() => {
    const all = result?.files ?? [];
    const now = Date.now();
    return all.filter((f) => {
      switch (filter) {
        case "video":
          return f.kind === "video";
        case "archive":
          return f.kind === "archive";
        case "downloads":
          return f.inDownloads;
        case "old":
          return f.modifiedMs > 0 && now - f.modifiedMs > OLD_MS;
        default:
          return true;
      }
    });
  }, [result, filter]);

  const selected = (result?.files ?? []).filter((f) => picked.has(f.path));
  const selectedBytes = selected.reduce((sum, f) => sum + f.size, 0);
  // Move to the other fixed drive with the most free space.
  const target = drives.filter((d) => d.letter !== drive).sort((a, b) => b.free - a.free)[0] ?? null;

  const toggle = (f: BigFile) => {
    if (f.locked) return;
    const next = new Set(picked);
    if (next.has(f.path)) next.delete(f.path);
    else next.add(f.path);
    setPicked(next);
  };

  const act = async (kind: "move" | "recycle") => {
    if (!selected.length || busy) return;
    setBusy(true);
    setMoodOverride("working");
    try {
      const paths = selected.map((f) => f.path);
      const r = kind === "move" && target ? await moveFiles(paths, target.letter) : await recycleFiles(paths);
      await refreshScan(drive);
      setPicked(new Set(r.failed));
      const n = fmtNumber(r.done.length, lang);
      // FSI … PDI: isolate Latin values inside the plain-text note, or bidi reorders them.
      const iso = (v: string) => `⁨${v}⁩`;
      setNote(
        r.done.length === 0
          ? t("sys.files.nothing")
          : kind === "move"
            ? t("sys.files.moved").replace("{n}", n).replace("{dest}", iso(r.dest ?? ""))
            : t("sys.files.recycled").replace("{n}", n).replace("{bytes}", iso(fmtBytes(r.bytes))),
      );
      setMoodOverride(r.done.length ? "happy" : "error", 2000);
    } catch (err) {
      console.error(err);
      setNote(t("sys.files.nothing"));
      setMoodOverride("error", 2000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sys sys--files">
      <header className="files__head">
        <button type="button" className="icon-btn icon-btn--round" aria-label={t("sys.back")} onClick={onBack}>
          <Icon name="chev" size={16} className="flip-rtl" />
        </button>
        <h3>{t("sys.files.title")}</h3>
        <DriveChips drives={drives} active={drive} onPick={onDrive} />
      </header>

      {running || !result ? (
        <section className="card scanning">
          <div className="scanning__title">{t("sys.files.scanning").replace("{d}", drive.replace(":", ""))}</div>
          <div className="scanning__sub">{t("sys.files.scanned").replace("{n}", fmtNumber(progress?.files ?? 0, lang))}</div>
          <div className="bar">
            <i style={{ width: `${progress && progress.bytesTotal > 0 ? Math.min(100, (progress.bytes / progress.bytesTotal) * 100) : 4}%` }} />
          </div>
          <div className="scanning__path" dir="ltr">
            {progress?.current ?? ""}
          </div>
          {running ? (
            <button type="button" className="pill-btn pill-btn--ghost" onClick={() => void cancelScan()}>
              {t("sys.files.cancel")}
            </button>
          ) : (
            <button type="button" className="pill-btn pill-btn--primary" onClick={() => void scanDrive(drive)}>
              {t("sys.files.rescan")}
            </button>
          )}
        </section>
      ) : (
        <>
          <div className="filters">
            {FILTERS.map(([id, key]) => (
              <button key={id} type="button" className={"filter" + (filter === id ? " is-active" : "")} onClick={() => setFilter(id)}>
                {t(key)}
              </button>
            ))}
            <button type="button" className="filter filter--ghost" title={relTime(result.finishedMs, lang, t)} onClick={() => void scanDrive(drive)}>
              <Icon name="search" size={13} /> {t("sys.files.rescan")}
            </button>
          </div>
          <ul className="files">
            {files.length === 0 && <li className="files__empty">{t("sys.files.none")}</li>}
            {files.map((f) => (
              <li key={f.path} className={"file" + (f.locked ? " is-locked" : "") + (picked.has(f.path) ? " is-picked" : "")}>
                <button type="button" className="file__row" disabled={f.locked} onClick={() => toggle(f)} title={f.path}>
                  <span className="file__check" aria-hidden="true">
                    {f.locked ? <Icon name="lock" size={13} /> : <Icon name="check" size={13} />}
                  </span>
                  <span className="file__text">
                    <bdi className="file__name">{f.name}</bdi>
                    <span className="file__sub">
                      {f.locked ? (
                        <Fill text={t("sys.files.system")} k="{d}" value={`${drive}\\`} />
                      ) : (
                        <>
                          {relTime(f.modifiedMs, lang, t)} · <bdi>{f.folder}</bdi>
                        </>
                      )}
                    </span>
                  </span>
                  <span className="file__size">{fmtBytes(f.size)}</span>
                </button>
              </li>
            ))}
          </ul>
          <footer className="files__foot">
            <span className="files__total">
              <Fill text={t("sys.files.selected")} k="{bytes}" value={fmtBytes(selectedBytes)} />
            </span>
            {note && <span className="files__note">{note}</span>}
            {target && (
              <button type="button" className="pill-btn pill-btn--butter-ghost" disabled={!selected.length || busy} onClick={() => void act("move")}>
                <Icon name="folder" size={14} /> <Fill text={t("sys.files.move")} k="{d}" value={target.letter} />
              </button>
            )}
            <button type="button" className="pill-btn pill-btn--coral" disabled={!selected.length || busy} onClick={() => void act("recycle")}>
              <Icon name="trash" size={14} /> {t("sys.files.recycle")}
            </button>
          </footer>
          <div className="sys__foot">{t("sys.files.rule")}</div>
        </>
      )}
    </div>
  );
}

/** A translated line with one Latin value (path, size, drive) isolated so bidi can't reorder it. */
function Fill({ text, k, value }: { text: string; k: string; value: string }) {
  const [before, after = ""] = text.split(k);
  return (
    <>
      {before}
      <bdi dir="ltr">{value}</bdi>
      {after}
    </>
  );
}
