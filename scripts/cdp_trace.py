"""Record a short Chromium trace of a running NIMI webview and summarize where frame time goes.

    python scripts/cdp_trace.py [--target substr] [--index N] [--seconds 3]

Prints total wall time per trace event name (Paint, RasterTask, UpdateLayerTree, …), the paint
damage rects, and the GPU-side raster totals, so animation cost can be attributed. Dev-only;
needs the app started with --remote-debugging-port=9222 (see cdp.py).
"""

import argparse
import collections
import json
import sys
import time

sys.path.insert(0, __file__.rsplit("\\", 1)[0] if "\\" in __file__ else ".")
from cdp import WebSocket, targets  # noqa: E402

CATEGORIES = ",".join(
    [
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "disabled-by-default-devtools.timeline.frame",
        "blink",
        "cc",
        "gpu",
        "viz",
    ]
)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", default="1420")
    ap.add_argument("--index", type=int, default=0)
    ap.add_argument("--seconds", type=float, default=3.0)
    args = ap.parse_args()

    pages = [t for t in targets() if args.target in (t.get("url", "") + t.get("title", ""))]
    pages.sort(key=lambda t: t.get("url", "") == "about:blank")
    ws = WebSocket(pages[args.index]["webSocketDebuggerUrl"])
    ws.sock.settimeout(60)

    def send(i, method, params=None):
        ws.send(json.dumps({"id": i, "method": method, "params": params or {}}))

    send(1, "Tracing.start", {"categories": CATEGORIES, "transferMode": "ReturnAsEvents", "options": "sampling-frequency=0"})
    time.sleep(args.seconds)
    send(2, "Tracing.end")

    events = []
    while True:
        msg = json.loads(ws.recv())
        if msg.get("method") == "Tracing.dataCollected":
            events.extend(msg["params"]["value"])
        elif msg.get("method") == "Tracing.tracingComplete":
            break

    by_name = collections.Counter()
    count = collections.Counter()
    by_proc = collections.Counter()
    paint_areas = []
    for e in events:
        if e.get("ph") != "X":
            continue
        dur = e.get("dur", 0) / 1000.0
        name = e.get("name", "?")
        by_name[name] += dur
        count[name] += 1
        by_proc[(e.get("pid"), name)] += dur
        if name == "Paint":
            clip = e.get("args", {}).get("data", {}).get("clip")
            if clip and len(clip) >= 8:
                xs = clip[0::2]
                ys = clip[1::2]
                paint_areas.append((max(xs) - min(xs)) * (max(ys) - min(ys)))

    interesting = [
        "Paint",
        "RasterTask",
        "RasterizerTaskImpl::RunOnWorkerThread",
        "UpdateLayerTree",
        "UpdateLayoutTree",
        "Layout",
        "PrePaint",
        "Animation",
        "CompositeLayers",
        "Commit",
        "ProxyImpl::ScheduledActionDraw",
        "GPUTask",
        "SkiaOutputSurfaceImplOnGpu::SwapBuffers",
        "DirectRenderer::DrawFrame",
        "Display::DrawAndSwap",
        "BeginFrame",
        "RunTask",
    ]
    print(f"{len(events)} events over {args.seconds:.1f}s\n")
    print(f"{'event':48} {'total ms':>9} {'count':>6} {'ms/s':>8}")
    for name, total in sorted(by_name.items(), key=lambda kv: -kv[1])[:28]:
        print(f"{name[:48]:48} {total:9.1f} {count[name]:6d} {total / args.seconds:8.1f}")
    print("\nflagged:")
    for name in interesting:
        if by_name.get(name):
            print(f"  {name:44} {by_name[name]:8.1f} ms  ({count[name]} ×)  {by_name[name] / args.seconds:6.1f} ms/s")
    if paint_areas:
        paint_areas.sort()
        print(f"\nPaint damage area (CSS px²): median {paint_areas[len(paint_areas)//2]:.0f}, max {paint_areas[-1]:.0f}, paints/s {len(paint_areas)/args.seconds:.1f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
