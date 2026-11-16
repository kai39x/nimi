# NIMI — plan for the risky parts

Written in phase 0, before the code. Updated whenever reality disagrees.

## 1. The overlay window

**One window, fixed size, never resized during morphs.** Label `overlay`, about 960 × 720 logical px: enough for
the 880 px panel, the soap bubbles under NIMI, the command bar, the pocket tray, toasts and the snow around the
capsule. Everything inside is drawn by CSS, so capsule → island → panel is a pure CSS morph; resizing a
transparent window on Windows flickers, so we don't. Settings is a second, ordinary glass window (phase 10).
Games, onboarding and the command bar all live inside the overlay.

**Window flags** (`tauri.conf.json`): `transparent`, `decorations: false`, `shadow: false` (a DWM shadow frame breaks
transparency), `alwaysOnTop`, `skipTaskbar`, `focus: false`, `visible: false` until placed. Glass is CSS
(`.n-glass`: opaque dark gradient + iridescent rim) so Windows 10 and 11 look identical; no Mica/Acrylic.

**Focus.** The overlay must never steal focus from the game or editor underneath. Default: not focusable
(`WS_EX_NOACTIVATE` through Tauri's `set_focusable(false)`). Only while the panel or the command bar needs the
keyboard do we flip to focusable, and we flip back on collapse.

**Placement, DPI, monitors.** All placement math is in physical pixels from Tauri's monitor API. The chosen monitor
is a setting (primary by default, or a monitor by name); if it disappears we fall back to primary. We subclass the
tao HWND once (`SetWindowSubclass`) to receive `WM_DISPLAYCHANGE`, `WM_DPICHANGED`, `WM_SETTINGCHANGE`,
`WM_DEVICECHANGE` and `WM_POWERBROADCAST` — one place for display, theme, USB and power events. Any display
change → re-place at the top edge, re-send hit rects.

**Drag along the top edge.** Pointer-drag on the capsule → `set_position` deltas clamped to the monitor's top edge;
double-click → recenter. The x offset is persisted per monitor name.

**Fullscreen auto-hide.** A 1 Hz check (microseconds): `SHQueryUserNotificationState` (busy / D3D fullscreen /
presentation mode) OR the foreground window's rect covers its monitor (excluding the shell/desktop windows). Hidden →
`hide()` plus a `nimi://overlay/visibility` event so the frontend pauses animations and timers; when it ends we show
again with a soft fade.

## 2. Click-through + OS drag-and-drop — the riskiest part

Goal: only the visible UI (capsule / island / panel / bubbles / tray / toasts) receives the mouse; the rest of the
960 × 720 passes clicks to whatever is beneath; and dragging a file from Explorer onto NIMI must still work.

Mechanism:
1. **Click-through by default.** `set_ignore_cursor_events(true)` → tao sets `WS_EX_TRANSPARENT | WS_EX_LAYERED`.
2. **The frontend owns the hit rects.** A `useHitRect(ref)` hook registers every interactive surface (ResizeObserver
   + state changes, debounced one frame). The union is sent to Rust as logical rects; Rust converts them to physical
   screen rects using the window position and scale factor.
3. **Rust polls the cursor.** `window::hittest` runs one thread calling `GetCursorPos`: every 16 ms while the
   cursor is inside a 160 px "near zone" around any rect, every 100 ms otherwise (a few microseconds per tick,
   far under the 1 % budget). Cursor enters a rect (+8 px slack) → `set_ignore_cursor_events(false)`; leaves → back
   to click-through. Hysteresis so edges don't flap. Toggling goes through the main thread via Tauri's dispatcher.
4. **Drag-and-drop rides on the same flip.** Explorer's OLE drag loop (`DoDragDrop`) re-resolves the target window
   on every mouse move with `WindowFromPoint`, which skips `WS_EX_TRANSPARENT` windows. `GetCursorPos` keeps working
   during a drag, so when the cursor enters the larger "hungry zone" (rect + 120 px) we flip to interactive, and
   Tauri's drop target (`dragDropEnabled: true`) receives `DragEnter` with the absolute file paths and the cursor
   position → `onDragDropEvent` (enter / over / drop / leave) on the frontend. The position decides mouth vs. Nuri.
   The hungry zone is bigger than the click zone, so the flip always happens before the cursor reaches the capsule.
5. **Click outside the panel.** While the panel is open, a left-button press (`GetAsyncKeyState(VK_LBUTTON)`
   transition in the same poll) outside the rects collapses it; Esc is handled in the webview.
6. **Plan B** if polling ever shows in a profile: a `WH_MOUSE_LL` hook on its own thread gives the same cursor
   stream event-driven with zero idle cost. Same logic, different source.

**Proof, first thing in phase 1** (a throw-away spike before any real UI): two colored rects in the overlay.
Verify (a) clicks outside land on the desktop and Explorer windows; (b) clicks inside work; (c) a file dragged from
Explorer fires drag-enter / over / drop with paths and positions; (d) the same at 150 % DPI and on a second monitor;
(e) a fullscreen video hides the overlay and it returns. Short screen recording as evidence.

**Known limits.** An elevated (admin) source cannot drop into a non-elevated window (UIPI) — true for every app.
Extremely fast cursor flicks across the zone between two 16 ms polls are not realistic at 160 px.

### What phase 1 taught us (keep!)

- **Never set `focus: false` on a window that must accept file drops.** With that flag, WebView2 never
  registers its own OLE drop targets on its browser-process child windows (`Chrome_WidgetWin_1`,
  `Chrome_RenderWidgetHostHWND`), and OLE only walks up the window chain within the thread of the
  window under the cursor, so wry's drop target on the host window is never reached: every drop
  returns `DROPEFFECT_NONE`, no `drag-enter` ever fires. Found by bisecting the overlay config with
  a real OLE drag (`scripts/drag-file.ps1`). The overlay instead uses `focusable: false`
  (`WS_EX_NOACTIVATE`) plus `WM_MOUSEACTIVATE → MA_NOACTIVATE` in `window/subclass.rs`, which keeps
  drops working and still never steals focus.
- `alwaysOnTop`, `skipTaskbar`, `focusable: false` and toggling `set_ignore_cursor_events` do **not**
  interfere with drops (all verified).
- Secondary windows are declared in `tauri.conf.json` and created hidden at startup; creating a
  webview window at runtime from a command left its webview stuck on `about:blank` on this machine.
  Opening = `show()` + `set_focus()`, closing = hide (`on_window_event` in `lib.rs`).
- Measured on the 4K @ 200 % machine: click-through flips in one poll tick, drag + recenter exact to
  the pixel, fullscreen auto-hide within 1 s, idle CPU of the whole process tree ≈ 0.2 % of one core.

### What phase 2 taught us (the character)

- **SVG-internal animations are too expensive here.** The display runs at ~141 Hz and every CSS
  transform on an SVG `<g>` re-runs style, layout, paint and GPU raster for the whole character each
  frame: the straight port of the rig cost ~60 % of one core while idle. The port keeps the exact
  geometry and the approved keyframes, but every layer that moves each frame (shadow, lift, squash,
  orbit, Nuri, glow, face) is an HTML wrapper inside a 208 px "unit stage" scaled to the frame, so
  the reference keyframes (written in rig px) apply unchanged and run on the compositor. Result:
  ~5–7 % of one core (≈0.5 % of the machine) with the full idle motion, measured with
  `scripts/cdp_trace.py` and the process-tree CPU script.
- The ring sparkle (`stroke-dashoffset`) cannot be composited; it is driven from a 15 fps timer
  instead of a CSS animation so the main thread sleeps between updates.
- **Never put `will-change` on a 0×0 box**: a zero-size compositor layer clips its own children
  (Nuri vanished until the moon wrappers got real centered boxes).
- Nuri never jumps: the orbit nodes stay mounted across moods and the animation's current time is
  rescaled to the new period on mood change (`Nimi.tsx`, `useLayoutEffect`).

### What phase 3 taught us (the panel)

- **Hand focus back.** The panel makes the overlay focusable so Esc and typing work. If the overlay
  keeps the foreground after collapsing, Chromium never throttles it and idle CPU jumps ~5×. On
  open we remember the previous foreground window; on collapse we make the overlay non-activatable
  again and `SetForegroundWindow` the old one (`window/mod.rs`, `set_overlay_focus`).
- **Single vs double click.** A single click waits 260 ms before morphing; otherwise the panel opens
  under the cursor and the second click of a double-click lands outside the old capsule rect.
- Click-outside uses `GetAsyncKeyState`'s "pressed since last call" bit, and the hit-test loop polls
  at 16 ms while the panel is open, so even very short clicks collapse it.
- The panel content unmounts 320 ms after it closes; a closed panel costs nothing.
- Measured on 4K @ 200 %, 143 Hz: idle with the panel closed ≈ 3–5 % of one core for the whole
  process tree (≈0.3–0.4 % of the machine).

### What phase 4 taught us (music, character v3)

- **Lift SVG-internal animations.** A CSS animation on an element *inside* an SVG (the rig's notes,
  z's, twinkles, rings) repaints that SVG on the main thread every frame — ~20 % of a core for the
  three music notes at 143 Hz. `engine.ts` `liftAnimations` moves each animated group into its own
  small HTML box (parent transform kept as a matrix) so the same keyframes run on the compositor.
  Same reason Nuri's glow and roll are HTML wrappers.
- **The overlay starts unthrottled.** WebView2 marks the page focused when the webview is created;
  the overlay is never activated, so it never gets a blur and Chromium never throttles it (≈3× idle
  CPU) until the panel is opened and closed once. `window::settle_focus` runs that focus round trip
  once, 1.5 s after startup. Check with `document.hasFocus()` over CDP before measuring CPU.
- **Measure CPU only after ~30 s**: right after a launch Vite and WebView2 warm-up dominate, and
  numbers swing ±5 % run to run; repeat and report ranges.
- **Testing SMTC without a player**: a local page with an `<audio>` element and
  `navigator.mediaSession` metadata/action handlers (title, artist, artwork, seek, prev/next),
  played in the built-in browser pane, shows up as a full SMTC session.
- One exception in the shared frame loop used to stop every NIMI; the loop now catches per engine.

### What phase 5 taught us (system, and two engine bugs it exposed)

- **No CSS animation may stay on screen at idle.** Any running CSS animation (even a compositor
  one like Nuri's glow) makes Chromium draw the whole transparent 4K overlay on every vsync
  (144/s). Nuri's glow and roll are now driven by `engine.ts` at its own 30 / 60 steps → 52
  draws/s and idle ≈ 8–10 % of one core (was ≈ 30 %), stable run to run.
- **The engine loop multiplied.** A tween or mood switch started inside a frame called `kick()`
  while no rAF/timer was pending, starting a second chain next to the running one; chains kept
  piling up (~400 steps/s). `loop()` now sets `inLoop` and refuses to chain twice. Phase 4's
  noisy CPU numbers were partly this.
- **Bidi**: a Latin value inside an Arabic sentence («864 GB من 953 GB», «C:\», «G:») must be its
  own isolated run — `<bdi dir="ltr">` in JSX (`Fill` in LargestFiles.tsx), U+2068…U+2069 in
  plain strings.
- **The panel is 620 px tall** (spec) and the overlay window 720 px, so board 12's taller System
  layout is compressed to fit; `.sys` scrolls as a fallback (English wraps a little more).
- Process data without admin: Toolhelp + `K32GetProcessMemoryInfo` (private bytes) +
  `GetProcessTimes`; GPU % = PDH `GPU Engine` (busiest engine type), VRAM = PDH `GPU Adapter
  Memory` + DXGI, temperature = `D3DKMTQueryAdapterInfo(ADAPTERPERFDATA)`; SSD = seek-penalty
  IOCTL on a 0-access volume handle.
- A full scan of a 1 TB system drive (1.67 M files) takes ~38 s with directory-listing metadata only.

### What phase 6 taught us (feeding and the pocket)

- **File names are case-insensitive on Windows.** `feed/Feed.tsx` next to `feed/feed.ts` made
  `@/features/feed/Feed` resolve to the store. Components that share a folder with a same-named
  store get a distinct name (`FeedLayer.tsx`).
- **Shell mode CSS loses to `.shell`** when its file is imported before `shell.css` (same
  specificity, later wins). Mode rules in feature CSS use `.shell.shell--<mode>`.
- OLE drag positions from `onDragDropEvent` are physical px; divide by `devicePixelRatio`.
  NIMI's `.nimi` frame is ≈ 1.22 × his size (158 px at 130), so drop zones are measured from the
  live frame rect, never from the size setting.
- The drop zones stay generous: a drop anywhere within 2.1 × the body radius eats the file; only
  Nuri's small circle sends it to the pocket.
- Native, no new crates: WIC (convert / shrink / strip), Windows.Media.Ocr, `tar.exe` (bsdtar ships
  with Windows 10+), `SHCreateDataObject` + `SHDoDragDrop` for drag-out (main thread),
  `SHFileOperationW` for the Recycle Bin.

### What phase 6.1 taught us (drops of text and links, formats, background jobs)

- **wry's drop target takes files only.** Its `IDropTarget` answers `DROPEFFECT_NONE` to any drag
  without `CF_HDROP`, so a browser link or a text selection never reached the page. `files/drop.rs`
  revokes it on the overlay's WebView2 child windows and registers ours (main thread; again after
  1.5 s in case WebView2 adds its input window late). Ours must answer COPY or LINK — a source
  that offers MOVE (an editor) deletes the dragged text when the target says MOVE.
- A left/right click sent before the hit-test loop has made the overlay interactive goes to the
  window behind it. In tests, hover first and wait ~1 s; a stray right-click opened a Claude app
  context menu (`#32768`) that then swallowed every later click over the capsule.
- WinRT async in windows 0.62: `.join()` (not `.get()`).
- `lopdf` 0.42 (needed by `pdf-extract` 0.12) wants Rust 1.85, so MSRV moved to 1.85.
- The page picker types into the overlay, which never takes focus on its own: `feed.ts` calls
  `focusOverlay(true)` only while the picker is shown.
- A background job must also switch peek off, or the capsule rises and the working face and pill
  are gone — exactly what Kai saw.

## 3. SMTC — media

- `windows` crate, features `Media_Control`, `Storage_Streams`, `Foundation`, `Foundation_Collections`. One
  dedicated thread initialised with `RoInitialize(MTA)`: `GlobalSystemMediaTransportControlsSessionManager::
  RequestAsync()?.get()`, subscribe `CurrentSessionChanged`; on the current session subscribe
  `MediaPropertiesChanged`, `PlaybackInfoChanged`, `TimelinePropertiesChanged`. Every change → one snapshot
  `MediaState { title, artist, album, sourceApp, status, positionMs, durationMs, lastUpdatedMs, rate, canSeek,
  canNext, canPrev, thumbnail }` → event `nimi://media/state`.
- **Thumbnail**: `IRandomAccessStreamReference.OpenReadAsync` → bytes → `data:image/…;base64` (≤ 300 px, cached
  by hash so we don't resend the same art on every tick).
- **Timeline**: apps push position only every few seconds; the frontend interpolates
  `position + (now − lastUpdated) × rate` while playing and snaps on each update.
- **Controls**: `TryTogglePlayPauseAsync`, `TrySkipNextAsync`, `TrySkipPreviousAsync`,
  `TryChangePlaybackPositionAsync(ticks)` for seek and ±10 s — guarded by `IsPlaybackPositionEnabled`
  (Spotify yes, some browsers no → the seek bar becomes read-only).
- **Volume**: SMTC has no volume API. The island slider and the wheel gesture control the **system master volume**
  through Core Audio (`IMMDeviceEnumerator` → `IAudioEndpointVolume`, with `OnNotify` so the orbit-ring meter follows
  external changes). Per-app volume is possible later, but mapping SMTC's AppUserModelId to a process is unreliable.
- **Session**: SMTC's *current* session — the same one Windows' own media flyout shows.
- **Fallback**: if the manager cannot be created (rare stripped-down Windows), music features hide and the capsule
  stays idle; nothing crashes.

## 4. Other decisions worth stating now

- **Double-Ctrl**: `WH_KEYBOARD_LL` on its own thread with a message loop. Two Ctrl taps within 350 ms, each held
  < 200 ms, no other key in between. Keys are never swallowed.
- **Recycle Bin**: `trash` crate (`IFileOperation` with `FOF_ALLOWUNDO`). No code path deletes permanently.
- **Autostart**: `tauri-plugin-autostart` (HKCU Run key, current exe path — works for the portable exe too).
- **Single instance**: `tauri-plugin-single-instance`; a second launch just shows the overlay.
- **Tray**: Tauri `tray-icon` with the monochrome assets; taskbar theme from the registry `SystemUsesLightTheme`
  plus `WM_SETTINGCHANGE` to swap light/dark variants and the normal / notify / sleep / DND states.
- **Character performance**: transforms inside one inline `<svg>` rasterise on the main thread. The rig is ported
  with its exact geometry and keyframes; if idle CPU measures above 1 % in phase 2, each `L-*` layer gets its own
  HTML wrapper so the transforms composite on the GPU — same drawing, same keyframes.
- **Typed IPC**: Rust structs derive `ts_rs::TS`; `npm run ipc:gen` writes `src/ipc/generated/`, committed, so the
  frontend never guesses a shape.
