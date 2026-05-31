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
from pathlib import Path
from unittest import mock


# Patch BEFORE import so rapidocr_onnxruntime never actually loads.
_RAPIDOCR_STUB = mock.MagicMock(return_value=mock.MagicMock())
with mock.patch.dict(sys.modules, {"rapidocr_onnxruntime": mock.MagicMock(RapidOCR=_RAPIDOCR_STUB)}):
    from game_ocr import ocr as ocr_module
    from game_ocr.ocr import RapidOCRBackend


class TestGpuFallbackWarning(unittest.TestCase):
    """Warning surface contract.

    - Trigger: use_gpu=True AND, after the nvidia-*-cu12 preload attempt,
      at least one of _REQUIRED_CUDA_LIBS is still missing.
    - Format: single line on stderr, leading `[ocr] WARN:`, naming the
      missing libraries and the remediation.
    - Suppressed: use_gpu=False (no fallback question to answer) and
      use_gpu=True with all libs loadable (GPU works as advertised).
    """

    def _make_backend(self, *, use_gpu: bool, missing: list[str]):
        """Construct a RapidOCRBackend with the probe return value forced.
        Patches the preload to a no-op so this test only exercises the
        warning surface, not the preload mechanism (covered separately
        in TestPreloadNvidiaCu12Libs). Returns captured stderr text."""
        with mock.patch.object(ocr_module, "_probe_cuda_runtime", return_value=missing), \
             mock.patch.object(ocr_module, "_preload_nvidia_cu12_libs", return_value=not missing):
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


class TestPreloadNvidiaCu12Libs(unittest.TestCase):
    """The pip wheels for nvidia-*-cu12 install .so files under
    site-packages/nvidia/<lib>/lib/ but don't register them with the
    dynamic linker. _preload_nvidia_cu12_libs() dlopens each manually so
    onnxruntime can find them. Tests exercise the lookup + dlopen logic
    against a synthetic nvidia/ tree.
    """

    def test_returns_false_when_nvidia_namespace_absent(self) -> None:
        """No `nvidia` package on sys.path → no-op + returns False (the
        apt-installed CUDA case has libs on the system ld.so path and
        doesn't need this preload at all)."""
        with mock.patch.object(ocr_module.importlib.util, "find_spec", return_value=None):
            self.assertFalse(ocr_module._preload_nvidia_cu12_libs())

    def test_returns_false_when_find_spec_raises(self) -> None:
        """find_spec can raise ImportError on a malformed path entry; the
        preload swallows it (best-effort, no GPU-acceleration is a valid
        outcome) and returns False."""
        with mock.patch.object(
            ocr_module.importlib.util, "find_spec", side_effect=ImportError("bad")
        ):
            self.assertFalse(ocr_module._preload_nvidia_cu12_libs())

    def test_dlopens_each_lib_in_sorted_order(self) -> None:
        """Synthetic nvidia/<sub>/lib/*.so.* tree → preload dlopens each
        with RTLD_GLOBAL and stops on the probe verdict."""
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "nvidia"
            for sub in ocr_module._NVIDIA_PRELOAD_ORDER:
                sub_dir = root / sub / "lib"
                sub_dir.mkdir(parents=True)
                # One synthetic .so per sub-package so we can assert
                # CDLL was called for each.
                (sub_dir / f"libfake_{sub}.so.99").touch()

            fake_spec = mock.MagicMock()
            fake_spec.submodule_search_locations = [str(root)]
            opened: list[str] = []

            def fake_cdll(path, mode=0):
                if isinstance(path, str) and path.startswith(str(root)):
                    opened.append(Path(path).name)
                return mock.MagicMock()

            with mock.patch.object(ocr_module.importlib.util, "find_spec", return_value=fake_spec), \
                 mock.patch.object(ocr_module.ctypes, "CDLL", side_effect=fake_cdll):
                # Force the probe to report no missing libs so the
                # return value path is exercised.
                with mock.patch.object(ocr_module, "_probe_cuda_runtime", return_value=[]):
                    result = ocr_module._preload_nvidia_cu12_libs()

            self.assertTrue(result)
            # Every sub-package contributed exactly one synthetic .so;
            # they should land in declared (_NVIDIA_PRELOAD_ORDER) order.
            expected = [f"libfake_{sub}.so.99" for sub in ocr_module._NVIDIA_PRELOAD_ORDER]
            self.assertEqual(opened, expected)

    def test_swallows_per_lib_dlopen_failure(self) -> None:
        """One missing/broken .so doesn't doom the rest — preload keeps
        trying others. The probe verdict is the final word."""
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "nvidia"
            sub_dir = root / "cublas" / "lib"
            sub_dir.mkdir(parents=True)
            (sub_dir / "libgood.so.12").touch()
            (sub_dir / "libbad.so.12").touch()

            fake_spec = mock.MagicMock()
            fake_spec.submodule_search_locations = [str(root)]

            def selective_cdll(path, mode=0):
                if isinstance(path, str) and "libbad" in path:
                    raise OSError("synthetic load failure")
                return mock.MagicMock()

            with mock.patch.object(ocr_module.importlib.util, "find_spec", return_value=fake_spec), \
                 mock.patch.object(ocr_module.ctypes, "CDLL", side_effect=selective_cdll), \
                 mock.patch.object(ocr_module, "_probe_cuda_runtime", return_value=["libcudnn.so.9"]):
                # Should not raise; should return False because the probe
                # still reports a missing lib.
                self.assertFalse(ocr_module._preload_nvidia_cu12_libs())


if __name__ == "__main__":
    unittest.main()
