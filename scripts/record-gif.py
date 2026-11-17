"""Record the README's header GIF: NIMI in his capsule going through a few moods.

Needs the dev build running with CDP (see scripts/e2e.py) and, for a clean background, something
plain behind the capsule (the GIF is cut from the screen). Uses Pillow.

    python scripts/record-gif.py docs/screenshots/nimi.gif
    python scripts/record-gif.py out.gif --fps 15 --width 720
"""

import argparse
import ctypes
import os
import sys
import threading
import time

from PIL import Image, ImageGrab

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from e2e import Page, park  # noqa: E402  (also makes this process DPI-aware)

# (mood, seconds). None = his own idle life (blinks, glances, Nuri orbiting).
SCENE = [
    (None, 2.2),
    ("happy", 1.6),
    ("curious", 1.6),
    ("love", 1.6),
    ("music", 2.0),
    ("laugh", 1.4),
    ("sleeping", 2.4),
    ("excited", 1.6),
    (None, 1.2),
]


def capsule_box(ov, pad_x=190, height=232):
    """Screen box (physical px) around the capsule: centered on NIMI, from the top of the window."""
    cx, top = ov.js(
        "(() => { const r = document.querySelector('.shell').getBoundingClientRect(), d = devicePixelRatio;"
        " return [Math.round((screenX + r.x + r.width / 2) * d), Math.round(screenY * d)]; })()"
    )
    half = ov.js("Math.round(document.querySelector('.shell').getBoundingClientRect().width * devicePixelRatio / 2)")
    half += pad_x
    return (cx - half, top, cx + half, top + height)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--fps", type=int, default=15)
    ap.add_argument("--width", type=int, default=720, help="width of the GIF in pixels")
    args = ap.parse_args()

    ov = Page("overlay")
    ov.js("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); 1")
    park()
    time.sleep(1.0)
    box = capsule_box(ov)

    frames, stamps, stop = [], [], threading.Event()

    def grab():
        step = 1 / args.fps
        nxt = time.perf_counter()
        while not stop.is_set():
            frames.append(ImageGrab.grab(bbox=box))
            stamps.append(time.perf_counter())
            nxt += step
            time.sleep(max(0, nxt - time.perf_counter()))

    t = threading.Thread(target=grab)
    t.start()
    try:
        for mood, secs in SCENE:
            arg = "null" if mood is None else f"'{mood}'"
            ov.js(f"window.__nimi.setMood({arg}, {int(secs * 1000) + 400}); 1")
            time.sleep(secs)
    finally:
        stop.set()
        t.join()
        ov.js("window.__nimi.setMood(null); 1")

    w = args.width
    h = round(frames[0].height * w / frames[0].width)
    small = [f.convert("RGB").resize((w, h), Image.LANCZOS) for f in frames]
    # One palette for the whole clip (from a few frames across it) keeps colors steady between frames.
    sample = Image.new("RGB", (w, h * 4))
    for i, k in enumerate((0, len(small) // 3, 2 * len(small) // 3, len(small) - 1)):
        sample.paste(small[k], (0, h * i))
    palette = sample.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    gif = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in small]
    durations = [max(20, round((stamps[i + 1] - stamps[i]) * 1000)) for i in range(len(stamps) - 1)] + [80]
    gif[0].save(args.out, save_all=True, append_images=gif[1:], duration=durations, loop=0, optimize=True, disposal=1)
    size = os.path.getsize(args.out) / 1024
    print(f"{args.out}: {len(gif)} frames, {w}x{h}, {sum(durations) / 1000:.1f} s, {size:.0f} KB")


if __name__ == "__main__":
    ctypes.windll.user32  # noqa: B018  (Windows only)
    main()
