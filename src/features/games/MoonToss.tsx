import { play } from "@/lib/sounds";
import { useEffect, useRef, useState } from "react";
import { Nimi } from "@/features/character/Nimi";
import type { Mood } from "@/features/character/rig/moods";
import { drawNuri, drawSky, drawStar, fitCanvas, sky, useLoop } from "./engine";
import type { GameProps } from "./types";

const ROUND_S = 120;
const NIMI = 72;
const ORBIT = 46;
const MOON = 10;
const V0 = 430; // launch speed, px/s
const GRAVITY = 320; // px/s²

type Vec = { x: number; y: number };

/**
 * «رمية القمر» (board 15): Nuri circles NIMI; click (or Space) to let go at the right moment —
 * the moon flies off along its orbit and falls in an arc. Hit the star to score; every hit puts
 * the next star farther and makes the orbit quicker and the aiming dots shorter. Three misses end it.
 */
export function MoonToss({ paused, onScore, onLives, onOver, onTime }: GameProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [mood, setMood] = useState<Mood>("curious");
  const [center, setCenter] = useState<Vec>({ x: 0, y: 0 });
  const moodTimer = useRef(0);
  const s = useRef({
    w: 0,
    h: 0,
    c: { x: 0, y: 0 } as Vec,
    theta: 1.2,
    omega: 1.7,
    flying: null as null | { p: Vec; v: Vec; trail: Vec[] },
    star: null as null | (Vec & { r: number; born: number }),
    burst: null as null | (Vec & { t: number }),
    score: 0,
    lives: 3,
    t: 0,
    over: false,
    dots: [] as ReturnType<typeof sky>,
  });

  const react = (m: Mood, ms: number) => {
    setMood(m);
    window.clearTimeout(moodTimer.current);
    moodTimer.current = window.setTimeout(() => setMood("curious"), ms);
  };
  useEffect(() => () => window.clearTimeout(moodTimer.current), []);

  /** A star the moon can really reach: sample a launch angle, fly it, put the star on that path. */
  const newStar = () => {
    const st = s.current;
    const minX = st.w * Math.min(0.75, 0.38 + st.score * 0.035);
    for (let tries = 0; tries < 40; tries++) {
      const phi = 0.35 + Math.random() * 0.9;
      const p = { x: st.c.x + ORBIT * Math.cos(phi), y: st.c.y + ORBIT * Math.sin(phi) };
      const v = { x: V0 * Math.sin(phi), y: -V0 * Math.cos(phi) };
      const spots: Vec[] = [];
      for (let t = 0.2; t < 2.4; t += 0.02) {
        const x = p.x + v.x * t;
        const y = p.y + v.y * t + 0.5 * GRAVITY * t * t;
        if (x >= minX && x <= st.w - 28 && y >= 26 && y <= st.h - 36) spots.push({ x, y });
      }
      if (spots.length) {
        const at = spots[Math.floor(Math.random() * spots.length)];
        st.star = { ...at, r: Math.max(11, 17 - st.score * 0.4), born: st.t };
        return;
      }
    }
    st.star = { x: st.w * 0.7, y: st.h * 0.35, r: 14, born: st.t };
  };

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => {
      const st = s.current;
      st.w = el.clientWidth;
      st.h = el.clientHeight;
      st.c = { x: Math.max(70, st.w * 0.13), y: st.h * 0.64 };
      setCenter({ ...st.c });
      st.dots = sky(st.w, st.h, 46);
      if (!st.star) newStar();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const launch = () => {
    const st = s.current;
    if (paused || st.flying || st.over) return;
    const p = { x: st.c.x + ORBIT * Math.cos(st.theta), y: st.c.y + ORBIT * Math.sin(st.theta) };
    // The orbit turns with θ decreasing (counter-clockwise on screen): the velocity is the tangent.
    st.flying = { p, v: { x: V0 * Math.sin(st.theta), y: -V0 * Math.cos(st.theta) }, trail: [] };
    react("excited", 500);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        launch();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  useLoop(!paused, (dt) => {
    const st = s.current;
    const g = canvas.current && fitCanvas(canvas.current);
    if (!g || !st.w || st.over) return;
    st.t += dt;
    onTime?.(st.t);

    st.theta -= st.omega * dt;
    const moon = { x: st.c.x + ORBIT * Math.cos(st.theta), y: st.c.y + ORBIT * Math.sin(st.theta) };

    // Flight
    const f = st.flying;
    if (f) {
      f.trail.push({ ...f.p });
      if (f.trail.length > 26) f.trail.shift();
      f.v.y += GRAVITY * dt;
      f.p.x += f.v.x * dt;
      f.p.y += f.v.y * dt;
      const star = st.star;
      if (star && Math.hypot(f.p.x - star.x, f.p.y - star.y) < star.r + MOON + 6) {
        st.score += 1;
        onScore(st.score);
        play("nuri_twinkle");
        st.burst = { x: star.x, y: star.y, t: 0 };
        st.flying = null;
        st.omega = Math.min(3.6, st.omega + 0.12);
        react("celebrate", 900);
        newStar();
      } else if (f.p.x > st.w + 30 || f.p.x < -30 || f.p.y > st.h + 30) {
        st.lives -= 1;
        onLives?.(st.lives);
        st.flying = null;
        react("sad", 900);
      }
    }

    // Draw
    g.clearRect(0, 0, st.w, st.h);
    drawSky(g, st.dots);
    if (st.star) {
      const pulse = 1 + Math.sin((st.t - st.star.born) * 5) * 0.08;
      drawStar(g, st.star.x, st.star.y, st.star.r * pulse, (st.t - st.star.born) * 0.6);
    }
    if (st.burst) {
      st.burst.t += dt;
      g.save();
      g.globalAlpha = Math.max(0, 1 - st.burst.t / 0.6);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const d = 10 + st.burst.t * 90;
        drawStar(g, st.burst.x + Math.cos(a) * d, st.burst.y + Math.sin(a) * d, 4);
      }
      g.restore();
      if (st.burst.t > 0.6) st.burst = null;
    }
    // The orbit ring, and the aiming dots while Nuri waits (shorter as the score grows).
    g.save();
    g.strokeStyle = "rgba(255, 231, 160, 0.25)";
    g.setLineDash([3, 5]);
    g.beginPath();
    g.ellipse(st.c.x, st.c.y, ORBIT, ORBIT, 0, 0, Math.PI * 2);
    g.stroke();
    g.restore();
    if (!st.flying) {
      const span = Math.max(0.14, 0.42 - st.score * 0.025);
      const v = { x: V0 * Math.sin(st.theta), y: -V0 * Math.cos(st.theta) };
      g.save();
      g.fillStyle = "rgba(255, 231, 160, 0.55)";
      for (let t = 0.05; t < span; t += 0.035) {
        g.beginPath();
        g.arc(moon.x + v.x * t, moon.y + v.y * t + 0.5 * GRAVITY * t * t, 1.6, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
      drawNuri(g, moon.x, moon.y, MOON);
    } else {
      f!.trail.forEach((p, i) => {
        g.save();
        g.globalAlpha = (i / f!.trail.length) * 0.6;
        g.fillStyle = "#FFE7A0";
        g.beginPath();
        g.arc(p.x, p.y, 2, 0, Math.PI * 2);
        g.fill();
        g.restore();
      });
      drawNuri(g, f!.p.x, f!.p.y, MOON);
    }

    if (st.lives <= 0 || st.t >= ROUND_S) {
      st.over = true;
      onOver(st.score);
    }
  });

  const c = center;
  return (
    <div ref={wrap} className="game-play" onPointerDown={launch}>
      <canvas ref={canvas} className="game-canvas" />
      <div className="mt-nimi" style={{ left: c.x - NIMI / 2, top: c.y - NIMI / 2, width: NIMI, height: NIMI }}>
        <Nimi mood={mood} size={NIMI} idleBehaviors={false} />
      </div>
    </div>
  );
}
