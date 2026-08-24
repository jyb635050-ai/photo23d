from __future__ import annotations

import os
import urllib.error
import urllib.request
import urllib.parse
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE = os.environ.get("PHOTO23D_LIVE_URL", "https://jyb635050-ai.github.io/photo23d/")
ROOT = Path(__file__).resolve().parents[1]
DOWNLOAD = ROOT / ".tmp" / "live-photo23d.glb"


def head(relative: str, minimum_bytes: int = 1) -> None:
    url = urllib.parse.urljoin(BASE, relative)
    request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Photo23D live verifier"})
    with urllib.request.urlopen(request, timeout=60) as response:
        length = int(response.headers.get("Content-Length", "0"))
        if response.status != 200 or length < minimum_bytes:
            raise RuntimeError(f"{relative}: status={response.status} bytes={length}")
        print(f"LIVE_HTTP {relative or '/'} status={response.status} bytes={length}")


def main() -> None:
    head("", 1000)
    head("vendor/transformers.min.js", 800_000)
    head("vendor/ort-wasm-simd-threaded.jsep.wasm", 20_000_000)
    head("models/briaai/RMBG-1.4/onnx/model_quantized.onnx", 40_000_000)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
        page = context.new_page()
        console_errors: list[str] = []
        page_errors: list[str] = []
        http_errors: list[str] = []
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on("response", lambda response: http_errors.append(f"{response.status} {response.url}") if response.status >= 400 else None)
        page.goto(BASE, wait_until="domcontentloaded", timeout=120_000)
        page.wait_for_function("window.__photo23dState.assetCheck === 'ok'", timeout=180_000)
        result = page.evaluate(
            """async () => {
              const mesh = await window.__photo23dTest.loadSyntheticFixture('beveled_cube');
              return {faces: mesh.cells.length, vertices: mesh.positions.length, status: window.__photo23dState.status};
            }"""
        )
        if result["status"] != "ready" or result["faces"] <= 0:
            raise RuntimeError(f"live generation failed: {result}")
        with page.expect_download(timeout=60_000) as event:
            page.locator('[data-export="glb"]').click()
        DOWNLOAD.parent.mkdir(parents=True, exist_ok=True)
        event.value.save_as(str(DOWNLOAD))
        payload = DOWNLOAD.read_bytes()
        if payload[:4] != b"glTF" or len(payload) < 1000:
            raise RuntimeError("downloaded GLB is invalid")
        if console_errors or page_errors or http_errors:
            raise RuntimeError(
                f"browser errors console={console_errors} page={page_errors} http={http_errors}"
            )
        print("LIVE_BROWSER assetCheck=ok console_errors=0 page_errors=0 http_errors=0")
        print(f"LIVE_GENERATE vertices={result['vertices']} faces={result['faces']} status={result['status']}")
        print(f"LIVE_DOWNLOAD format=GLB bytes={len(payload)} magic={payload[:4].decode('ascii')}")
        context.close()
        browser.close()
    print(f"LIVE_OK {BASE}")


if __name__ == "__main__":
    main()
