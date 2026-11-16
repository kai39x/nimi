import { useCallback, useEffect, useState } from "react";
import nimiHappy from "@design/character/svg-small/nimi_happy_small.svg";
import nimiExcited from "@design/character/svg-small/nimi_excited_small.svg";
import nimiCurious from "@design/character/svg-small/nimi_curious_small.svg";
import nimiLove from "@design/character/svg-small/nimi_love_small.svg";
import nimiSleeping from "@design/character/svg-small/nimi_sleeping_small.svg";
import { Icon } from "@/components/Icon";
import { useT, type Lang, type TKey } from "@/i18n";
import type { GameScores } from "@/ipc/generated/GameScores";
import { fmtNumber } from "@/lib/format";
import { getSettingsNow, updateSettings, useSettings } from "@/lib/settings";
import { setMoodOverride } from "@/features/character/useNimiMood";
import { setPlaying } from "./engine";
import { ExpressionMemory } from "./ExpressionMemory";
import { MoonToss } from "./MoonToss";
import { StarCatch } from "./StarCatch";
import type { GameId } from "./types";
import "./games.css";

type Run = "ready" | "playing" | "paused" | "over";

const GAMES: Array<{ id: GameId; title: TKey; sub: TKey; hint: TKey }> = [
  { id: "star", title: "games.star", sub: "games.star.sub", hint: "games.star.hint" },
  { id: "moon", title: "games.moon", sub: "games.moon.sub", hint: "games.moon.hint" },
  { id: "memory", title: "games.memory", sub: "games.memory.sub", hint: "games.memory.hint" },
];

/** «٤٢ ث» */
function secs(ms: number, lang: Lang, t: (k: TKey) => string) {
  return t("games.secs").replace("{n}", fmtNumber(Math.max(1, Math.round(ms / 1000)), lang));
}

function best(id: GameId, g: GameScores | undefined): number {
  if (!g) return 0;
  return id === "star" ? g.starCatch : id === "moon" ? g.moonToss : g.memoryMs;
}

/** A higher score wins, except memory where the faster time wins. */
function beats(id: GameId, score: number, prev: number) {
  return id === "memory" ? score > 0 && (prev === 0 || score < prev) : score > prev;
}

/**
 * «ألعاب» (spec §5, board 15): the stage with the score, the best score, pause and Nuri's three
 * lives on top; the three game cards under it. Each round is under two minutes, offline; the best
 * score stays on this PC and NIMI celebrates a new one.
 */
export function GamesTab() {
  const t = useT();
  const settings = useSettings();
  const lang: Lang = settings?.language ?? "ar";
  const scores = settings?.games;
  const [game, setGame] = useState<GameId>("star");
  const [run, setRun] = useState<Run>("ready");
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [time, setTime] = useState(0);
  const [result, setResult] = useState<{ score: number; record: boolean } | null>(null);

  useEffect(() => {
    setPlaying(run === "playing" || run === "paused");
    return () => setPlaying(false);
  }, [run]);

  const start = (id: GameId) => {
    setGame(id);
    setScore(0);
    setLives(3);
    setTime(0);
    setResult(null);
    setRound((r) => r + 1);
    setRun("playing");
  };

  const onOver = useCallback(
    (final: number) => {
      const prev = best(game, getSettingsNow()?.games);
      const record = beats(game, final, prev);
      if (record) {
        const g = getSettingsNow()?.games ?? { starCatch: 0, moonToss: 0, memoryMs: 0 };
        void updateSettings({
          games: { ...g, ...(game === "star" ? { starCatch: final } : game === "moon" ? { moonToss: final } : { memoryMs: final }) },
        });
        setMoodOverride("celebrate", 4000);
      } else setMoodOverride(game === "memory" ? "happy" : "shy", 1800);
      setResult({ score: final, record: record && (game === "memory" || final > 0) });
      setRun("over");
    },
    [game],
  );

  // Space / P pauses; the panel closing or another tab ends the round (nothing saved).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "p") setRun((r) => (r === "playing" ? "paused" : r === "paused" ? "playing" : r));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const props = {
    paused: run !== "playing",
    onScore: setScore,
    onLives: setLives,
    onTime: setTime,
    onOver,
  };
  const def = GAMES.find((g) => g.id === game)!;
  const shownBest = best(game, scores);
  // Scores in Latin digits as on board 15 («120», «340»); seconds and counts follow the language.
  const big = String(score);

  return (
    <div className="games">
      <section className={`stage stage--${game}`}>
        <header className="stage__hud">
          <span className="stage__score">
            <b>{game === "memory" ? secs(time * 1000, lang, t) : big}</b>
            <span>
              {game === "memory"
                ? t("games.pairs").replace("{n}", fmtNumber(score, lang))
                : t("games.best").replace("{n}", String(shownBest))}
              {game === "memory" && shownBest > 0 && ` · ${t("games.bestTime").replace("{s}", secs(shownBest, lang, t))}`}
            </span>
          </span>
          <span className="stage__tools">
            {game !== "memory" && (
              <span className="stage__lives" aria-label={t("games.lives").replace("{n}", String(lives))}>
                {[0, 1, 2].map((i) => (
                  <span key={i} className={"life" + (i < lives ? "" : " is-lost")} />
                ))}
              </span>
            )}
            {(run === "playing" || run === "paused") && (
              <button
                type="button"
                className="icon-btn icon-btn--round stage__pause"
                aria-label={t(run === "paused" ? "games.resume" : "games.pause")}
                title={t(run === "paused" ? "games.resume" : "games.pause")}
                onClick={() => setRun(run === "paused" ? "playing" : "paused")}
              >
                <Icon name={run === "paused" ? "play" : "pause"} size={16} />
              </button>
            )}
          </span>
        </header>

        {run !== "ready" && (
          <div className="stage__game" key={round}>
            {game === "star" ? <StarCatch {...props} /> : game === "moon" ? <MoonToss {...props} /> : <ExpressionMemory {...props} />}
          </div>
        )}

        {run === "ready" && (
          <div className="stage__cover">
            <img src={nimiHappy} alt="" className="stage__nimi" draggable={false} />
            <div className="card__title">{t(def.title)}</div>
            <div className="card__sub">{t(def.hint)}</div>
            <button type="button" className="chip chip--butter stage__go" onClick={() => start(game)}>
              <Icon name="play" size={14} /> {t("games.playNow")}
            </button>
          </div>
        )}
        {run === "paused" && (
          <div className="stage__cover stage__cover--dim">
            <img src={nimiSleeping} alt="" className="stage__nimi" draggable={false} />
            <div className="card__title">{t("games.paused")}</div>
            <button type="button" className="chip chip--butter stage__go" onClick={() => setRun("playing")}>
              <Icon name="play" size={14} /> {t("games.resume")}
            </button>
          </div>
        )}
        {run === "over" && result && (
          <div className="stage__cover stage__cover--dim">
            <img src={result.record ? nimiExcited : nimiLove} alt="" className="stage__nimi" draggable={false} />
            <div className="card__title">{result.record ? t("games.record") : t("games.over")}</div>
            <div className="card__sub">
              {game === "memory"
                ? t("games.memory.done").replace("{s}", secs(result.score, lang, t))
                : t("games.scoreWas").replace("{n}", String(result.score))}
            </div>
            <button type="button" className="chip chip--butter stage__go" onClick={() => start(game)}>
              <Icon name="undo" size={14} /> {t("games.again")}
            </button>
          </div>
        )}

        {run === "playing" && <div className="stage__hint">{t(def.hint)}</div>}
      </section>

      <div className="games__cards">
        {GAMES.map((g) => {
          const b = best(g.id, scores);
          const active = g.id === game;
          return (
            <section key={g.id} className={"card gcard" + (active ? " is-active" : "")}>
              <div className={`gcard__art gcard__art--${g.id}`} aria-hidden="true">
                {g.id === "star" && (
                  <>
                    <span className="gcard__star" style={{ insetInlineStart: "18%", top: "18%" }} />
                    <span className="gcard__star" style={{ insetInlineStart: "62%", top: "12%" }} />
                    <span className="gcard__star" style={{ insetInlineStart: "38%", top: "40%" }} />
                    <img src={nimiHappy} alt="" className="gcard__nimi" />
                  </>
                )}
                {g.id === "moon" && (
                  <>
                    <img src={nimiCurious} alt="" className="gcard__nimi gcard__nimi--start" />
                    <span className="gcard__arc" />
                    <span className="gcard__star" style={{ insetInlineEnd: "16%", top: "20%" }} />
                  </>
                )}
                {g.id === "memory" && (
                  <span className="gcard__grid">
                    {[nimiHappy, null, nimiLove, null, null, nimiCurious, null, nimiSleeping].map((src, i) =>
                      src ? <img key={i} src={src} alt="" /> : <span key={i} className="gcard__back" />,
                    )}
                  </span>
                )}
              </div>
              <div className="gcard__text">
                <div className="card__title">{t(g.title)}</div>
                <div className="card__sub">{t(g.sub)}</div>
              </div>
              <div className="gcard__row">
                <span className="gcard__best" title={t("games.bestScore")}>
                  <Icon name="trophy" size={14} />
                  {g.id === "memory" ? (b ? secs(b, lang, t) : "—") : String(b)}
                </span>
                <button type="button" className={"chip gcard__play" + (active && run !== "playing" ? " chip--butter" : "")} onClick={() => start(g.id)}>
                  {t(active && run === "ready" ? "games.playNow" : "games.play")}
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
