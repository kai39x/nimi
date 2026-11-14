# NIMI — Design Spec (v1.0, approved)

NIMI is a small, original digital creature that lives at the top-center of the Windows desktop, Dynamic-Island style. It is a character first and a utility second: it has moods, reacts to the user, and performs real tasks (media control, file actions, system monitor, quick tools, games). Everything is offline: no AI, no cloud, no accounts.

Visual reference for every screen: `design/boards/*.jpg` (rendered from the approved design canvas, in reading order).
Animated character reference: `design/character/nimi-reference.html` (open in a browser — this is the source of truth for the character and its motion).

UI language: Arabic (RTL) and English (LTR), switchable. Default: Arabic. All copy in the boards is the approved Arabic copy.

---

## 1. Identity

- **NIMI** — final name. Wordmark: `design/brand/wordmark_nimi_*.svg` (custom lettering; the first i-dot is Nuri, the second is a star). Arabic: «نيمي».
- **Nuri (نوري)** — NIMI's little moon. It orbits NIMI on a tilted ring, has its own face and mood, passes *behind* NIMI's body and comes back in front.
- **Story (approved):** «كوكب صغير تاه عن مجرّته، ولقى أعلى شاشتك مكان دافي يدور فيه. معه قمره الصغير نوري اللي ما يفارقه، يدور حوله لما يكون رايق، ويسرع لما يشتغل، وينام فوق راسه إذا نعس.»
- **Personality:** dreamy, a little sleepy, curious, smart, playful; talks rarely (short, useful comments only); never interrupts without a reason.

## 2. Character rig

Built as layered SVG + CSS (no images, no game engine). Exact geometry and keyframes: `design/character/nimi_rig_generator.py` + `design/character/nimi.css`. Port these to a React component `<Nimi mood size satellites volume belly winter reducedMotion />`.

Layers (outer → inner), each animated independently:
| Layer | Purpose |
|---|---|
| `L-sh` | ground shadow — stays on the ground, shrinks/fades when NIMI is in the air |
| `L-lift` | vertical lift (jumps) |
| `L-orb` (back + front) | orbit ring + Nuri; lags behind the body (follow-through) |
| `L-sq` | body squash & stretch, origin at the feet |
| `L-fl` / `L-fr` | feet (tap to music, dangle when grabbed) |
| `L-face` | eyes + mouth + blush; trails the body slightly; looks around |
| `L-eyes` / `L-blink` | eye pop / double-blink at randomized intervals (4–7 s) |
| `orb` / `orbF` | Nuri orbit: translate along the tilted ellipse (rx 92, ry 24, tilt −14°), scale 0.87→1.13 for depth; front copy visible only on the near half |
| `L-scarf`, `L-pom` | winter scarf tail and beanie pom-pom sway |

Proportions: body 136 units, Nuri 26 (≈19%), orbit 184×48 tilted −14°, frame 208×208. Default compact size 64px (setting 48–96).

### 17 moods (`design/boards/02_Expressions.jpg`)
| mood | trigger | eyes / mouth | body motion | Nuri |
|---|---|---|---|---|
| idle | default | star-glint eyes, small smile | breathe, look around, occasional small hop (8 s loop) | orbit 9 s |
| sleeping | 10 min after bored / late night | closed / small o | slow breathing | sleeps on his head (on the beanie in winter), z's float |
| happy | clicked / task done | arcs / open smile | hop with squash & stretch | orbit 4.5 s, happy face |
| curious | cursor approaches | one eye bigger + raised brow | head tilt toward cursor | peeks beside his cheek, «?» pops |
| surprised | sudden notification | big eyes / O | anticipation → jump → freeze → tiny shake | flung away, shakes, drifts back |
| excited | achievement (timer done, game record) | sparkle eyes / big open mouth | double high hops with tilt | orbit 2.2 s, twinkles |
| working | executing a command / search / Boost | focused eyes + brows | steady float; eyes scan like reading | orbit 1.3 s with motion trail, «...» dots |
| error | command failed / system problem | worried + sweat drop | shiver, slight droop | falls, bounces, turns coral; ring becomes dashed coral |
| music | media playing | content closed eyes / singing mouth | groove on the beat, feet tap alternately | orbit 2.4 s, notes float |
| attention | important notification waiting | big bright eyes, raised brows | two nudge hops then leans "closer" | comes forward, pulses with rings |
| bored | no interaction for a while | half-lidded, flat mouth | slump + sigh | orbit 16 s, sigh puff |
| grabbed | being dragged | squeezed > < | pendulum swing, stretched, feet dangle | trails behind with lag |
| dizzy | shaken while dragging | spiral eyes | wobble | erratic orbit, stars circle head |
| shy | clicked repeatedly | looks down, hot blush | shrinks and turns away | hides behind his shoulder and peeks |
| hungry | file dragged over him | sparkle eyes / wide open mouth | stretches up, trembles with anticipation | backs off to the side (becomes the pocket drop target) |
| chomp | file dropped on mouth | happy arcs / puffed cheeks | gulp squash | spins |
| chew | digesting (≈0.5 s) | content / munching mouth | quick chew bounce | fast orbit; the eaten file is visible faintly in his belly |

Transitions between moods: 250–400 ms with a slight squash; Nuri continues from where it is (never jumps). Randomize blink/glance timings so nothing repeats on a fixed rhythm. **Reduce motion** setting: no hops/squash/stretch; keep blinks and fades. Pause all animation when hidden (fullscreen, locked).

### Winter look (`design/boards/03_Winter.jpg`)
- Knitted beanie with pom-pom + scarf (rose `#FF9DB5` with butter stripes), snow layer on top of the capsule, light snowfall only around the capsule/panel (max ~16 flakes, click-through, never full-screen).
- Setting «زينة الشتاء»: تلقائي (Dec 1 → end of Feb, from the device date) / دايماً / مطفية. Separate toggle «الثلج يتساقط» (keeps hat & scarf). Reduce-motion stops snow. Rest of the year: default look.

## 3. Compact mode — capsule (approved option A) (`06_Compact.jpg`)
- Dark glass capsule (148×52, `--n-r-capsule`) at top-center; NIMI sits inside and pokes out slightly.
- States: idle · music (album art + NIMI + equalizer + time) · notification (3 levels) · running timer · pocket count badge · winter snow cap.
- Only the capsule is interactive; everything else is transparent and **click-through**.
- Drag left/right along the top edge; double-click its spot to recenter. Multi-monitor: primary by default (setting).
- Auto-hide when a fullscreen game/video is in front; return gently afterwards.

## 4. Music — horizontal island (approved option B) (`07_Music.jpg`)
- Click the capsule while media is playing → capsule widens into a 736×160 island: NIMI (music mood) · album art · title/artist · seek bar with times · −10 s / prev / play-pause / next / +10 s · volume. A button opens the full panel.
- Quick gestures on the capsule (all states): hover → song name tooltip · mouse wheel → volume (the orbit ring itself becomes the volume meter) · double-click → play/pause · right-click → menu (next, previous, **mute NIMI sounds**, hide NIMI for an hour).

## 5. Expanded panel (`11`–`15`)
Opens from the capsule (capsule → panel morph, 420 ms spring, content fades in after 120 ms). 880 px wide dark glass, NIMI sits at the top center. Header: status pill «NIMI رايق» (left/start), buttons: **mute sounds**, settings, collapse. Six tabs: الرئيسية · الأغنية · النظام · اختصارات · تنبيهات · ألعاب (notifications tab shows a count badge). Esc or click outside → back to capsule.

- **Home:** NIMI status card (energy, mood, «أكلات اليوم», days together, last action) + now playing + mini system bars + timer card + favorites + top alert.
- **Music:** same content as the island.
- **System:** CPU / RAM / GPU cards (value, 60 s sparkline, top consumer); temperature only if Windows exposes it without admin, otherwise hide the line. **Storage card with drive switcher** (all fixed drives, e.g. C: and G:; tap the letter or swipe; dots indicator; donut + free/used; color by state: ok/warn/full). **Largest files** view (filters: all, video, archives, Downloads, old; select → move to another drive / send to Recycle Bin; system files are locked). **Boost**: shows a checklist before running (temp files, Recycle Bin, close heavy background apps *that the user ticks*, power plan → High performance for 2 h) then a result («حرّرت 4.7 GB»). **No fake "RAM cleaning".** No battery card (desktop PC); show battery only if a battery exists. NIMI adds one-line comments only when something matters (e.g. «القرص C قرب يمتلي، تبيني أوريك أكبر الملفات فيه؟»).
- **Shortcuts:** 8 fixed tiles (screenshot, timer, Downloads, color picker, mute mic, lock, clipboard history, command bar) · favorite apps (drag apps in) · user shortcuts (open folder / run command or script / open URL — each also usable as a command-bar command) · timer & Pomodoro ring (25/5, 4 rounds, pause, +5 min).
- **Notifications:** list with action button per item, «لا تزعجني» toggle, clear all. Levels: هادي (expression only) · عادي (capsule expands for 5 s) · مهم (nudge, stays until clicked). Watched events (each can be turned off): disk < 10 %, CPU/RAM > 85 % for 5 min, timer/reminder done, new file in Downloads, USB connected/removed, network lost/restored (battery events only on laptops).
- **Games:** Star Catch (move NIMI, catch stars, avoid red meteors, 3 Nuri lives) · Moon Toss (timing: launch Nuri from orbit to hit stars) · Expression Memory (12 cards). Each < 2 min, offline, best score saved locally; NIMI celebrates a new record; suggested during Pomodoro breaks.

## 6. Feed NIMI — drag & drop (approved option B: bubbles) (`08_Feed.jpg`)
1. File dragged near → curious. 2. Over him → hungry, mouth open; two drop zones appear: **mouth** (eat → actions) and **Nuri** (pocket). 3. Drop on mouth → chomp (file shrinks into mouth). 4. Chew ≈0.5 s, file visible in belly. 5. Soap-bubble actions fan out below him (7 bubbles + «المزيد»): copy, cut, copy path, ZIP, move, convert, pocket. Bubbles pop when chosen. 6. Result: the output file pops out of his mouth + toast with «افتح المجلد» and «تراجع».
- Actions depend on what he ate: image (convert PNG/JPG/WebP, shrink, OCR copy text via Windows OCR, strip EXIF) · PDF (merge, extract pages, compress) · archive (extract here/to folder, list contents) · multiple files (one ZIP, batch rename, merge PDFs) · folder (ZIP, size, copy path, open terminal) · text (save note, copy plain, word count) · link (open, copy, desktop shortcut).
- Results are saved next to the original by default (setting: next to original / Downloads / ask). Deletion always goes to the Recycle Bin.

## 7. Pocket (`09_Pocket.jpg`)
Drop on Nuri → the file becomes a tiny satellite orbiting with Nuri (max 8 visible, then a count). Click the satellites → pocket tray: cards with checkbox, name, size, source & time; drag selected out to anywhere; ZIP / copy / move / empty pocket. Stores **paths only** (no copies). Auto-empties after 24 h (setting). Missing files get a mark and are removed after being seen.

## 8. Command bar (`10_Command.jpg`)
Double-tap **Ctrl** (configurable). Glass bar under NIMI (curious). Arabic or English commands: timer/مؤقت, remind/ذكرني, zip/ضغط, shot/لقطة, color/لون, mute/كتم, lock/قفل, open/افتح, find/دوّر, `=` calculator & unit conversion (`10 km to mi`). ↑↓ navigate, Enter run, Tab complete, Esc close. User shortcuts are commands too.

## 9. Settings (`16_Settings.jpg`)
Glass window, sidebar sections: عام · NIMI ونوري · الكبسولة · التنبيهات · الأكل والجيب · الأصوات · الاختصارات · الخصوصية · حول. Changes apply instantly (no save button).
- عام: language (عربي/English), start with Windows, display, winter decoration (تلقائي/دايماً/مطفية).
- NIMI ونوري: size in capsule (48–96, live preview), talkativeness (صامت/قليل/ثرثار — default قليل), gets sleepy after (10/20/30 min/never), Nuri activity (هادي/عادي/نشيط), reduce motion, show status on Home.
- الأكل والجيب: where results go, pocket auto-empty (24 h/week/never), delete = Recycle Bin (locked).
- الأصوات: master on/off, volume (default 40 %, independent of system volume), eating/bubble sounds, mute in fullscreen.
- الخصوصية: «كل شي على جهازك» banner, clear clipboard history, reset stats, replay tour.

## 10. First launch (`17_Onboarding.jpg`)
≤ 1 min, skippable at every step, no windows — only NIMI's bubbles: a star falls from the top → NIMI wakes with Nuri («هلا! أنا NIMI، وهذا نوري.») → language choice → try feeding him a demo file → teaches double-Ctrl → settles into the capsule with «شغّلني مع ويندوز» toggle. Saved as completed; replay from Privacy settings.

## 11. Sounds (`05_Sounds.jpg`, files in `design/sounds/`)
14 WAVs (44.1 kHz, 16-bit mono), original, synced to animations: nimi_chomp, nimi_gulp, bubble_pop, pocket_in, done_success, error_soft, notify_soft, notify_important, timer_done, nimi_hop, nimi_wake, nimi_sleep, boost, nuri_twinkle.
Rules: **mute all in one tap from three places — the speaker button in the panel header, the right-click menu, and Settings** (plus the tray menu). Default 40 %. Auto-mute in fullscreen and Do Not Disturb. Never two sounds at once (queue or drop the less important). No loops.

## 12. Brand (`04_Brand.jpg`)
- App icon: **option B (character without background)** — `design/icons/app/` (SVG, PNG 16–256, `nimi.ico`). ≤ 32 px uses the simplified version.
- Tray icon: monochrome, follows taskbar theme (white on dark, dark on light), states: normal / notification dot / sleeping / do-not-disturb — `design/icons/tray/`. Tray menu: open, settings, mute sounds, hide for 1 h, quit.
- UI icons: `design/icons/ui/*.svg` (24 grid, 1.8 stroke, round caps, `currentColor`).

## 13. Design system (`18_DesignSystem.jpg`, tokens in `design/tokens/`)
Colors, Rubik type scale, radius, spacing (4-pt), shadows/glass, motion curves & durations — use `tokens.css` as-is. Font: Rubik (bundle it locally, e.g. `@fontsource-variable/rubik`; OFL license). Glass = opaque dark gradient fill + 1 px iridescent rim (works on Windows 10 too — no dependency on OS blur effects).

## 14. Interaction map (`19_Flow.jpg`) and components (`20_Inventory.jpg`)
Every path starts and ends at the capsule: click (music? → island : panel) · drag a file (mouth → eat → bubbles → result; Nuri → pocket) · system event → notification → notifications tab · idle → bored → sleeping → wakes when the cursor comes near · Ctrl×2 → command bar → working → result · fullscreen → hidden → returns. Component list with props is in board 20.

## 15. Data sources (all local Windows APIs)
| Feature | Source |
|---|---|
| Media | Windows SMTC — `GlobalSystemMediaTransportControlsSessionManager` (title, artist, thumbnail, timeline, play/pause/next/prev/seek) |
| CPU / RAM | `sysinfo` crate or PDH counters |
| GPU usage / VRAM | PDH "GPU Engine" counters (Win10 1709+) + DXGI adapter memory |
| Disks | `GetDiskFreeSpaceExW` per fixed drive; largest files = on-demand local scan (skip system/protected paths) |
| Downloads | directory watcher (`notify` crate / `ReadDirectoryChangesW`) |
| USB / network | `WM_DEVICECHANGE`, Network List Manager |
| OCR | `Windows.Media.Ocr` (offline, uses installed languages) |
| Recycle Bin | `IFileOperation` with recycle flag (never permanent delete) |
| Power plan | `PowerSetActiveScheme` (restore previous after 2 h) |
| Double-Ctrl | low-level keyboard hook (`WH_KEYBOARD_LL`) |
| Fullscreen detection | `SHQueryUserNotificationState` + foreground-window-covers-monitor check |
| ZIP / images / PDF / hash | `zip`, `image` (+ WebP), `lopdf`, `sha2` crates |

Performance budget: idle CPU < 1 %, no polling faster than needed (system stats every 2 s when the panel is open, 10 s when compact), animations paused when hidden.
