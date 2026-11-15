import { useEffect, useState, type CSSProperties } from "react";
import { Icon } from "@/components/Icon";
import { useT } from "@/i18n";
import { openMediaPlayer } from "@/ipc/commands";
import type { MediaState } from "@/ipc/generated/MediaState";
import { fmtTime, hasSong, media, useMedia, useMediaArt, usePosition, useVolume } from "./media";
import "./music.css";

/**
 * Music UI (design spec §4, board 07 option B): the capsule's music look, the 736×160 island,
 * the panel's Music tab and the pieces they share. Media content is laid out left-to-right in
 * both languages, as on the boards (a timeline reads left to right); text inside follows its
 * own direction.
 */

/** Album art, or the rose→periwinkle tile with a music note (board 07). */
export function ArtTile({ size, className }: { size: number; className?: string }) {
  const art = useMediaArt();
  return (
    <div className={"art" + (className ? ` ${className}` : "")} style={{ width: size, height: size }}>
      {art ? <img src={art} alt="" draggable={false} /> : <Icon name="music" size={Math.round(size * 0.42)} />}
    </div>
  );
}

/** Four bouncing bars; still while paused. Compositor-only (transform). */
export function Equalizer({ playing, className }: { playing: boolean; className?: string }) {
  return (
    <span className={"eq" + (playing ? " is-playing" : "") + (className ? ` ${className}` : "")} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/** Seek bar with both times; read-only (no thumb) when the player does not allow seeking. */
export function SeekBar({ m, active, className }: { m: MediaState; active: boolean; className?: string }) {
  const position = usePosition(m, active);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? position;
  const pct = m.durationMs > 0 ? Math.min(100, (shown / m.durationMs) * 100) : 0;
  const commit = () => {
    if (drag != null) media.seekTo(drag);
    setDrag(null);
  };
  return (
    <div className={"seek" + (m.canSeek ? "" : " is-readonly") + (className ? ` ${className}` : "")}>
      <span className="seek__time">{fmtTime(shown)}</span>
      <input
        type="range"
        className="seek__bar"
        min={0}
        max={Math.max(1, m.durationMs)}
        step={1000}
        value={Math.min(shown, Math.max(1, m.durationMs))}
        disabled={!m.canSeek}
        style={{ "--pct": `${pct}%` } as CSSProperties}
        aria-label="seek"
        onChange={(e) => setDrag(Number(e.currentTarget.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={() => setDrag(null)}
      />
      <span className="seek__time">{m.durationMs > 0 ? fmtTime(m.durationMs) : "–:––"}</span>
    </div>
  );
}

/** −10 s · previous · play/pause · next · +10 s. */
export function Transport({ m, big = false }: { m: MediaState; big?: boolean }) {
  const t = useT();
  const playing = m.status === "playing";
  const btn = big ? "tbtn tbtn--lg" : "tbtn";
  return (
    <div className={"transport" + (big ? " transport--lg" : "")}>
      <button type="button" className={btn} disabled={!m.canSeek} title={t("music.back10")} aria-label={t("music.back10")} onClick={() => media.seekBy(-10_000)}>
        <Icon name="back10" size={big ? 20 : 17} />
      </button>
      <button type="button" className={btn} disabled={!m.canPrev} title={t("music.prev")} aria-label={t("music.prev")} onClick={media.previous}>
        <Icon name="prev" size={big ? 20 : 17} />
      </button>
      <button
        type="button"
        className={"tbtn tbtn--play" + (big ? " tbtn--play-lg" : "")}
        disabled={!m.canPlayPause}
        title={t(playing ? "music.pause" : "music.play")}
        aria-label={t(playing ? "music.pause" : "music.play")}
        onClick={media.playPause}
      >
        <Icon name={playing ? "pause" : "play"} size={big ? 26 : 20} />
      </button>
      <button type="button" className={btn} disabled={!m.canNext} title={t("music.next")} aria-label={t("music.next")} onClick={media.next}>
        <Icon name="next" size={big ? 20 : 17} />
      </button>
      <button type="button" className={btn} disabled={!m.canSeek} title={t("music.fwd10")} aria-label={t("music.fwd10")} onClick={() => media.seekBy(10_000)}>
        <Icon name="fwd10" size={big ? 20 : 17} />
      </button>
    </div>
  );
}

/** System volume: speaker icon + slider (+ percentage in the panel). */
export function VolumeControl({ showPct = false, className }: { showPct?: boolean; className?: string }) {
  const t = useT();
  const v = useVolume();
  if (!v.available) return null;
  const pct = Math.round(v.level * 100);
  return (
    <label className={"vol" + (className ? ` ${className}` : "")}>
      <Icon name={v.muted || pct === 0 ? "mute" : "vol"} size={17} />
      <input
        type="range"
        className="vol__bar"
        min={0}
        max={100}
        value={pct}
        aria-label={t("music.volume")}
        style={{ "--pct": `${pct}%` } as CSSProperties}
        onChange={(e) => media.setVolume(Number(e.currentTarget.value) / 100)}
      />
      {showPct && <span className="vol__pct">{pct}%</span>}
    </label>
  );
}

function SongText({ m, inline = false }: { m: MediaState; inline?: boolean }) {
  return inline ? (
    <div className="song song--inline">
      <bdi className="song__title">{m.title}</bdi>
      {m.artist && <bdi className="song__artist">{m.artist}</bdi>}
    </div>
  ) : (
    <div className="song">
      <bdi className="song__title">{m.title}</bdi>
      {m.artist && <bdi className="song__artist">{m.artist}</bdi>}
    </div>
  );
}

/** «ما فيه شي شغّال» (board_states): bored NIMI is drawn by the caller. */
export function MusicEmpty({ className }: { className?: string }) {
  const t = useT();
  const [lastApp] = useState(() => lastSourceApp());
  return (
    <div className={"music-empty" + (className ? ` ${className}` : "")}>
      <div className="music-empty__title">{t("music.empty.title")}</div>
      <div className="music-empty__sub">{t("music.empty.sub")}</div>
      <button type="button" className="pill-btn pill-btn--primary" onClick={() => void openMediaPlayer(lastApp).catch(console.error)}>
        {t("music.empty.open")}
      </button>
    </div>
  );
}

// --- capsule -----------------------------------------------------------------------------------

/** The capsule's music look (board 06/07 ①): art · [NIMI] · equalizer · time. */
export function MusicCapsule({ nimi }: { nimi: boolean }) {
  const m = useMedia();
  const position = usePosition(m, true, 1000);
  return (
    <div className={"music-capsule" + (nimi ? "" : " music-capsule--bare")}>
      <ArtTile size={36} className="music-capsule__art" />
      <span className="music-capsule__end">
        <Equalizer playing={m.status === "playing"} />
        <span className="music-capsule__time">{fmtTime(position)}</span>
      </span>
    </div>
  );
}

// --- island ------------------------------------------------------------------------------------

/** The 736×160 island (board 07 ②). NIMI is drawn by the shell in the left slot. */
export function MusicIsland({ open, onOpenPanel }: { open: boolean; onOpenPanel: () => void }) {
  const t = useT();
  const m = useMedia();
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const id = window.setTimeout(() => setMounted(false), 320);
    return () => window.clearTimeout(id);
  }, [open]);
  if (!mounted) return null;
  return (
    <div className={"island" + (open ? " is-open" : "")} aria-hidden={!open} inert={!open}>
      <span className="island__divider" />
      {hasSong(m) ? (
        <>
          <ArtTile size={80} className="island__art" />
          <div className="island__main">
            <SongText m={m} inline />
            <SeekBar m={m} active={open} />
            <div className="island__row">
              <Transport m={m} />
              <VolumeControl />
            </div>
          </div>
        </>
      ) : (
        <MusicEmpty className="island__empty" />
      )}
      <button type="button" className="island__expand icon-btn icon-btn--round" title={t("music.openPanel")} aria-label={t("music.openPanel")} onClick={onOpenPanel}>
        <Icon name="open" size={16} />
      </button>
    </div>
  );
}

// --- panel tab ---------------------------------------------------------------------------------

/** The panel's «الأغنية» tab: same content as the island, roomier (spec §5). */
export function MusicTab({ nimi }: { nimi: React.ReactNode }) {
  const t = useT();
  const m = useMedia();
  if (!hasSong(m)) {
    return (
      <section className="card music-tab music-tab--empty">
        {nimi}
        <MusicEmpty />
      </section>
    );
  }
  return (
    <section className="card music-tab">
      <div className="music-tab__head">
        <ArtTile size={84} />
        <div className="music-tab__text">
          <SongText m={m} />
          {m.sourceName && (
            <div className="music-tab__from" dir={document.documentElement.dir || "ltr"}>
              <Icon name="music" size={13} />
              <span>{t("music.from").replace("{app}", m.sourceName)}</span>
            </div>
          )}
        </div>
        <Equalizer playing={m.status === "playing"} className="eq--lg" />
      </div>
      <SeekBar m={m} active />
      {!m.canSeek && <div className="music-tab__note">{t("music.noseek")}</div>}
      <Transport m={m} big />
      <VolumeControl showPct className="vol--wide" />
    </section>
  );
}

/** Small «now playing» card for Home: art, title, prev / play / next. */
export function NowPlayingCard() {
  const t = useT();
  const m = useMedia();
  const song = hasSong(m);
  const playing = m.status === "playing";
  return (
    <section className="card nowplaying">
      <ArtTile size={52} className="nowplaying__art" />
      <div className="nowplaying__text">
        <div className="card__title">{song ? <bdi>{m.title}</bdi> : t("home.nowplaying.none")}</div>
        <div className="card__sub">{song ? <bdi>{m.artist}</bdi> : t("home.nowplaying.hint")}</div>
      </div>
      <div className="nowplaying__controls">
        <button type="button" className="icon-btn icon-btn--sm" disabled={!m.canPrev} aria-label={t("music.prev")} onClick={media.previous}>
          <Icon name="prev" size={16} />
        </button>
        <button type="button" className="icon-btn icon-btn--sm icon-btn--primary" disabled={!m.canPlayPause} aria-label={t(playing ? "music.pause" : "music.play")} onClick={media.playPause}>
          <Icon name={playing ? "pause" : "play"} size={16} />
        </button>
        <button type="button" className="icon-btn icon-btn--sm" disabled={!m.canNext} aria-label={t("music.next")} onClick={media.next}>
          <Icon name="next" size={16} />
        </button>
      </div>
    </section>
  );
}

// --- last player (for «افتح مشغّلك المفضّل») ----------------------------------------------------

const LAST_APP_KEY = "nimi.music.lastApp";

function lastSourceApp(): string | null {
  try {
    return localStorage.getItem(LAST_APP_KEY);
  } catch {
    return null;
  }
}

/** Remembers the app that last played, so the empty state can reopen it. */
export function useRememberPlayer() {
  const m = useMedia();
  useEffect(() => {
    if (!m.sourceApp || !hasSong(m)) return;
    try {
      localStorage.setItem(LAST_APP_KEY, m.sourceApp);
    } catch {
      /* storage unavailable: the button falls back to the system player */
    }
  }, [m]);
}
