# NIMI refinements (v3) — boards: board_refinements.png, board_states.png

## 1. Peek mode (capsule must not block tabs / title bars)
- Trigger: the foreground window under the capsule is **maximized** (or fullscreen-but-not-exclusive) and its title bar/tab strip lies under the capsule rect.
- Capsule slides up (spring, ~280 ms) leaving a **12 px strip** visible (eyes peek). Everything outside the visible strip is click-through (`set_ignore_cursor_events` / region hit-test).
- Cursor within **60 px** of the strip → slides down to the normal compact capsule. Cursor leaves → back to peek after **1 s**.
- Notifications drop him down for 5 s with the bubble, then back to peek.
- Never peeks while a file drag is in progress (he grows and opens his mouth as usual).
- Setting: Settings → Capsule → "Peek over maximized windows" (on by default).

## 2. Small-size variant
- At render size **≤ 72 px** use `nimi(..., small=True)` (see `svg-small/`): eyes ×1.28, mouth ×1.3, no freckle stars, no rim light.
- Nuri's orbit stays — at 64 px it is ~57 px wide and fits the capsule.

## 3. Mouth morph
- On expression change: old mouth scales 1→0.55 and fades out (120 ms); new mouth scales 0.5→1 with easeOutBack and fades in (210 ms), both pivoting at (100,160). Runs together with the blink-swap of the eyes. Reference: `setMouth()` in animation-lab.html. Instant when reduce-motion is on.

## 4. Depth
- Body fill = radial gradient (cx .36, cy .26, r .85): #D3DBFF → #B4C0FF @55% → #97A5F0.
- Core shadow under the belly (#8F9DEC, 35%), right rim light (#EEF1FF stroke 3, 35%), gloss + small sparkle dot. See `body_layers()` in nimi_rig_generator.py.

## 5. Empty & error states (board_states.png)
| State | NIMI | Text (AR) | Action |
|---|---|---|---|
| No media playing | bored | ما فيه شي شغّال | Open preferred player |
| No notifications | sleeping | كل شي هادي | — |
| Large-files scan running | working | أفحص القرص C… + count + current folder + progress | Cancel; continues if panel closes, notifies when done |
| File can't be eaten | error | ما قدرت آكله + one-line reason | Retry / Give back |
| Unknown file type | curious | ما أعرف هذا النوع | Copy / Move / ZIP / Pocket |
| Access denied | scared | ويندوز ما سمح لي | Choose another place / Open folder (never request admin) |
| Pocket empty | idle | الجيب فاضي | — |
| Command bar no results | curious | ما لقيت شي بهذا الاسم + "did you mean" (Tab) | — |
| Drive disconnected | — | G: مفصول (dimmed, stays in switcher) | — |
| Player has no seek | — | progress bar read-only + note | — |

Rules: one sentence + a matching expression, no technical messages; every error says why and gives a next step; long operations show progress and a cancel button.
