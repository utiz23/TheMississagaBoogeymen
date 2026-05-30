"""Lock the `selected_frames.json` sidecar semantics in
`Extractor.extract_input()` — visual-prefilter Phase 2 contract.

Cases:
  (a) no sidecar → existing behaviour (process all matching files)
  (b) sidecar present with subset of basenames → process only listed files
      in the same sort order
  (c) sidecar listing a basename that does not exist in the directory →
      skipped silently
  (d) sidecar present on a single-file `input_path` → ignored (only directory
      inputs are subject to filtering)

Tests use a fake OCRBackend so we don't depend on RapidOCR / ONNX at test
time; the contract under test is the input-file filtering, not the OCR
result content.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from game_ocr.extractor import (
    SELECTED_FRAMES_SIDECAR_NAME,
    Extractor,
    ScreenRegistry,
)
from game_ocr.ocr import OCRLine


class _NoOpBackend:
    """Minimal OCRBackend satisfying the Protocol: returns no lines for any
    image. Lets extract_path run end-to-end without standing up RapidOCR."""

    name = "noop-test-backend"

    def read(self, image: np.ndarray) -> list[OCRLine]:
        return []


def _make_png(path: Path) -> None:
    """Write a minimal 8x8 white PNG so cv2.imread can load it."""
    img = np.full((8, 8, 3), 255, dtype=np.uint8)
    cv2.imwrite(str(path), img)


def _make_extractor() -> Extractor:
    return Extractor(backend=_NoOpBackend(), registry=ScreenRegistry())


class TestNoSidecar(unittest.TestCase):
    def test_processes_all_matching_files(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            _make_png(d / "00001.png")
            _make_png(d / "00002.png")
            _make_png(d / "00003.png")
            results = _make_extractor().extract_input("pre_game_lobby_state_1", d)
            sources = sorted(Path(r.meta.source_path).name for r in results)
            self.assertEqual(sources, ["00001.png", "00002.png", "00003.png"])


class TestSidecarSubset(unittest.TestCase):
    def test_subset_filters_to_listed_basenames(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            for name in ("00001.png", "00002.png", "00003.png", "00004.png"):
                _make_png(d / name)
            (d / SELECTED_FRAMES_SIDECAR_NAME).write_text(
                json.dumps(["00002.png", "00004.png"])
            )
            results = _make_extractor().extract_input("pre_game_lobby_state_1", d)
            sources = [Path(r.meta.source_path).name for r in results]
            self.assertEqual(sources, ["00002.png", "00004.png"])

    def test_preserves_sort_order_when_sidecar_listing_is_unsorted(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            for name in ("00001.png", "00002.png", "00003.png"):
                _make_png(d / name)
            # Sidecar lists names out of order — extract_input must still
            # emit results in the directory sort order (00001, 00002, 00003).
            (d / SELECTED_FRAMES_SIDECAR_NAME).write_text(
                json.dumps(["00003.png", "00001.png"])
            )
            results = _make_extractor().extract_input("pre_game_lobby_state_1", d)
            sources = [Path(r.meta.source_path).name for r in results]
            self.assertEqual(sources, ["00001.png", "00003.png"])

    def test_sidecar_with_all_listed_keeps_all(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            for name in ("00001.png", "00002.png"):
                _make_png(d / name)
            (d / SELECTED_FRAMES_SIDECAR_NAME).write_text(
                json.dumps(["00001.png", "00002.png"])
            )
            results = _make_extractor().extract_input("pre_game_lobby_state_1", d)
            sources = sorted(Path(r.meta.source_path).name for r in results)
            self.assertEqual(sources, ["00001.png", "00002.png"])

    def test_empty_sidecar_list_processes_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            for name in ("00001.png", "00002.png"):
                _make_png(d / name)
            (d / SELECTED_FRAMES_SIDECAR_NAME).write_text(json.dumps([]))
            results = _make_extractor().extract_input("pre_game_lobby_state_1", d)
            self.assertEqual(results, [])


class TestSidecarMissingBasenames(unittest.TestCase):
    def test_missing_basename_skipped_silently(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            _make_png(d / "00001.png")
            _make_png(d / "00002.png")
            # Sidecar references a file that doesn't exist — skip silently,
            # no error, no warning, no spurious result entry.
            (d / SELECTED_FRAMES_SIDECAR_NAME).write_text(
                json.dumps(["00001.png", "00099.png"])
            )
            results = _make_extractor().extract_input("pre_game_lobby_state_1", d)
            sources = [Path(r.meta.source_path).name for r in results]
            self.assertEqual(sources, ["00001.png"])
            # No FailedExtractionResult, no warning entries for the missing file.
            for r in results:
                self.assertEqual(r.errors, [])


class TestSidecarOnSingleFileInput(unittest.TestCase):
    def test_sidecar_ignored_on_single_file_input(self) -> None:
        # Put a sidecar in the dir, but pass a file path directly. The
        # sidecar must NOT be consulted — single-file inputs always process
        # the one file.
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            target = d / "only.png"
            _make_png(target)
            (d / SELECTED_FRAMES_SIDECAR_NAME).write_text(json.dumps([]))
            results = _make_extractor().extract_input("pre_game_lobby_state_1", target)
            self.assertEqual(len(results), 1)
            self.assertEqual(Path(results[0].meta.source_path).name, "only.png")


class TestMalformedSidecar(unittest.TestCase):
    def test_invalid_json_falls_back_to_no_filtering(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            for name in ("00001.png", "00002.png"):
                _make_png(d / name)
            (d / SELECTED_FRAMES_SIDECAR_NAME).write_text("not json{{{")
            results = _make_extractor().extract_input("pre_game_lobby_state_1", d)
            sources = sorted(Path(r.meta.source_path).name for r in results)
            self.assertEqual(sources, ["00001.png", "00002.png"])

    def test_non_list_payload_falls_back_to_no_filtering(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            for name in ("00001.png", "00002.png"):
                _make_png(d / name)
            (d / SELECTED_FRAMES_SIDECAR_NAME).write_text(
                json.dumps({"selected": ["00001.png"]})
            )
            results = _make_extractor().extract_input("pre_game_lobby_state_1", d)
            sources = sorted(Path(r.meta.source_path).name for r in results)
            self.assertEqual(sources, ["00001.png", "00002.png"])


if __name__ == "__main__":
    unittest.main()
