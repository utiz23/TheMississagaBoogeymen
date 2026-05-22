"""Tests for Phase 2A-3: slot identity extractor — geometric subject_slot_key.

TDD tests written before implementation.  Run with:
    PYTHONPATH=tools/game_ocr python3 -m pytest tools/video_ingest/tests/test_loadout_slot_identity.py -v
"""

from __future__ import annotations

import re
import unittest

import numpy as np

from game_ocr.ocr import OCRLine
from game_ocr.loadout_extractors.slot_identity import (
    SlotIdentity,
    extract_slot_identities,
    ROW_Y_BUCKET_TOLERANCE_PX,
    MAX_ROWS_PER_LOADOUT_SEGMENT,
)


# ---------------------------------------------------------------------------
# Helpers for building synthetic OCR fixtures
# ---------------------------------------------------------------------------

# The left-strip layout (from parsers.py):
#   Position label at x_center < 130, y in [180..980]
#   Row content (gamertag, #N - Name) at x_center in [180..400], within ±45 px of anchor y

def _pos_line(pos: str, y: float, conf: float = 0.95) -> OCRLine:
    """Build a synthetic position-label OCRLine (x_center ~65, well below 130)."""
    return OCRLine(text=pos, confidence=conf, x1=20.0, y1=y - 8, x2=110.0, y2=y + 8)


def _gamertag_line(tag: str, y: float, conf: float = 0.9) -> OCRLine:
    """Build a synthetic gamertag OCRLine at x_center ~270 (in [180,400])."""
    return OCRLine(text=tag, confidence=conf, x1=200.0, y1=y - 8, x2=340.0, y2=y + 8)


def _number_name_line(text: str, y: float, conf: float = 0.9) -> OCRLine:
    """Build a synthetic '#N - Name' OCRLine at x_center ~290."""
    return OCRLine(text=text, confidence=conf, x1=200.0, y1=y - 8, x2=380.0, y2=y + 8)


# Five canonical anchor Y positions for a "full" left strip.
ANCHOR_YS = [210.0, 320.0, 430.0, 540.0, 650.0]
POSITIONS = ["C", "LW", "RW", "LD", "RD"]


def _make_full_5row_lines(gamertags=None) -> list[OCRLine]:
    """Build 5-row synthetic OCRLine list with position anchors + gamertag rows."""
    if gamertags is None:
        gamertags = [f"Player{i}" for i in range(5)]
    lines: list[OCRLine] = []
    for i, (y, pos, tag) in enumerate(zip(ANCHOR_YS, POSITIONS, gamertags)):
        lines.append(_pos_line(pos, y))
        lines.append(_gamertag_line(tag, y))
        lines.append(_number_name_line(f"#{i + 10} - Persona{i}", y))
    return lines


_DUMMY_IMAGE = np.zeros((1080, 1920, 3), dtype=np.uint8)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestExtractSlotsReturnsOneRecordPerVisibleRow(unittest.TestCase):
    """Given N visible rows in ocr_lines, returns exactly N SlotIdentity records."""

    def test_five_rows_returns_five_records(self):
        lines = _make_full_5row_lines()
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=1, ocr_lines=lines)
        self.assertEqual(len(result), 5)

    def test_three_rows_returns_three_records(self):
        """Only rows for anchors at ANCHOR_YS[0..2] + gamertag lines."""
        lines: list[OCRLine] = []
        for i in range(3):
            y = ANCHOR_YS[i]
            lines.append(_pos_line(POSITIONS[i], y))
            lines.append(_gamertag_line(f"Player{i}", y))
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=lines)
        self.assertEqual(len(result), 3)

    def test_empty_lines_returns_empty_list(self):
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=[])
        self.assertEqual(result, [])

    def test_one_row_returns_one_record(self):
        lines = [
            _pos_line("G", 400.0),
            _gamertag_line("GoalieTag", 400.0),
        ]
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=lines)
        self.assertEqual(len(result), 1)


class TestSlotKeyFormat(unittest.TestCase):
    """slot_key must match 'loadout_slot_seg{NNNN}_row{R}'."""

    _SLOT_KEY_RE = re.compile(r"^loadout_slot_seg\d{4}_row\d$")

    def test_slot_key_format_five_rows(self):
        lines = _make_full_5row_lines()
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=7, ocr_lines=lines)
        self.assertEqual(len(result), 5)
        for slot in result:
            self.assertRegex(slot.slot_key, self._SLOT_KEY_RE)

    def test_slot_key_segment_index_7_first_row(self):
        lines = _make_full_5row_lines()
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=7, ocr_lines=lines)
        self.assertEqual(result[0].slot_key, "loadout_slot_seg0007_row0")

    def test_slot_key_segment_index_7_second_row(self):
        lines = _make_full_5row_lines()
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=7, ocr_lines=lines)
        self.assertEqual(result[1].slot_key, "loadout_slot_seg0007_row1")

    def test_slot_key_segment_index_7_row_sequence(self):
        lines = _make_full_5row_lines()
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=7, ocr_lines=lines)
        expected = [f"loadout_slot_seg0007_row{r}" for r in range(5)]
        actual = [s.slot_key for s in result]
        self.assertEqual(actual, expected)


class TestSlotKeySegmentIndexPadding(unittest.TestCase):
    """Segment index is always zero-padded to 4 digits."""

    def test_segment_index_0_produces_seg0000(self):
        lines = [_pos_line("C", 210.0), _gamertag_line("TagA", 210.0)]
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=lines)
        self.assertEqual(result[0].slot_key, "loadout_slot_seg0000_row0")

    def test_segment_index_42_produces_seg0042(self):
        lines = [_pos_line("C", 210.0), _gamertag_line("TagA", 210.0)]
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=42, ocr_lines=lines)
        self.assertEqual(result[0].slot_key, "loadout_slot_seg0042_row0")

    def test_segment_index_9999_produces_seg9999(self):
        lines = [_pos_line("C", 210.0), _gamertag_line("TagA", 210.0)]
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=9999, ocr_lines=lines)
        self.assertEqual(result[0].slot_key, "loadout_slot_seg9999_row0")


class TestSlotKeyStableAcrossOCRVariation(unittest.TestCase):
    """Same Y-positions → same slot_keys, regardless of OCR text differences."""

    def test_gamertag_variation_produces_same_slot_keys(self):
        """Two frames with same row Y positions but different gamertag OCR text
        produce the same sequence of slot_keys."""
        # Frame A: gamertag "henrythebobjr"
        lines_a = _make_full_5row_lines(gamertags=[
            "henrythebobjr", "Player1", "Player2", "Player3", "Player4"
        ])
        # Frame B: same positions, gamertag is "henrytheboblr" (1 char typo)
        lines_b = _make_full_5row_lines(gamertags=[
            "henrytheboblr", "Player1", "Player2", "Player3", "Player4"
        ])

        result_a = extract_slot_identities(_DUMMY_IMAGE, segment_index=5, ocr_lines=lines_a)
        result_b = extract_slot_identities(_DUMMY_IMAGE, segment_index=5, ocr_lines=lines_b)

        keys_a = [s.slot_key for s in result_a]
        keys_b = [s.slot_key for s in result_b]
        self.assertEqual(keys_a, keys_b)
        self.assertEqual(len(keys_a), 5)

    def test_number_text_variation_produces_same_slot_keys(self):
        """OCR typo in jersey number text has no effect on slot_key."""
        y = ANCHOR_YS[0]
        lines_a = [_pos_line("C", y), _gamertag_line("PlayerX", y), _number_name_line("#77 - Name", y)]
        lines_b = [_pos_line("C", y), _gamertag_line("PlayerX", y), _number_name_line("#17 - Name", y)]  # diff number

        result_a = extract_slot_identities(_DUMMY_IMAGE, segment_index=3, ocr_lines=lines_a)
        result_b = extract_slot_identities(_DUMMY_IMAGE, segment_index=3, ocr_lines=lines_b)

        self.assertEqual(result_a[0].slot_key, result_b[0].slot_key)


class TestSlotKeyDoesNotIncludeOCRText(unittest.TestCase):
    """slot_key must be purely geometric — no OCR-derived text."""

    _SLOT_KEY_RE = re.compile(r"^loadout_slot_seg\d{4}_row\d$")

    def test_slot_key_matches_pure_geometric_pattern(self):
        lines = _make_full_5row_lines(gamertags=["TeamAlpha", "RightWing", "GoalieGod", "Tank", "Speed"])
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=2, ocr_lines=lines)
        for slot in result:
            self.assertRegex(
                slot.slot_key,
                self._SLOT_KEY_RE,
                f"slot_key '{slot.slot_key}' does not match pure-geometry pattern",
            )

    def test_slot_key_does_not_contain_gamertag_substring(self):
        lines = _make_full_5row_lines(gamertags=["AlphaTag", "BetaTag", "GammaTag", "DeltaTag", "EpsilonTag"])
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=lines)
        for slot in result:
            self.assertNotIn("AlphaTag", slot.slot_key)
            self.assertNotIn("BetaTag", slot.slot_key)

    def test_slot_key_does_not_contain_position_string(self):
        lines = _make_full_5row_lines()
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=lines)
        for slot in result:
            for pos in ["C", "LW", "RW", "LD", "RD", "G"]:
                self.assertNotIn(pos, slot.slot_key)

    def test_slot_key_does_not_contain_team_side(self):
        lines = _make_full_5row_lines()
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=lines)
        for slot in result:
            self.assertNotIn("home", slot.slot_key.lower())
            self.assertNotIn("away", slot.slot_key.lower())
            self.assertNotIn("bgm", slot.slot_key.lower())
            self.assertNotIn("opp", slot.slot_key.lower())


class TestRowOrdinalDerivedFromAnchorY(unittest.TestCase):
    """row_ordinal must be derived from anchor_y, sorted top-to-bottom (ascending Y)."""

    def test_row_ordinal_0_has_smallest_anchor_y(self):
        lines = _make_full_5row_lines()
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=lines)
        anchor_ys = [s.anchor_y for s in result]
        self.assertEqual(anchor_ys, sorted(anchor_ys))

    def test_out_of_order_input_produces_sorted_ordinals(self):
        """Even if OCR lines are shuffled/out-of-order in the input list,
        row_ordinals are assigned 0..4 by ascending Y."""
        # Provide anchors in non-ascending Y order
        shuffled_ys = [300.0, 100.0, 500.0, 250.0, 150.0]
        shuffled_positions = ["LW", "C", "RD", "RW", "LD"]
        lines: list[OCRLine] = []
        for pos, y in zip(shuffled_positions, shuffled_ys):
            lines.append(_pos_line(pos, y))
            lines.append(_gamertag_line(f"Player_{pos}", y))

        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=lines)

        # row_ordinal[i] == i always (already in ascending-Y order from the extractor)
        for i, slot in enumerate(result):
            self.assertEqual(slot.row_ordinal, i)

        # Verify Y-ordering
        anchor_ys = [s.anchor_y for s in result]
        self.assertEqual(anchor_ys, sorted(anchor_ys))

    def test_row_ordinal_0_is_topmost_row(self):
        """row_ordinal=0 corresponds to the smallest anchor_y (topmost in image)."""
        lines = [
            _pos_line("G", 800.0),   # bottom
            _pos_line("C", 200.0),   # top
        ]
        for i, y in enumerate([800.0, 200.0]):
            lines.append(_gamertag_line(f"Player{i}", y))

        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=lines)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].row_ordinal, 0)
        self.assertLess(result[0].anchor_y, result[1].anchor_y)


class TestYBucketTolerance(unittest.TestCase):
    """Lines within ROW_Y_BUCKET_TOLERANCE_PX of each other collapse into one row."""

    def test_two_close_position_lines_collapse_to_one_row(self):
        """Two position-label lines within tolerance of each other => 1 row, not 2."""
        y_base = 400.0
        y_near = y_base + ROW_Y_BUCKET_TOLERANCE_PX - 1  # within tolerance
        lines = [
            _pos_line("C", y_base),
            _pos_line("LW", y_near),  # within tolerance of y_base — same bucket
        ]
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=lines)
        self.assertEqual(len(result), 1)

    def test_two_position_lines_beyond_tolerance_produce_two_rows(self):
        """Two position-label lines farther apart than tolerance => 2 rows."""
        y_base = 400.0
        y_far = y_base + ROW_Y_BUCKET_TOLERANCE_PX + 10  # beyond tolerance
        lines = [
            _pos_line("C", y_base),
            _pos_line("LW", y_far),
        ]
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=lines)
        self.assertEqual(len(result), 2)


class TestSlotIdentityEvidenceFields(unittest.TestCase):
    """Evidence fields (gamertag, position, jersey, captain, persona) are populated
    from OCR lines attributed to the slot's row — they are evidence, not identity."""

    def test_gamertag_field_populated_from_row_lines(self):
        y = ANCHOR_YS[0]
        lines = [
            _pos_line("C", y),
            _gamertag_line("SomePlayer", y, conf=0.92),
        ]
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=lines)
        self.assertEqual(len(result), 1)
        slot = result[0]
        self.assertIsNotNone(slot.gamertag)

    def test_position_field_populated_from_anchor(self):
        y = ANCHOR_YS[0]
        lines = [
            _pos_line("C", y, conf=0.95),
            _gamertag_line("SomePlayer", y),
        ]
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=lines)
        self.assertEqual(len(result), 1)
        slot = result[0]
        self.assertEqual(slot.position, "C")
        self.assertIsNotNone(slot.position_confidence)

    def test_jersey_number_extracted_from_hash_pattern(self):
        y = ANCHOR_YS[0]
        lines = [
            _pos_line("C", y),
            _gamertag_line("SomePlayer", y),
            _number_name_line("#42 - PersName", y, conf=0.88),
        ]
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=lines)
        slot = result[0]
        self.assertEqual(slot.jersey_number, 42)
        self.assertIsNotNone(slot.jersey_confidence)

    def test_persona_raw_extracted_from_number_name_line(self):
        y = ANCHOR_YS[0]
        lines = [
            _pos_line("RW", y),
            _gamertag_line("SomePlayer", y),
            _number_name_line("#7 - Evgeni Wanhg", y, conf=0.90),
        ]
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=lines)
        slot = result[0]
        # persona_raw may be the full_name extracted from the #N - Name pattern
        self.assertIsNotNone(slot.persona_raw)

    def test_is_captain_none_when_no_captain_glyph(self):
        """is_captain should be None when no captain glyph is present."""
        y = ANCHOR_YS[0]
        lines = [
            _pos_line("C", y),
            _gamertag_line("SomePlayer", y),
        ]
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=lines)
        slot = result[0]
        # No captain glyph => is_captain is None (not False)
        self.assertIsNone(slot.is_captain)

    def test_is_captain_true_when_star_glyph_present(self):
        """is_captain=True when a captain glyph appears in a row line."""
        y = ANCHOR_YS[0]
        lines = [
            _pos_line("C", y),
            _gamertag_line("SomePlayer", y),
            OCRLine(text="★ SomePlayer", confidence=0.85, x1=200.0, y1=y - 8, x2=340.0, y2=y + 8),
        ]
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=lines)
        slot = result[0]
        self.assertTrue(slot.is_captain)
        self.assertIsNotNone(slot.is_captain_confidence)


class TestObservability(unittest.TestCase):
    """observability field reflects the quality of evidence found at each slot."""

    def test_observable_when_evidence_present(self):
        y = ANCHOR_YS[0]
        lines = [
            _pos_line("C", y, conf=0.95),
            _gamertag_line("PlayerA", y, conf=0.92),
        ]
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=lines)
        slot = result[0]
        self.assertEqual(slot.observability, "observable")

    def test_not_observable_when_only_anchor_no_other_lines(self):
        """An anchor-only row (no content lines) has observability 'not_observable_from_source'."""
        y = ANCHOR_YS[0]
        lines = [_pos_line("C", y)]
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=lines)
        slot = result[0]
        self.assertEqual(slot.observability, "not_observable_from_source")

    def test_low_quality_when_evidence_below_threshold(self):
        """Lines with very low confidence produce 'low_quality' observability."""
        y = ANCHOR_YS[0]
        lines = [
            _pos_line("C", y, conf=0.10),   # below threshold
            _gamertag_line("PlayerA", y, conf=0.10),  # below threshold
        ]
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=lines)
        # Depending on threshold definition, either low_quality or not_observable_from_source
        slot = result[0]
        self.assertIn(slot.observability, ("low_quality", "not_observable_from_source"))


class TestAnchorYField(unittest.TestCase):
    """anchor_y is the integer Y pixel of the row center in the source image."""

    def test_anchor_y_matches_position_label_y(self):
        y = 350.0
        lines = [_pos_line("RD", y), _gamertag_line("P", y)]
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=lines)
        self.assertEqual(len(result), 1)
        # anchor_y should be close to the anchor line's y_center
        self.assertAlmostEqual(result[0].anchor_y, y, delta=5)

    def test_anchor_y_is_int(self):
        lines = [_pos_line("C", 210.0), _gamertag_line("Tag", 210.0)]
        result = extract_slot_identities(_DUMMY_IMAGE, segment_index=0, ocr_lines=lines)
        self.assertIsInstance(result[0].anchor_y, int)


class TestSlotIdentityDataclass(unittest.TestCase):
    """SlotIdentity is a frozen dataclass with the required fields."""

    def test_slot_identity_is_frozen(self):
        slot = SlotIdentity(slot_key="loadout_slot_seg0000_row0", row_ordinal=0, anchor_y=200)
        with self.assertRaises((TypeError, AttributeError)):
            slot.row_ordinal = 99  # type: ignore[misc]

    def test_slot_identity_optional_fields_default_none(self):
        slot = SlotIdentity(slot_key="loadout_slot_seg0001_row2", row_ordinal=2, anchor_y=430)
        self.assertIsNone(slot.gamertag)
        self.assertIsNone(slot.position)
        self.assertIsNone(slot.jersey_number)
        self.assertIsNone(slot.is_captain)
        self.assertIsNone(slot.persona_raw)

    def test_slot_identity_default_observability_is_observable(self):
        slot = SlotIdentity(slot_key="loadout_slot_seg0001_row2", row_ordinal=2, anchor_y=430)
        self.assertEqual(slot.observability, "observable")

    def test_constants_have_expected_values(self):
        self.assertEqual(ROW_Y_BUCKET_TOLERANCE_PX, 6)
        # MAX_ROWS_PER_LOADOUT_SEGMENT counts distinct subjects (6 BGM + 6 opp = 12, both goalies human)
        self.assertEqual(MAX_ROWS_PER_LOADOUT_SEGMENT, 12)


if __name__ == "__main__":
    unittest.main()
