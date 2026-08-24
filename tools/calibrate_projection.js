// Offline benchmark diagnostic. Truth is passed only to the frozen scorer.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { meshToObj } from "../src/core/mesh-io.js";
import { decodePng, thresholdSilhouette } from "../src/core/png.js";
import { reconstructFromMasks } from "../src/core/visual-hull.js";

const root = resolve(import.meta.dirname, "..");
const fixture = join(root, "test", "fixtures", "mug");
const resultDir = join(root, "test", "results");
const baseCamera = JSON.parse(readFileSync(join(fixture, "cameras.json"), "utf8"));
const images = baseCamera.views.map((view) => decodePng(readFileSync(join(fixture, view.image))));
const masks = images.map(thresholdSilhouette);
const blender = process.env.BLENDER_PATH || "D:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe";

for (const cyOffset of [-0.5, 0, 0.5]) {
  for (const cxOffset of [-0.5, 0, 0.5]) {
    const camera = structuredClone(baseCamera);
    camera.intrinsics.cx += cxOffset;
    camera.intrinsics.cy += cyOffset;
    const mesh = reconstructFromMasks({ masks, camera, images, gridSize: 128 });
    const output = join(resultDir, `projection-${cxOffset}-${cyOffset}.obj`);
    writeFileSync(output, meshToObj(mesh));
    const run = spawnSync(
      blender,
      [
        "-b",
        "--factory-startup",
        "--python",
        join(root, "tools", "score_iou.py"),
        "--",
        "--truth",
        join(fixture, "truth.obj"),
        "--recon",
        output,
        "--camera",
        join(fixture, "cameras.json"),
        "--name",
        "mug",
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    const text = `${run.stdout || ""}\n${run.stderr || ""}`;
    const match = text.match(/IoU=([0-9.]+)/);
    if (!match || /Traceback/.test(text)) throw new Error(text);
    console.log(`PROJECTION cx=${cxOffset} cy=${cyOffset} IoU=${match[1]}`);
  }
}
