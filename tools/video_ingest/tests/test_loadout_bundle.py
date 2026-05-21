"""Tests for Phase 2A-8: frame bundle assembler with position-stability validation.

TDD tests written before implementation.  Run with:
    PYTHONPATH=tools/game_ocr python3 -m pytest tools/video_ingest/tests/test_loadout_bundle.py -v
"""

from __future__ import annotations

import logging
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np

from game_ocr.loadout_extractors.slot_identity import SlotIdentity


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_slot_identity(
    slot_key: str,
    row_ordinal: int,
    *,
    position: str | None = "C",
    anchor_y: int = 300,
    observability: str = "observable",
) -> SlotIdentity:
    return SlotIdentity(
        slot_key=slot_key,
        row_ordinal=row_ordinal,
        anchor_y=anchor_y,
        position=position,
        observability=observability,
    )


def _fake_paths(n: int) -> list[Path]:
    return [Path(f"/fake/frame_{i:04d}.png") for i in range(n)]


def _dummy_bgr_image():
    """Return a small dummy BGR image (non-None)."""
    return np.zeros((10, 10, 3), dtype=np.uint8)


# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------


class TestGroupFramesByGeometricSlotKey(unittest.TestCase):
    """assemble_loadout_bundles groups frames by slot_key from slot identity extractor."""

    def setUp(self):
        """Set up: 3 frames.
        - Frame 0: slots A (row 0), B (row 1), C (row 2)
        - Frame 1: slots A (row 0), B (row 1), C (row 2)
        - Frame 2: slot  A (row 0) only
        Expect: 3 bundles — A (3 frames), B (2 frames), C (2 frames).
        """
        self.seg = 5
        self.frames = _fake_paths(3)

        self.slot_A0 = _make_slot_identity(f"loadout_slot_seg{self.seg:04d}_row0", row_ordinal=0)
        self.slot_B1 = _make_slot_identity(f"loadout_slot_seg{self.seg:04d}_row1", row_ordinal=1)
        self.slot_C2 = _make_slot_identity(f"loadout_slot_seg{self.seg:04d}_row2", row_ordinal=2)

        # Per-frame identity return values
        self.identity_returns = [
            [self.slot_A0, self.slot_B1, self.slot_C2],  # frame 0
            [self.slot_A0, self.slot_B1, self.slot_C2],  # frame 1
            [self.slot_A0],                               # frame 2
        ]

        self.ocr_lines_per_frame = [[], [], []]

    def test_assemble_bundles_groups_frames_by_geometric_slot_key(self):
        from game_ocr.loadout_bundle import assemble_loadout_bundles

        dummy_img = _dummy_bgr_image()
        identity_iter = iter(self.identity_returns)

        with patch("game_ocr.loadout_bundle.cv2.imread", return_value=dummy_img), \
             patch("game_ocr.loadout_bundle.extract_slot_identities",
                   side_effect=lambda *a, **kw: next(identity_iter)), \
             patch("game_ocr.loadout_bundle.blur_score", return_value=50.0):

            bundles = assemble_loadout_bundles(
                self.frames,
                segment_index=self.seg,
                ocr_lines_per_frame=self.ocr_lines_per_frame,
            )

        slot_keys = [b.slot_key for b in bundles]
        key_A = self.slot_A0.slot_key
        key_B = self.slot_B1.slot_key
        key_C = self.slot_C2.slot_key

        self.assertIn(key_A, slot_keys)
        self.assertIn(key_B, slot_keys)
        self.assertIn(key_C, slot_keys)
        self.assertEqual(len(bundles), 3)

        bundle_A = next(b for b in bundles if b.slot_key == key_A)
        bundle_B = next(b for b in bundles if b.slot_key == key_B)
        bundle_C = next(b for b in bundles if b.slot_key == key_C)

        self.assertEqual(len(bundle_A.frame_paths), 3)
        self.assertEqual(len(bundle_B.frame_paths), 2)
        self.assertEqual(len(bundle_C.frame_paths), 2)


class TestPicksSharpestFramePerSlot(unittest.TestCase):
    """best_frame_path is the frame with the highest blur score (sharpest)."""

    def test_picks_sharpest_frame_per_slot(self):
        from game_ocr.loadout_bundle import assemble_loadout_bundles

        seg = 3
        frames = _fake_paths(3)
        slot_key = f"loadout_slot_seg{seg:04d}_row0"
        identity = _make_slot_identity(slot_key, row_ordinal=0)

        # blur_scores: [10, 5, 15] — highest is frame index 2 (blur=15 → sharpest)
        blur_scores_sequence = [10.0, 5.0, 15.0]
        blur_call_count = [0]

        def mock_blur(img):
            idx = blur_call_count[0]
            blur_call_count[0] += 1
            return blur_scores_sequence[idx]

        dummy_img = _dummy_bgr_image()

        with patch("game_ocr.loadout_bundle.cv2.imread", return_value=dummy_img), \
             patch("game_ocr.loadout_bundle.extract_slot_identities",
                   return_value=[identity]), \
             patch("game_ocr.loadout_bundle.blur_score", side_effect=mock_blur):

            bundles = assemble_loadout_bundles(
                frames,
                segment_index=seg,
                ocr_lines_per_frame=[[], [], []],
            )

        self.assertEqual(len(bundles), 1)
        bundle = bundles[0]
        self.assertEqual(bundle.best_frame_path, frames[2])
        self.assertAlmostEqual(bundle.best_frame_blur_score, 15.0)


class TestSkipsFramesWithNoRecognisableSlot(unittest.TestCase):
    """Frames where extract_slot_identities returns [] are dropped from all bundles."""

    def test_skips_frames_with_no_recognisable_slot(self):
        from game_ocr.loadout_bundle import assemble_loadout_bundles

        seg = 1
        frames = _fake_paths(3)
        slot_key = f"loadout_slot_seg{seg:04d}_row0"
        identity = _make_slot_identity(slot_key, row_ordinal=0)

        # Frame 0: has a slot; frame 1: no slots; frame 2: has a slot
        identity_returns = [
            [identity],  # frame 0 — has slot
            [],           # frame 1 — no slot (should be skipped)
            [identity],  # frame 2 — has slot
        ]
        identity_iter = iter(identity_returns)
        dummy_img = _dummy_bgr_image()

        with patch("game_ocr.loadout_bundle.cv2.imread", return_value=dummy_img), \
             patch("game_ocr.loadout_bundle.extract_slot_identities",
                   side_effect=lambda *a, **kw: next(identity_iter)), \
             patch("game_ocr.loadout_bundle.blur_score", return_value=20.0):

            bundles = assemble_loadout_bundles(
                frames,
                segment_index=seg,
                ocr_lines_per_frame=[[], [], []],
            )

        self.assertEqual(len(bundles), 1)
        bundle = bundles[0]
        # Only frames 0 and 2 contributed (frame 1 skipped)
        self.assertEqual(len(bundle.frame_paths), 2)
        self.assertIn(frames[0], bundle.frame_paths)
        self.assertIn(frames[2], bundle.frame_paths)
        self.assertNotIn(frames[1], bundle.frame_paths)


class TestBundleCarriesSlotKeyAndSupportFrameIds(unittest.TestCase):
    """bundle.slot_key matches the SlotIdentity.slot_key; support_frame_indices
    reference the frame's global index within the input list."""

    def test_bundle_carries_slot_key_and_support_frame_ids(self):
        from game_ocr.loadout_bundle import assemble_loadout_bundles

        seg = 7
        frames = _fake_paths(4)
        slot_key_row0 = f"loadout_slot_seg{seg:04d}_row0"
        slot_key_row1 = f"loadout_slot_seg{seg:04d}_row1"

        id_row0 = _make_slot_identity(slot_key_row0, row_ordinal=0)
        id_row1 = _make_slot_identity(slot_key_row1, row_ordinal=1)

        # Frames 0, 2, 3 show row0; frames 1, 2 show row1
        identity_returns = [
            [id_row0],          # frame 0
            [id_row1],          # frame 1
            [id_row0, id_row1], # frame 2
            [id_row0],          # frame 3
        ]
        identity_iter = iter(identity_returns)
        dummy_img = _dummy_bgr_image()

        with patch("game_ocr.loadout_bundle.cv2.imread", return_value=dummy_img), \
             patch("game_ocr.loadout_bundle.extract_slot_identities",
                   side_effect=lambda *a, **kw: next(identity_iter)), \
             patch("game_ocr.loadout_bundle.blur_score", return_value=30.0):

            bundles = assemble_loadout_bundles(
                frames,
                segment_index=seg,
                ocr_lines_per_frame=[[], [], [], []],
            )

        bundle_row0 = next(b for b in bundles if b.slot_key == slot_key_row0)
        bundle_row1 = next(b for b in bundles if b.slot_key == slot_key_row1)

        # slot_key matches the expected value from SlotIdentity
        self.assertEqual(bundle_row0.slot_key, slot_key_row0)
        self.assertEqual(bundle_row1.slot_key, slot_key_row1)

        # support_frame_indices are global indices within the `frames` input
        self.assertEqual(set(bundle_row0.support_frame_indices), {0, 2, 3})
        self.assertEqual(set(bundle_row1.support_frame_indices), {1, 2})


class TestPositionStabilityAcrossBundleFrames(unittest.TestCase):
    """Modal position must appear in ≥80% of frames for 'observable'; below → 'obstructed'."""

    def _run_bundle(self, positions: list[str | None], seg: int = 2) -> "LoadoutFrameBundle":
        from game_ocr.loadout_bundle import assemble_loadout_bundles

        frames = _fake_paths(len(positions))
        slot_key = f"loadout_slot_seg{seg:04d}_row0"
        identities = [
            _make_slot_identity(slot_key, row_ordinal=0, position=pos)
            for pos in positions
        ]
        identity_iter = iter([[ident] for ident in identities])
        dummy_img = _dummy_bgr_image()

        with patch("game_ocr.loadout_bundle.cv2.imread", return_value=dummy_img), \
             patch("game_ocr.loadout_bundle.extract_slot_identities",
                   side_effect=lambda *a, **kw: next(identity_iter)), \
             patch("game_ocr.loadout_bundle.blur_score", return_value=10.0):

            bundles = assemble_loadout_bundles(
                frames,
                segment_index=seg,
                ocr_lines_per_frame=[[] for _ in positions],
            )

        self.assertEqual(len(bundles), 1)
        return bundles[0]

    def test_asserts_position_stability_at_threshold_is_observable(self):
        """4/5 frames say 'C', 1 says 'LW' → stability=0.8, observability='observable'."""
        bundle = self._run_bundle(["C", "C", "C", "C", "LW"])
        self.assertAlmostEqual(bundle.position_stability, 0.8)
        self.assertEqual(bundle.observability, "observable")

    def test_asserts_position_stability_below_threshold_is_obstructed(self):
        """3/5 frames say 'C', 2 say 'LW' → stability=0.6, observability='obstructed'."""
        bundle = self._run_bundle(["C", "C", "C", "LW", "LW"])
        self.assertAlmostEqual(bundle.position_stability, 0.6)
        self.assertEqual(bundle.observability, "obstructed")

    def test_full_stability_is_observable(self):
        """5/5 frames same position → stability=1.0, observability='observable'."""
        bundle = self._run_bundle(["RW", "RW", "RW", "RW", "RW"])
        self.assertAlmostEqual(bundle.position_stability, 1.0)
        self.assertEqual(bundle.observability, "observable")


class TestWarnsWhenIntraSegmentRosterSwitchDetected(unittest.TestCase):
    """When position stability < 80%, a warning is logged with slot_key + percentage."""

    def test_warns_when_intra_segment_roster_switch_detected(self):
        from game_ocr.loadout_bundle import assemble_loadout_bundles

        seg = 4
        positions = ["C", "C", "C", "LW", "LW"]  # 3/5 = 60% — below threshold
        frames = _fake_paths(len(positions))
        slot_key = f"loadout_slot_seg{seg:04d}_row0"
        identities = [
            _make_slot_identity(slot_key, row_ordinal=0, position=pos)
            for pos in positions
        ]
        identity_iter = iter([[ident] for ident in identities])
        dummy_img = _dummy_bgr_image()

        with patch("game_ocr.loadout_bundle.cv2.imread", return_value=dummy_img), \
             patch("game_ocr.loadout_bundle.extract_slot_identities",
                   side_effect=lambda *a, **kw: next(identity_iter)), \
             patch("game_ocr.loadout_bundle.blur_score", return_value=10.0), \
             self.assertLogs("game_ocr.loadout_bundle", level="WARNING") as log_ctx:

            bundles = assemble_loadout_bundles(
                frames,
                segment_index=seg,
                ocr_lines_per_frame=[[] for _ in positions],
            )

        # The warning log must mention the slot_key
        warning_text = "\n".join(log_ctx.output)
        self.assertIn(slot_key, warning_text)
        # Must mention the percentage (60%)
        self.assertIn("60", warning_text)


class TestMissingOcrLinesRaisesValueError(unittest.TestCase):
    """assemble_loadout_bundles raises ValueError when ocr_lines_per_frame is None."""

    def test_raises_when_ocr_lines_not_provided(self):
        from game_ocr.loadout_bundle import assemble_loadout_bundles

        with self.assertRaises(ValueError):
            assemble_loadout_bundles(_fake_paths(2), segment_index=0)

    def test_raises_when_ocr_lines_count_mismatch(self):
        from game_ocr.loadout_bundle import assemble_loadout_bundles

        with self.assertRaises(ValueError):
            assemble_loadout_bundles(
                _fake_paths(3),
                segment_index=0,
                ocr_lines_per_frame=[[], []],  # only 2 for 3 frames
            )


class TestBundlesSortedByRowOrdinal(unittest.TestCase):
    """Returned bundles are sorted by row_ordinal ascending."""

    def test_bundles_sorted_by_row_ordinal(self):
        from game_ocr.loadout_bundle import assemble_loadout_bundles

        seg = 0
        frames = _fake_paths(2)
        # Frame 0 reveals row 2 first, then row 0 (reversed order)
        id_row2 = _make_slot_identity(f"loadout_slot_seg{seg:04d}_row2", row_ordinal=2)
        id_row0 = _make_slot_identity(f"loadout_slot_seg{seg:04d}_row0", row_ordinal=0)

        identity_returns = [
            [id_row2, id_row0],  # frame 0
            [id_row2, id_row0],  # frame 1
        ]
        identity_iter = iter(identity_returns)
        dummy_img = _dummy_bgr_image()

        with patch("game_ocr.loadout_bundle.cv2.imread", return_value=dummy_img), \
             patch("game_ocr.loadout_bundle.extract_slot_identities",
                   side_effect=lambda *a, **kw: next(identity_iter)), \
             patch("game_ocr.loadout_bundle.blur_score", return_value=10.0):

            bundles = assemble_loadout_bundles(
                frames,
                segment_index=seg,
                ocr_lines_per_frame=[[], []],
            )

        ordinals = [b.row_ordinal for b in bundles]
        self.assertEqual(ordinals, sorted(ordinals))


class TestLoadoutFrameBundleDataclass(unittest.TestCase):
    """LoadoutFrameBundle is a frozen dataclass with expected fields and defaults."""

    def test_bundle_is_frozen(self):
        from game_ocr.loadout_bundle import LoadoutFrameBundle

        bundle = LoadoutFrameBundle(
            slot_key="loadout_slot_seg0000_row0",
            row_ordinal=0,
            segment_index=0,
            frame_paths=(Path("/fake/f.png"),),
            best_frame_path=Path("/fake/f.png"),
            best_frame_blur_score=10.0,
            slot_identities=(),
            support_frame_indices=(0,),
        )
        with self.assertRaises((TypeError, AttributeError)):
            bundle.row_ordinal = 99  # type: ignore[misc]

    def test_bundle_default_observability_is_observable(self):
        from game_ocr.loadout_bundle import LoadoutFrameBundle

        bundle = LoadoutFrameBundle(
            slot_key="loadout_slot_seg0000_row0",
            row_ordinal=0,
            segment_index=0,
            frame_paths=(Path("/fake/f.png"),),
            best_frame_path=Path("/fake/f.png"),
            best_frame_blur_score=10.0,
            slot_identities=(),
            support_frame_indices=(0,),
        )
        self.assertEqual(bundle.observability, "observable")
        self.assertAlmostEqual(bundle.position_stability, 1.0)


if __name__ == "__main__":
    unittest.main()
