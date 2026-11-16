import { useEffect, useMemo, useRef, useState } from "react";
import happy from "@design/character/svg-small/nimi_happy_small.svg";
import love from "@design/character/svg-small/nimi_love_small.svg";
import surprised from "@design/character/svg-small/nimi_surprised_small.svg";
import sleeping from "@design/character/svg-small/nimi_sleeping_small.svg";
import angry from "@design/character/svg-small/nimi_angry_small.svg";
import laugh from "@design/character/svg-small/nimi_laugh_small.svg";
import { Icon } from "@/components/Icon";
import { useLoop } from "./engine";
import type { GameProps } from "./types";

const FACES = [happy, love, surprised, sleeping, angry, laugh];
/** A wrong pair stays face up this long. */
const SHOW_MS = 750;

type Card = { id: number; face: number; open: boolean; done: boolean };

function deal(): Card[] {
  const faces = [...FACES.keys(), ...FACES.keys()];
  for (let i = faces.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [faces[i], faces[j]] = [faces[j], faces[i]];
  }
  return faces.map((face, id) => ({ id, face, open: false, done: false }));
}

/**
 * «ذاكرة التعابير» (board 15): 12 cards, six of NIMI's expressions twice. Turn two; a pair stays
 * open. The clock starts with the first card; the score is the time (faster is better).
 */
export function ExpressionMemory({ paused, onScore, onOver, onTime }: GameProps) {
  const [cards, setCards] = useState<Card[]>(deal);
  const [busy, setBusy] = useState(false);
  const started = useRef<number | null>(null);
  const elapsed = useRef(0);
  const finished = useRef(false);
  const pairs = useMemo(() => cards.filter((c) => c.done).length / 2, [cards]);

  useEffect(() => onScore(pairs), [pairs, onScore]);

  // The clock (it stops while paused).
  useLoop(!paused && started.current != null && !finished.current, (dt) => {
    elapsed.current += dt;
    onTime?.(elapsed.current);
  });

  const flip = (id: number) => {
    if (paused || busy || finished.current) return;
    const card = cards.find((c) => c.id === id);
    if (!card || card.open || card.done) return;
    if (started.current == null) started.current = performance.now();
    const next = cards.map((c) => (c.id === id ? { ...c, open: true } : c));
    const open = next.filter((c) => c.open && !c.done);
    if (open.length < 2) {
      setCards(next);
      return;
    }
    const [a, b] = open;
    if (a.face === b.face) {
      const done = next.map((c) => (c.id === a.id || c.id === b.id ? { ...c, done: true, open: false } : c));
      setCards(done);
      if (done.every((c) => c.done)) {
        finished.current = true;
        onOver(Math.round(elapsed.current * 1000));
      }
      return;
    }
    setCards(next);
    setBusy(true);
    window.setTimeout(() => {
      setCards((cs) => cs.map((c) => (c.done ? c : { ...c, open: false })));
      setBusy(false);
    }, SHOW_MS);
  };

  return (
    <div className="game-play mem">
      <div className="mem__grid">
        {cards.map((c) => (
          <button
            key={c.id}
            type="button"
            className={"mem__card" + (c.open || c.done ? " is-open" : "") + (c.done ? " is-done" : "")}
            onClick={() => flip(c.id)}
            aria-label={c.open || c.done ? `${c.face}` : "?"}
          >
            <span className="mem__face mem__face--back">
              <Icon name="pocket" size={22} />
            </span>
            <span className="mem__face mem__face--front">
              <img src={FACES[c.face]} alt="" draggable={false} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
