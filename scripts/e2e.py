"""Real-input end-to-end tests: drive the running dev build with the real mouse and keyboard.

Why real input: a click sent from code (`el.click()`) has `detail = 0` and skips the capsule's open
path, so the tour bug in 1.0.0 (every tour click also opened the island) passed every scripted
test. These tests move the real cursor and press real keys, the way a person does.

Run before each release:

    1. Quit the installed NIMI (tray → خروج); only one NIMI can run.
    2. $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
       npm run tauri dev
    3. python scripts/e2e.py                 # all suites
       python scripts/e2e.py tour command    # some of them

Don't touch the mouse or keyboard while it runs (about a minute). Before typing, it checks that
NIMI's command bar has the keyboard focus, so keys never land in another window. The settings are
read from the app first and put back at the end, even when a test fails. Dev builds never touch
the Windows autostart entry, so the tour's autostart switch is safe to press.

Exit code 0 = everything passed.
"""

import ctypes
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import evaluate, targets  # noqa: E402

# Arabic and arrows in the report, whatever the console code page is.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

user32 = ctypes.windll.user32
user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))  # physical pixels, like the app

# ---------------------------------------------------------------------------------------------
# Webview access


class Page:
    def __init__(self, label):
        for t in targets():
            ws = t.get("webSocketDebuggerUrl")
            if ws and self._eval(ws, "window.__TAURI_INTERNALS__.metadata.currentWindow.label") == label:
                self.ws = ws
                return
        raise SystemExit(f"no '{label}' webview on the debug port: is the dev build running with CDP?")

    @staticmethod
    def _eval(ws, expression):
        msg = evaluate(ws, expression)
        res = msg.get("result", {})
        if "exceptionDetails" in res:
            raise RuntimeError(res["exceptionDetails"].get("exception", {}).get("description", res))
        return res.get("result", {}).get("value")

    def js(self, expression):
        return self._eval(self.ws, expression)

    def invoke(self, cmd, args=None):
        return self.js(f"window.__TAURI_INTERNALS__.invoke({json.dumps(cmd)}, {json.dumps(args or {})})")

    def at(self, selector):
        """Like `center`, but a missing element fails the check instead of crashing the suite."""
        pt = self.center(selector)
        if pt is None:
            raise AssertionError(f"nothing visible matches {selector}")
        return pt

    def center(self, selector):
        """Physical screen point at the middle of the first visible match, or None."""
        return self.js(
            "(() => {"
            f"  const el = [...document.querySelectorAll({json.dumps(selector)})]"
            "    .find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });"
            "  if (!el) return null;"
            "  const r = el.getBoundingClientRect(), d = devicePixelRatio;"
            "  return [Math.round((screenX + r.x + r.width / 2) * d), Math.round((screenY + r.y + r.height / 2) * d)];"
            "})()"
        )

    def wait(self, expression, timeout=5.0, what=None):
        end = time.time() + timeout
        while time.time() < end:
            try:
                if self.js(expression):
                    return True
            except RuntimeError:
                pass
            time.sleep(0.15)
        raise AssertionError(f"timed out waiting for {what or expression}")


# ---------------------------------------------------------------------------------------------
# Real input (SendInput / mouse_event, physical pixels)

MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP = 0x0002, 0x0004
KEYEVENTF_KEYUP, KEYEVENTF_UNICODE = 0x0002, 0x0004
VK_LCONTROL, VK_ESCAPE, VK_BACK, VK_A = 0xA2, 0x1B, 0x08, 0x41


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", ctypes.c_ushort), ("wScan", ctypes.c_ushort), ("dwFlags", ctypes.c_ulong),
                ("time", ctypes.c_ulong), ("dwExtraInfo", ctypes.c_size_t)]


class INPUT(ctypes.Structure):
    class _U(ctypes.Union):
        _fields_ = [("ki", KEYBDINPUT), ("pad", ctypes.c_byte * 32)]

    _anonymous_ = ("u",)
    _fields_ = [("type", ctypes.c_ulong), ("u", _U)]


def _key(vk=0, scan=0, flags=0):
    inp = INPUT(type=1)
    inp.ki = KEYBDINPUT(vk, scan, flags, 0, 0)
    user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))


def tap(vk, hold=0.04):
    _key(vk)
    time.sleep(hold)
    _key(vk, flags=KEYEVENTF_KEYUP)
    time.sleep(0.03)


def chord(mod, vk):
    _key(mod)
    tap(vk)
    _key(mod, flags=KEYEVENTF_KEYUP)
    time.sleep(0.05)


def type_text(text):
    for ch in text:
        _key(scan=ord(ch), flags=KEYEVENTF_UNICODE)
        _key(scan=ord(ch), flags=KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)
        time.sleep(0.02)


def move(x, y):
    user32.SetCursorPos(int(x), int(y))


def click(pt):
    move(*pt)
    time.sleep(0.12)
    user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    time.sleep(0.05)
    user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)


def drag(a, b, steps=12):
    move(*a)
    time.sleep(0.15)
    user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    time.sleep(0.12)
    for i in range(1, steps + 1):
        move(a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps)
        time.sleep(0.03)
    time.sleep(0.3)
    user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)


def park():
    """Cursor away from NIMI, so hover effects don't change what is checked."""
    w, h = user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
    move(w * 0.8, h * 0.75)


# ---------------------------------------------------------------------------------------------
# Checks

OPEN_MODES = ("shell--panel", "shell--island", "shell--pocket", "shell--command")
SHELL = "document.querySelector('.shell')?.className ?? ''"
results = []


def check(name, ok, detail=""):
    results.append((name, ok))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{('  — ' + detail) if detail and not ok else ''}")


def capsule_closed(ov):
    # A single click opens the capsule only after the double-click interval: wait it out, or a
    # check right after the click passes before the bug shows.
    time.sleep(0.7)
    cls = ov.js(SHELL)
    return not any(m in cls for m in OPEN_MODES), cls


def back_to_compact(ov):
    if not capsule_closed(ov)[0]:
        ov.js("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); 1")
        ov.wait(f"!/{'|'.join(OPEN_MODES)}/.test({SHELL})", 3, "the capsule to close")


# ---------------------------------------------------------------------------------------------
# Suites


def suite_tour(ov, original):
    print("tour")
    # A fresh page resets the tour's remembered step from any earlier run.
    ov.js("location.reload(); 1")
    time.sleep(1.5)
    ov.wait("!!document.querySelector('.shell')", 15, "the overlay to load")
    back_to_compact(ov)
    park()
    ov.invoke("set_settings", {"settings": {**ov.invoke("get_settings"), "onboarded": False}})
    ov.wait("!!document.querySelector('.tour--language')", 12, "the tour's language step")
    offsets = json.dumps(ov.invoke("get_settings")["overlayOffsets"], sort_keys=True)

    lang = "عربي" if original["language"] == "ar" else "English"
    btn = ov.js(
        "(() => { const b = [...document.querySelectorAll('.tour__btn')].find((e) => e.textContent.trim() === "
        f"{json.dumps(lang)}); if (!b) return null; const r = b.getBoundingClientRect(), d = devicePixelRatio;"
        " return [Math.round((screenX + r.x + r.width / 2) * d), Math.round((screenY + r.y + r.height / 2) * d)]; })()"
    )
    if btn is None:
        raise AssertionError(f"no «{lang}» button on the language step")
    click(btn)
    ov.wait("!!document.querySelector('.tour--feed')", 3, "the feed step")
    ok, cls = capsule_closed(ov)
    check("language click moves the tour on and leaves the capsule closed", ok, cls)

    drag(ov.at(".tour__file"), ov.at(".shell__nimi .nimi"))
    try:
        ov.wait("!!document.querySelector('.tour--ctrl')", 4, "the Ctrl step")
        ok, cls = capsule_closed(ov)
        check("dragging the demo file onto NIMI feeds him", ok, cls)
    except AssertionError as e:
        check("dragging the demo file onto NIMI feeds him", False, str(e))
        click(ov.at(".tour__bubble .tour__skip"))

    click(ov.at(".tour__bubble .tour__skip"))
    ov.wait("!!document.querySelector('.tour--apps')", 3, "the notifications step")
    ok, cls = capsule_closed(ov)
    check("«skip» on the Ctrl step moves on and leaves the capsule closed", ok, cls)

    # «إيه» turns on other apps' notifications and shows the Windows hint; «التالي» moves on.
    click(ov.at(".tour__apps-yes"))
    time.sleep(0.6)
    on = ov.invoke("get_settings")["notifyWatch"]["apps"]
    hint = ov.js("!!document.querySelector('.tour__apps-next')")
    click(ov.at(".tour__apps-next"))
    ov.wait("!!document.querySelector('.tour--home')", 3, "the last step")
    ok, cls = capsule_closed(ov)
    check("«إيه» on the notifications step turns them on, then moves on", on and hint and ok, cls)

    before = ov.invoke("get_settings")["autostart"]
    sw = ov.at(".tour__auto [role=switch]")
    click(sw)
    time.sleep(0.6)
    flipped = ov.invoke("get_settings")["autostart"] != before
    click(sw)
    time.sleep(0.6)
    back = ov.invoke("get_settings")["autostart"] == before
    ok, cls = capsule_closed(ov)
    check("the autostart switch flips (twice) without opening the capsule", flipped and back and ok, cls)

    click(ov.at(".tour__go"))
    ov.wait("!document.querySelector('.tour')", 3, "the tour to close")
    done = ov.invoke("get_settings")["onboarded"]
    ok, cls = capsule_closed(ov)
    check("«يلا» ends the tour and saves it", done and ok, cls)

    moved = json.dumps(ov.invoke("get_settings")["overlayOffsets"], sort_keys=True) != offsets
    check("no tour click dragged the capsule", not moved)
    park()


def suite_capsule(ov, _original):
    print("capsule")
    back_to_compact(ov)
    click(ov.at(".shell__nimi .nimi"))
    try:
        ov.wait(f"/shell--panel|shell--island/.test({SHELL})", 3, "the panel or island")
        check("a real click on NIMI opens him", True)
    except AssertionError as e:
        check("a real click on NIMI opens him", False, str(e))
    park()
    time.sleep(0.3)
    if ov.js("document.hasFocus()"):
        tap(VK_ESCAPE)
        try:
            ov.wait(f"!/{'|'.join(OPEN_MODES)}/.test({SHELL})", 3, "the panel to close")
            check("Esc closes the panel", True)
        except AssertionError as e:
            check("Esc closes the panel", False, str(e))
    else:
        check("the opened panel has the keyboard focus", False)
        back_to_compact(ov)


COMMAND_CASES = {
    "ar": [("= 12 * 3.5", "42"), ("10 km to mi", "6.21"), ("tmier 5", "timer"), ("ذكرني 10 اشرب موية", "اشرب موية")],
    "en": [("= 12 * 3.5", "42"), ("10 km to mi", "6.21"), ("tmier 5", "timer"), ("remind 10 drink water", "drink water")],
}


def suite_command(ov, original):
    print("command bar")
    back_to_compact(ov)
    park()
    for attempt in range(2):
        tap(VK_LCONTROL, 0.05)
        time.sleep(0.08)
        tap(VK_LCONTROL, 0.05)
        try:
            ov.wait("!!document.querySelector('.cmd.is-open')", 2.5, "the command bar")
            break
        except AssertionError:
            if attempt:
                check("double Ctrl opens the command bar", False, "it did not open")
                return
            time.sleep(0.6)
    check("double Ctrl opens the command bar", True)

    focus = "document.hasFocus() && document.activeElement?.classList.contains('cmd__input')"
    try:
        ov.wait(focus, 2.5, "the command field to take the keyboard")
        check("the command field has the keyboard focus", True)
    except AssertionError as e:
        # Never type when the focus may be somewhere else.
        check("the command field has the keyboard focus", False, str(e))
        back_to_compact(ov)
        return

    lang = original["language"]
    for text, expect in COMMAND_CASES.get(lang, COMMAND_CASES["en"]):
        if not ov.js(focus):
            check(f"typing «{text}»", False, "the field lost the focus; stopped typing")
            break
        chord(VK_LCONTROL, VK_A)
        tap(VK_BACK)
        type_text(text)
        # The first result row, or the «did you mean …» hint when nothing matched.
        first = (
            "(document.querySelector('.cmd__row .cmd__title') ?? document.querySelector('.cmd__none'))"
            "?.textContent ?? ''"
        )
        try:
            ov.wait(f"({first}).includes({json.dumps(expect)})", 3, f"«{expect}» in the first result")
            check(f"«{text}» → first result has «{expect}»", True)
        except AssertionError:
            check(f"«{text}» → first result has «{expect}»", False, f"first result: {ov.js(first)!r}")

    tap(VK_ESCAPE)
    try:
        ov.wait("!document.querySelector('.cmd.is-open')", 3, "the command bar to close")
        check("Esc closes the command bar", True)
    except AssertionError as e:
        check("Esc closes the command bar", False, str(e))


SUITES = {"tour": suite_tour, "capsule": suite_capsule, "command": suite_command}


def main():
    names = sys.argv[1:] or list(SUITES)
    unknown = [n for n in names if n not in SUITES]
    if unknown:
        raise SystemExit(f"unknown suite(s): {', '.join(unknown)} (have: {', '.join(SUITES)})")
    ov = Page("overlay")
    if not ov.js("!!window.__nimi"):  # the dev-only test hooks
        raise SystemExit("this is not a dev build")
    original = ov.invoke("get_settings")
    if original.get("commandHotkey") != "doubleCtrl":
        ov.invoke("set_settings", {"settings": {**original, "commandHotkey": "doubleCtrl"}})
    print("Real mouse and keyboard from here: hands off for about a minute.\n")
    time.sleep(1.5)
    try:
        for n in names:
            try:
                SUITES[n](ov, original)
            except Exception as e:  # one broken suite must not skip the restore or the others
                check(f"{n}: finished", False, f"{type(e).__name__}: {e}")
                try:
                    back_to_compact(ov)
                except Exception:
                    pass
    finally:
        park()
        ov.invoke("set_settings", {"settings": original})
        print("\nsettings restored")
    failed = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
