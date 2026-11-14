"""Evaluate JavaScript inside a running NIMI webview through the Chrome DevTools Protocol.

Dev-only test hook. Start the app with WebView2 remote debugging enabled:

    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
    npm run tauri dev

Then:

    python scripts/cdp.py --list
    python scripts/cdp.py "document.title"
    python scripts/cdp.py --target settings "location.href"
    python scripts/cdp.py "window.__TAURI_INTERNALS__.invoke('open_settings_window')"

Expressions are awaited, so promises (Tauri commands) resolve before printing.
Standard library only (no websocket package needed).
"""

import argparse
import base64
import json
import os
import socket
import struct
import sys
import urllib.request

PORT = int(os.environ.get("NIMI_CDP_PORT", "9222"))


def targets():
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=5) as r:
        return [t for t in json.load(r) if t.get("type") == "page"]


class WebSocket:
    """Just enough RFC 6455 for CDP on localhost: text frames, client masking, no fragmentation."""

    def __init__(self, url):
        _, rest = url.split("://", 1)
        hostport, path = rest.split("/", 1)
        host, port = hostport.split(":")
        self.sock = socket.create_connection((host, int(port)), timeout=30)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(
            (
                f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\n"
                f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
            ).encode()
        )
        header = b""
        while b"\r\n\r\n" not in header:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("websocket handshake failed")
            header += chunk
        if b" 101 " not in header.split(b"\r\n", 1)[0]:
            raise RuntimeError(header.decode(errors="replace"))

    def send(self, text):
        payload = text.encode()
        mask = os.urandom(4)
        n = len(payload)
        if n < 126:
            head = struct.pack("!BB", 0x81, 0x80 | n)
        elif n < 65536:
            head = struct.pack("!BBH", 0x81, 0x80 | 126, n)
        else:
            head = struct.pack("!BBQ", 0x81, 0x80 | 127, n)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(head + mask + masked)

    def _recv_exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise RuntimeError("websocket closed")
            buf += chunk
        return buf

    def recv(self):
        b1, b2 = self._recv_exact(2)
        n = b2 & 0x7F
        if n == 126:
            n = struct.unpack("!H", self._recv_exact(2))[0]
        elif n == 127:
            n = struct.unpack("!Q", self._recv_exact(8))[0]
        if b2 & 0x80:
            mask = self._recv_exact(4)
            data = bytes(b ^ mask[i % 4] for i, b in enumerate(self._recv_exact(n)))
        else:
            data = self._recv_exact(n)
        if (b1 & 0x0F) == 0x8:  # close
            raise RuntimeError("websocket closed by peer")
        return data.decode()


def evaluate(ws_url, expression):
    ws = WebSocket(ws_url)
    ws.send(
        json.dumps(
            {
                "id": 1,
                "method": "Runtime.evaluate",
                "params": {
                    "expression": expression,
                    "awaitPromise": True,
                    "returnByValue": True,
                },
            }
        )
    )
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == 1:
            return msg


def main():
    # Windows consoles default to a legacy code page; the pages speak UTF-8 (Arabic copy).
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("expression", nargs="?")
    ap.add_argument("--target", default="", help="substring of the page url or title (default: first page)")
    ap.add_argument("--index", type=int, default=0, help="which of the matching pages to use (0-based)")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    pages = targets()
    if args.list or not args.expression:
        for t in pages:
            print(f"{t.get('title')!r:24} {t.get('url')}")
        return 0

    # Default to a real page (a webview still on about:blank is never what we mean).
    pages.sort(key=lambda t: t.get("url", "") == "about:blank")
    pick = [t for t in pages if args.target in (t.get("url", "") + " " + t.get("title", ""))]
    if len(pick) <= args.index:
        print(f"no page target matching {args.target!r} at index {args.index}", file=sys.stderr)
        return 2

    msg = evaluate(pick[args.index]["webSocketDebuggerUrl"], args.expression)
    result = msg.get("result", {})
    if "exceptionDetails" in result:
        print(json.dumps(result["exceptionDetails"], indent=1, ensure_ascii=False), file=sys.stderr)
        return 1
    value = result.get("result", {})
    print(json.dumps(value.get("value", value.get("description")), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
