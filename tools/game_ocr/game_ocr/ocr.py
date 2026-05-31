from __future__ import annotations

import ctypes
import importlib.util
import sys
from dataclasses import dataclass
from pathlib import Path
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


# Dependency-safe order for preloading the pip-installed nvidia-*-cu12
# wheels. cuda_runtime + nvjitlink ship symbols cublas/cufft/etc. depend
# on; cudnn loads last because its sub-libraries chain through cublas.
_NVIDIA_PRELOAD_ORDER: tuple[str, ...] = (
    "cuda_runtime",
    "nvjitlink",
    "cublas",
    "cufft",
    "curand",
    "cusolver",
    "cusparse",
    "cudnn",
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


def _preload_nvidia_cu12_libs() -> bool:
    """Best-effort dlopen of nvidia-*-cu12 pip-installed shared libs so
    onnxruntime's CUDAExecutionProvider can find them via the process
    dynamic symbol table without LD_LIBRARY_PATH.

    Returns True iff after preload every entry in _REQUIRED_CUDA_LIBS is
    loadable via the plain `ctypes.CDLL(name)` path the bare ld.so lookup
    uses. False when the nvidia/ namespace package isn't installed (the
    apt-installed CUDA case — libs are already on ld.so path) or any
    required lib remains missing.

    Pip wheels under `site-packages/nvidia/<lib>/lib/` are not on ld.so's
    search path by default; without this preload, RapidOCR silently falls
    back to CPU even though all the libraries are present on disk."""
    try:
        spec = importlib.util.find_spec("nvidia")
    except (ImportError, ValueError):
        return False
    if spec is None or not spec.submodule_search_locations:
        return False
    nvidia_root = Path(next(iter(spec.submodule_search_locations)))
    for sub in _NVIDIA_PRELOAD_ORDER:
        lib_dir = nvidia_root / sub / "lib"
        if not lib_dir.is_dir():
            continue
        for so in sorted(lib_dir.glob("*.so.*")):
            try:
                ctypes.CDLL(str(so), mode=ctypes.RTLD_GLOBAL)
            except OSError:
                # Best-effort: one missing lib doesn't doom the rest, and
                # _probe_cuda_runtime() below surfaces the real verdict.
                pass
    return not _probe_cuda_runtime()


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
            # are missing OR not on ld.so's search path. The fallback warning
            # goes to stderr at session-construction time inside RapidOCR
            # and is easy to miss in the firehose of a long-running ingest —
            # Pass-1 ends up taking 5-10x longer than expected with no
            # obvious cause.
            #
            # Common case on this project's WSL2 hosts: the pip wheels
            # (nvidia-cublas-cu12, nvidia-cudnn-cu12, etc., dragged in by
            # `onnxruntime-gpu`) install the .so files under
            # `site-packages/nvidia/<lib>/lib/` but don't register that
            # directory with the dynamic linker. _preload_nvidia_cu12_libs()
            # dlopens each via ctypes with RTLD_GLOBAL so the symbols land
            # in the process address space before RapidOCR initialises
            # its CUDAExecutionProvider session.
            _preload_nvidia_cu12_libs()
            missing = _probe_cuda_runtime()
            if missing:
                print(
                    "[ocr] WARN: use_gpu=True but CUDA runtime libraries "
                    f"unavailable ({', '.join(missing)}). RapidOCR will "
                    "silently fall back to CPU inference — Pass-1 will run "
                    "5-10x slower than the GPU baseline. Fix: install the "
                    "pip wheels matching onnxruntime-gpu's CUDA 12 / cuDNN "
                    "9 requirement (e.g. `pip install nvidia-cudnn-cu12 "
                    "nvidia-cublas-cu12`) or apt-install cuda-toolkit-12-* "
                    "+ cuDNN 9 via the NVIDIA WSL repo.",
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
