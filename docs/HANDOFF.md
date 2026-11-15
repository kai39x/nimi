# Handoff — read this first when resuming

## Where we are (2026-11-15, evening)
- Phases 0–3 done · `ec27c55` Kai's 3 notes + character v3 + peek mode · **phase 4 (Music) built,
  committed as `phase 4:`, waiting for Kai's OK.** Next after the OK: phase 5 (System). Nothing pushed.
- Talk to Kai in Arabic (casual). Commit at phase ends with the `phase N:` prefix; push only when asked.
- Character v3: source of truth is `design/character/animation-lab.html` (+ `ANIMATION.md`,
  `REFINEMENTS.md`). `python scripts/gen-rig-data.py` regenerates `rig/rigData.ts` (24 moods) after
  any design change. `engine.ts` = the lab's spring engine on HTML compositor layers.
- Peek «يطل» (REFINEMENTS §1): `fullscreen.rs` reports `covered`, the hit-test loop `reveal`,
  `features/shell/usePeek.ts` decides; `revealCapsule(5000)` is the hook for notifications (phase 8).

## Phase 4 — music (spec §4, board 07 option B)
- Rust `media/`: `smtc.rs` (one MTA thread, current session's events → `nimi://media/state`, art once
  per change → `nimi://media/art`, transport + seek commands), `volume.rs` (Core Audio master volume,
  `OnNotify` → `nimi://media/volume`, follows default-device changes every 3 s), `open_player`.
- Front: `features/music/media.ts` (store, interpolated position, `useMusicActive` = playing or paused
  < 60 s), `Music.tsx` (capsule look, island, Music tab, Home card, empty state), `shell/Shell.tsx`
  modes compact / island / panel + gestures (hover pill, wheel volume + ring meter, double-click
  play/pause, right-click `CapsuleMenu`). Music mood comes from `setAmbientMood` (beats idle/bored/
  sleep, not clicks or drags).
- Open question for Kai: board_states says a click with no song opens the island with «ما فيه شي
  شغّال»; spec §11 says no song → panel. Built per the spec (empty state shows in the Music tab and
  in an open island when the song ends).
- Also fixed: the overlay started unthrottled after every launch (`window::settle_focus`), SVG-internal
  extras animations lifted to HTML (`liftAnimations`). CPU (unfocused, settled): idle ≈ 3–9 % of one
  core, music playing ≈ 10–19 %. See docs/PLAN.md "What phase 4 taught us".
- Not done: sneeze's text bubble and REFINEMENTS §5 empty states for other features (their phases).

## Dev loop (cheap)
```
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev   # background
python scripts/cdp.py --list                       # two pages: settings (index 0 usually) + overlay
python scripts/cdp.py --index 1 "window.__nimi.setMood('curious')"   # force a mood (dev)
powershell -File scripts/screenshot.ps1 -Out shot.png -X 1660 -Y 0 -W 520 -H 190    # capsule on 4K
powershell -File scripts/dev/mouse.ps1 click|dblclick|move|dragto|up X Y [X2 Y2]  # physical px
powershell -File scripts/dev/flipcheck.ps1         # click-through flips over the capsule?
powershell -File scripts/dev/cpu-tree.ps1 6        # CPU of nimi + WebView2 tree
```
- Kai's main display: 4K @ 200 %, 143 Hz. Overlay window x=960 (physical), capsule center ≈ (1920, 72).
  Kai sometimes switches to a 2560×1440 @ 100 % screen — read `dev_hittest_state` for real geometry
  before clicking. Hover before pressing (the hit-test loop needs one tick to make the window clickable).
- Measure CPU only with NIMI **not** focused; a focused overlay is never throttled.

## Hard-won rules (details in docs/PLAN.md)
- Never `focus:false` on a window that must accept file drops; overlay uses `focusable:false` + `MA_NOACTIVATE`.
- Character per-frame layers are HTML wrappers on a 208 px unit stage (compositor); never `will-change` on 0×0 boxes.
- Panel open → `focusOverlay(true)`; close → `focusOverlay(false)` restores the previous foreground window.
- Single click waits 260 ms before opening the panel (double-click needs the capsule to stay put).
- Never run a CSS animation on an element inside an SVG that stays on screen; lift it to an HTML box (`liftAnimations`).
- Check `document.hasFocus()` is false before measuring CPU; wait ~30 s after a launch.
