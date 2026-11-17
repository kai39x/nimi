import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Toggle } from "@/components/controls";
import { useT } from "@/i18n";
import { Events, onEvent } from "@/ipc/events";
import { updateSettings, useSettings } from "@/lib/settings";
import { play } from "@/lib/sounds";
import { setMoodOverride } from "@/features/character/useNimiMood";
import { useHitRect } from "@/features/overlay/hitRects";
import { useFeed } from "@/features/feed/feed";
import "./tour.css";

type Step = "star" | "hello" | "language" | "feed" | "ctrl" | "home";
const ORDER: Step[] = ["star", "hello", "language", "feed", "ctrl", "home"];

/** The tour steps aside while the command bar (or a feeding) is open: remember where it was. */
let savedStep: Step = "star";

/**
 * First launch (spec §10, board 17): under a minute, «تخطي» at every step, no windows — only
 * NIMI's bubbles. A star falls and wakes him; he says hello, asks the language, lets you feed him
 * a demo file, teaches double Ctrl, then settles into the capsule with «شغّلني مع ويندوز».
 * Saved as done; «الخصوصية ← الجولة التعريفية» shows it again.
 */
export function Tour({ nimi }: { nimi: () => DOMRect | null }) {
  const t = useT();
  const settings = useSettings();
  const feed = useFeed();
  const [step, setStep] = useState<Step>(() => savedStep);
  useEffect(() => {
    savedStep = step;
  }, [step]);
  const root = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  /** A real file was fed during the feed step (the demo has its own path). */
  const [ate, setAte] = useState(false);
  const [demoAte, setDemoAte] = useState(false);
  useHitRect(root, "tour");

  const next = () => setStep((s) => ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(s) + 1)]);
  const finish = () => {
    savedStep = "star";
    setMoodOverride("happy", 1500);
    void updateSettings({ onboarded: true });
  };

  // The star falls, then he wakes.
  useEffect(() => {
    if (step === "star") {
      setMoodOverride("sleeping", 10_000);
      const id = window.setTimeout(() => {
        play("nimi_wake");
        setMoodOverride("excited", 1800);
        setStep("hello");
      }, 1500);
      return () => window.clearTimeout(id);
    }
    if (step === "hello") {
      const id = window.setTimeout(() => setStep("language"), 3200);
      return () => window.clearTimeout(id);
    }
    if (step === "feed") setMoodOverride("curious", 60_000);
    if (step === "ctrl") setMoodOverride("attention", 60_000);
    if (step === "home") setMoodOverride("happy", 3000);
  }, [step]);

  // A real file fed to him counts too.
  useEffect(() => {
    if (step === "feed" && (feed.phase === "menu" || feed.phase === "pocketed")) {
      setAte(true);
    }
  }, [feed.phase, step]);
  useEffect(() => {
    if (step === "feed" && ate && feed.phase === "idle") {
      const id = window.setTimeout(next, 600);
      return () => window.clearTimeout(id);
    }
  }, [ate, feed.phase, step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Double Ctrl opens the bar; the tour goes on when the capsule is back.
  useEffect(
    () =>
      onEvent(Events.commandOpen, () => {
        // The bar opens and this unmounts: move the saved step on right away.
        if (savedStep === "ctrl") savedStep = "home";
        setStep((s) => (s === "ctrl" ? "home" : s));
      }),
    [],
  );

  // The demo file: drag it with the pointer onto NIMI.
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      // a pen / synthetic pointer without capture: the moves still arrive while over the tour
    }
    setDrag({ x: e.clientX, y: e.clientY });
  };
  const onMove = (e: React.PointerEvent) => drag && setDrag({ x: e.clientX, y: e.clientY });
  const onUp = (e: React.PointerEvent) => {
    if (!drag) return;
    setDrag(null);
    const r = nimi();
    if (r && e.clientX >= r.left - 20 && e.clientX <= r.right + 20 && e.clientY >= r.top - 20 && e.clientY <= r.bottom + 20) {
      setDemoAte(true);
      setMoodOverride("chomp", 500);
      play("nimi_chomp");
      window.setTimeout(() => {
        setMoodOverride("chew", 700);
        play("nimi_gulp");
      }, 500);
      window.setTimeout(() => {
        setMoodOverride("happy", 1400);
        next();
      }, 1300);
    }
  };

  const skip = (
    <button type="button" className="tour__skip" onClick={finish}>
      {t("tour.skip")}
    </button>
  );

  // The tour is rendered inside the capsule element: without this, every click on a tour button
  // also reached the capsule's handlers (open the island, start a drag, the right-click menu).
  const keep = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      ref={root}
      className={`tour tour--${step}`}
      onClick={keep}
      onDoubleClick={keep}
      onPointerDown={keep}
      onContextMenu={keep}
      onWheel={keep}
    >
      {step === "star" && <span className="tour__star" aria-hidden="true" />}

      {step === "hello" && (
        <div className="tour__bubble n-glass" onClick={next}>
          <div className="tour__text">{t("tour.hello")}</div>
        </div>
      )}

      {step === "language" && (
        <div className="tour__bubble n-glass">
          <div className="tour__text">{t("tour.language")}</div>
          <div className="tour__row">
            {(["ar", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                className={"chip tour__btn" + (settings?.language === l ? " chip--butter is-on" : "")}
                onClick={() => {
                  void updateSettings({ language: l });
                  next();
                }}
              >
                {l === "ar" ? "عربي" : "English"}
              </button>
            ))}
          </div>
          {skip}
        </div>
      )}

      {step === "feed" && (
        <div className="tour__bubble n-glass">
          <div className="tour__text">{ate || demoAte ? t("tour.feed.yum") : t("tour.feed")}</div>
          {!ate && !demoAte && (
            <div
              ref={chip}
              className={"tour__file" + (drag ? " is-dragging" : "")}
              style={drag ? { position: "fixed", left: drag.x - 22, top: drag.y - 26 } : undefined}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              title={t("tour.feed.file")}
            >
              <Icon name="image" size={22} />
              <span>PNG</span>
            </div>
          )}
          {!ate && !demoAte && (
            <button type="button" className="tour__skip" onClick={next}>
              {t("tour.skipStep")}
            </button>
          )}
        </div>
      )}

      {step === "ctrl" && (
        <div className="tour__bubble n-glass">
          <div className="tour__text">{t("tour.ctrl")}</div>
          <div className="tour__row">
            <span className="kbd">Ctrl</span>
            <span className="kbd">Ctrl</span>
          </div>
          <button type="button" className="tour__skip" onClick={next}>
            {t("tour.skipStep")}
          </button>
        </div>
      )}

      {step === "home" && (
        <div className="tour__bubble n-glass">
          <div className="tour__text">{t("tour.home")}</div>
          <label className="tour__row tour__auto">
            <span>{t("tour.autostart")}</span>
            <Toggle label={t("tour.autostart")} checked={settings?.autostart ?? false} onChange={(autostart) => void updateSettings({ autostart })} />
          </label>
          <button type="button" className="chip chip--butter tour__go" onClick={finish}>
            {t("tour.go")}
          </button>
        </div>
      )}
    </div>
  );
}
