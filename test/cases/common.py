from __future__ import annotations


def open_page(browser, base_url: str, viewport: dict[str, int]):
    context = browser.new_context(viewport=viewport, accept_downloads=True)
    page = context.new_page()
    evidence = {"console": [], "page_errors": [], "external": []}
    page.on(
        "console",
        lambda message: evidence["console"].append(message.text)
        if message.type == "error"
        else None,
    )
    page.on("pageerror", lambda error: evidence["page_errors"].append(str(error)))
    page.on(
        "request",
        lambda request: evidence["external"].append(request.url)
        if not (
            request.url.startswith(base_url)
            or request.url.startswith("blob:")
            or request.url.startswith("data:")
        )
        else None,
    )
    page.goto(base_url, wait_until="domcontentloaded", timeout=120_000)
    page.wait_for_function(
        "window.__photo23dState && window.__photo23dState.assetCheck !== 'pending'",
        timeout=120_000,
    )
    asset_state = page.evaluate("window.__photo23dState.assetCheck")
    if asset_state != "ok":
        human_error = page.locator("#asset-status").inner_text()
        raise AssertionError(f"页面资源检查失败：{human_error}")
    page.evaluate("() => navigator.serviceWorker.ready.then(() => true)")
    return context, page, evidence


def load_fixture(page, name: str = "beveled_cube") -> int:
    result = page.evaluate(
        """async (name) => {
          const mesh = await window.__photo23dTest.loadSyntheticFixture(name);
          return { faces: mesh.cells.length, vertices: mesh.positions.length };
        }""",
        name,
    )
    page.wait_for_function("window.__photo23dState.status === 'ready'", timeout=180_000)
    assert result["faces"] > 0
    assert result["vertices"] > 0
    return result["faces"]


def assert_clean(evidence):
    assert evidence["external"] == [], f"检测到站外请求：{evidence['external']}"
    assert evidence["page_errors"] == [], f"页面异常：{evidence['page_errors']}"
    assert evidence["console"] == [], f"控制台错误：{evidence['console']}"

