import isosurface from "../../vendor/isosurface.mjs";

function ensureMaskShape(mask, index) {
  if (!mask || !Number.isInteger(mask.width) || !Number.isInteger(mask.height)) {
    throw new Error(`RECONSTRUCTION_INPUT_ERROR: 第 ${index + 1} 张轮廓缺少宽高`);
  }
  if (!(mask.data instanceof Uint8Array) || mask.data.length !== mask.width * mask.height) {
    throw new Error(`RECONSTRUCTION_INPUT_ERROR: 第 ${index + 1} 张轮廓数组长度不符`);
  }
}

function classifyMaskSet(masks) {
  let anyForeground = false;
  let anyBackground = false;
  for (const mask of masks) {
    for (const value of mask.data) {
      if (value) anyForeground = true;
      else anyBackground = true;
      if (anyForeground && anyBackground) return "mixed";
    }
  }
  if (!anyForeground) return "empty";
  if (!anyBackground) return "full";
  return "mixed";
}

function sampleMask(mask, u, v) {
  const x = Math.floor(u);
  const y = Math.floor(v);
  if (x < 0 || x >= mask.width || y < 0 || y >= mask.height) return 0;
  return mask.data[y * mask.width + x];
}

function project(matrix, intrinsics, x, y, z) {
  const cameraX = matrix[0][0] * x + matrix[0][1] * y + matrix[0][2] * z + matrix[0][3];
  const cameraY = matrix[1][0] * x + matrix[1][1] * y + matrix[1][2] * z + matrix[1][3];
  const cameraZ = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2] * z + matrix[2][3];
  const depth = -cameraZ;
  if (depth <= 1.0e-8) return null;
  return {
    u: intrinsics.fx * (cameraX / depth) + intrinsics.cx,
    v: intrinsics.cy - intrinsics.fy * (cameraY / depth),
    depth,
  };
}

function carveVisualHull(masks, camera, gridSize, onProgress) {
  const bounds = camera.voxel_bounds;
  if (!Array.isArray(bounds) || bounds.length !== 2) {
    throw new Error("RECONSTRUCTION_INPUT_ERROR: 相机 JSON 缺少 voxel_bounds");
  }
  const lower = bounds[0];
  const upper = bounds[1];
  const step = lower.map((value, axis) => (upper[axis] - value) / gridSize);
  const occupancy = new Uint8Array(gridSize ** 3);
  occupancy.fill(1);
  let occupiedCount = occupancy.length;
  for (let viewIndex = 0; viewIndex < masks.length; viewIndex += 1) {
    const mask = masks[viewIndex];
    const view = camera.views[viewIndex];
    const matrix = view.world_to_camera;
    for (let zIndex = 0; zIndex < gridSize; zIndex += 1) {
      const z = lower[2] + (zIndex + 0.5) * step[2];
      for (let yIndex = 0; yIndex < gridSize; yIndex += 1) {
        const y = lower[1] + (yIndex + 0.5) * step[1];
        const row = gridSize * (yIndex + gridSize * zIndex);
        for (let xIndex = 0; xIndex < gridSize; xIndex += 1) {
          const index = row + xIndex;
          if (!occupancy[index]) continue;
          const x = lower[0] + (xIndex + 0.5) * step[0];
          const pixel = project(matrix, camera.intrinsics, x, y, z);
          if (!pixel || !sampleMask(mask, pixel.u, pixel.v)) {
            occupancy[index] = 0;
            occupiedCount -= 1;
          }
        }
      }
    }
    onProgress?.({ stage: "carve", completed: viewIndex + 1, total: masks.length });
    if (occupiedCount === 0) {
      throw new Error(`RECONSTRUCTION_RESULT_ERROR: 第 ${viewIndex + 1} 个视角后体素被全部雕空`);
    }
  }
  if (occupiedCount === occupancy.length) {
    throw new Error("RECONSTRUCTION_RESULT_ERROR: 雕刻后仍是完整方块，请检查轮廓与相机参数");
  }
  return { occupancy, occupiedCount, lower, upper, step };
}

function extractMarchingCubes(volume, gridSize) {
  const { occupancy, lower, upper, step } = volume;
  const paddedSize = gridSize + 2;
  const sampleLower = lower.map((value, axis) => value - 0.5 * step[axis]);
  const sampleUpper = upper.map((value, axis) => value + 1.5 * step[axis]);
  const mesh = isosurface.marchingCubes(
    [paddedSize, paddedSize, paddedSize],
    (x, y, z) => {
      const ix = Math.round((x - sampleLower[0]) / step[0]);
      const iy = Math.round((y - sampleLower[1]) / step[1]);
      const iz = Math.round((z - sampleLower[2]) / step[2]);
      if (
        ix <= 0 ||
        iy <= 0 ||
        iz <= 0 ||
        ix > gridSize ||
        iy > gridSize ||
        iz > gridSize
      ) {
        return -1;
      }
      const index = ix - 1 + gridSize * (iy - 1 + gridSize * (iz - 1));
      return occupancy[index] ? 1 : -1;
    },
    [sampleLower, sampleUpper],
  );
  if (!mesh.positions.length || !mesh.cells.length) {
    throw new Error("RECONSTRUCTION_RESULT_ERROR: marching cubes 没有生成可用网格");
  }
  return mesh;
}

function projectVertexColors(positions, images, masks, camera) {
  if (!images?.length) {
    return positions.map(() => [0.08, 0.86, 0.94]);
  }
  return positions.map(([x, y, z]) => {
    let red = 0;
    let green = 0;
    let blue = 0;
    let weight = 0;
    for (let index = 0; index < camera.views.length; index += 1) {
      const image = images[index];
      const pixel = project(camera.views[index].world_to_camera, camera.intrinsics, x, y, z);
      if (!pixel || !sampleMask(masks[index], pixel.u, pixel.v)) continue;
      const px = Math.floor(pixel.u);
      const py = Math.floor(pixel.v);
      if (px < 0 || px >= image.width || py < 0 || py >= image.height) continue;
      const offset = (py * image.width + px) * 4;
      const contribution = 1 / Math.max(pixel.depth, 0.01);
      red += image.data[offset] * contribution;
      green += image.data[offset + 1] * contribution;
      blue += image.data[offset + 2] * contribution;
      weight += contribution;
    }
    return weight
      ? [red / weight / 255, green / weight / 255, blue / weight / 255]
      : [0.08, 0.86, 0.94];
  });
}

export function reconstructFromMasks({ masks, camera, images = null, gridSize = 128, onProgress }) {
  if (!Array.isArray(masks) || masks.length < 3) {
    throw new Error("RECONSTRUCTION_INPUT_ERROR: 至少需要 3 张轮廓掩码");
  }
  masks.forEach(ensureMaskShape);
  const classification = classifyMaskSet(masks);
  if (classification === "full") {
    throw new Error("RECONSTRUCTION_INPUT_ERROR: 所有轮廓均为全满，拒绝输出无意义方块");
  }
  if (classification === "empty") {
    throw new Error("RECONSTRUCTION_INPUT_ERROR: 所有轮廓均为空，拒绝输出空网格");
  }
  if (!camera || !Array.isArray(camera.views) || camera.views.length !== masks.length) {
    throw new Error("RECONSTRUCTION_INPUT_ERROR: 轮廓数量与相机视角数量不一致");
  }
  if (!Number.isInteger(gridSize) || gridSize < 8 || gridSize > 256) {
    throw new Error("RECONSTRUCTION_INPUT_ERROR: gridSize 必须是 8–256 的整数");
  }
  const volume = carveVisualHull(masks, camera, gridSize, onProgress);
  onProgress?.({ stage: "mesh", completed: 0, total: 1 });
  const mesh = extractMarchingCubes(volume, gridSize);
  const colors = projectVertexColors(mesh.positions, images, masks, camera);
  onProgress?.({ stage: "mesh", completed: 1, total: 1 });
  return {
    positions: mesh.positions,
    cells: mesh.cells,
    colors,
    bounds: [volume.lower, volume.upper],
    gridSize,
    occupiedVoxels: volume.occupiedCount,
  };
}

