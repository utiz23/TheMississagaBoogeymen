from __future__ import annotations

import ctypes
import sys
from dataclasses import dataclass
from typing import Protocol

import numpy as np
from rapidocr_onnxruntime import RapidOCR

from game_ocr.utils import normalize_text


# CUDA 12 + cuDNN 9 runtime libraries that onnxruntime-gpu's
# CUDAExecutionProvider dlopens at session construction. If any are missing,
# onnxruntime silently falls back to CPU and rapidocr_onnxruntime won't tell
# you. _probe_cuda_runtime() below tries to load each via ctypes and returns
# the list of names that failed — empty list = all loadable = GPU should work.
_REQUIRED_CUDA_LIBS: tuple[str, ...] = (
    "libcublasLt.so.12",   # cuBLAS — the one that bit us first
    "libcublas.so.12",
    "libcudart.so.12",
    "libcudnn.so.9",       # cuDNN 9
)


def _probe_cuda_runtime() -> list[str]:
    """Return the subset of _REQUIRED_CUDA_LIBS that failed to dlopen."""
    missing: list[str] = []
    for name in _REQUIRED_CUDA_LIBS:
        try:
            ctypes.CDLL(name)
        except OSError:
            missing.append(name)
    return missing


@dataclass
class OCRLine:
    text: str
    confidence: float
    x1: float = 0.0
    y1: float = 0.0
    x2: float = 0.0
    y2: float = 0.0

    @property
    def y_center(self) -> float:
        return (self.y1 + self.y2) / 2.0

    @property
    def x_center(self) -> float:
        return (self.x1 + self.x2) / 2.0


class OCRBackend(Protocol):
    name: str

    def read(self, image: np.ndarray) -> list[OCRLine]:
        ...


class RapidOCRBackend:
    name = "rapidocr_onnxruntime"

    def __init__(self, *, use_gpu: bool = False) -> None:
        if use_gpu:
            # Defensive check: onnxruntime-gpu silently falls back to
            # CPUExecutionProvider when CUDAExecutionProvider's runtime libs
            # are missing (e.g., the WSL2 default lacks libcublasLt.so.12 +
            # cuDNN 9). The fallback warning goes to stderr at session-
            # construction time inside RapidOCR and is easy to miss in the
            # firehose of a long-running ingest run — Pass-1 ends up taking
            # 5-10x longer than expected with no obvious cause.  Probe the
            # required CUDA 12 runtime libraries up front; print a single,
            # high-visibility line to stderr listing what's missing so the
            # operator can fix it. We do NOT raise — preserving the silent-
            # fallback behaviour is important for environments that
            # legitimately don't have GPU and pass use_gpu=True out of
            # convenience.
            missing = _probe_cuda_runtime()
            if missing:
                print(
                    "[ocr] WARN: use_gpu=True but CUDA runtime libraries "
                    f"unavailable ({', '.join(missing)}). RapidOCR will "
                    "silently fall back to CPU inference — Pass-1 will run "
                    "5-10x slower than the GPU baseline. Fix: install CUDA "
                    "12.* toolkit + cuDNN 9.* matching the onnxruntime-gpu "
                    "wheel (on WSL2: the cuda-keyring + cuda-toolkit-12-* "
                    "apt repo; cuDNN 9 via the same NVIDIA repo).",
                    file=sys.stderr,
                    flush=True,
                )
            self._engine = RapidOCR(
                det_use_cuda=True,
                cls_use_cuda=True,
                rec_use_cuda=True,
            )
        else:
            self._engine = RapidOCR()

    def read(self, image: np.ndarray) -> list[OCRLine]:
        result, _ = self._engine(image)
        if not result:
            return []
        lines: list[OCRLine] = []
        for box, text, confidence in result:
            normalized = normalize_text(text)
            if normalized:
                xs = [point[0] for point in box]
                ys = [point[1] for point in box]
                lines.append(
                    OCRLine(
                        text=normalized,
                        confidence=float(confidence),
                        x1=float(min(xs)),
                        y1=float(min(ys)),
                        x2=float(max(xs)),
                        y2=float(max(ys)),
                    )
                )
        return lines
