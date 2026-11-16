# Handoff â€” read this first when resuming

## Where we are (2026-11-15, evening)
- Phases 0â€“3 done آ· `ec27c55` Kai's 3 notes + character v3 + peek mode آ· **phase 4 (Music) built,
  committed as `phase 4:`, waiting for Kai's OK.** Next after the OK: phase 5 (System). Nothing pushed.
- Talk to Kai in Arabic (casual). Commit at phase ends with the `phase N:` prefix; push only when asked.
- Character v3: source of truth is `design/character/animation-lab.html` (+ `ANIMATION.md`,
  `REFINEMENTS.md`). `python scripts/gen-rig-data.py` regenerates `rig/rigData.ts` (24 moods) after
  any design change. `engine.ts` = the lab's spring engine on HTML compositor layers.
- Peek آ«ظٹط·ظ„آ» (REFINEMENTS آ§1): `fullscreen.rs` reports `covered`, the hit-test loop `reveal`,
  `features/shell/usePeek.ts` decides; `revealCapsule(5000)` is the hook for notifications (phase 8).

## Phase 4 â€” music (spec آ§4, board 07 option B)
- Rust `media/`: `smtc.rs` (one MTA thread, current session's events â†’ `nimi://media/state`, art once
  per change â†’ `nimi://media/art`, transport + seek commands), `volume.rs` (Core Audio master volume,
  `OnNotify` â†’ `nimi://media/volume`, follows default-device changes every 3 s), `open_player`.
- Front: `features/music/media.ts` (store, interpolated position, `useMusicActive` = playing or paused
  < 60 s), `Music.tsx` (capsule look, island, Music tab, Home card, empty state), `shell/Shell.tsx`
  modes compact / island / panel + gestures (hover pill, wheel volume + ring meter, double-click
  play/pause, right-click `CapsuleMenu`). Music mood comes from `setAmbientMood` (beats idle/bored/
  sleep, not clicks or drags).
- Open question for Kai: board_states says a click with no song opens the island with آ«ظ…ط§ ظپظٹظ‡ ط´ظٹ
  ط´ط؛ظ‘ط§ظ„آ»; spec آ§11 says no song â†’ panel. Built per the spec (empty state shows in the Music tab and
  in an open island when the song ends).
- Also fixed: the overlay started unthrottled after every launch (`window::settle_focus`), SVG-internal
  extras animations lifted to HTML (`liftAnimations`). CPU (unfocused, settled): idle â‰ˆ 3â€“9 % of one
  core, music playing â‰ˆ 10â€“19 %. See docs/PLAN.md "What phase 4 taught us".
- Not done: sneeze's text bubble and REFINEMENTS آ§5 empty states for other features (their phases).
- Kai: no song + click â†’ panel stays (decided 2026-11-16).
- Fixed (2026-11-16, Kai confirmed): Kai saw NIMI vanish on the bare desktop and come back
  when any window opened. Not reproducible here (Win+D, minimize-all, desktop click all fine; Kai
  runs Wallpaper Engine, Rainmeter, Windhawk, TranslucentTB). `fullscreen.rs` hardened (no
  `QUNS_BUSY`-only hide; skips cloaked / minimized / click-through / own windows) and every
  hide/show is logged with the culprit window to
  `%LOCALAPPDATA%\io.github.kai39x.nimi\logs\NIMI.log` â€” read it if Kai sees it again.
  Autostart points at `target\debug\nimi.exe --autostart`.

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
- Kai's main display: 4K @ 200 %, 143 Hz. Overlay window x=960 (physical), capsule center â‰ˆ (1920, 72).
  Kai sometimes switches to a 2560أ—1440 @ 100 % screen â€” read `dev_hittest_state` for real geometry
  before clicking. Hover before pressing (the hit-test loop needs one tick to make the window clickable).
- Measure CPU only with NIMI **not** focused; a focused overlay is never throttled.

## Hard-won rules (details in docs/PLAN.md)
- Never `focus:false` on a window that must accept file drops; overlay uses `focusable:false` + `MA_NOACTIVATE`.
- Character per-frame layers are HTML wrappers on a 208 px unit stage (compositor); never `will-change` on 0أ—0 boxes.
- Panel open â†’ `focusOverlay(true)`; close â†’ `focusOverlay(false)` restores the previous foreground window.
- Single click waits 260 ms before opening the panel (double-click needs the capsule to stay put).
- Never run a CSS animation on an element inside an SVG that stays on screen; lift it to an HTML box (`liftAnimations`).
- Check `document.hasFocus()` is false before measuring CPU; wait ~30 s after a launch.
