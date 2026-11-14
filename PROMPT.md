# Build NIMI — Windows desktop companion (Tauri 2 + React)

You're building **NIMI**, a finished, launch-quality Windows desktop app from an approved design package. The design phase is done; your job is to make it real, faithfully.

Talk to me (Kai) in Arabic, casual. Code, comments, and commit messages in English.

## Read first
- `design/DESIGN_SPEC.md` — every approved decision (this is the contract).
- `design/boards/*.jpg` — the approved screens, in reading order. Look at them before building each screen and match them closely: spacing, sizes, colors, copy.
- `design/character/nimi-reference.html` — open it in a browser. It is the animated source of truth for the character. `nimi_rig_generator.py` + `nimi.css` contain the exact SVG geometry and keyframes. Port them; don't redraw the character.
- `design/tokens/tokens.css` — use these tokens as-is.
- `design/icons/`, `design/brand/`, `design/sounds/` — final assets.

## What "done" looks like
NIMI lives in a dark glass capsule at the top-center of the screen. It feels alive (17 moods, squash & stretch, Nuri orbiting behind and in front of it). Clicking opens the music island or the expanded panel. Dropping files on it triggers eat → bubbles → result. Everything in the spec works offline, in Arabic (RTL) and English, on **Windows 10 and 11**. The app ships as **both an NSIS installer and a portable .exe**, published to GitHub Releases.

## Stack & constraints
- Tauri 2 (Rust backend) + React + TypeScript + Vite. No Electron, no cloud services, no telemetry, no AI.
- One transparent, frameless, always-on-top overlay window at top-center (not in the taskbar). Only the visible UI (capsule / island / panel) receives the mouse; everything else is **click-through**. The usual approach: keep the window click-through by default and turn hit-testing on while the cursor is over a visible element (cursor polling plus element rects reported from the frontend). It must still receive **OS file drag-and-drop** over NIMI. Prove this works early; it's the riskiest part.
- Handle DPI scaling, multiple monitors, and fullscreen auto-hide. Glass is drawn in CSS (opaque dark gradient + iridescent rim), so it looks identical on Windows 10 with no Mica/Acrylic.
- Single instance, autostart (setting), and a tray icon with a menu (open, settings, mute sounds, hide 1 h, quit) using the tray assets.
- Bundle the Rubik font locally (e.g. `@fontsource-variable/rubik`).
- Performance: idle CPU under 1%. Pause animations when hidden. Poll system stats every 2 s with the panel open and every 10 s when compact.
- Safety: deletes always go to the Recycle Bin. System files are never touched. Boost only closes apps the user ticked. No fake "RAM cleaning".

## Work in phases
At the end of each phase: run it, show me evidence (screenshots or a short screen recording plus what you tested), and give me a short checklist to try myself in Arabic. **Wait for my OK before the next phase.** Commit at the end of every phase.

0. **Setup & plan.** Check the toolchain (Rust MSVC, Node LTS, Git, WebView2, VS Build Tools). Tell me exactly what's missing and the command to install it; ask before installing anything system-wide. Scaffold the project, write a short `CLAUDE.md` (commands, structure, conventions), and give me your plan for the riskiest parts (overlay window, click-through + drag-drop, SMTC) before writing much code.
1. **Overlay window + capsule.** Transparent always-on-top window, click-through, capsule at top-center, drag along the top edge, multi-monitor, fullscreen auto-hide, tray icon + menu, single instance, autostart.
2. **The character.** `<Nimi>` React component ported from the reference: all 17 moods, layered motion, Nuri orbit with front/back depth, randomized blinks and glances, reduce-motion, winter outfit, a mood state machine (idle → bored → sleeping timers, hover → curious, click → happy, drag → grabbed/dizzy).
3. **Expanded panel.** Capsule→panel morph, header (status, mute, settings, collapse), 6 tabs, Home tab.
4. **Music.** SMTC integration, island (option B), seek, prev/next, ±10 s, volume, gestures (hover tooltip, wheel = volume with the orbit-ring meter, double-click play/pause, right-click menu).
5. **System.** CPU/RAM/GPU cards with sparklines, the storage card with the drive switcher (all fixed drives), largest-files view, Boost (checklist → run → result).
6. **Feed & Pocket.** Drag-over states, mouth vs. Nuri drop zones, chomp/chew, soap-bubble actions per file type, results next to the original with undo, pocket satellites + tray.
7. **Shortcuts & Command bar.** Tiles, favorites, user shortcuts, timer/Pomodoro, clipboard history, region screenshot, color picker, double-Ctrl command bar (Arabic + English commands, calculator, unit conversion, file find).
8. **Notifications.** Event watchers, the three levels, Do Not Disturb, notifications tab.
9. **Games.** Star Catch, Moon Toss, Expression Memory, local best scores.
10. **Settings, first launch, sounds, i18n, release.** Settings window, onboarding tour, the 14 sounds (mute from panel/right-click/settings/tray, default 40%, never overlapping), winter auto-dates, full Arabic/English with RTL, NSIS installer + portable exe, app icon/`.ico`, and a GitHub Actions release workflow.

## Quality bar
- Match the boards. If something in the spec is ambiguous or technically impossible on Windows 10, tell me and propose the closest option. Don't silently change the design.
- Arabic text must render and align correctly (RTL, mixed numbers and Latin, Rubik).
- Keep the code organized: Rust modules per feature (window, media, system, files, hotkeys, notifications), React feature folders, and typed IPC commands/events between Rust and React.
- Before calling a phase done, review your own diff against the spec section for that phase.
