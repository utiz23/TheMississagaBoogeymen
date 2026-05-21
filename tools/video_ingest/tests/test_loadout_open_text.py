"""Tests for Phase 2A-7: open-text extractor — gamertag, persona, player level.

TDD tests written before implementation.  Run with:
    PYTHONPATH=tools/game_ocr python3 -m pytest tools/video_ingest/tests/test_loadout_open_text.py -v
"""

from __future__ import annotations

import unittest

from game_ocr.ocr import OCRLine
from game_ocr.loadout_extractors.open_text import (
    LoadoutOpenTextExtractor,
    OpenTextEvidence,
    _normalize_unicode_minus,
)


# ---------------------------------------------------------------------------
# Helpers for building synthetic OCR fixtures
# ---------------------------------------------------------------------------

# Default ROI used by most tests: top-left (100, 50), size 400x60 px.
_GAMERTAG_ROI: dict[str, float] = {"x": 100.0, "y": 50.0, "w": 400.0, "h": 60.0}

# An ROI that none of the "in-roi" lines fall within.
_EMPTY_ROI: dict[str, float] = {"x": 0.0, "y": 0.0, "w": 10.0, "h": 10.0}


def _line_in_roi(text: str, conf: float, roi: dict[str, float] = _GAMERTAG_ROI) -> OCRLine:
    """Build an OCRLine whose bbox is fully inside *roi*."""
    x = roi["x"] + 5.0
    y = roi["y"] + 5.0
    return OCRLine(
        text=text,
        confidence=conf,
        x1=x,
        y1=y,
        x2=x + roi["w"] - 10.0,
        y2=y + roi["h"] - 10.0,
    )


def _line_outside_roi(text: str, conf: float = 0.9) -> OCRLine:
    """Build an OCRLine whose bbox is completely outside _GAMERTAG_ROI."""
    # Place it far below the ROI.
    return OCRLine(
        text=text,
        confidence=conf,
        x1=0.0,
        y1=900.0,
        x2=200.0,
        y2=920.0,
    )


# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------


class TestOpenTextTopNCandidates(unittest.TestCase):
    """test_open_text_returns_topN_for_gamertag

    Three lines in the ROI with confidences [0.9, 0.5, 0.7].
    Expected output: three records ranked [0, 1, 2] in order 0.9 → 0.7 → 0.5.
    """

    def setUp(self) -> None:
        self.extractor = LoadoutOpenTextExtractor()
        self.lines = [
            _line_in_roi("PlayerAlpha", 0.9),
            _line_in_roi("PlayerBeta", 0.5),
            _line_in_roi("PlayerGamma", 0.7),
        ]

    def test_returns_three_candidates(self) -> None:
        results = self.extractor.extract_open_text_for_roi(
            self.lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
        )
        self.assertEqual(len(results), 3)

    def test_candidates_ranked_by_confidence_descending(self) -> None:
        results = self.extractor.extract_open_text_for_roi(
            self.lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
        )
        # Confidences should be descending.
        confs = [r.raw_confidence for r in results]
        self.assertEqual(confs, sorted(confs, reverse=True))

    def test_rank_0_has_highest_confidence(self) -> None:
        results = self.extractor.extract_open_text_for_roi(
            self.lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
        )
        top = next(r for r in results if r.candidate_rank == 0)
        self.assertAlmostEqual(top.raw_confidence, 0.9)
        self.assertEqual(top.value, "PlayerAlpha")

    def test_rank_1_is_second_highest(self) -> None:
        results = self.extractor.extract_open_text_for_roi(
            self.lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
        )
        second = next(r for r in results if r.candidate_rank == 1)
        self.assertAlmostEqual(second.raw_confidence, 0.7)
        self.assertEqual(second.value, "PlayerGamma")

    def test_rank_2_is_lowest_confidence(self) -> None:
        results = self.extractor.extract_open_text_for_roi(
            self.lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
        )
        third = next(r for r in results if r.candidate_rank == 2)
        self.assertAlmostEqual(third.raw_confidence, 0.5)

    def test_field_key_propagated(self) -> None:
        results = self.extractor.extract_open_text_for_roi(
            self.lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
        )
        for r in results:
            self.assertEqual(r.field_key, "gamertag")

    def test_observability_is_observable(self) -> None:
        results = self.extractor.extract_open_text_for_roi(
            self.lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
        )
        for r in results:
            self.assertEqual(r.observability, "observable")

    def test_calibrated_confidence_equals_raw_in_phase2a(self) -> None:
        results = self.extractor.extract_open_text_for_roi(
            self.lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
        )
        for r in results:
            self.assertAlmostEqual(r.calibrated_confidence, r.raw_confidence)


class TestUnicodeMinusNormalization(unittest.TestCase):
    """test_open_text_normalizes_unicode_minus_glyphs

    An OCRLine with an en-dash in the text should have it replaced with ASCII '-'.
    """

    def setUp(self) -> None:
        self.extractor = LoadoutOpenTextExtractor()

    def test_en_dash_normalized(self) -> None:
        lines = [_line_in_roi("henry–thebobjr", 0.88)]
        results = self.extractor.extract_open_text_for_roi(
            lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
        )
        self.assertEqual(results[0].value, "henry-thebobjr")

    def test_em_dash_normalized(self) -> None:
        lines = [_line_in_roi("some—name", 0.85)]
        results = self.extractor.extract_open_text_for_roi(
            lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
        )
        self.assertEqual(results[0].value, "some-name")

    def test_minus_sign_normalized(self) -> None:
        lines = [_line_in_roi("P2LVL−40", 0.80)]
        results = self.extractor.extract_open_text_for_roi(
            lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="player_level_raw",
        )
        self.assertEqual(results[0].value, "P2LVL-40")

    def test_hyphen_u2010_normalized(self) -> None:
        lines = [_line_in_roi("abc‐def", 0.75)]
        results = self.extractor.extract_open_text_for_roi(
            lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="persona_raw",
        )
        self.assertEqual(results[0].value, "abc-def")

    def test_non_breaking_hyphen_normalized(self) -> None:
        lines = [_line_in_roi("abc‑def", 0.75)]
        results = self.extractor.extract_open_text_for_roi(
            lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="persona_raw",
        )
        self.assertEqual(results[0].value, "abc-def")

    def test_ascii_hyphen_unchanged(self) -> None:
        lines = [_line_in_roi("henry-thebobjr", 0.88)]
        results = self.extractor.extract_open_text_for_roi(
            lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
        )
        self.assertEqual(results[0].value, "henry-thebobjr")

    def test_normalize_unicode_minus_standalone(self) -> None:
        self.assertEqual(_normalize_unicode_minus("henry–thebobjr"), "henry-thebobjr")
        self.assertEqual(_normalize_unicode_minus("P2LVL−40"), "P2LVL-40")
        self.assertEqual(_normalize_unicode_minus("normal text"), "normal text")


class TestRoiBlankEmitsLowQuality(unittest.TestCase):
    """test_returns_empty_candidate_list_when_roi_blank

    When no OCRLines fall within the ROI the extractor must return a *single*
    record with observability='low_quality' (not an empty list).
    """

    def setUp(self) -> None:
        self.extractor = LoadoutOpenTextExtractor()

    def test_returns_single_low_quality_record(self) -> None:
        lines = [_line_outside_roi("XZ4RKY")]
        results = self.extractor.extract_open_text_for_roi(
            lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
        )
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].observability, "low_quality")

    def test_low_quality_value_is_empty_string(self) -> None:
        results = self.extractor.extract_open_text_for_roi(
            [],
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
        )
        self.assertEqual(results[0].value, "")

    def test_low_quality_confidence_is_zero(self) -> None:
        results = self.extractor.extract_open_text_for_roi(
            [],
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
        )
        self.assertAlmostEqual(results[0].raw_confidence, 0.0)
        self.assertAlmostEqual(results[0].calibrated_confidence, 0.0)

    def test_low_quality_rank_is_zero(self) -> None:
        results = self.extractor.extract_open_text_for_roi(
            [],
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
        )
        self.assertEqual(results[0].candidate_rank, 0)

    def test_low_quality_field_key_propagated(self) -> None:
        results = self.extractor.extract_open_text_for_roi(
            [],
            roi_bbox=_GAMERTAG_ROI,
            field_key="persona_raw",
        )
        self.assertEqual(results[0].field_key, "persona_raw")

    def test_completely_empty_lines_list(self) -> None:
        """Edge case: no lines at all → still returns one low_quality record."""
        results = self.extractor.extract_open_text_for_roi(
            [],
            roi_bbox=_EMPTY_ROI,
            field_key="gamertag",
        )
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].observability, "low_quality")


class TestFiltersBelowMinConfidence(unittest.TestCase):
    """test_filters_lines_below_min_confidence

    Lines whose confidence is strictly below min_confidence are excluded,
    even when they overlap the ROI.
    """

    def setUp(self) -> None:
        self.extractor = LoadoutOpenTextExtractor()

    def test_all_below_threshold_yields_low_quality(self) -> None:
        lines = [
            _line_in_roi("LowConf1", 0.2),
            _line_in_roi("LowConf2", 0.1),
        ]
        results = self.extractor.extract_open_text_for_roi(
            lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
            min_confidence=0.3,
        )
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].observability, "low_quality")

    def test_exactly_at_threshold_is_included(self) -> None:
        lines = [_line_in_roi("AtThreshold", 0.3)]
        results = self.extractor.extract_open_text_for_roi(
            lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
            min_confidence=0.3,
        )
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].value, "AtThreshold")
        self.assertEqual(results[0].observability, "observable")

    def test_mixed_confidence_excludes_low(self) -> None:
        lines = [
            _line_in_roi("HighConf", 0.9),
            _line_in_roi("LowConf", 0.1),
        ]
        results = self.extractor.extract_open_text_for_roi(
            lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
            min_confidence=0.3,
        )
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].value, "HighConf")

    def test_custom_min_confidence_zero_includes_all_in_roi(self) -> None:
        lines = [
            _line_in_roi("VeryLow", 0.01),
            _line_in_roi("Medium", 0.5),
        ]
        results = self.extractor.extract_open_text_for_roi(
            lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
            min_confidence=0.0,
        )
        self.assertEqual(len(results), 2)


class TestMaxCandidatesCap(unittest.TestCase):
    """test_max_candidates_caps_output

    When there are more qualifying lines than max_candidates, only the top-N
    by confidence are returned.
    """

    def setUp(self) -> None:
        self.extractor = LoadoutOpenTextExtractor()

    def test_capped_at_max_candidates(self) -> None:
        lines = [_line_in_roi(f"Player{i}", conf=0.9 - i * 0.05) for i in range(6)]
        results = self.extractor.extract_open_text_for_roi(
            lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
            max_candidates=3,
        )
        self.assertEqual(len(results), 3)

    def test_top_3_are_highest_confidence(self) -> None:
        lines = [_line_in_roi(f"Player{i}", conf=round(0.9 - i * 0.05, 2)) for i in range(6)]
        results = self.extractor.extract_open_text_for_roi(
            lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
            max_candidates=3,
        )
        returned_confs = sorted(r.raw_confidence for r in results)
        all_confs_sorted = sorted(l.confidence for l in lines)
        top3_confs = sorted(all_confs_sorted[-3:])
        self.assertEqual(returned_confs, top3_confs)

    def test_max_candidates_1_returns_single(self) -> None:
        lines = [_line_in_roi("Best", 0.95), _line_in_roi("Second", 0.80)]
        results = self.extractor.extract_open_text_for_roi(
            lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
            max_candidates=1,
        )
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].value, "Best")
        self.assertEqual(results[0].candidate_rank, 0)

    def test_fewer_lines_than_max_returns_all(self) -> None:
        lines = [_line_in_roi("OnlyOne", 0.88)]
        results = self.extractor.extract_open_text_for_roi(
            lines,
            roi_bbox=_GAMERTAG_ROI,
            field_key="gamertag",
            max_candidates=5,
        )
        self.assertEqual(len(results), 1)


class TestOpenTextEvidence(unittest.TestCase):
    """Dataclass structural tests."""

    def test_frozen(self) -> None:
        ev = OpenTextEvidence(
            field_key="gamertag",
            value="XZ4RKY",
            raw_confidence=0.9,
            calibrated_confidence=0.9,
            candidate_rank=0,
        )
        with self.assertRaises((AttributeError, TypeError)):
            ev.value = "other"  # type: ignore[misc]

    def test_roi_bbox_optional(self) -> None:
        ev = OpenTextEvidence(
            field_key="gamertag",
            value="XZ4RKY",
            raw_confidence=0.9,
            calibrated_confidence=0.9,
            candidate_rank=0,
        )
        self.assertIsNone(ev.roi_bbox)

    def test_default_observability_is_observable(self) -> None:
        ev = OpenTextEvidence(
            field_key="gamertag",
            value="XZ4RKY",
            raw_confidence=0.9,
            calibrated_confidence=0.9,
            candidate_rank=0,
        )
        self.assertEqual(ev.observability, "observable")

    def test_roi_bbox_stored(self) -> None:
        ev = OpenTextEvidence(
            field_key="gamertag",
            value="XZ4RKY",
            raw_confidence=0.9,
            calibrated_confidence=0.9,
            candidate_rank=0,
            roi_bbox=_GAMERTAG_ROI,
        )
        self.assertEqual(ev.roi_bbox, _GAMERTAG_ROI)


class TestBboxOverlap(unittest.TestCase):
    """Unit-level tests for the _bbox_overlaps helper."""

    def setUp(self) -> None:
        from game_ocr.loadout_extractors.open_text import _bbox_overlaps
        self._fn = _bbox_overlaps

    def test_full_containment_overlaps(self) -> None:
        roi = {"x": 100.0, "y": 100.0, "w": 200.0, "h": 100.0}
        line = OCRLine(text="a", confidence=0.9, x1=110.0, y1=110.0, x2=200.0, y2=150.0)
        self.assertTrue(self._fn(line, roi))

    def test_partial_overlap_is_overlap(self) -> None:
        roi = {"x": 100.0, "y": 100.0, "w": 200.0, "h": 100.0}
        # Line partly outside to the right
        line = OCRLine(text="a", confidence=0.9, x1=250.0, y1=110.0, x2=350.0, y2=150.0)
        self.assertTrue(self._fn(line, roi))

    def test_completely_left_no_overlap(self) -> None:
        roi = {"x": 100.0, "y": 100.0, "w": 200.0, "h": 100.0}
        line = OCRLine(text="a", confidence=0.9, x1=0.0, y1=110.0, x2=99.0, y2=150.0)
        self.assertFalse(self._fn(line, roi))

    def test_completely_below_no_overlap(self) -> None:
        roi = {"x": 100.0, "y": 100.0, "w": 200.0, "h": 100.0}
        line = OCRLine(text="a", confidence=0.9, x1=110.0, y1=210.0, x2=200.0, y2=250.0)
        self.assertFalse(self._fn(line, roi))

    def test_touching_edge_is_not_overlap(self) -> None:
        # x2 of line == x1 of roi — touching but not overlapping.
        roi = {"x": 100.0, "y": 100.0, "w": 200.0, "h": 100.0}
        line = OCRLine(text="a", confidence=0.9, x1=0.0, y1=110.0, x2=100.0, y2=150.0)
        self.assertFalse(self._fn(line, roi))


if __name__ == "__main__":
    unittest.main()
