"""Unit tests for the Phase 2B-1 label_loadout_crops CLI.

Tests cover:
  - _extract_crop produces correct shape and coordinates
  - _corpus_save_path constructs the correct path
  - _already_labeled detects presence / absence of labeled files
  - label_crops saves crops with the correct filename and directory structure
    when run non-interactively (label=1 via monkeypatched stdin)
  - label_crops skips images that are already labeled
  - _collect_pngs deduplicates entries correctly

Interactive menu presentation is intentionally NOT tested — it requires
live stdin and is better verified by the operator at runtime.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np


GAME_OCR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(GAME_OCR))

from scripts.label_loadout_crops import (  # noqa: E402
    FAMILY_REGIONS,
    _already_labeled,
    _collect_pngs,
    _corpus_save_path,
    _extract_crop,
    label_crops,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _synthetic_frame(h: int = 1080, w: int = 1920) -> np.ndarray:
    """Return a BGR frame with random-noise content.

    Random noise gives the crops high enough variance to pass the
    blank-crop auto-skip filter in label_crops(). A solid black frame
    triggers the auto-skip and would zero out save counts in the tests.
    """
    rng = np.random.default_rng(seed=42)
    return rng.integers(0, 256, size=(h, w, 3), dtype=np.uint8)


def _write_png(path: Path, image: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), image)


# ---------------------------------------------------------------------------
# _extract_crop
# ---------------------------------------------------------------------------


class TestExtractCrop(unittest.TestCase):
    def test_build_class_region_shape(self) -> None:
        frame = _synthetic_frame()
        region = FAMILY_REGIONS["build_class"][0]
        crop = _extract_crop(frame, region)
        expected_h = region["y2"] - region["y1"]
        expected_w = region["x2"] - region["x1"]
        self.assertEqual(crop.shape, (expected_h, expected_w, 3))

    def test_xf_slot0_region_shape(self) -> None:
        frame = _synthetic_frame()
        region = FAMILY_REGIONS["x_factor_name"][0]
        crop = _extract_crop(frame, region)
        expected_h = region["y2"] - region["y1"]
        expected_w = region["x2"] - region["x1"]
        self.assertEqual(crop.shape, (expected_h, expected_w, 3))

    def test_clip_to_frame_bounds(self) -> None:
        # Region that extends beyond a tiny frame should be clipped
        tiny = np.zeros((100, 100, 3), dtype=np.uint8)
        region = {"y1": 50, "y2": 200, "x1": 50, "x2": 200, "label": "test"}
        crop = _extract_crop(tiny, region)
        self.assertEqual(crop.shape, (50, 50, 3))  # clipped to (100-50, 100-50)

    def test_pixel_content_preserved(self) -> None:
        frame = _synthetic_frame()
        # Place a white rectangle inside the title-bar region
        region = FAMILY_REGIONS["build_class"][0]
        frame[region["y1"]:region["y2"], region["x1"]:region["x2"]] = 255
        crop = _extract_crop(frame, region)
        self.assertTrue(np.all(crop == 255))


# ---------------------------------------------------------------------------
# _corpus_save_path
# ---------------------------------------------------------------------------


class TestCorpusSavePath(unittest.TestCase):
    def test_path_structure(self) -> None:
        root = Path("/tmp/corpus")
        path = _corpus_save_path(root, "build_class", "Sniper", "00001", "title_bar")
        self.assertEqual(path, root / "build_class" / "Sniper" / "00001_title_bar.png")

    def test_xfactor_slot(self) -> None:
        root = Path("/tmp/corpus")
        path = _corpus_save_path(root, "x_factor_name", "Wheels", "frame42", "xf_slot2")
        self.assertEqual(path, root / "x_factor_name" / "Wheels" / "frame42_xf_slot2.png")


# ---------------------------------------------------------------------------
# _already_labeled
# ---------------------------------------------------------------------------


class TestAlreadyLabeled(unittest.TestCase):
    def setUp(self) -> None:
        import tempfile
        self._tmp = tempfile.TemporaryDirectory()
        self.corpus_root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_returns_false_when_no_corpus(self) -> None:
        result = _already_labeled(self.corpus_root, "build_class", "00001", "title_bar")
        self.assertFalse(result)

    def test_returns_false_when_different_stem(self) -> None:
        existing = self.corpus_root / "build_class" / "Sniper" / "99999_title_bar.png"
        existing.parent.mkdir(parents=True)
        existing.touch()
        result = _already_labeled(self.corpus_root, "build_class", "00001", "title_bar")
        self.assertFalse(result)

    def test_returns_true_when_labeled_any_canonical(self) -> None:
        existing = self.corpus_root / "build_class" / "Sniper" / "00001_title_bar.png"
        existing.parent.mkdir(parents=True)
        existing.touch()
        result = _already_labeled(self.corpus_root, "build_class", "00001", "title_bar")
        self.assertTrue(result)

    def test_returns_true_under_different_canonical(self) -> None:
        # Same stem+region under a different canonical should also be detected
        existing = self.corpus_root / "build_class" / "Playmaker" / "00001_title_bar.png"
        existing.parent.mkdir(parents=True)
        existing.touch()
        result = _already_labeled(self.corpus_root, "build_class", "00001", "title_bar")
        self.assertTrue(result)


# ---------------------------------------------------------------------------
# _collect_pngs
# ---------------------------------------------------------------------------


class TestCollectPngs(unittest.TestCase):
    def setUp(self) -> None:
        import tempfile
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_collects_pngs_in_dir(self) -> None:
        (self.base / "a.png").touch()
        (self.base / "b.png").touch()
        (self.base / "skip.txt").touch()
        result = _collect_pngs(self.base)
        names = {p.name for p in result}
        self.assertIn("a.png", names)
        self.assertIn("b.png", names)
        self.assertNotIn("skip.txt", names)

    def test_deduplicates_across_dirs(self) -> None:
        f = self.base / "unique.png"
        f.touch()
        result = _collect_pngs(self.base, self.base)  # same dir twice
        paths = [p for p in result if p.name == "unique.png"]
        self.assertEqual(len(paths), 1)

    def test_missing_dir_does_not_crash(self) -> None:
        result = _collect_pngs(self.base / "does_not_exist")
        self.assertEqual(result, [])

    def test_walks_subdirs(self) -> None:
        sub = self.base / "frames"
        sub.mkdir()
        (sub / "frame001.png").touch()
        result = _collect_pngs(self.base)
        names = {p.name for p in result}
        self.assertIn("frame001.png", names)


# ---------------------------------------------------------------------------
# label_crops — non-interactive save path
# ---------------------------------------------------------------------------


class TestLabelCropsSavePath(unittest.TestCase):
    """Tests the save-path logic by mocking stdin to always choose label 1.

    Each test patches FIXTURE_ROOT so label_crops only sees the test's
    own synthetic source directory — the real fixture tree is excluded to
    keep tests deterministic and fast.
    """

    def setUp(self) -> None:
        import tempfile
        self._tmp = tempfile.TemporaryDirectory()
        self.corpus_root = Path(self._tmp.name) / "crops"
        # Source dir name matches the player_loadout_view filter so PNGs survive
        # the relevance check applied by label_crops.
        self.source_dir = Path(self._tmp.name) / "seg-001-player_loadout_view"
        self.source_dir.mkdir()
        # Empty fixture root so the function finds no canonical fixture PNGs
        self._empty_fixtures = Path(self._tmp.name) / "empty_fixtures"
        self._empty_fixtures.mkdir()

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _write_frame(self, name: str) -> Path:
        p = self.source_dir / name
        _write_png(p, _synthetic_frame())
        return p

    def _run(self, family: str, stdin_side_effect: list[str], **kwargs) -> int:
        """Run label_crops with a patched FIXTURE_ROOT and mocked stdin."""
        import scripts.label_loadout_crops as mod

        with (
            patch.object(mod, "FIXTURE_ROOT", self._empty_fixtures),
            patch("builtins.input", side_effect=stdin_side_effect),
        ):
            return label_crops(
                family,
                extra_sources=[self.source_dir],
                corpus_root=self.corpus_root,
                **kwargs,
            )

    def test_build_class_saves_crop_to_corpus(self) -> None:
        self._write_frame("frame_bc.png")
        saved = self._run("build_class", stdin_side_effect=["1"])
        self.assertEqual(saved, 1)
        family_root = self.corpus_root / "build_class"
        self.assertTrue(family_root.exists())
        crops = list(family_root.rglob("frame_bc_title_bar.png"))
        self.assertEqual(len(crops), 1, f"expected 1 saved crop, got: {crops}")

    def test_x_factor_name_saves_three_slot_crops(self) -> None:
        """Choosing '1' three times (one per slot) should save 3 crops."""
        self._write_frame("frame_xf.png")
        saved = self._run("x_factor_name", stdin_side_effect=["1", "1", "1"])
        self.assertEqual(saved, 3)

    def test_skip_does_not_save(self) -> None:
        self._write_frame("frame_skip.png")
        saved = self._run("build_class", stdin_side_effect=["s"])
        self.assertEqual(saved, 0)
        family_root = self.corpus_root / "build_class"
        crops = list(family_root.rglob("*.png")) if family_root.exists() else []
        self.assertEqual(len(crops), 0)

    def test_dry_run_does_not_write(self) -> None:
        self._write_frame("frame_dry.png")
        saved = self._run("build_class", stdin_side_effect=["1"], dry_run=True)
        self.assertEqual(saved, 1)  # counted but not written
        family_root = self.corpus_root / "build_class"
        crops = list(family_root.rglob("*.png")) if family_root.exists() else []
        self.assertEqual(len(crops), 0)

    def test_already_labeled_skipped(self) -> None:
        """Second run with same source should produce 0 items in queue."""
        self._write_frame("frame_already.png")
        # First pass: label it
        saved_first = self._run("build_class", stdin_side_effect=["1"])
        self.assertEqual(saved_first, 1)
        # Second pass: already labeled — nothing in queue → returns 0 immediately
        saved_second = self._run("build_class", stdin_side_effect=[])
        self.assertEqual(saved_second, 0)


if __name__ == "__main__":
    unittest.main()
