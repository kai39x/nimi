import { useCallback, useEffect, useRef, useState, type CSSProperties, type WheelEvent } from "react";
import { Icon } from "@/components/Icon";
import { focusOverlay, recenterOverlay, setOverlayExpanded } from "@/ipc/commands";
import { Events, onEvent } from "@/ipc/events";
import { useT } from "@/i18n";
import type { CapsuleStyle } from "@/ipc/generated/CapsuleStyle";
import { useSettings } from "@/lib/settings";
import { isWinter, nuriPace } from "@/lib/winter";
import { refreshHitRects, useHitRect } from "@/features/overlay/hitRects";
import { useOverlayDrag } from "@/features/overlay/useOverlayDrag";
import { Nimi, type NimiHandle } from "@/features/character/Nimi";
import { setAmbientMood, useNimiMood } from "@/features/character/useNimiMood";
import { hasSong, media, useMedia, useMusicActive, useVolume } from "@/features/music/media";
import { MusicCapsule, MusicIsland, useRememberPlayer } from "@/features/music/Music";
import { Panel } from "@/features/panel/Panel";
import { dismiss as dismissFeed, setFeedEnabled, useFeed, useFeedDrops } from "@/features/feed/feed";
import { FeedLayer, useFeedZones } from "@/features/feed/FeedLayer";
import { PocketTray, usePocket } from "@/features/pocket/Pocket";
import type { TabId } from "@/features/panel/TabBar";
import { CapsuleMenu, CapsulePill } from "./CapsuleMenu";
import { CAPSULE_TOP, DEFAULT_NIMI_SIZE, FEED_NIMI_CENTER, FEED_NIMI_SIZE, ISLAND_NIMI_SIZE, PANEL_NIMI_SIZE, PANEL_TOP } from "./constants";
import { usePeek } from "./usePeek";
import "./shell.css";

/** Time to wait for a second click before treating a click as a single click. */
const DOUBLE_CLICK_MS = 260;
/** NIMI fades out before unmounting («الكبسولة بس»), so a hidden NIMI costs no animation time. */
const NIMI_FADE_MS = 200;
/** Hover this long on the capsule before the song name shows (board 07 gestures). */
const SONG_TOOLTIP_MS = 450;
/** How long the volume pill and the orbit-ring meter stay after the last change. */
const VOLUME_SHOW_MS = 1200;
/** Volume step per wheel notch (deltaY 100). */
const WHEEL_STEP = 0.02;

type Mode = "compact" | "island" | "panel" | "pocket";
type Pill = { kind: "song" | "volume" | "toast"; text: string; icon?: "play" | "pause" } | null;

/** Stays true for `ms` after `shown` turns false, so the element can fade before unmounting. */
function useFadeMount(shown: boolean, ms: number): boolean {
  const [mounted, setMounted] = useState(shown);
  useEffect(() => {
    if (shown) {
      setMounted(true);
      return;
    }
    const t = window.setTimeout(() => setMounted(false), ms);
    return () => window.clearTimeout(t);
  }, [shown, ms]);
  return shown || mounted;
}

/**
 * The one glass surface NIMI lives in. Compact it is the 148×52 capsule (board 06) — wider with
 * art · equalizer · time while music plays. A click morphs it into the 736×160 music island when
 * a song is on (board 07, option B), else into the 880 px panel (board 11). Esc or a click
 * outside brings the capsule back. Capsule gestures (spec §4): hover → song name, wheel →
 * system volume with the orbit ring as the meter, double-click → play/pause (recenter when
 * nothing plays), right-click → menu.
 */
export function Shell() {
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  const settings = useSettings();
  const drag = useOverlayDrag();
  const [mode, setMode] = useState<Mode>("compact");
  const [tab, setTab] = useState<TabId>("home");
  const [menuOpen, setMenuOpen] = useState(false);
  const expanded = mode !== "compact";
  const stripRef = useRef<HTMLDivElement>(null);

  const size = settings?.nimiSize ?? DEFAULT_NIMI_SIZE;
  const scale = size / DEFAULT_NIMI_SIZE;
  const winter = isWinter(settings);
  const nimiRef = useRef<NimiHandle>(null);
  const { mood, onClick: moodClick, onPointerEnter, onPointerLeave } = useNimiMood({
    sleepAfterMin: settings?.sleepAfterMin ?? 10,
    nimi: nimiRef,
  });

  // --- music -------------------------------------------------------------------------------
  const m = useMedia();
  const musicActive = useMusicActive();
  const volume = useVolume();
  useRememberPlayer();
  useEffect(() => setAmbientMood(m.status === "playing" ? "music" : null), [m.status]);
  const musicRef = useRef(musicActive);
  musicRef.current = musicActive;

  // --- feeding (board 08) and the pocket (board 09) -------------------------------------------
  useFeedDrops();
  const feed = useFeed();
  const feeding = feed.phase !== "idle";
  const pocket = usePocket();
  const pocketCount = pocket.filter((p) => !p.missing).length;
  useEffect(() => setFeedEnabled(mode === "compact"), [mode]);
  useFeedZones(
    useCallback(() => ref.current?.querySelector(".shell__nimi .nimi")?.getBoundingClientRect() ?? null, []),
    true,
  );

  // The hit rect must follow the morph frame by frame.
  const morphing = useRef(0);
  const trackMorph = useCallback(() => {
    const until = performance.now() + 520;
    const step = () => {
      refreshHitRects();
      if (performance.now() < until) morphing.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(morphing.current);
    morphing.current = requestAnimationFrame(step);
  }, []);

  const show = useCallback(
    (next: Mode) => {
      setMode(next);
      setMenuOpen(false);
      void setOverlayExpanded(next !== "compact");
      void focusOverlay(next !== "compact");
      trackMorph();
    },
    [trackMorph],
  );
  const openPanel = useCallback(() => show("panel"), [show]);
  const close = useCallback(() => show("compact"), [show]);

  // The right-click menu needs click-outside reports too, but never takes keyboard focus.
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    void setOverlayExpanded(false);
  }, []);

  const feedRef = useRef(false);
  const pendingOpen = useRef(0);
  useEffect(() => () => window.clearTimeout(pendingOpen.current), []);

  useEffect(
    () =>
      onEvent(Events.overlayClickOutside, () => {
        if (menuOpen) closeMenu();
        else if (feedRef.current) dismissFeed();
        else close();
      }),
    [close, closeMenu, menuOpen],
  );
  useEffect(() => onEvent(Events.trayOpen, openPanel), [openPanel]);

  feedRef.current = feeding;

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, close]);

  // The song ending while the island is open: it shows the empty state; the panel stays.
  const nimiSize =
    mode === "panel" || mode === "pocket" ? PANEL_NIMI_SIZE : mode === "island" ? ISLAND_NIMI_SIZE : feeding ? FEED_NIMI_SIZE : size;

  // --- pills: song name on hover, volume on wheel / external change, play/pause toast ----------
  const [pill, setPill] = useState<Pill>(null);
  const pillTimer = useRef(0);
  const hoverTimer = useRef(0);
  const flash = useCallback((next: NonNullable<Pill>, ms: number) => {
    window.clearTimeout(pillTimer.current);
    setPill(next);
    pillTimer.current = window.setTimeout(() => setPill(null), ms);
  }, []);
  useEffect(
    () => () => {
      window.clearTimeout(pillTimer.current);
      window.clearTimeout(hoverTimer.current);
    },
    [],
  );

  // Volume changes (ours or the keyboard's) light the orbit ring as a meter for a moment.
  const [meter, setMeter] = useState(false);
  const meterTimer = useRef(0);
  const lastVolume = useRef<string | null>(null);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  useEffect(() => {
    if (!volume.available) return;
    const key = `${volume.level.toFixed(3)}|${volume.muted}`;
    const first = lastVolume.current === null;
    if (lastVolume.current === key) return;
    lastVolume.current = key;
    if (first) return; // the initial reading is not a change
    setMeter(true);
    window.clearTimeout(meterTimer.current);
    meterTimer.current = window.setTimeout(() => setMeter(false), VOLUME_SHOW_MS);
    if (!expandedRef.current) flash({ kind: "volume", text: `${Math.round(volume.level * 100)}%` }, VOLUME_SHOW_MS);
  }, [volume.level, volume.muted, volume.available, flash]);
  useEffect(() => () => window.clearTimeout(meterTimer.current), []);

  const onWheel = (e: WheelEvent) => {
    if (expanded || !volume.available) return;
    const notches = Math.max(-3, Math.min(3, -e.deltaY / 100));
    media.setVolume(media.volume().level + notches * WHEEL_STEP);
  };

  // «الكبسولة»: the compact look. The panel and the island are always glass with NIMI.
  const capsuleStyle: CapsuleStyle = settings?.capsuleStyle ?? "nimiInCapsule";
  const nimiShown = expanded || feeding || capsuleStyle !== "capsuleOnly";
  const nimiMounted = useFadeMount(nimiShown, NIMI_FADE_MS);
  const musicLook = !expanded && !feeding && musicActive && capsuleStyle !== "nimiOnly";

  // «يطل»: over a maximized window only a 12 px strip stays; it alone takes the mouse.
  const peek = usePeek({ enabled: settings?.peekOverMaximized ?? true, expanded: expanded || menuOpen || feeding });
  useHitRect(ref, "shell", !peek);
  useHitRect(stripRef, "peek", peek);

  // The hit rect follows the shell box, which changes shape with the style, music and peek.
  useEffect(() => trackMorph(), [capsuleStyle, peek, musicLook, feed.phase, trackMorph]);

  const vars = {
    "--nimi-scale": scale,
    "--capsule-top": `${CAPSULE_TOP}px`,
    "--panel-top": `${PANEL_TOP}px`,
  } as CSSProperties;

  return (
    <>
      <div
        ref={stripRef}
        className={`peek-strip peek-strip--${capsuleStyle}` + (musicLook ? " peek-strip--music" : "")}
        style={vars}
        aria-hidden="true"
      />
      <div
        ref={ref}
        className={[
          "shell",
          mode === "panel"
            ? "shell--panel"
            : mode === "island"
              ? "shell--island"
              : mode === "pocket"
                ? "shell--pocket"
                : feeding
                  ? `shell--feed shell--feed-${feed.phase}`
                  : `shell--capsule shell--${capsuleStyle}`,
          musicLook && "shell--music",
          peek && "shell--peek",
          winter && "shell--winter",
        ]
          .filter(Boolean)
          .join(" ")}
        style={vars}
        role={expanded ? "dialog" : "button"}
        aria-label={t("app.name")}
        aria-expanded={expanded}
        onPointerDown={expanded || feeding ? undefined : drag.onPointerDown}
        onPointerEnter={(e) => {
          onPointerEnter(e);
          window.clearTimeout(hoverTimer.current);
          if (!expanded && musicRef.current && hasSong(m)) {
            hoverTimer.current = window.setTimeout(() => {
              const text = m.artist ? `${m.title} · ${m.artist}` : m.title;
              setPill((p) => (p && p.kind !== "song" ? p : { kind: "song", text }));
            }, SONG_TOOLTIP_MS);
          }
        }}
        onPointerLeave={() => {
          onPointerLeave();
          window.clearTimeout(hoverTimer.current);
          setPill((p) => (p?.kind === "song" ? null : p));
        }}
        onWheel={onWheel}
        onContextMenu={(e) => {
          e.preventDefault();
          if (expanded || feeding) return;
          window.clearTimeout(pendingOpen.current);
          setPill(null);
          setMenuOpen(true);
          void setOverlayExpanded(true);
        }}
        onClick={(e) => {
          if (expanded || feeding || drag.wasDragged()) return;
          if (menuOpen) {
            closeMenu();
            return;
          }
          // A pocket satellite (or the pocket badge) opens the pocket tray (spec §7).
          if ((e.target as Element).closest(".n-sat, .pocket-badge")) {
            window.clearTimeout(pendingOpen.current);
            show("pocket");
            return;
          }
          // Wait out the double-click interval before morphing: once the island or panel opens, a
          // second click would land outside the old capsule rect.
          window.clearTimeout(pendingOpen.current);
          if (e.detail === 1) {
            moodClick();
            pendingOpen.current = window.setTimeout(() => show(musicRef.current ? "island" : "panel"), DOUBLE_CLICK_MS);
          } else if (e.detail === 2) {
            if (hasSong(m) && m.canPlayPause) {
              const willPlay = m.status !== "playing";
              media.playPause();
              flash({ kind: "toast", text: t(willPlay ? "music.play" : "music.pause"), icon: willPlay ? "play" : "pause" }, 1400);
            } else {
              void recenterOverlay();
            }
          }
        }}
      >
        <div className="shell__glass n-glass" aria-hidden="true" />
        {musicLook && <MusicCapsule nimi={capsuleStyle !== "capsuleOnly"} />}
        {nimiMounted && (
          <div className={"shell__nimi" + (nimiShown ? "" : " is-leaving")} onClick={mode === "panel" ? moodClick : undefined}>
            <Nimi
              ref={nimiRef}
              mood={mood}
              size={nimiSize}
              winter={winter}
              volume={meter && !expanded ? (volume.muted ? 0 : volume.level) : null}
              satellites={Math.min(pocketCount, 8)}
              belly={feed.phase === "chew"}
              reducedMotion={settings?.reduceMotion ?? false}
              nuriPace={nuriPace(settings?.nuriActivity)}
            />
          </div>
        )}
        <MusicIsland
          open={mode === "island"}
          onOpenPanel={() => {
            setTab("music");
            show("panel");
          }}
        />
        <Panel open={mode === "panel"} mood={mood} tab={tab} onTab={setTab} onCollapse={close} />
        <PocketTray open={mode === "pocket"} onClose={close} />
        {feeding && mode === "compact" && <FeedLayer nimiCenter={FEED_NIMI_CENTER} />}
        {!expanded && !feeding && !peek && pocketCount > 0 && (
          <span className="pocket-badge" title={t("pocket.title")}>
            <Icon name="pocket" size={12} />
            {pocketCount}
          </span>
        )}
        {!expanded && !peek && menuOpen && <CapsuleMenu onClose={closeMenu} />}
        {!expanded && !peek && !menuOpen && pill && (
          <CapsulePill key={pill.kind} tone={pill.kind === "volume" ? "butter" : undefined}>
            {pill.icon && <Icon name={pill.icon} size={14} className="capsule-pill__icon" />}
            <bdi>{pill.text}</bdi>
          </CapsulePill>
        )}
      </div>
    </>
  );
}
