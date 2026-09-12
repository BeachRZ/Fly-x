"""Screenshots of the FLY X viewer at chosen moments, plus any console errors.

Needs a static server at the repo root (python -m http.server 8090) and
exported missions (sim/export.py). Each shot opens its own page with
?mission=&t=&cam=&paused=1 so the moment is exact regardless of frame rate.

    python tools/shoot_space.py [out_dir] [name ...]
"""
import sys
import time
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8090/web/index.html"
SHOTS = [
    ("pad", "mission=fly-L1-s3&t=-0.5&paused=1&auto=0"),
    ("liftoff", "mission=fly-L1-s3&t=3&paused=1&auto=0"),
    ("cockpit", "mission=fly-L1-s3&t=8&paused=1&auto=0&cam=cockpit"),
    ("cabin", "mission=fly-L1-s3&t=10&paused=1&auto=0&cam=cabin"),
    ("cruise", "mission=fly-L1-s3&t=16&paused=1&auto=0"),
    ("asteroid", "mission=fly-L1-s1&t=12.2&paused=1&auto=0"),
    ("explosion", "mission=fly-L1-s1&t=9.8&paused=0&auto=0"),
    ("flip", "mission=fly-L1-s3&t=24.6&paused=1&auto=0&cam=landing"),
    ("descent", "mission=fly-L1-s3&t=31&paused=1&auto=0&cam=landing"),
    ("touchdown", "mission=fly-L1-s3&t=36.6&paused=1&auto=0&cam=landing"),
    ("overview", "mission=fly-L1-s3&t=20&paused=1&auto=0&cam=overview"),
]


def main():
    args = sys.argv[1:]
    out = Path(args[0] if args else "space-shots")
    only = set(args[1:])
    out.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--enable-unsafe-swiftshader", "--use-gl=angle", "--hide-scrollbars"])
        try:
            ctx = browser.new_context(viewport={"width": 1600, "height": 900})
            for name, query in SHOTS:
                if only and name not in only:
                    continue
                page = ctx.new_page()
                page.on("console", lambda m, n=name: errors.append(f"[{n}] [{m.type}] {m.text}")
                        if m.type in ("error", "warning") else None)
                page.on("pageerror", lambda e, n=name: errors.append(f"[{n}] [pageerror] {e}"))
                page.goto(f"{BASE}?{query}", wait_until="domcontentloaded")
                time.sleep(7)
                target = out / f"{name}.png"
                page.screenshot(path=str(target))
                stage = page.evaluate("() => document.getElementById('stage').textContent")
                print(f"{name:10} -> {target} ({target.stat().st_size // 1024} KB), stage: {stage}")
                page.close()
        finally:
            browser.close()
    print(f"\nCONSOLE ERRORS/WARNINGS ({len(errors)}):")
    for e in errors[:30]:
        print("  " + e)


if __name__ == "__main__":
    main()
