import { useCallback, useEffect, useRef, useState, type CSSProperties, type WheelEvent } from "react";
import { Icon } from "@/components/Icon";
import { focusOverlay, recenterOverlay, setOverlayExpanded, toolRun } from "@/ipc/commands";
import { Events, onEvent } from "@/ipc/events";
import { useT } from "@/i18n";
import type { CapsuleStyle } from "@/ipc/generated/CapsuleStyle";
import type { Notification } from "@/ipc/generated/Notification";
import { useSettings } from "@/lib/settings";
import { isWinter, nuriPace } from "@/lib/winter";
import { refreshHitRects, useHitRect } from "@/features/overlay/hitRects";
import { useOverlayDrag } from "@/features/overlay/useOverlayDrag";
import { Nimi, type NimiHandle } from "@/features/character/Nimi";
import { setAmbientMood, setMoodOverride, useNimiMood } from "@/features/character/useNimiMood";
import { hasSong, media, useMedia, useMusicActive, useVolume } from "@/features/music/media";
import { MusicCapsule, MusicIsland, useRememberPlayer } from "@/features/music/Music";
import { Panel } from "@/features/panel/Panel";
import { dismiss as dismissFeed, reopen as reopenFeed, setFeedEnabled, useFeed, useFeedDrops } from "@/features/feed/feed";
import { FeedLayer, useFeedZones } from "@/features/feed/FeedLayer";
import { PocketTray, usePocket } from "@/features/pocket/Pocket";
import type { TabId } from "@/features/panel/TabBar";
import { CommandBar, type Outcome } from "@/features/commandbar/CommandBar";
import { useTimers } from "@/features/shortcuts/timer";
import { NoticeCapsule } from "@/features/notifications/NoticeCapsule";
import { levelOf, moodFor, onNotifyNew, useNotifications } from "@/features/notifications/notify";
import { TimerCapsule } from "@/features/shortcuts/TimerCapsule";
import { TimerPill } from "@/features/shortcuts/TimerPill";
import { onShellRequest } from "./actions";
import { CapsuleMenu, CapsulePill } from "./CapsuleMenu";
import { CAPSULE_TOP, COMMAND_NIMI_SIZE, DEFAULT_NIMI_SIZE, FEED_NIMI_CENTER, FEED_NIMI_SIZE, ISLAND_NIMI_SIZE, PANEL_NIMI_SIZE, PANEL_TOP } from "./constants";
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

type Mode = "compact" | "island" | "panel" | "pocket" | "command";
type Pill = { kind: "song" | "volume" | "toast"; text: string; icon?: "play" | "pause" | "check" | "timer" | "pick"; tone?: "butter" } | null;

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
  const modeRef = useRef(mode);
  modeRef.current = mode;
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
  // The feeding stage is open. A job left running behind the capsule (`bg`) doesn't count: the
  // capsule stays itself, with NIMI's working face and a pill, until the result is clicked.
  const feeding = feed.phase !== "idle" && !feed.bg;
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
      // NIMI stays curious while the command bar is open (board 10); leaving it ends that.
      if (next === "command") setMoodOverride("curious", 120_000);
      else if (modeRef.current === "command") setMoodOverride(null);
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
    mode === "panel" || mode === "pocket"
      ? PANEL_NIMI_SIZE
      : mode === "island"
        ? ISLAND_NIMI_SIZE
        : mode === "command"
          ? COMMAND_NIMI_SIZE
          : feeding
            ? FEED_NIMI_SIZE
            : size;

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

  // --- command bar (spec §8), tools, timers (phase 7) -----------------------------------------
  const [prefill, setPrefill] = useState("");
  const [commandHeight, setCommandHeight] = useState(200);
  const openCommand = useCallback(
    (text = "") => {
      setPrefill(text);
      setPill(null);
      show("command");
    },
    [show],
  );
  useEffect(
    () =>
      onEvent(Events.commandOpen, () => {
        if (modeRef.current === "command") close();
        else openCommand("");
      }),
    [openCommand, close],
  );
  // Screen tools run once the panel / bar has gone, so they never capture NIMI's own UI.
  const runTool = useCallback(
    (tool: "screenshot" | "colorPicker" | "lock") => {
      close();
      window.setTimeout(() => void toolRun(tool).catch(() => flash({ kind: "toast", text: t("cmd.err.generic") }, 2400)), tool === "lock" ? 0 : 320);
    },
    [close, flash, t],
  );
  const commandDone = useCallback(
    (outcome: Outcome | null) => {
      close();
      if (!outcome) return;
      if (outcome.tool) runTool(outcome.tool);
      if (outcome.toast) flash({ kind: "toast", text: outcome.toast, icon: outcome.ok ? "check" : undefined, tone: outcome.tone }, 2600);
      setMoodOverride(outcome.ok || outcome.tone ? "happy" : outcome.toast ? "shy" : null, 1800);
    },
    [close, flash, runTool],
  );
  useEffect(
    () =>
      onShellRequest((r) => {
        if (r.kind === "command") openCommand(r.prefill ?? "");
        else if (r.kind === "tool") runTool(r.tool);
        else if (r.kind === "tab") {
          setTab(r.tab);
          show("panel");
        } else flash({ kind: "toast", text: r.text, tone: r.tone }, 2600);
      }),
    [openCommand, runTool, flash, show],
  );
  // The color picker closed with a color: it is on the clipboard.
  useEffect(
    () =>
      onEvent<string | null>(Events.pickerDone, (hex) => {
        if (!hex) return;
        flash({ kind: "toast", text: t("picker.copied").replace("{s}", hex), icon: "pick", tone: "butter" }, 2600);
        setMoodOverride("happy", 1500);
      }),
    [flash, t],
  );

  // A snip taken through NIMI was saved (setting «وين تنحفظ اللقطة»).
  useEffect(
    () =>
      onEvent<{ Ok?: string; Err?: string }>(Events.screenshotSaved, (r) => {
        if (r.Ok) {
          const name = r.Ok.split(/[\\/]/).pop() ?? r.Ok;
          flash({ kind: "toast", text: t("shot.saved").replace("{s}", `⁨${name}⁩`), icon: "check", tone: "butter" }, 3200);
          setMoodOverride("happy", 1500);
        } else {
          flash({ kind: "toast", text: t("shot.failed") }, 3200);
        }
      }),
    [flash, t],
  );

  const timersState = useTimers();
  const mainTimer = timersState.main;
  // --- notifications (phase 8, board 14) ----------------------------------------------------
  // هادي: an expression only. عادي: the capsule grows with the note for 5 s. مهم: a double nudge
  // and the note stays until clicked. «لا تزعجني» keeps all of it in the list only.
  const [notice, setNotice] = useState<Notification | null>(null);
  const notes = useNotifications();
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const [nudge, setNudge] = useState(0);
  const noticeTimer = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);
  const clearNotice = useCallback(() => {
    window.clearTimeout(noticeTimer.current);
    setNotice(null);
    setMoodOverride(null);
  }, []);
  useEffect(
    () =>
      onNotifyNew((n) => {
        if (settingsRef.current?.dnd) return;
        const level = levelOf(n);
        if (level === "calm") {
          setMoodOverride(moodFor(n), 2600);
          return;
        }
        nimiRef.current?.poke();
        window.clearTimeout(noticeTimer.current);
        setNotice(n);
        if (level === "important") {
          setMoodOverride("attention", 600_000);
          setNudge((k) => k + 1);
        } else {
          setMoodOverride(moodFor(n), 5000);
          // After 5 s an unread «مهم» one (if any) takes the capsule back.
          noticeTimer.current = window.setTimeout(() => {
            const sticky = notesRef.current.find((x) => !x.read && levelOf(x) === "important") ?? null;
            setNotice((cur) => (cur?.id === n.id ? sticky : cur));
            if (sticky) setMoodOverride("attention", 600_000);
          }, 5000);
        }
      }),
    [],
  );
  // «لا تزعجني» switched on: whatever the capsule shows goes back to the list.
  const dnd = settings?.dnd ?? false;
  useEffect(() => {
    if (dnd) clearNotice();
  }, [dnd, clearNotice]);
  // An unread «مهم» one survives a restart; reading or dismissing it in the list clears it here.
  const restored = useRef(false);
  const seenInList = useRef(0);
  useEffect(() => {
    if (!restored.current && notes.length) {
      restored.current = true;
      const pending = notes.find((n) => !n.read && levelOf(n) === "important");
      if (pending && !settingsRef.current?.dnd) {
        setNotice(pending);
        setMoodOverride("attention", 600_000);
      }
      return;
    }
    if (!notice) return;
    // The list may arrive a moment after the «new» event: only a notification already seen in the
    // list and then read or removed clears the capsule.
    const inList = notes.find((n) => n.id === notice.id);
    if (inList) {
      seenInList.current = notice.id;
      if (inList.read) clearNotice();
    } else if (seenInList.current === notice.id) clearNotice();
  }, [notes, notice, clearNotice]);
  useEffect(() => {
    if (!nudge) return;
    const el = ref.current;
    el?.classList.remove("shell--nudge");
    void el?.offsetWidth; // restart the animation
    el?.classList.add("shell--nudge");
    const id = window.setTimeout(() => el?.classList.remove("shell--nudge"), 950);
    return () => window.clearTimeout(id);
  }, [nudge]);

  const onWheel = (e: WheelEvent) => {
    // Only the bare capsule is a volume knob: over a feed stage (e.g. a long text result) or the
    // right-click menu the wheel scrolls that content instead.
    if (expanded || feeding || menuOpen || !volume.available) return;
    const notches = Math.max(-3, Math.min(3, -e.deltaY / 100));
    media.setVolume(media.volume().level + notches * WHEEL_STEP);
  };

  // «الكبسولة»: the compact look. The panel and the island are always glass with NIMI.
  const capsuleStyle: CapsuleStyle = settings?.capsuleStyle ?? "nimiInCapsule";
  const noticeLook = !expanded && !feeding && !menuOpen && !!notice;
  const nimiShown = expanded || feeding || noticeLook || capsuleStyle !== "capsuleOnly";
  const nimiMounted = useFadeMount(nimiShown, NIMI_FADE_MS);
  // A running timer takes the capsule over from the music look (board 13 note).
  const timerLook = !expanded && !feeding && !noticeLook && !!mainTimer && capsuleStyle !== "nimiOnly";
  const musicLook = !expanded && !feeding && !noticeLook && !timerLook && musicActive && capsuleStyle !== "nimiOnly";

  // «يطل»: over a maximized window only a 12 px strip stays; it alone takes the mouse.
  // No «يطل» while a job runs behind the capsule (or its result waits): Kai wants to see it working.
  const peek = usePeek({ enabled: settings?.peekOverMaximized ?? true, expanded: expanded || menuOpen || feeding || feed.bg || !!notice || pill?.kind === "toast" });
  useHitRect(ref, "shell", !peek);
  useHitRect(stripRef, "peek", peek);

  // The hit rect follows the shell box, which changes shape with the style, music and peek.
  useEffect(() => trackMorph(), [capsuleStyle, peek, musicLook, timerLook, noticeLook, feed.phase, feed.bg, tab, commandHeight, trackMorph]);

  const vars = {
    ...(mode === "command" ? { height: commandHeight } : null),
    "--nimi-scale": scale,
    "--capsule-top": `${CAPSULE_TOP}px`,
    "--panel-top": `${PANEL_TOP}px`,
  } as CSSProperties;

  return (
    <>
      <div
        ref={stripRef}
        className={`peek-strip peek-strip--${capsuleStyle}` + (musicLook ? " peek-strip--music" : "") + (timerLook ? " peek-strip--timer" : "") + (noticeLook ? " peek-strip--notice" : "")}
        style={{ ...vars, height: undefined }}
        aria-hidden="true"
      />
      <div
        ref={ref}
        className={[
          "shell",
          mode === "panel"
            ? "shell--panel" + (tab === "shortcuts" || tab === "notifications" || tab === "games" ? " shell--tall" : "")
            : mode === "command"
              ? "shell--command"
              : mode === "island"
              ? "shell--island"
              : mode === "pocket"
                ? "shell--pocket"
                : feeding
                  ? `shell--feed shell--feed-${feed.phase}`
                  : `shell--capsule shell--${noticeLook ? "nimiInCapsule" : capsuleStyle}`,
          musicLook && "shell--music",
          timerLook && "shell--timer",
          noticeLook && "shell--notice",
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
          if (feed.bg) {
            window.clearTimeout(pendingOpen.current);
            reopenFeed();
            return;
          }
          // A notification in the capsule: a click opens the list (its button runs the action).
          if (notice) {
            window.clearTimeout(pendingOpen.current);
            clearNotice();
            setTab("notifications");
            show("panel");
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
        {timerLook && mainTimer && <TimerCapsule timer={mainTimer} />}
        {noticeLook && notice && <NoticeCapsule n={notice} onDone={clearNotice} />}
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
        <CommandBar open={mode === "command"} prefill={prefill} onDone={commandDone} onHeight={setCommandHeight} />
        <PocketTray open={mode === "pocket"} onClose={close} />
        {feeding && mode === "compact" && <FeedLayer nimiCenter={FEED_NIMI_CENTER} />}
        {!expanded && !feeding && !peek && pocketCount > 0 && (
          <span className={`pocket-badge pocket-badge--${capsuleStyle}`} title={t("pocket.title")}>
            <Icon name="pocket" size={12} />
            {pocketCount}
          </span>
        )}
        {!expanded && !peek && menuOpen && (
          <CapsuleMenu onClose={closeMenu} pocketCount={pocketCount} onPocket={() => window.setTimeout(() => show("pocket"), 0)} />
        )}
        {!expanded && !peek && !menuOpen && !pill && feed.bg && (
          <CapsulePill key={`feed-${feed.phase}`} tone={feed.phase === "result" ? "butter" : undefined}>
            <Icon name={feed.phase === "working" ? "timer" : feed.phase === "result" ? "check" : "info"} size={14} className="capsule-pill__icon" />
            <bdi>{t(feed.phase === "working" ? "feed.bg.working" : feed.phase === "result" ? "feed.bg.done" : "feed.bg.failed")}</bdi>
          </CapsulePill>
        )}
        {!expanded && !peek && !menuOpen && !pill && !feed.bg && !notice && mainTimer && capsuleStyle === "nimiOnly" && <TimerPill timer={mainTimer} />}
        {!expanded && !peek && !menuOpen && pill && (
          <CapsulePill key={pill.kind + pill.text} tone={pill.kind === "volume" || pill.tone === "butter" ? "butter" : undefined}>
            {pill.icon && <Icon name={pill.icon} size={14} className="capsule-pill__icon" />}
            <bdi>{pill.text}</bdi>
          </CapsulePill>
        )}
      </div>
    </>
  );
}
