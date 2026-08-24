from __future__ import annotations

import importlib.util
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
CASES = ROOT / "test" / "cases"
ARTIFACTS = ROOT / "artifacts" / "screenshots"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def load_case(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def main() -> int:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(CASES))
    handler = partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}/"
    passed = 0
    failed = 0
    skipped = 0
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome", headless=True)
            for path in sorted(CASES.glob("[0-9][0-9]_*.py")):
                try:
                    detail = load_case(path).run(browser, base_url, ARTIFACTS)
                    passed += 1
                    print(f"[PASS] {path.stem}: {detail}")
                except Exception as error:
                    failed += 1
                    print(f"[FAIL] {path.stem}: {type(error).__name__}: {error}")
                finally:
                    sys.stdout.flush()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print(f"SUMMARY passed={passed} failed={failed} skipped={skipped}")
    return 0 if failed == 0 and skipped == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
