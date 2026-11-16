# Handoff — read this first when resuming

## Where we are (2026-11-16)
- Phases 0–5 done and pushed (`4326dd4` phase 5, Kai confirmed it works; Recycle Bin stays
  pre-ticked in Boost). **Phase 6 (Feed & Pocket) committed as `phase 6:` (`23738cb`, not pushed).
  Kai tested it and left 5 notes — do "Kai's notes on phase 6" below first, show him, get his OK,
  then phase 7.**
- Talk to Kai in Arabic (casual). Commit at phase ends with the `phase N:` prefix; push only when
  asked, and say clearly when something is committed but not pushed.
- Character v3: source of truth is `design/character/animation-lab.html` (+ `ANIMATION.md`,
  `REFINEMENTS.md`). `python scripts/gen-rig-data.py` regenerates `rig/rigData.ts` after any design
  change. `engine.ts` = the lab's spring engine on HTML compositor layers; it also drives Nuri's
  glow and roll (no idle CSS animations — see PLAN "What phase 5 taught us").
- Peek «يطل»: `fullscreen.rs` reports `covered`, the hit-test loop `reveal`, `usePeek.ts` decides.

## Kai's notes on phase 6 (2026-11-16) — do these next, in this order
Kai allows downloading any crate / npm library these need (no need to ask again).

1. **Pocket badge invisible in «نيمي بس»**, worse at bigger NIMI sizes, so the pocket can't be
   opened. The badge sits at the shell's top corner (`.pocket-badge`, `Shell.tsx`), which in
   «نيمي بس» is NIMI's own small circle and is hidden while peeking. Give it a place that stays
   visible and clickable in every capsule style and size (inside the hit rect), and check the
   satellites are clickable there too. Screenshot all three styles at 48 / 64 / 96.
2. **More conversions, as a second round of bubbles.** «تحويل» opens a new bubble arc of the target
   formats the meal can become (e.g. JPG → PNG / WebP / PDF / ICO / BMP; PNG → JPG / WebP / PDF;
   PDF → TXT / images …), with a back bubble. Plan the matrix per kind and say which need which
   crate. Notes: WebP encode needs a crate (`image` with webp, or `webp`); image → PDF via
   `printpdf` / `lopdf`; PDF → TXT via `pdf-extract` / `lopdf`.
   **Dropped by Kai (2026-11-16): PDF → DOCX and DOCX → PDF** — a faithful conversion needs Word or
   an online service, NIMI is local-only, and Kai has no Word. Don't offer them.
3. **OCR: add a «نسخ النص» button** on the result (it copies automatically today, but he wants the
   button; show «نسخت» feedback).
4. **The "working" look must stay until the job ends.** Zipping a 6 GB MP4 showed NIMI working,
   but once Kai clicked back into his work NIMI went up / back to normal and it no longer looked
   busy. Cause: `overlayClickOutside` → `dismissFeed()` runs even while `phase === "working"`
   (`feed.ts` `dismiss()` doesn't check `busy()`), which clears the mood while the job keeps
   running in Rust. Fix: while working, a click outside collapses the stage back to the capsule
   but keeps the `working` mood (and peek shows it too); when the job ends, show the result toast
   (or a small pill) under the capsule. Consider a progress % for big ZIP / extract.
5. **Build what phase 6 left out:** PDF merge / extract pages / compress (`lopdf`), WebP output,
   **text and link drops** (the webview's file-drop handler only gives paths — needs a custom OLE
   drop target or `IDropTarget` on the overlay to receive CF_UNICODETEXT / URLs; check Tauri
   `dragDropEnabled` options first), link actions (open, copy, desktop shortcut, **safety check**),
   text actions (save as note, copy plain, word count). **Skip batch rename** (Kai doesn't need it).
   - Link safety: Kai suggested OpenPhish "or whatever is better". NIMI is offline-only (CLAUDE.md),
     so: offline heuristics always (IP host, punycode / look-alike letters, `@` in URL, many
     subdomains, http, suspicious TLDs, URL shorteners) + OpenPhish's free community feed
     downloaded at most daily **only if Kai turns it on** (setting, off by default) and checked
     locally — the URL itself never leaves the PC. Confirm this with Kai before shipping.

Then test everything with real drags on NIMI's own test files, show Kai, wait for his OK, commit
(`phase 6:` follow-up, e.g. `phase 6.1:`), and start **phase 7**.

## Phase 6 — feed & pocket (spec §6–7, boards 08 option B and 09)
- Rust `files/`: `mod.rs` (meal info, every action, undo tokens: recycle the outputs or move
  back), `tar.rs` (Windows' own `tar.exe` for ZIP / extract / list), `imaging.rs` (WIC: PNG↔JPG,
  shrink, strip metadata), `ocr.rs` (Windows.Media.Ocr, user-profile languages), `shell.rs`
  (clipboard CF_HDROP + text, reveal, terminal, folder picker, move, Recycle Bin, drag-out with
  `SHDoDragDrop`). `pocket.rs`: `pocket.json` with paths only, auto-empty by setting, missing files
  marked once then dropped, `nimi://pocket/changed`. No new crates.
- Front `features/feed/`: `feed.ts` (store + OS drag events → near / hungry / chomp / chew / menu /
  working / result / error / pocketed), `FeedLayer.tsx` (zones, flying file, bubbles, «المزيد»,
  result toast with open folder / undo, OCR text box, error card). `features/pocket/Pocket.tsx`
  (store, tray). Shell gets `shell--feed-*` and `shell--pocket` modes; satellites and the badge open
  the tray. Settings «الأكل والجيب»: results location, pocket auto-empty, locked Recycle Bin toggle.
- Feeding only reacts on the compact capsule (not over the open panel / island).
- Not built (need new crates or a different drop path; ask Kai): PDF merge / extract / compress,
  WebP output, text and link drops (the overlay only receives file drops), batch rename.
- Tested with real OLE drags on NIMI's own test files only (mouth → bubbles → OCR / convert / undo /
  error; Nuri → pocket → tray ZIP / empty). Drag-out from the tray was not driven by a script
  (it would drop into a real app) — Kai to try.

## Phase 5 — system (spec §5, board 12)
- Rust `system/`: `procs.rs` (user processes: private bytes, CPU time, readable name, category
  browser / launcher), `stats.rs` (CPU, RAM, GPU via PDH + DXGI + D3DKMT temperature, battery),
  `drives.rs` (fixed drives, SSD), `scan.rs` (largest files; move to `<drive>\NIMI`, Recycle Bin
  via `SHFileOperationW` with `FOF_WANTNUKEWARNING`; only files from the last scan, never locked
  ones), `boost.rs` (preview / run / power plan with restore after 2 h, state in `boost.json`).
  Sampler: 2 s with the panel open (top apps + GPU), 10 s compact; `nimi://system/stats`.
- Front `features/system/`: `system.ts` store (60 s history), `SystemTab.tsx`, `Boost.tsx`,
  `LargestFiles.tsx`. Home's mini bars are live.
- Boost defaults: temp + Recycle Bin + power ticked (board; Kai confirmed), apps unticked except
  background game launchers; apps with any visible window are asked to close and never forced.

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
- Kai: no song + click → panel stays (decided 2026-11-16).
- Fixed (2026-11-16, Kai confirmed): Kai saw NIMI vanish on the bare desktop and come back
  when any window opened. Not reproducible here (Win+D, minimize-all, desktop click all fine; Kai
  runs Wallpaper Engine, Rainmeter, Windhawk, TranslucentTB). `fullscreen.rs` hardened (no
  `QUNS_BUSY`-only hide; skips cloaked / minimized / click-through / own windows) and every
  hide/show is logged with the culprit window to
  `%LOCALAPPDATA%\io.github.kai39x.nimi\logs\NIMI.log` — read it if Kai sees it again.
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
- After hot-reloading a store module (`feed.ts`, `media.ts`, …) reload the page before testing: the
  old module's listeners stay registered and the new one never sees the events.
