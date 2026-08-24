import { reconstructFromMasks } from "../src/core/visual-hull.js";

const probe = process.argv.find((argument) => argument.startsWith("--probe="))?.split("=", 2)[1];
if (!new Set(["full", "empty"]).has(probe)) {
  console.error("用法: node tools/reconstruct.js --probe=full|empty");
  process.exit(64);
}
const value = probe === "full" ? 1 : 0;
const masks = Array.from({ length: 3 }, () => ({
  width: 8,
  height: 8,
  data: new Uint8Array(64).fill(value),
}));
try {
  reconstructFromMasks({ masks, camera: { views: [{}, {}, {}] }, gridSize: 8 });
  console.error(`REVERSE_VALIDATION_ERROR: ${probe} 轮廓未被拒绝`);
  process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
