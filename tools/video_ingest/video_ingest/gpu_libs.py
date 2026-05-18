"""Preload CUDA libs bundled by the nvidia-*-cu12 pip wheels.

`onnxruntime-gpu` dlopens `libonnxruntime_providers_cuda.so` lazily; that
shared object then dlopens `libcublasLt.so.12`, `libcudnn.so.9`, etc.
Linux's dynamic loader consults LD_LIBRARY_PATH at dlopen time, so we
either:

  (a) set LD_LIBRARY_PATH in the shell before launching python, or
  (b) preload each lib once at process start via ctypes.CDLL with
      RTLD_GLOBAL so subsequent dlopens find the symbols in memory.

(b) keeps the venv hermetic — callers don't have to remember an env-var
ritual. Import this module BEFORE `import onnxruntime` whenever the CUDA
EP is wanted. Cheap no-op when libs are missing (caller will fall back
to CPU EP).
"""

from __future__ import annotations

import ctypes
import sys
from pathlib import Path

# Order matters: cudart + nvjitlink before everything; cublasLt before cublas
# is fine because we use RTLD_GLOBAL so symbols become available to later loads.
_LIB_ORDER: tuple[str, ...] = (
    "cuda_runtime/lib/libcudart.so.12",
    "nvjitlink/lib/libnvJitLink.so.12",
    "cublas/lib/libcublasLt.so.12",
    "cublas/lib/libcublas.so.12",
    "cudnn/lib/libcudnn.so.9",
    "cufft/lib/libcufft.so.11",
    "curand/lib/libcurand.so.10",
    "cusparse/lib/libcusparse.so.12",
    "cusolver/lib/libcusolver.so.11",
    "cuda_nvrtc/lib/libnvrtc.so.12",
)


def _nvidia_root() -> Path | None:
    """Locate site-packages/nvidia/ via Python's import machinery.

    Robust to system-wide, user-local (`pip install --user`), and venv
    installs. The nvidia-*-cu12 wheels register a `nvidia` namespace
    package — its `__path__[0]` is the directory we need.

    Previously this used `sysconfig.get_paths()["purelib"]` which returns
    the system Python's purelib only — when wheels were installed via
    `pip install --user` they live in `~/.local/lib/.../site-packages/`
    and the preload silently bailed, forcing onnxruntime back to CPU EP.
    """
    try:
        import nvidia
    except ImportError:
        return None
    paths = getattr(nvidia, "__path__", None)
    if not paths:
        return None
    return Path(paths[0])


def preload(verbose: bool = False) -> list[str]:
    """Preload bundled CUDA libs. Returns list of successfully loaded libs."""
    nvidia_root = _nvidia_root()
    if nvidia_root is None:
        if verbose:
            print("[gpu_libs] nvidia namespace package not importable", file=sys.stderr)
        return []
    loaded: list[str] = []
    for rel in _LIB_ORDER:
        p = nvidia_root / rel
        if not p.exists():
            continue
        try:
            ctypes.CDLL(str(p), mode=ctypes.RTLD_GLOBAL)
            loaded.append(p.name)
        except OSError as e:
            if verbose:
                print(f"[gpu_libs] preload {p.name} failed: {e}", file=sys.stderr)
    if verbose:
        print(
            f"[gpu_libs] preloaded {len(loaded)} CUDA libs from {nvidia_root}",
            file=sys.stderr,
        )
    return loaded


if __name__ == "__main__":
    libs = preload(verbose=True)
    for n in libs:
        print(n)
