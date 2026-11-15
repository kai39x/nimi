# Handoff — read this first when resuming

## Where we are (2026-11-15)
- Phases 0–3 done and pushed to `main`: `96249b9` (0) · `ea065c1` (1 overlay) · `d4e7f4f` (2 character) · `85cf62e` (3 panel).
- **Next: Kai's three notes below, then phase 4 (Music / SMTC).** Kai already agreed: double-click on the
  capsule = play/pause while music plays, recenter otherwise. Tray icon stays in the «^» overflow (Kai is fine with it).
- Talk to Kai in Arabic (casual). Commit only at phase ends, with `phase N:` prefix.

## Status 2026-11-15 (later): the three notes are done, uncommitted, waiting for Kai's OK
- Evidence: `docs/evidence/notes/` (`moods-ar.png` all 17 moods, `capsule-style-ar.png`, `en-check.png`,
  `ar-panel-from-capsuleOnly.png`). Phase 4 starts only after Kai looks at them.
- 1: `direction: ltr` on `.nimi` + `.nimi-units` pinned `left/top` (no `inset`). 2: parked opacity is inline
  in `orbiter()`; every animation the rig CSS binds was checked running for all 17 moods (scratch script).
- 3: `capsuleStyle` in `Settings`; glass moved to its own `.shell__glass` layer (fades for nimiOnly);
  nimiOnly shell = NIMI's 78·s frame (hit rect follows, checked via `dev_hittest_state`); capsuleOnly
  unmounts NIMI after a 200 ms fade; the panel always has glass + NIMI.

## Character v3 (Kai's new design package) — ported, uncommitted, waiting for Kai to test
- Source of truth is now `design/character/animation-lab.html` (+ `ANIMATION.md`, `REFINEMENTS.md`).
  `python scripts/gen-rig-data.py` copies its markup/data into `rig/rigData.ts` (24 moods) — re-run
  after any design update. `engine.ts` is the lab's spring engine; `Nimi.tsx` renders HTML layers it moves.
- Done: springs/mood programs, blink-swap + mouth morph, Nuri glides on an arc, yawn into sleep /
  stretch out, idle behaviors (yawn, stretch, look, play with Nuri, hum, winter sneeze), 7 new moods,
  depth shading, small variant ≤ 72, click/hover-love/drag/shake rules in `useNimiMood.ts`.
- Peek mode (REFINEMENTS §1) done: Rust `fullscreen.rs` reports `covered` (maximized foreground
  window under the capsule, 0.5 s tick, event `nimi://overlay/covered`); hit-test adds
  `CursorProximity.reveal` (60 px or a held button nearby); `features/shell/usePeek.ts` combines them
  with the setting «يطل فوق النوافذ المكبّرة» (`peekOverMaximized`, on) and the panel; a 12 px
  `.peek-strip` is the only hit rect while peeking. `revealCapsule(5000)` is the hook for
  notifications (phase 7). Hit rects are now clipped to the window.
- **Not done:** §5 empty/error states (their phases), sneeze's text bubble (no bubble component yet).
- Perf: engine steps 60 fps when moving fast, 30 fps when calm, sleeps on a timer between steps,
  writes only changed styles; Nuri glow/roll are HTML wrappers. Idle ≈ 7 % of one core
  (phase 3 was 3–5 %). Measure with `window.__nimi.pause(true)` to A/B the engine.
- Gotcha: after many HMR swaps the overlay once stopped painting entirely; a full restart of
  `tauri dev` fixed it. Restart before trusting CPU numbers.

## Kai's notes to fix first (from screenshots)
1. **Arabic: NIMI renders outside the capsule; English is fine.**
   Likely cause: `src/features/character/nimi.css` gives `.nimi-units` (and other stage wrappers)
   `position:absolute; inset:0` plus a fixed `width:208px`. In RTL the `right` edge wins, so the
   208 px stage is anchored to the right and then scaled from `0 0`. Fix: add `direction: ltr` on
   `.nimi` (the rig is not text), or use `left:0; top:0` instead of `inset:0` for the stage.
   Check both languages and the settings preview.
2. **Animation bug: in `curious` (and other parked-Nuri moods) Nuri is parked by the cheek AND a
   second Nuri still orbits.** Cause: `.orbit-frame.is-parked { opacity: 0 }` is overridden by the
   inline `style={{ opacity }}` set in `orbiter()` in `Nimi.tsx`. Fix: put the parked state into the
   inline opacity (0 when hidden) and keep the CSS transition. Then review all 17 moods side by side
   with `design/character/nimi-reference.html` for other mismatches (Kai: "some animations need checking").
3. **New setting «الكبسولة»: show NIMI inside the capsule (current) / capsule only (no NIMI) / NIMI alone
   (no glass).** Add `capsuleStyle: "nimiInCapsule" | "capsuleOnly" | "nimiOnly"` to `Settings`
   (`src-tauri/src/ipc.rs`, then `npm run ipc:gen`), honour it in `features/shell/Shell.tsx` + `shell.css`
   (hit rect must follow the visible thing), and put it in the settings «الكبسولة» section
   (enable that nav item in `SettingsWindow.tsx`) with a live preview.

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
