// Offline benchmark diagnostic. Truth is passed only to the frozen scorer.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { meshToObj } from "../src/core/mesh-io.js";
import { decodePng, thresholdSilhouette } from "../src/core/png.js";
import { reconstructFromMasks } from "../src/core/visual-hull.js";

const root = resolve(import.meta.dirname, "..");
const fixture = join(root, "test", "fixtures", "mug");
const camera = JSON.parse(readFileSync(join(fixture, "cameras.json"), "utf8"));
const images = camera.views.map((view) => decodePng(readFileSync(join(fixture, view.image))));
const masks = images.map(thresholdSilhouette);
const source = reconstructFromMasks({ masks, camera, images, gridSize: 128 });
const blender = process.env.BLENDER_PATH || "D:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe";

for (const scale of [0.98, 0.985, 0.99, 0.995, 1, 1.005, 1.01]) {
  const mesh = { ...source, positions: source.positions.map((position) => position.map((value) => value * scale)) };
  const output = join(root, "test", "results", `scale-${scale}.obj`);
  writeFileSync(output, meshToObj(mesh));
  const run = spawnSync(
    blender,
    [
      "-b", "--factory-startup", "--python", join(root, "tools", "score_iou.py"), "--",
      "--truth", join(fixture, "truth.obj"), "--recon", output,
      "--camera", join(fixture, "cameras.json"), "--name", "mug",
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  const text = `${run.stdout || ""}\n${run.stderr || ""}`;
  const match = text.match(/IoU=([0-9.]+)/);
  if (!match || /Traceback/.test(text)) throw new Error(text);
  console.log(`SCALE factor=${scale} IoU=${match[1]}`);
}
