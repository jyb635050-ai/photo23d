from __future__ import annotations

from common import assert_clean, open_page


def run(browser, base_url, artifacts):
    context, page, evidence = open_page(browser, base_url, {"width": 1280, "height": 800})
    try:
        page.wait_for_function("navigator.serviceWorker.controller !== null", timeout=120_000)
        context.set_offline(True)
        page.reload(wait_until="domcontentloaded", timeout=120_000)
        page.wait_for_function("window.__photo23dState.assetCheck === 'ok'", timeout=120_000)
        assert page.locator("h1").is_visible()
        assert page.locator("#asset-status").inner_text().startswith("离线模型已就绪")
        assert_clean(evidence)
        return "断网重载后页面与 44MB 模型仍从 Service Worker 缓存可用"
    finally:
        context.close()

