# NIMI — notes for Claude Code

Windows desktop companion: **Tauri 2 (Rust) + React 19 + TypeScript + Vite**. Offline only. No cloud, no telemetry, no AI.
Talk to Kai in Arabic (casual). Code, comments and commit messages in English.

## Commands
| What | Command |
|---|---|
| Dev: Vite + the Tauri overlay window, hot reload | `npm run tauri dev` |
| Release build (NSIS installer + exe) | `npm run tauri build` |
| Typecheck the frontend | `npm run typecheck` |
| Rust check / clippy / fmt | `npm run rust:check` · `npm run rust:clippy` · `npm run rust:fmt` |
| Regenerate TS types from Rust IPC structs | `npm run ipc:gen` |
| DPI-correct screenshot for phase evidence | `powershell -File scripts/screenshot.ps1 -Out docs/evidence/<name>.png [-X -Y -W -H]` |
| Drive a running webview (dev build started with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`) | `python scripts/cdp.py --list` · `python scripts/cdp.py --index 1 "<js>"` |
| Profile a running webview (trace summary: paints, raster, GPU per second) | `python scripts/cdp_trace.py --index <n> --seconds 3` |
| Real OLE file drag for drop tests (STA) | `powershell -STA -File scripts/drag-file.ps1 -Path <file> -ToX <px> -ToY <px>` |

Portable exe: `src-tauri/target/release/nimi.exe`. Installer: `src-tauri/target/release/bundle/nsis/`.
Tauri downloads NSIS into `%LOCALAPPDATA%\tauri` on the first `tauri build` (user-scoped, no admin).

## Read first
- `docs/HANDOFF.md` — **current state and what to do next** (short; read before anything else).
- `PROMPT.md` — the brief and the 11 phases. Wait for Kai's OK between phases; commit at the end of each.
- `design/DESIGN_SPEC.md` — the contract. `design/boards/*.jpg` — the approved screens; look at the board before building its screen.
- `design/character/nimi-reference.html`, `nimi_rig_generator.py`, `nimi.css` — the character. Port the geometry and keyframes; never redraw.
- `docs/PLAN.md` — how the risky parts work (overlay window, click-through + drag-drop, SMTC).

## Structure
```
src/                         React (TypeScript)
  app/                       root shell; routes by window label (overlay / settings)
  features/<name>/           one folder per feature: overlay (click-through, hit rects, drag), shell (the one
                             glass surface: capsule ↔ panel morph), panel (header, tabs, Home), character,
                             music, system, feed, pocket, shortcuts, commandbar, notifications, games,
                             settings, onboarding
  ipc/                       commands.ts (typed invoke wrappers), events.ts, generated/ (ts-rs output — never edit)
  i18n/                      ar.json, en.json, t()
  lib/                       sounds, store, utils
  styles/                    fonts.css (Rubik @font-face), global.css; tokens come from design/tokens via "@design"
src-tauri/src/
  lib.rs                     builder: plugins → commands → setup
  ipc.rs                     every command/event payload type (derive Serialize + TS)
  window/                    placement, hittest (click-through), fullscreen, monitors
  tray.rs · settings.rs      (phase 1 / 10)
  media/ system/ files/ hotkeys/ notifications/      (phases 4–8)
design/                      the approved design package — read-only, imported directly by the frontend
docs/                        PLAN.md (architecture of the risky parts), evidence/ (phase screenshots)
scripts/                     screenshot.ps1 (DPI-aware capture), cdp.py (drive a webview over CDP), cdp_trace.py (perf trace), drag-file.ps1 (real OLE drag)
```

## Conventions
- **Tokens**: use `--n-*` from `design/tokens/tokens.css` as-is; glass surfaces use `.n-glass`. The font family is `'Rubik'`, declared in `src/styles/fonts.css` from the `@fontsource-variable/rubik` files (Arabic + Latin subsets).
- **RTL first**: Arabic is the default; `<html dir>` follows the language. Use logical CSS (`margin-inline-start`, `inset-inline-end`, …), never left/right for layout. Numbers and Latin inside Arabic text get `unicode-bidi: isolate` where needed.
- **IPC**: Rust command `snake_case` ↔ TS wrapper `camelCase` in `src/ipc/commands.ts`. Payload fields are `camelCase` via `#[serde(rename_all = "camelCase")]`. Every payload type lives in `src-tauri/src/ipc.rs` with `#[derive(Serialize, TS)] #[ts(export)]`; run `npm run ipc:gen` after changing one and commit the output. Events are named `nimi://<area>/<event>`.
- **Rust**: one module per feature. Windows-only code behind `#[cfg(windows)]`. COM/WinRT work (SMTC, Core Audio, hooks) runs on its own thread with its own message loop; never block the main thread. Prefer Tauri's window API; drop to the `windows` crate only when Tauri has no API, and say why in a comment.
- **Safety**: deletion goes through the `trash` crate (Recycle Bin) only. Never touch system/protected paths. Boost closes only the processes the user ticked. No fake "RAM cleaning".
- **Character rig**: `src/features/character/` — `rig/parts.tsx` is the geometry port (never redraw), `rig/moods.ts` the 17-mood table, `Nimi.tsx` the layered component (compositor wrappers, see docs/PLAN.md "phase 2"), `useNimiMood.ts` the state machine; other features drive moods with `setMoodOverride`. In dev, `window.__nimi.setMood('happy')` forces a mood for screenshots.
- **Shell & panel**: `features/shell/Shell.tsx` owns compact/expanded state, the hit rect, the mood machine and the morph (`constants.ts` has the sizes); `features/panel/` renders the header, `TabBar` and tabs. Other tabs land in their phases; until then they show the approved «يجي قريب» placeholder. Open = `setOverlayExpanded(true)` + `focusOverlay(true)` (Rust then reports clicks outside and the window may take keyboard focus); close reverses both.
- **Performance budget**: idle CPU < 1 %; system stats every 2 s with the panel open, 10 s when compact; pause all animation and timers while hidden.
- **Dev-only switches** (debug builds): `NIMI_DEV_SKIP=clickthrough,subclass,hittest,fullscreen` disables parts of the overlay setup; the `dev_window_flags` command flips window styles at runtime. Both exist to bisect Win32 behaviour with `scripts/cdp.py`.
- **Window rules learned the hard way** (see docs/PLAN.md "What phase 1 taught us"): never `focus: false` on a window that must accept file drops; secondary windows are declared in `tauri.conf.json`, created hidden, and only shown/hidden at runtime.
- **Before calling a phase done**: `npm run typecheck`, `npm run rust:clippy`, run the app, capture screenshot/video evidence, and review the diff against that phase's spec section. Phase-end commits start with `phase N:`.
