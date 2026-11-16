import { useEffect, useRef, useState } from "react";
import { Nimi } from "@/features/character/Nimi";
import type { Mood } from "@/features/character/rig/moods";
import { drawMeteor, drawSky, drawStar, fitCanvas, sky, useLoop } from "./engine";
import type { GameProps } from "./types";

/** One round lasts at most this long (spec: «كل لعبة أقل من دقيقتين»). */
const ROUND_S = 90;
const NIMI = 64;
const SPEED = 460; // px/s with the arrow keys

type Thing = { x: number; y: number; vy: number; r: number; rot: number; spin: number; meteor: boolean };
type Pop = { x: number; y: number; t: number; text: string; bad: boolean };

/**
 * «صيد النجوم» (board 15): NIMI under the sky, moved with ← → or the mouse. Stars are 10 points;
 * a red meteor takes one of Nuri's three moons. Faster and with more meteors as time goes on.
 */
export function StarCatch({ paused, onScore, onLives, onOver, onTime }: GameProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const nimiBox = useRef<HTMLDivElement>(null);
  const [mood, setMood] = useState<Mood>("happy");
  const moodTimer = useRef(0);
  const s = useRef({
    x: 0,
    target: null as number | null,
    keys: { left: false, right: false },
    things: [] as Thing[],
    pops: [] as Pop[],
    spawn: 0.4,
    t: 0,
    score: 0,
    lives: 3,
    over: false,
    dots: [] as ReturnType<typeof sky>,
    w: 0,
    h: 0,
  });

  const react = (m: Mood, ms: number) => {
    setMood(m);
    window.clearTimeout(moodTimer.current);
    moodTimer.current = window.setTimeout(() => setMood("happy"), ms);
  };
  useEffect(() => () => window.clearTimeout(moodTimer.current), []);

  // Size, sky, NIMI in the middle.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => {
      const st = s.current;
      st.w = el.clientWidth;
      st.h = el.clientHeight;
      st.dots = sky(st.w, st.h, 46);
      if (!st.x) st.x = st.w / 2;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ← → (and A / D); the mouse takes over when it moves.
  useEffect(() => {
    const set = (e: KeyboardEvent, on: boolean) => {
      const k = e.key.toLowerCase();
      if (k === "arrowleft" || k === "a") s.current.keys.left = on;
      else if (k === "arrowright" || k === "d") s.current.keys.right = on;
      else return;
      s.current.target = null;
      e.preventDefault();
    };
    const down = (e: KeyboardEvent) => set(e, true);
    const up = (e: KeyboardEvent) => set(e, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useLoop(!paused, (dt) => {
    const st = s.current;
    const g = canvas.current && fitCanvas(canvas.current);
    if (!g || !st.w || st.over) return;
    st.t += dt;
    onTime?.(st.t);
    const k = Math.min(1, st.t / ROUND_S); // difficulty 0 → 1

    // NIMI
    const half = NIMI / 2;
    if (st.target != null) st.x += (st.target - st.x) * Math.min(1, dt * 14);
    else st.x += ((st.keys.right ? 1 : 0) - (st.keys.left ? 1 : 0)) * SPEED * dt;
    // His orbit ring is wider than his body: keep all of him on the stage.
    const edge = NIMI * 0.78;
    st.x = Math.max(edge, Math.min(st.w - edge, st.x));
    if (nimiBox.current) nimiBox.current.style.transform = `translateX(${st.x - half}px)`;

    // Spawn
    st.spawn -= dt;
    if (st.spawn <= 0) {
      st.spawn = 0.8 - 0.45 * k + Math.random() * 0.25;
      const meteor = Math.random() < 0.22 + 0.2 * k;
      st.things.push({
        x: 18 + Math.random() * (st.w - 36),
        y: -20,
        vy: (95 + 170 * k) * (0.85 + Math.random() * 0.3) * (meteor ? 1.15 : 1),
        r: meteor ? 8 + Math.random() * 3 : 10 + Math.random() * 4,
        rot: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 2,
        meteor,
      });
    }

    // Move, catch, miss
    const top = st.h - NIMI - 4;
    st.things = st.things.filter((o) => {
      o.y += o.vy * dt;
      o.rot += o.spin * dt;
      const near = Math.abs(o.x - st.x) < half - 6 + o.r;
      if (near && o.y + o.r >= top + 14 && o.y - o.r <= st.h - 8) {
        if (o.meteor) {
          st.lives -= 1;
          onLives?.(st.lives);
          st.pops.push({ x: o.x, y: top, t: 0, text: "", bad: true });
          react("dizzy", 900);
        } else {
          st.score += 10;
          onScore(st.score);
          st.pops.push({ x: o.x, y: top - 6, t: 0, text: "+10", bad: false });
          react("excited", 450);
        }
        return false;
      }
      return o.y - o.r < st.h;
    });

    // Draw
    g.clearRect(0, 0, st.w, st.h);
    drawSky(g, st.dots);
    for (const o of st.things) o.meteor ? drawMeteor(g, o.x, o.y, o.r) : drawStar(g, o.x, o.y, o.r, o.rot);
    st.pops = st.pops.filter((p) => (p.t += dt) < 0.7);
    for (const p of st.pops) {
      g.save();
      g.globalAlpha = 1 - p.t / 0.7;
      if (p.bad) {
        g.strokeStyle = "rgba(255,155,155,.9)";
        g.lineWidth = 2;
        g.beginPath();
        g.arc(p.x, p.y + 20, 14 + p.t * 40, 0, Math.PI * 2);
        g.stroke();
      } else {
        g.fillStyle = "#FFE7A0";
        g.font = "600 14px Rubik, sans-serif";
        g.textAlign = "center";
        g.fillText(p.text, p.x, p.y - p.t * 30);
      }
      g.restore();
    }

    if (st.lives <= 0 || st.t >= ROUND_S) {
      st.over = true;
      onOver(st.score);
    }
  });

  return (
    <div
      ref={wrap}
      className="game-play"
      onPointerMove={(e) => {
        const r = wrap.current?.getBoundingClientRect();
        if (r) s.current.target = e.clientX - r.left;
      }}
    >
      <canvas ref={canvas} className="game-canvas" />
      <div ref={nimiBox} className="sc-nimi" style={{ width: NIMI }}>
        <Nimi mood={mood} size={NIMI} idleBehaviors={false} />
      </div>
    </div>
  );
}
