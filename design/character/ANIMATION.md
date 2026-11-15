# NIMI animation system (v2) — source of truth: `animation-lab.html`

Open `animation-lab.html` in a browser. Its inline `<script>` is the reference engine to port to React (requestAnimationFrame loop, no CSS keyframes for body motion).

## 1. Soft body (springs)
Body state = damped springs, integrated at 240 Hz substeps: `x(k70,c14)`, `y(k520,c34)`, `sx/sy(k300,c11, underdamped = jelly)`, `rot(k220,c15)`, face offset `fx/fy(k160,c17, trails the body)`, orbit lag `orbX/orbY(k70,c9, follows the body late)`.
Body transform: `translate(100 206) rotate(rot) scale(sx sy) translate(-100 -206)` (pivot at the feet). Shadow scales/fades with height.
- **Drag:** body follows the pointer; lean = −vx·0.025° (±24°), stretch along speed; face switches to `grabbed`.
- **Release:** gravity 2600 u/s², bounce restitution 0.36, impact squash ∝ impact speed; glides back home horizontally.
- **Shake:** ≥4 horizontal direction flips during a drag → `dizzy` after release; otherwise `surprised` briefly.
- **Click:** jelly impulse + small hop → `happy` 1.8 s. 3 clicks in 1.5 s → `shy`. Mouse hover 1.8 s → `love`.

## 2. Mood programs
Each mood is a function of time returning targets `{x,y,sx,sy,rot,fx,fy}` (hops with anticipation/air/landing, grooves, trembles, slumps). Springs blend between programs, so switching moods never snaps. Reduce motion: no hops/squash, rotation clamped to ±3°.

## 3. Smooth transitions
- Every expression change happens **behind a blink**: eyes close (85 ms) → swap eyes/mouth/blush/extras → reopen with overshoot (170 ms) + small anticipation squash.
- Nuri glides to its new place on an arc (650 ms, ease-in-out, 14-unit lift); orbit speed is a spring.
- Into sleep: **yawn** first. Out of sleep: **stretch** first.
- Blinks are random (2.4–5.6 s), 22% double blinks.

## 4. Idle behaviors (only in `idle`, after 3.5 s without interaction, every 7–12 s)
yawn · stretch · look around · play with Nuri (Nuri bounces on his head 3×, he squashes each time) · hum (notes + sway) · sneeze (winter only: "ah… ah…" lean back → "choo!" jolt, Nuri flung away, snow puff).

## 5. New moods (7)
love, laugh, sad, angry, scared, celebrate, cold — triggers and Nuri behavior are in the canvas Expressions board and `nimi_rig_generator.py` (`MOODS`, `extras()`).
