"""Phase 0.2 benchmark — RapidOCR CPU vs GPU + classifier-anchor latency.

Drives the Pass-2 sample-rate decisions:
  - full-frame OCR latency caps action-tracker fps
  - panel-crop latency is the realistic action-tracker workload
  - small-ROI latency is the classifier-anchor case (Pass-1)

Usage:
  python3 tools/video_ingest/scripts/bench_rapidocr_gpu.py
"""

from __future__ import annotations

import gc
import sys
import time
from pathlib import Path
from statistics import median

REPO_ROOT = Path(__file__).resolve().parents[3]
VIDEO_INGEST = REPO_ROOT / "tools" / "video_ingest"
sys.path.insert(0, str(VIDEO_INGEST))

# Preload CUDA libs so the GPU runs find cublasLt/cudnn from nvidia-* wheels.
from video_ingest import gpu_libs  # noqa: E402
gpu_libs.preload(verbose=True)

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from rapidocr_onnxruntime import RapidOCR  # noqa: E402

SCREENSHOTS = REPO_ROOT / "tools" / "game_ocr" / "ScreenShots"

# A diverse trio of frames spanning the workload.
FRAMES: list[Path] = [
    SCREENSHOTS / "Post Game Action tracker (All-Goals + Hits + Shots + Penalties + Faceoffs).png",
    SCREENSHOTS / "Player Loadout View.png",
    SCREENSHOTS / "Pre-Game Lobby State 1.png",
]

# Three crop strategies. Coordinates are eyeballed for 1920x1080 frames.
CROPS = {
    "full_frame": None,  # whole image
    "panel_crop": (1100, 110, 1855, 970),       # action-tracker right panel
    "anchor_roi": (650, 30, 1270, 85),          # screen-title bar (Pass-1 anchor)
}

N_WARMUP = 2
N_TIMED = 5


def time_call(ocr: RapidOCR, img: np.ndarray) -> float:
    t0 = time.perf_counter()
    ocr(img)
    return (time.perf_counter() - t0) * 1000.0


def bench_mode(label: str, ocr: RapidOCR, frames_imgs: dict[str, np.ndarray]) -> None:
    print(f"\n=== {label} ===")
    for crop_name, _ in CROPS.items():
        latencies: list[float] = []
        for fname, img in frames_imgs.items():
            if crop_name == "full_frame":
                sub = img
            else:
                x1, y1, x2, y2 = CROPS[crop_name]
                h, w = img.shape[:2]
                sub = img[max(0, y1):min(h, y2), max(0, x1):min(w, x2)]
                if sub.size == 0:
                    continue
            for _ in range(N_WARMUP):
                ocr(sub)
            for _ in range(N_TIMED):
                latencies.append(time_call(ocr, sub))
        if latencies:
            latencies.sort()
            print(
                f"  {crop_name:11s}  p50={median(latencies):6.1f} ms  "
                f"p95={latencies[int(len(latencies)*0.95)]:6.1f} ms  "
                f"min={min(latencies):6.1f} ms  n={len(latencies)}"
            )


def main() -> int:
    imgs: dict[str, np.ndarray] = {}
    for p in FRAMES:
        if not p.exists():
            print(f"missing fixture: {p}", file=sys.stderr)
            return 1
        img = cv2.imread(str(p))
        if img is None:
            print(f"cv2.imread failed: {p}", file=sys.stderr)
            return 1
        imgs[p.name] = img
        print(f"loaded {p.name}: {img.shape}")

    print("\n>>> RapidOCR CPU (baseline)")
    ocr_cpu = RapidOCR()
    t0 = time.perf_counter()
    ocr_cpu(imgs[list(imgs)[0]])
    print(f"  cold start: {(time.perf_counter() - t0) * 1000:.1f} ms")
    bench_mode("CPU", ocr_cpu, imgs)
    del ocr_cpu
    gc.collect()

    print("\n>>> RapidOCR GPU (CUDA EP)")
    ocr_gpu = RapidOCR(
        det_use_cuda=True,
        cls_use_cuda=True,
        rec_use_cuda=True,
    )
    t0 = time.perf_counter()
    ocr_gpu(imgs[list(imgs)[0]])
    print(f"  cold start: {(time.perf_counter() - t0) * 1000:.1f} ms")
    bench_mode("GPU", ocr_gpu, imgs)
    return 0


if __name__ == "__main__":
    sys.exit(main())
