"""Verify RapidOCRBackend surfaces a high-visibility stderr warning when
use_gpu=True is requested but the CUDA runtime libraries onnxruntime-gpu
depends on can't be loaded — covers the silent-fallback failure mode that
was hiding a 5-10× Pass-1 slowdown on this WSL2 environment.

We don't actually invoke RapidOCR here (the constructor is expensive and
its provider selection is what we're working around). Instead we patch the
helper that does the dlopen probe and the heavy RapidOCR construction, then
inspect the captured stderr.
"""

from __future__ import annotations

import io
import sys
import unittest
from contextlib import redirect_stderr
from unittest import mock


# Patch BEFORE import so rapidocr_onnxruntime never actually loads.
_RAPIDOCR_STUB = mock.MagicMock(return_value=mock.MagicMock())
with mock.patch.dict(sys.modules, {"rapidocr_onnxruntime": mock.MagicMock(RapidOCR=_RAPIDOCR_STUB)}):
    from game_ocr import ocr as ocr_module
    from game_ocr.ocr import RapidOCRBackend


class TestGpuFallbackWarning(unittest.TestCase):
    """Warning surface contract.

    - Trigger: use_gpu=True AND at least one of _REQUIRED_CUDA_LIBS fails
      to dlopen via ctypes.
    - Format: single line on stderr, leading `[ocr] WARN:`, naming the
      missing libraries and the remediation.
    - Suppressed: use_gpu=False (no fallback question to answer) and
      use_gpu=True with all libs loadable (GPU works as advertised).
    """

    def _make_backend(self, *, use_gpu: bool, missing: list[str]):
        """Construct a RapidOCRBackend with the probe return value forced.
        Returns captured stderr text."""
        with mock.patch.object(ocr_module, "_probe_cuda_runtime", return_value=missing):
            buf = io.StringIO()
            with redirect_stderr(buf):
                RapidOCRBackend(use_gpu=use_gpu)
            return buf.getvalue()

    def test_warns_when_gpu_requested_and_libs_missing(self) -> None:
        stderr = self._make_backend(
            use_gpu=True,
            missing=["libcublasLt.so.12", "libcudnn.so.9"],
        )
        self.assertIn("[ocr] WARN:", stderr)
        self.assertIn("libcublasLt.so.12", stderr)
        self.assertIn("libcudnn.so.9", stderr)
        # Remediation hint present so operators know what to do.
        self.assertIn("CUDA 12", stderr)
        self.assertIn("cuDNN 9", stderr)

    def test_silent_when_gpu_requested_and_libs_present(self) -> None:
        stderr = self._make_backend(use_gpu=True, missing=[])
        self.assertNotIn("[ocr] WARN:", stderr)

    def test_silent_when_gpu_not_requested(self) -> None:
        """use_gpu=False bypasses the probe entirely — no warning even if
        the libs are missing (CPU is the explicitly-chosen path)."""
        stderr = self._make_backend(
            use_gpu=False,
            missing=["libcublasLt.so.12", "libcudnn.so.9"],
        )
        self.assertEqual(stderr, "")


class TestProbeCudaRuntime(unittest.TestCase):
    """Smoke test for _probe_cuda_runtime — verifies the contract that it
    returns the subset of _REQUIRED_CUDA_LIBS that failed to dlopen."""

    def test_returns_all_when_all_fail(self) -> None:
        with mock.patch.object(ocr_module.ctypes, "CDLL", side_effect=OSError("nope")):
            result = ocr_module._probe_cuda_runtime()
        self.assertEqual(list(result), list(ocr_module._REQUIRED_CUDA_LIBS))

    def test_returns_empty_when_all_load(self) -> None:
        with mock.patch.object(ocr_module.ctypes, "CDLL", return_value=mock.MagicMock()):
            result = ocr_module._probe_cuda_runtime()
        self.assertEqual(result, [])

    def test_returns_specific_failing_lib(self) -> None:
        """Only libcudnn.so.9 fails; others load."""
        def selective_cdll(name):
            if name == "libcudnn.so.9":
                raise OSError("missing cudnn")
            return mock.MagicMock()
        with mock.patch.object(ocr_module.ctypes, "CDLL", side_effect=selective_cdll):
            result = ocr_module._probe_cuda_runtime()
        self.assertEqual(result, ["libcudnn.so.9"])


if __name__ == "__main__":
    unittest.main()
