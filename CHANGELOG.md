# Changelog

Every release of NIMI. The release workflow copies a version's section into its GitHub Release
notes, so each version is written here before it is tagged.

## 1.2.0 — 2026-11-18

### New
- **Other apps' notifications in NIMI** (WhatsApp, Teams, mail…): turn on «إشعارات البرامج» in
  Settings → Notifications (or say yes in the tour) and NIMI shows them in his capsule and his
  list, with the app's icon; «افتح» opens the app. The messages are kept in memory only, never
  saved. Windows still shows its own pop-ups unless its «Do not disturb» is on; NIMI keeps getting
  them either way, and both places have a button to that Windows page.
- The first-launch tour asks whether NIMI should show your apps' notifications.
- **Update now**: when «تحقق من التحديثات» finds a newer version, «حدّث الحين» downloads it,
  checks its signature against NIMI's own key (a changed file is refused), installs it and starts
  NIMI again. Only when you press it. This works from 1.2.0 on: 1.1.x still uses the download page.

## 1.1.1 — 2026-11-18

### Fixed
- NIMI could sit off-center, and double-click («back to the middle») put him in the same wrong
  place. When Windows changed the display scale while NIMI was running (for example right after
  logging in), it enlarged his window and nothing shrank it back. His window now always keeps
  its real size, and goes back to it after any scale or display change.
- «الطاقة» on Home was stuck at 10 %: it only counted while Home was open and treated every gap
  (nights included) as awake time. It now runs all the time; sleep and time away refill it.
- «أكلات اليوم» and «آخر شي سواه» on Home now show what he really ate and did today (they were
  never filled in), with the right Arabic for one, two and many files.
- The tray icon lost «لا تزعجني» or the unread dot after NIMI came back from hiding behind a
  fullscreen game or video.
- Dragging NIMI could save a position a few pixels off from where he was let go.
- A settings file saved by an editor with a BOM (or otherwise unreadable) made NIMI start from
  defaults and then overwrite it. It is read now, and a broken one is kept as
  `settings.json.bad` instead of being lost.
- Notifications older than a week are removed while NIMI runs, not only at the next start.

### Faster and lighter
- Less RAM: the settings and color-picker windows, hidden almost all the time, now ask WebView2
  to keep their memory low until they are opened (about 55 MB less on a fresh start, measured).
  The fixed window size also cuts graphics memory on PCs that hit the scaling bug.

## 1.1.0 — 2026-11-17

### New
- **Check for updates** in Settings → About. It asks GitHub for the latest version only when you
  press it, and offers the download page if there is a newer one. Nothing is downloaded or
  installed by itself; NIMI stays offline the rest of the time.

### Project
- The release notes now come from this changelog.
- Automated tests that drive the real app with real mouse clicks and key presses (the tour and the
  command bar), run before each release.
- The release workflow is ready to sign the exe files through SignPath once the project is
  approved (docs/SIGNING.md), and the README has the «Code signing policy» SignPath asks for.
- The README opens with a GIF of NIMI and has badges for the version and the downloads.
- Dev builds no longer write themselves into Windows autostart (they used to take it over from the
  installed NIMI).

## 1.0.1 — 2026-11-17

### Fixed
- First-launch tour: clicking its buttons also opened the capsule's island, so it had to be
  closed before every next step. The tour's clicks now stay in the tour.
- The installer (`setup.exe`) now shows NIMI's icon instead of the default installer icon.

### Project
- The README shows real screenshots of the app, in Arabic and in English.

## 1.0.0 — 2026-11-16

The first release.

- NIMI and his moon Nuri in a glass capsule at the top of the screen: 24 expressions, soft spring
  motion, sleepy when ignored, a winter hat and scarf.
- Music from any app (Windows media controls): seek, skip, volume with the mouse wheel.
- Feeding: drop a file on him to convert images, read text from images (OCR), merge / split /
  compress PDFs, ZIP and unzip, and check links. The pocket keeps files for later.
- System: CPU, RAM, GPU, every drive, the largest files, and a Boost that only closes the apps you
  pick.
- Shortcuts: screenshot, timer and Pomodoro, color picker, clipboard history, mute mic, lock PC,
  favorite apps and your own shortcuts.
- Command bar on a double Ctrl, in Arabic and English: timers, reminders, math, units, open, find.
- Notifications with three levels and Do Not Disturb.
- Three mini games: Star Catch, Moon Toss and Expression Memory.
- Arabic and English, a first-launch tour, an installer and a portable exe.
