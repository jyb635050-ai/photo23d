import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { exportAllFormats } from "../src/core/mesh-export.js";
import { decodePng, thresholdSilhouette } from "../src/core/png.js";
import { reconstructFromMasks } from "../src/core/visual-hull.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const fixture = join(ROOT, "test", "fixtures", "beveled_cube");
const output = join(ROOT, "test", "results", "exports");
const blender = process.env.BLENDER_PATH || "D:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe";

const camera = JSON.parse(readFileSync(join(fixture, "cameras.json"), "utf8"));
const images = camera.views.map((view) => decodePng(readFileSync(join(fixture, view.image))));
const masks = images.map((image) => thresholdSilhouette(image));
const mesh = reconstructFromMasks({ masks, camera, images, gridSize: 128 });
const files = exportAllFormats(mesh);
mkdirSync(output, { recursive: true });
for (const [extension, bytes] of Object.entries(files)) {
  writeFileSync(join(output, `model.${extension}`), bytes);
}

const run = spawnSync(
  blender,
  [
    "-b",
    "--factory-startup",
    "--python",
    join(ROOT, "tools", "validate_exports.py"),
    "--",
    "--dir",
    output,
    "--faces",
    String(mesh.cells.length),
  ],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
const combined = `${run.stdout || ""}\n${run.stderr || ""}`;
const lines = combined.split(/\r?\n/).filter((line) => /^(GLB|OBJ|STL|PLY|3MF) vertices=/.test(line));
if (run.error || /Traceback/.test(combined) || run.status !== 0 || lines.length !== 5) {
  console.error(combined.trim());
  process.exit(1);
}
console.log(lines.join("\n"));

