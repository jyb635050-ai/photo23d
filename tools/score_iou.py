"""Voxel-IoU scorer for the immutable Photo23D benchmark.

This script is intentionally run by Blender so it can use mathutils.bvhtree
without adding a Python package. It voxelizes both meshes into the exact same
128^3 cell-centre grid and prints one machine-readable result line.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree


GRID_SIZE = 128


def parse_args() -> argparse.Namespace:
    arguments = sys.argv
    arguments = arguments[arguments.index("--") + 1 :] if "--" in arguments else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--truth", type=Path, required=True)
    parser.add_argument("--recon", type=Path, required=True)
    parser.add_argument("--camera", type=Path, required=True)
    parser.add_argument("--name", required=True)
    return parser.parse_args(arguments)


def parse_obj(path: Path) -> tuple[list[Vector], list[list[int]]]:
    vertices: list[Vector] = []
    faces: list[list[int]] = []
    for raw_line in path.read_text(encoding="utf-8", errors="strict").splitlines():
        line = raw_line.strip()
        if line.startswith("v "):
            values = line.split()
            vertices.append(Vector((float(values[1]), float(values[2]), float(values[3]))))
        elif line.startswith("f "):
            face: list[int] = []
            for token in line.split()[1:]:
                value = int(token.split("/", 1)[0])
                face.append(value - 1 if value > 0 else len(vertices) + value)
            if len(face) >= 3:
                faces.append(face)
    if not vertices or not faces:
        raise ValueError(f"OBJ has no usable mesh: {path}")
    return vertices, faces


def dedupe_sorted(values: list[float], epsilon: float) -> list[float]:
    result: list[float] = []
    for value in sorted(values):
        if not result or abs(value - result[-1]) > epsilon:
            result.append(value)
    return result


def voxelize(path: Path, lower: np.ndarray, upper: np.ndarray) -> tuple[np.ndarray, int]:
    vertices, faces = parse_obj(path)
    tree = BVHTree.FromPolygons(vertices, faces, all_triangles=False, epsilon=0.0)
    if tree is None:
        raise ValueError(f"Could not build BVH: {path}")

    step = (upper - lower) / GRID_SIZE
    axes = [lower[axis] + (np.arange(GRID_SIZE) + 0.5) * step[axis] for axis in range(3)]
    occupancy = np.zeros((GRID_SIZE, GRID_SIZE, GRID_SIZE), dtype=np.bool_)
    ray_start_x = float(lower[0] - step[0] * 2.0)
    ray_length = float(upper[0] - lower[0] + step[0] * 4.0)
    advance = float(step[0] * 1.0e-4)
    dedupe_epsilon = float(step[0] * 5.0e-4)
    odd_rows = 0

    for iy, y_value in enumerate(axes[1]):
        for iz, z_value in enumerate(axes[2]):
            origin = Vector((ray_start_x, float(y_value), float(z_value)))
            travelled = 0.0
            hits: list[float] = []
            for _ in range(128):
                location, _normal, _index, distance = tree.ray_cast(
                    origin,
                    Vector((1.0, 0.0, 0.0)),
                    ray_length - travelled,
                )
                if location is None:
                    break
                hits.append(float(location.x))
                delta = float(distance) + advance
                travelled += delta
                if travelled >= ray_length:
                    break
                origin.x += delta
            hits = dedupe_sorted(hits, dedupe_epsilon)
            if len(hits) % 2:
                odd_rows += 1
                hits = hits[:-1]
            for entry, exit_ in zip(hits[0::2], hits[1::2]):
                start = int(np.searchsorted(axes[0], entry, side="right"))
                stop = int(np.searchsorted(axes[0], exit_, side="left"))
                if stop > start:
                    occupancy[start:stop, iy, iz] = True
    return occupancy, odd_rows


def main() -> None:
    args = parse_args()
    camera = json.loads(args.camera.read_text(encoding="utf-8"))
    lower = np.asarray(camera["voxel_bounds"][0], dtype=np.float64)
    upper = np.asarray(camera["voxel_bounds"][1], dtype=np.float64)
    truth, truth_odd = voxelize(args.truth, lower, upper)
    recon, recon_odd = voxelize(args.recon, lower, upper)
    intersection = int(np.logical_and(truth, recon).sum())
    union = int(np.logical_or(truth, recon).sum())
    if union == 0:
        raise ValueError("Both meshes voxelized to an empty union")
    iou = intersection / union
    print(
        "SCORE "
        f"name={args.name} grid={GRID_SIZE} intersection={intersection} union={union} "
        f"truth_voxels={int(truth.sum())} recon_voxels={int(recon.sum())} "
        f"truth_odd_rows={truth_odd} recon_odd_rows={recon_odd} IoU={iou:.6f}"
    )


if __name__ == "__main__":
    main()
