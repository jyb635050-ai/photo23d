"""Offline benchmark diagnostics. Never imported by the reconstruction kernel."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np


def parse_args():
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--truth", type=Path, required=True)
    parser.add_argument("--recon", type=Path, required=True)
    parser.add_argument("--camera", type=Path, required=True)
    return parser.parse_args(values)


def load_frozen_scorer():
    path = Path(__file__).with_name("score_iou.py")
    spec = importlib.util.spec_from_file_location("frozen_score_iou", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def bins(values: np.ndarray, width: int = 8) -> str:
    return " ".join(str(int(values[start : start + width].sum())) for start in range(0, len(values), width))


def main():
    args = parse_args()
    scorer = load_frozen_scorer()
    camera = json.loads(args.camera.read_text(encoding="utf-8"))
    lower = np.asarray(camera["voxel_bounds"][0], dtype=np.float64)
    upper = np.asarray(camera["voxel_bounds"][1], dtype=np.float64)
    truth, _ = scorer.voxelize(args.truth, lower, upper)
    recon, _ = scorer.voxelize(args.recon, lower, upper)
    false_positive = np.logical_and(recon, np.logical_not(truth))
    false_negative = np.logical_and(truth, np.logical_not(recon))
    print(f"DIAG totals fp={int(false_positive.sum())} fn={int(false_negative.sum())}")
    print(f"DIAG fp_z_bins8 {bins(false_positive.sum(axis=(0, 1)))}")
    print(f"DIAG fn_z_bins8 {bins(false_negative.sum(axis=(0, 1)))}")
    grid = scorer.GRID_SIZE
    step = (upper - lower) / grid
    xs = lower[0] + (np.arange(grid) + 0.5) * step[0]
    ys = lower[1] + (np.arange(grid) + 0.5) * step[1]
    xx, yy = np.meshgrid(xs, ys, indexing="ij")
    radius = np.sqrt(xx * xx + yy * yy)
    for lo, hi in ((0.0, 0.4), (0.4, 0.8), (0.8, 1.2), (1.2, 1.6), (1.6, 2.2)):
        region = np.logical_and(radius >= lo, radius < hi)[:, :, None]
        print(
            f"DIAG radius={lo:.1f}-{hi:.1f} "
            f"fp={int(np.logical_and(false_positive, region).sum())} "
            f"fn={int(np.logical_and(false_negative, region).sum())}"
        )


if __name__ == "__main__":
    main()
