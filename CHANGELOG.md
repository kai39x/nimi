# Changelog

Every release of NIMI. The release workflow copies a version's section into its GitHub Release
notes, so each version is written here before it is tagged.

## 1.1.0 — unreleased

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
