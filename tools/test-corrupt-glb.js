import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exportsDir = join(ROOT, "test", "results", "exports");
const source = join(exportsDir, "model.glb");
const corrupted = join(exportsDir, "model-corrupt.glb");
const bytes = new Uint8Array(readFileSync(source));
bytes[0] ^= 0x01;
writeFileSync(corrupted, bytes);
const blender = process.env.BLENDER_PATH || "D:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe";
const run = spawnSync(
  blender,
  [
    "-b",
    "--factory-startup",
    "--python",
    join(ROOT, "tools", "validate_exports.py"),
    "--",
    "--corrupt-glb",
    corrupted,
  ],
  { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
);
const combined = `${run.stdout || ""}\n${run.stderr || ""}`;
const line = combined.split(/\r?\n/).find((item) => item.startsWith("GLB_CORRUPTION FAIL"));
if (!line || run.status === 0) {
  console.error(combined.trim());
  process.exit(1);
}
console.log(`${line} exit=${run.status}`);
