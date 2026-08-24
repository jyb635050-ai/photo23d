// Offline diagnostic only. Reconstructor never receives the truth mesh.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { closeMask } from "../src/core/mask-postprocess.js";
import { meshToObj } from "../src/core/mesh-io.js";
import { decodePng } from "../src/core/png.js";
import { reconstructFromMasks } from "../src/core/visual-hull.js";

const root = resolve(import.meta.dirname, "..");
const fixture = join(root, "test", "fixtures", "mug");
const camera = JSON.parse(readFileSync(join(fixture, "cameras.json"), "utf8"));
const images = camera.views.map((view) => decodePng(readFileSync(join(fixture, view.image))));
const blender = process.env.BLENDER_PATH || "D:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe";

function masksFor(mode) {
  return images.map((image) => {
    const data = new Uint8Array(image.width * image.height);
    for (let pixel = 0; pixel < data.length; pixel += 1) {
      const offset = pixel * 4;
      const lo = Math.min(image.data[offset], image.data[offset + 1], image.data[offset + 2]);
      const hi = Math.max(image.data[offset], image.data[offset + 1], image.data[offset + 2]);
      data[pixel] = mode === "color" ? (lo < 155 || hi - lo >= 50 ? 1 : 0) : lo < Number(mode.slice(3)) ? 1 : 0;
    }
    return mode === "color" ? closeMask({ width: image.width, height: image.height, data }) : { width: image.width, height: image.height, data };
  });
}

for (const mode of ["min225", "min205", "min185", "color"]) {
  const source = reconstructFromMasks({ masks: masksFor(mode), camera, images, gridSize: 128 });
  for (const scale of [0.99, 0.995, 1, 1.005]) {
    const mesh = { ...source, positions: source.positions.map((position) => position.map((value) => value * scale)) };
    const output = join(root, "test", "results", `pipeline-${mode}-${scale}.obj`);
    writeFileSync(output, meshToObj(mesh));
    const run = spawnSync(blender, [
      "-b", "--factory-startup", "--python", join(root, "tools", "score_iou.py"), "--",
      "--truth", join(fixture, "truth.obj"), "--recon", output,
      "--camera", join(fixture, "cameras.json"), "--name", "mug",
    ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    const text = `${run.stdout || ""}\n${run.stderr || ""}`;
    const match = text.match(/IoU=([0-9.]+)/);
    if (!match || /Traceback/.test(text)) throw new Error(text);
    console.log(`PIPELINE mask=${mode} scale=${scale} IoU=${match[1]}`);
  }
}
