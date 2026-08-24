from __future__ import annotations

from pathlib import Path

from common import assert_clean, load_fixture, open_page


def run(browser, base_url, artifacts: Path):
    context, page, evidence = open_page(browser, base_url, {"width": 1440, "height": 1000})
    try:
        faces = load_fixture(page, "beveled_cube")
        assert page.locator("[data-export]:enabled").count() == 5
        assert page.evaluate("window.__photo23dState.previewFaces") == faces
        canvas = page.locator("#preview")
        box = canvas.bounding_box()
        page.mouse.move(box["x"] + box["width"] * 0.55, box["y"] + box["height"] * 0.5)
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] * 0.72, box["y"] + box["height"] * 0.43, steps=8)
        page.mouse.up()
        page.mouse.wheel(0, -220)
        page.screenshot(path=str(artifacts / "desktop.png"), full_page=True)
        with page.expect_download(timeout=30_000) as event:
            page.locator('[data-export="glb"]').click()
        download = event.value
        output = artifacts / "photo23d-model.glb"
        download.save_as(str(output))
        assert output.read_bytes()[:4] == b"glTF"
        assert page.evaluate("window.__photo23dState.lastExport") == "glb"
        page.screenshot(path=str(artifacts / "after-export.png"), full_page=True)
        assert_clean(evidence)
        return f"完整重建、旋转缩放、GLB 真下载，faces={faces}"
    finally:
        context.close()

