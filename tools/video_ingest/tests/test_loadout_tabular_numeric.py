"""Tests for Phase 2A-5: LoadoutTabularExtractor + NumericCellEvidence.

TDD tests — written before full implementation, verified green after.

Run with:
    PYTHONPATH=tools/game_ocr python3 -m pytest tools/video_ingest/tests/test_loadout_tabular_numeric.py -v
"""

from __future__ import annotations

import unittest
from typing import Optional
from unittest.mock import MagicMock, patch

import numpy as np

# ---------------------------------------------------------------------------
# Module under test
# ---------------------------------------------------------------------------
from game_ocr.loadout_extractors.tabular_numeric import (
    LoadoutTabularExtractor,
    NumericCellEvidence,
    _CONFIDENCE_THRESHOLD,
    _RESCAN_CONFIDENCE,
    _HSV_SIGN_CONFIDENCE,
)

# ---------------------------------------------------------------------------
# Helpers — minimal OCR-line-like object
# ---------------------------------------------------------------------------


class _FakeOCRLine:
    """Minimal stand-in for game_ocr.ocr.OCRLine in tests."""

    def __init__(self, text: str, confidence: float, x1: float, y1: float, x2: float, y2: float):
        self.text = text
        self.confidence = confidence
        self.x1 = x1
        self.y1 = y1
        self.x2 = x2
        self.y2 = y2
        self.x_center = (x1 + x2) / 2
        self.y_center = (y1 + y2) / 2


def _make_value_field(value: Optional[int], conf: float = 0.90):
    """Build a minimal ExtractionField-like object for value."""
    f = MagicMock()
    f.value = value
    f.confidence = conf if value is not None else None
    return f


def _make_delta_field(value: Optional[int], conf: float = 0.88, raw_text: str = "+3"):
    """Build a minimal ExtractionField-like object for delta."""
    if value is None:
        return None  # _extract_cell returns None when no delta found
    f = MagicMock()
    f.value = value
    f.confidence = conf
    f.raw_text = raw_text
    return f


def _make_rescan_field(value: Optional[int], conf: float = 0.75, raw_text: str = "3"):
    """Build a minimal ExtractionField-like object for rescan result."""
    if value is None:
        return None
    f = MagicMock()
    f.value = value
    f.confidence = conf
    f.raw_text = raw_text
    return f


def _blank_image(h: int = 100, w: int = 200) -> np.ndarray:
    return np.zeros((h, w, 3), dtype=np.uint8)


# ---------------------------------------------------------------------------
# Test: basic count + completeness
# ---------------------------------------------------------------------------


class TestExtractAttributeGridCounts(unittest.TestCase):
    """test_extract_attribute_grid_returns_23_cells_per_slot"""

    def _make_good_extract_cell(self):
        """Return an _extract_cell mock that always gives value=75, delta=+3."""
        def _extract_cell(cell_lines, cx, image):
            return (_make_value_field(75), _make_delta_field(3, raw_text="+3"))
        return _extract_cell

    def _make_null_rescan(self):
        """Rescan that returns None (rank-1 never fires)."""
        def _rescan(image, cx, row_y):
            return None
        return _rescan

    @patch("game_ocr.loadout_extractors.tabular_numeric._CONFIDENCE_THRESHOLD", 0.50)
    def test_extract_attribute_grid_returns_23_cells_per_slot(self):
        """Given all cells extractable, result has ≥46 records covering all 23 attribute_keys."""
        extractor = LoadoutTabularExtractor()

        with (
            patch("game_ocr.loadout_extractors.tabular_numeric.LoadoutTabularExtractor._extract_value_candidates") as mock_v,
            patch("game_ocr.loadout_extractors.tabular_numeric.LoadoutTabularExtractor._extract_delta_candidates") as mock_d,
        ):
            # Each method returns one record per call — total 23+23 = 46
            def fake_value(*, image_bgr, grid_row_idx, slot_anchor_y, cell_lines, attribute_key, column_cx, extract_cell_fn):
                return [NumericCellEvidence(
                    row_key=attribute_key,
                    column_key="value",
                    value=75,
                    raw_confidence=0.90,
                    calibrated_confidence=0.90,
                    candidate_rank=0,
                    observability="observable",
                )]

            def fake_delta(*, image_bgr, grid_row_idx, slot_anchor_y, cell_lines, attribute_key, column_cx, extract_cell_fn, rescan_fn):
                return [NumericCellEvidence(
                    row_key=attribute_key,
                    column_key="delta",
                    value=3,
                    raw_confidence=0.88,
                    calibrated_confidence=0.88,
                    candidate_rank=0,
                    observability="observable",
                )]

            mock_v.side_effect = fake_value
            mock_d.side_effect = fake_delta

            image = _blank_image(1080, 1920)
            results = extractor.extract_attribute_grid(image, slot_anchor_y=0, ocr_lines=[])

        self.assertGreaterEqual(len(results), 46, "Should have at least 23 value + 23 delta records")

        seen_keys = {r.row_key for r in results}
        self.assertEqual(len(seen_keys), 23, f"Expected 23 distinct attribute_keys, got {len(seen_keys)}: {seen_keys}")

        # Verify all 23 expected keys are present
        expected_keys = [
            "wrist_shot_accuracy", "slap_shot_accuracy", "speed", "balance", "agility",
            "wrist_shot_power", "slap_shot_power", "acceleration", "puck_control", "endurance",
            "passing", "offensive_awareness", "body_checking", "stick_checking", "defensive_awareness",
            "hand_eye", "strength", "durability", "shot_blocking",
            "deking", "faceoffs", "discipline", "fighting_skill",
        ]
        for key in expected_keys:
            with self.subTest(key=key):
                self.assertIn(key, seen_keys)


# ---------------------------------------------------------------------------
# Test: value + delta per cell, with correct row_key / column_key
# ---------------------------------------------------------------------------


class TestValueDeltaPerCell(unittest.TestCase):
    """test_returns_value_plus_delta_per_cell_with_row_key_column_key"""

    def test_returns_value_plus_delta_per_cell_with_row_key_column_key(self):
        """For a given attribute_key, both column_key='value' and 'delta' exist."""
        extractor = LoadoutTabularExtractor()

        target_key = "speed"  # third key in technique group

        with (
            patch("game_ocr.loadout_extractors.tabular_numeric.LoadoutTabularExtractor._extract_value_candidates") as mock_v,
            patch("game_ocr.loadout_extractors.tabular_numeric.LoadoutTabularExtractor._extract_delta_candidates") as mock_d,
        ):
            def fake_value(*, image_bgr, grid_row_idx, slot_anchor_y, cell_lines, attribute_key, column_cx, extract_cell_fn):
                return [NumericCellEvidence(
                    row_key=attribute_key,
                    column_key="value",
                    value=80,
                    raw_confidence=0.92,
                    calibrated_confidence=0.92,
                    candidate_rank=0,
                    observability="observable",
                )]

            def fake_delta(*, image_bgr, grid_row_idx, slot_anchor_y, cell_lines, attribute_key, column_cx, extract_cell_fn, rescan_fn):
                return [NumericCellEvidence(
                    row_key=attribute_key,
                    column_key="delta",
                    value=5,
                    raw_confidence=0.85,
                    calibrated_confidence=0.85,
                    candidate_rank=0,
                    observability="observable",
                )]

            mock_v.side_effect = fake_value
            mock_d.side_effect = fake_delta

            image = _blank_image(1080, 1920)
            results = extractor.extract_attribute_grid(image, slot_anchor_y=0, ocr_lines=[])

        speed_records = [r for r in results if r.row_key == target_key]
        self.assertGreaterEqual(len(speed_records), 2, f"Expected ≥2 records for {target_key}, got {len(speed_records)}")

        column_keys_seen = {r.column_key for r in speed_records}
        self.assertIn("value", column_keys_seen, "Missing column_key='value' for speed")
        self.assertIn("delta", column_keys_seen, "Missing column_key='delta' for speed")

        value_record = next(r for r in speed_records if r.column_key == "value")
        delta_record = next(r for r in speed_records if r.column_key == "delta")
        self.assertEqual(value_record.row_key, target_key)
        self.assertEqual(delta_record.row_key, target_key)


# ---------------------------------------------------------------------------
# Test: missing cell emits low_quality, not dropped row
# ---------------------------------------------------------------------------


class TestMissingCellObservability(unittest.TestCase):
    """test_missing_cell_carries_observability_low_quality_not_missing_row"""

    def test_missing_cell_carries_observability_low_quality_not_missing_row(self):
        """When OCR returns no result for a cell, the row is still emitted with value=None and observability='low_quality'."""
        extractor = LoadoutTabularExtractor()

        with (
            patch("game_ocr.loadout_extractors.tabular_numeric.LoadoutTabularExtractor._extract_value_candidates") as mock_v,
            patch("game_ocr.loadout_extractors.tabular_numeric.LoadoutTabularExtractor._extract_delta_candidates") as mock_d,
        ):
            def fake_value_missing(*, image_bgr, grid_row_idx, slot_anchor_y, cell_lines, attribute_key, column_cx, extract_cell_fn):
                return [NumericCellEvidence(
                    row_key=attribute_key,
                    column_key="value",
                    value=None,
                    raw_confidence=0.0,
                    calibrated_confidence=0.0,
                    candidate_rank=0,
                    observability="low_quality",
                )]

            def fake_delta_missing(*, image_bgr, grid_row_idx, slot_anchor_y, cell_lines, attribute_key, column_cx, extract_cell_fn, rescan_fn):
                return [NumericCellEvidence(
                    row_key=attribute_key,
                    column_key="delta",
                    value=None,
                    raw_confidence=0.0,
                    calibrated_confidence=0.0,
                    candidate_rank=0,
                    observability="low_quality",
                )]

            mock_v.side_effect = fake_value_missing
            mock_d.side_effect = fake_delta_missing

            image = _blank_image()
            results = extractor.extract_attribute_grid(image, slot_anchor_y=0, ocr_lines=[])

        # Every attribute_key must still be represented — low-quality, but present
        seen_keys = {r.row_key for r in results}
        self.assertEqual(len(seen_keys), 23, "All 23 attribute_keys must appear even when OCR misses all cells")

        low_quality = [r for r in results if r.observability == "low_quality"]
        self.assertEqual(len(low_quality), 46, "All 46 cells (23 value + 23 delta) should have low_quality observability")

        for rec in low_quality:
            self.assertIsNone(rec.value, "Missing cells must have value=None")

        # Row should NOT be silently dropped — verify wrist_shot_accuracy is there
        wrist_keys = [r for r in results if r.row_key == "wrist_shot_accuracy"]
        self.assertGreaterEqual(len(wrist_keys), 1, "wrist_shot_accuracy row must not be silently dropped")


# ---------------------------------------------------------------------------
# Test: HSV delta sign recovery (rank-2 candidate)
# ---------------------------------------------------------------------------


class TestDeltaChipHSVSignRecovery(unittest.TestCase):
    """test_delta_chip_sign_via_color_when_ocr_drops_sign"""

    def test_delta_chip_sign_via_color_when_ocr_drops_sign(self):
        """When OCR reads delta as '5' (no sign) but chip color is red (negative),
        the HSV-sign-recovery candidate emits value=-5 at rank 2."""
        extractor = LoadoutTabularExtractor()
        attribute_key = "speed"

        # rank-0 cell-aligned extraction: missing (so rank-1 fires)
        def mock_extract_cell(cell_lines, cx, image):
            return _make_value_field(None), None

        # rank-1 rescan: returns +5 with no sign in raw_text
        def mock_rescan(image, cx, row_y):
            f = MagicMock()
            f.value = 5
            f.confidence = _RESCAN_CONFIDENCE
            f.raw_text = "5"  # no leading sign — triggers HSV path
            return f

        # HSV color inference: red chip → -1
        def mock_infer_sign(image, line):
            return -1  # red chip

        def mock_lines_in_bbox(lines, y_range, x_range=None):
            return []

        with (
            patch("game_ocr.parsers._infer_delta_sign_from_color", mock_infer_sign),
        ):
            # Use the real _extract_delta_candidates but with mocked sub-functions
            # by passing them as arguments via the extract_attribute_grid path.
            # We patch the imports that extract_attribute_grid does locally.
            with patch("game_ocr.parsers._extract_cell", mock_extract_cell), \
                 patch("game_ocr.parsers._rescan_delta_chip", mock_rescan), \
                 patch("game_ocr.parsers._lines_in_bbox", mock_lines_in_bbox):

                image = _blank_image(1080, 1920)

                # Call _extract_delta_candidates directly, passing the mocked fns
                results = extractor._extract_delta_candidates(
                    image_bgr=image,
                    grid_row_idx=2,   # speed is index 2 in technique group
                    slot_anchor_y=0,
                    cell_lines=[],
                    attribute_key=attribute_key,
                    column_cx=500.0,
                    extract_cell_fn=mock_extract_cell,
                    rescan_fn=mock_rescan,
                )

        # rank-0 placeholder: value=None, low_quality
        rank0 = [r for r in results if r.candidate_rank == 0]
        self.assertEqual(len(rank0), 1)
        self.assertIsNone(rank0[0].value)
        self.assertEqual(rank0[0].observability, "low_quality")

        # rank-1: rescan value=5 (unsigned, as returned by rescan)
        rank1 = [r for r in results if r.candidate_rank == 1]
        self.assertEqual(len(rank1), 1, "rank-1 rescan candidate should be emitted")
        self.assertEqual(rank1[0].value, 5)

        # rank-2: HSV-sign flipped value=-5
        rank2 = [r for r in results if r.candidate_rank == 2]
        self.assertEqual(len(rank2), 1, "rank-2 HSV-sign recovery candidate should be emitted")
        self.assertEqual(rank2[0].value, -5, f"Expected -5 from HSV sign recovery, got {rank2[0].value}")
        self.assertAlmostEqual(rank2[0].raw_confidence, _HSV_SIGN_CONFIDENCE, places=3)


# ---------------------------------------------------------------------------
# Test: rescan fallback is a lower-ranked candidate, not a silent rescue
# ---------------------------------------------------------------------------


class TestRescanFallbackExplicitCandidate(unittest.TestCase):
    """test_rescan_fallback_emits_lower_ranked_candidate_not_silent_rescue"""

    def test_rescan_fallback_emits_lower_ranked_candidate_not_silent_rescue(self):
        """When cell-aligned extraction gives low confidence AND rescan finds a value,
        BOTH candidates are emitted: rank 0 (low conf or None) AND rank 1 (rescan value)."""
        extractor = LoadoutTabularExtractor()
        attribute_key = "balance"

        # rank-0: OCR found something but at confidence below threshold
        LOW_CONF = _CONFIDENCE_THRESHOLD - 0.10  # below the threshold

        def mock_extract_cell(cell_lines, cx, image):
            # Returns delta=4 at low confidence
            return _make_value_field(None), _make_delta_field(4, conf=LOW_CONF, raw_text="+4")

        # rank-1 rescan finds a different (or same) value at its own confidence
        def mock_rescan(image, cx, row_y):
            return _make_rescan_field(4, conf=_RESCAN_CONFIDENCE, raw_text="+4")

        results = extractor._extract_delta_candidates(
            image_bgr=_blank_image(1080, 1920),
            grid_row_idx=3,   # balance is index 3 in technique group
            slot_anchor_y=0,
            cell_lines=[],
            attribute_key=attribute_key,
            column_cx=500.0,
            extract_cell_fn=mock_extract_cell,
            rescan_fn=mock_rescan,
        )

        rank0 = [r for r in results if r.candidate_rank == 0]
        rank1 = [r for r in results if r.candidate_rank == 1]

        self.assertEqual(len(rank0), 1, "rank-0 candidate must always be emitted")
        self.assertIsNotNone(rank0[0].value, "rank-0 should have the low-conf value, not be wiped")
        self.assertEqual(rank0[0].value, 4)
        self.assertAlmostEqual(rank0[0].raw_confidence, LOW_CONF, places=3)

        self.assertEqual(len(rank1), 1, "rank-1 rescan candidate must be emitted explicitly (not silently overwrite rank-0)")
        self.assertEqual(rank1[0].value, 4)
        self.assertAlmostEqual(rank1[0].raw_confidence, _RESCAN_CONFIDENCE, places=3)

        # Critical: rank-0 and rank-1 coexist — not one replacing the other
        self.assertEqual(
            len([r for r in results if r.column_key == "delta"]),
            2,
            "Both rank-0 and rank-1 delta candidates must coexist, not one replacing the other",
        )

    def test_rescan_fallback_not_fired_when_rank0_high_confidence(self):
        """When rank-0 confidence is at/above threshold, rank-1 rescan is NOT emitted."""
        extractor = LoadoutTabularExtractor()

        HIGH_CONF = _CONFIDENCE_THRESHOLD + 0.10  # above threshold

        def mock_extract_cell(cell_lines, cx, image):
            return _make_value_field(None), _make_delta_field(7, conf=HIGH_CONF, raw_text="+7")

        def mock_rescan_should_not_fire(image, cx, row_y):
            raise AssertionError("_rescan_delta_chip should NOT be called when rank-0 confidence is high")

        results = extractor._extract_delta_candidates(
            image_bgr=_blank_image(1080, 1920),
            grid_row_idx=1,
            slot_anchor_y=0,
            cell_lines=[],
            attribute_key="agility",
            column_cx=500.0,
            extract_cell_fn=mock_extract_cell,
            rescan_fn=mock_rescan_should_not_fire,
        )

        rank0 = [r for r in results if r.candidate_rank == 0]
        rank1 = [r for r in results if r.candidate_rank == 1]

        self.assertEqual(len(rank0), 1)
        self.assertEqual(rank0[0].value, 7)
        self.assertEqual(len(rank1), 0, "No rank-1 candidate expected when rank-0 is high-confidence")


# ---------------------------------------------------------------------------
# Test: NumericCellEvidence dataclass invariants
# ---------------------------------------------------------------------------


class TestNumericCellEvidenceDataclass(unittest.TestCase):
    """Verify the NumericCellEvidence dataclass is frozen + fields are correct."""

    def test_is_frozen(self):
        ev = NumericCellEvidence(
            row_key="speed",
            column_key="value",
            value=75,
            raw_confidence=0.9,
            calibrated_confidence=0.9,
            candidate_rank=0,
        )
        with self.assertRaises(Exception):
            ev.value = 99  # frozen dataclass must raise

    def test_default_observability(self):
        ev = NumericCellEvidence(
            row_key="speed",
            column_key="value",
            value=75,
            raw_confidence=0.9,
            calibrated_confidence=0.9,
            candidate_rank=0,
        )
        self.assertEqual(ev.observability, "observable")

    def test_optional_value_none(self):
        ev = NumericCellEvidence(
            row_key="speed",
            column_key="delta",
            value=None,
            raw_confidence=0.0,
            calibrated_confidence=0.0,
            candidate_rank=0,
            observability="low_quality",
        )
        self.assertIsNone(ev.value)
        self.assertIsNone(ev.roi_bbox)


# ---------------------------------------------------------------------------
# Test: extractor loads 23 attribute keys
# ---------------------------------------------------------------------------


class TestExtractorInit(unittest.TestCase):
    """Verify LoadoutTabularExtractor loads the correct 23-key list."""

    def test_loads_23_attribute_keys(self):
        extractor = LoadoutTabularExtractor()
        self.assertEqual(len(extractor._attribute_keys), 23)

    def test_attribute_keys_include_all_groups(self):
        extractor = LoadoutTabularExtractor()
        keys = extractor._attribute_keys
        # Spot-check one from each group
        self.assertIn("wrist_shot_accuracy", keys)  # technique
        self.assertIn("endurance", keys)             # power
        self.assertIn("defensive_awareness", keys)  # playstyle
        self.assertIn("shot_blocking", keys)         # tenacity
        self.assertIn("fighting_skill", keys)        # tactics


if __name__ == "__main__":
    unittest.main()
