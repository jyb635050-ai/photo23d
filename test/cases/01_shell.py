from __future__ import annotations

from common import assert_clean, open_page


def run(browser, base_url, artifacts):
    context, page, evidence = open_page(browser, base_url, {"width": 1440, "height": 1000})
    try:
        assert page.locator("h1").inner_text().replace("\n", " ") == "把一圈照片， 变成一个 3D 模型"
        assert page.locator("#photos").get_attribute("multiple") == ""
        assert page.locator("[data-export]").count() == 5
        assert page.locator("#asset-status").inner_text().startswith("离线模型已就绪")
        assert page.evaluate("document.documentElement.scrollWidth === document.documentElement.clientWidth")
        assert_clean(evidence)
        return "离线资源、中文主界面、五个导出入口、无站外请求"
    finally:
        context.close()

