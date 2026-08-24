import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { meshToObj } from "../src/core/mesh-io.js";
import { decodePng, thresholdSilhouette } from "../src/core/png.js";
import { reconstructFromMasks } from "../src/core/visual-hull.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const FIXTURES = join(ROOT, "test", "fixtures");
const RESULTS = join(ROOT, "test", "results");
const BLENDER = process.env.BLENDER_PATH || "D:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe";
const SCORE_SCRIPT = join(ROOT, "tools", "score_iou.py");
const CASES = [
  ["beveled_cube", 0.85],
  ["cylinder", 0.85],
  ["suzanne", 0.60],
  ["mug", 0.50],
];

function score(name, resultPath, fixturePath) {
  const run = spawnSync(
    BLENDER,
    [
      "-b",
      "--factory-startup",
      "--python",
      SCORE_SCRIPT,
      "--",
      "--truth",
      join(fixturePath, "truth.obj"),
      "--recon",
      resultPath,
      "--camera",
      join(fixturePath, "cameras.json"),
      "--name",
      name,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const output = `${run.stdout || ""}\n${run.stderr || ""}`;
  const match = output.match(/SCORE .*?IoU=([0-9.]+)/);
  if (run.error || /Traceback/.test(output) || !match) {
    throw new Error(`BENCH_SCORE_ERROR ${name}: ${run.error?.message || output.trim()}`);
  }
  return Number(match[1]);
}

mkdirSync(RESULTS, { recursive: true });
let failed = false;
for (const [name, threshold] of CASES) {
  const fixturePath = join(FIXTURES, name);
  const camera = JSON.parse(readFileSync(join(fixturePath, "cameras.json"), "utf8"));
  const images = camera.views.map((view) => decodePng(readFileSync(join(fixturePath, view.image))));
  const masks = images.map((image) => thresholdSilhouette(image));
  const mesh = reconstructFromMasks({ masks, camera, images, gridSize: 128 });
  const resultPath = join(RESULTS, `${name}.obj`);
  writeFileSync(resultPath, meshToObj(mesh), "utf8");
  const iou = score(name, resultPath, fixturePath);
  const passed = iou + 1.0e-9 >= threshold;
  failed ||= !passed;
  console.log(`${name} IoU=${iou.toFixed(2)} ${passed ? "PASS" : "FAIL"}`);
}
if (failed) process.exitCode = 1;

