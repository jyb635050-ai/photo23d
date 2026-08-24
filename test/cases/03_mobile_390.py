from __future__ import annotations

from common import assert_clean, load_fixture, open_page


def run(browser, base_url, artifacts):
    context, page, evidence = open_page(browser, base_url, {"width": 390, "height": 844})
    try:
        faces = load_fixture(page, "cylinder")
        metrics = page.evaluate("({scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth})")
        assert metrics["scroll"] == metrics["client"], f"mobile overflow: {metrics}"
        sizes = page.locator("[data-export]").evaluate_all(
            "els => els.map(el => ({w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height}))"
        )
        assert all(item["h"] >= 44 and item["w"] >= 44 for item in sizes), f"small tap target: {sizes}"
        page.screenshot(path=str(artifacts / "mobile.png"), full_page=True)
        assert_clean(evidence)
        return f"390px 无横向溢出、触控目标≥44px，faces={faces}"
    finally:
        context.close()

