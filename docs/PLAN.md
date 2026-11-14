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
