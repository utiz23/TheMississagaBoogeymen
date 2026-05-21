"""Tests for the new single-subject-per-frame loadout identity extractor.

Phase 2A architectural fix: one SubjectIdentity per frame, not one SlotIdentity
per visible row.

Run with:
    PYTHONPATH=tools/game_ocr python3 -m pytest tools/video_ingest/tests/test_subject_identity.py -v
"""

from __future__ import annotations

import unittest

import numpy as np

from game_ocr.ocr import OCRLine
from game_ocr.loadout_extractors.slot_identity import (
    SubjectIdentity,
    extract_subject_identity,
    _normalize_tag,
    _levenshtein,
    _fuzzy_gamertag_match,
)


# ---------------------------------------------------------------------------
# Synthetic OCR line helpers
# ---------------------------------------------------------------------------

def _pos_line(pos: str, y: float, conf: float = 0.95) -> OCRLine:
    """Position label at x_center ~65 (left strip anchor)."""
    return OCRLine(text=pos, confidence=conf, x1=20.0, y1=y - 8, x2=110.0, y2=y + 8)


def _gamertag_line_left(tag: str, y: float, conf: float = 0.9) -> OCRLine:
    """Gamertag in left strip at x_center ~270."""
    return OCRLine(text=tag, confidence=conf, x1=200.0, y1=y - 8, x2=340.0, y2=y + 8)


def _number_name_line(text: str, y: float, conf: float = 0.9) -> OCRLine:
    """'#N - Name' line in left strip at x_center ~290."""
    return OCRLine(text=text, confidence=conf, x1=200.0, y1=y - 8, x2=380.0, y2=y + 8)


def _gamertag_line_top_right(tag: str, conf: float = 0.9) -> OCRLine:
    """Gamertag in top-right corner (y_center=155, x_center=1700)."""
    return OCRLine(text=tag, confidence=conf, x1=1600.0, y1=147.0, x2=1800.0, y2=163.0)


def _title_bar_line(text: str, conf: float = 0.9) -> OCRLine:
    """Title bar line (y_center=138, x_center=750)."""
    return OCRLine(text=text, confidence=conf, x1=300.0, y1=130.0, x2=1200.0, y2=146.0)


_DUMMY_IMAGE = np.zeros((1080, 1920, 3), dtype=np.uint8)

# Five canonical anchor Y positions
ANCHOR_YS = [210.0, 320.0, 430.0, 540.0, 650.0]
POSITIONS = ["C", "LW", "RW", "LD", "RD"]


def _make_full_roster_lines(subject_gamertag: str = "StickMenace", subject_pos_idx: int = 1) -> list[OCRLine]:
    """Build a synthetic frame with 5 left-strip rows + the subject's top-right gamertag."""
    gamertags = [f"Player{i}" for i in range(5)]
    lines: list[OCRLine] = []

    # Top-right gamertag (subject)
    lines.append(_gamertag_line_top_right(subject_gamertag))

    # Left strip (5 rows)
    for i, (y, pos) in enumerate(zip(ANCHOR_YS, POSITIONS)):
        lines.append(_pos_line(pos, y))
        tag = subject_gamertag if i == subject_pos_idx else gamertags[i]
        lines.append(_gamertag_line_left(tag, y))
        lines.append(_number_name_line(f"#{i + 10} - PlayerName{i}", y))

    return lines


# ---------------------------------------------------------------------------
# Test: extract_subject_identity returns one subject per frame
# ---------------------------------------------------------------------------


class TestExtractSubjectIdentityReturnsOneSubjectPerFrame(unittest.TestCase):
    """extract_subject_identity returns exactly one SubjectIdentity (or None) per frame."""

    def test_returns_subject_identity_dataclass(self):
        lines = _make_full_roster_lines("StickMenace", subject_pos_idx=1)
        result = extract_subject_identity(_DUMMY_IMAGE, ocr_lines=lines)
        self.assertIsNotNone(result)
        self.assertIsInstance(result, SubjectIdentity)

    def test_returns_none_when_no_top_right_gamertag(self):
        """Without a top-right gamertag, cannot identify the subject."""
        lines = [
            _pos_line("C", 210.0),
            _gamertag_line_left("SomePlayer", 210.0),
        ]
        result = extract_subject_identity(_DUMMY_IMAGE, ocr_lines=lines)
        self.assertIsNone(result)

    def test_returns_none_when_ocr_lines_empty(self):
        result = extract_subject_identity(_DUMMY_IMAGE, ocr_lines=[])
        self.assertIsNone(result)

    def test_result_is_single_object_not_list(self):
        """The new API returns ONE SubjectIdentity (not a list)."""
        lines = _make_full_roster_lines("TagA")
        result = extract_subject_identity(_DUMMY_IMAGE, ocr_lines=lines)
        # Must be a SubjectIdentity instance, not a list
        self.assertNotIsInstance(result, list)


# ---------------------------------------------------------------------------
# Test: subject identified via top-right gamertag match to left-strip row
# ---------------------------------------------------------------------------


class TestSubjectIdentifiedViaTopRightGamertag(unittest.TestCase):
    """Gamertag in top-right corner is matched against left-strip rows to identify the subject."""

    def test_gamertag_matches_left_strip_row(self):
        """The top-right gamertag 'StickMenace' should match row containing 'StickMenace'."""
        lines = [
            _gamertag_line_top_right("StickMenace"),
            # Left strip with 3 rows; StickMenace is in row 1
            _pos_line("LW", 300.0), _gamertag_line_left("OtherPlayer", 300.0),
            _pos_line("RW", 390.0), _gamertag_line_left("StickMenace", 390.0),
            _pos_line("LD", 480.0), _gamertag_line_left("AnotherPlayer", 480.0),
        ]
        result = extract_subject_identity(_DUMMY_IMAGE, ocr_lines=lines)
        self.assertIsNotNone(result)
        self.assertEqual(result.gamertag, "StickMenace")

    def test_subject_position_from_matched_row(self):
        """Position comes from the left-strip row matched to the subject."""
        lines = [
            _gamertag_line_top_right("StickMenace"),
            _pos_line("LW", 300.0), _gamertag_line_left("OtherPlayer", 300.0),
            _pos_line("RW", 390.0), _gamertag_line_left("StickMenace", 390.0),
        ]
        result = extract_subject_identity(_DUMMY_IMAGE, ocr_lines=lines)
        self.assertIsNotNone(result)
        self.assertEqual(result.position, "RW")

    def test_non_subject_rows_do_not_get_position_from_their_anchors(self):
        """When subject matches row at RW, the result's position is RW, not LW from another row."""
        lines = [
            _gamertag_line_top_right("SubjectPlayer"),
            _pos_line("LW", 300.0), _gamertag_line_left("DifferentPlayer", 300.0),
            _pos_line("RW", 390.0), _gamertag_line_left("SubjectPlayer", 390.0),
        ]
        result = extract_subject_identity(_DUMMY_IMAGE, ocr_lines=lines)
        self.assertIsNotNone(result)
        self.assertEqual(result.position, "RW")  # not "LW"

    def test_gamertag_case_insensitive_match(self):
        """OCR may return the gamertag in different case — matching is case-insensitive."""
        lines = [
            _gamertag_line_top_right("stickmenace"),  # lowercase in top-right
            _pos_line("RW", 390.0), _gamertag_line_left("StickMenace", 390.0),  # mixed in left
        ]
        result = extract_subject_identity(_DUMMY_IMAGE, ocr_lines=lines)
        self.assertIsNotNone(result)
        self.assertIsNotNone(result.position)


# ---------------------------------------------------------------------------
# Test: jersey number and player name extracted from matched row
# ---------------------------------------------------------------------------


class TestJerseyAndPlayerNameFromMatchedRow(unittest.TestCase):
    """Jersey number and player name come from the matched left-strip row."""

    def test_jersey_number_extracted(self):
        lines = [
            _gamertag_line_top_right("HenryTheBobJr"),
            _pos_line("LD", 540.0),
            _gamertag_line_left("HenryTheBobJr", 540.0),
            _number_name_line("#7 - Hubert Jenkins", 540.0),
        ]
        result = extract_subject_identity(_DUMMY_IMAGE, ocr_lines=lines)
        self.assertIsNotNone(result)
        self.assertEqual(result.jersey_number, 7)

    def test_player_name_full_extracted(self):
        lines = [
            _gamertag_line_top_right("HenryTheBobJr"),
            _pos_line("LD", 540.0),
            _gamertag_line_left("HenryTheBobJr", 540.0),
            _number_name_line("#7 - Hubert Jenkins", 540.0),
        ]
        result = extract_subject_identity(_DUMMY_IMAGE, ocr_lines=lines)
        self.assertIsNotNone(result)
        self.assertEqual(result.player_name_full, "Hubert Jenkins")

    def test_non_subject_jersey_not_returned(self):
        """Only the matched row's jersey is returned, not other rows'."""
        lines = [
            _gamertag_line_top_right("SubjectPlayer"),
            # Row 0: not the subject
            _pos_line("LW", 300.0),
            _gamertag_line_left("OtherPlayer", 300.0),
            _number_name_line("#99 - Other Name", 300.0),
            # Row 1: the subject
            _pos_line("C", 400.0),
            _gamertag_line_left("SubjectPlayer", 400.0),
            _number_name_line("#11 - Subject Name", 400.0),
        ]
        result = extract_subject_identity(_DUMMY_IMAGE, ocr_lines=lines)
        self.assertIsNotNone(result)
        self.assertEqual(result.jersey_number, 11)  # not 99


# ---------------------------------------------------------------------------
# Test: build class from title bar
# ---------------------------------------------------------------------------


class TestBuildClassFromTitleBar(unittest.TestCase):
    """build_class_raw comes from the title bar (y in [100, 175], x in [300, 1200])."""

    def test_build_class_extracted_from_title_bar(self):
        lines = [
            _gamertag_line_top_right("StickMenace"),
            _title_bar_line("TAGETHOMPSON-PWF"),
            _pos_line("RW", 390.0),
            _gamertag_line_left("StickMenace", 390.0),
        ]
        result = extract_subject_identity(_DUMMY_IMAGE, ocr_lines=lines)
        self.assertIsNotNone(result)
        self.assertIsNotNone(result.build_class_raw)
        self.assertIn("PWF", result.build_class_raw)

    def test_build_class_none_when_no_title_bar(self):
        """No title bar lines → build_class_raw is None."""
        lines = [
            _gamertag_line_top_right("PlayerA"),
            _pos_line("C", 300.0),
            _gamertag_line_left("PlayerA", 300.0),
        ]
        result = extract_subject_identity(_DUMMY_IMAGE, ocr_lines=lines)
        self.assertIsNotNone(result)
        self.assertIsNone(result.build_class_raw)


# ---------------------------------------------------------------------------
# Test: partial identity when gamertag found but no row match
# ---------------------------------------------------------------------------


class TestPartialIdentityWhenNoRowMatch(unittest.TestCase):
    """When the top-right gamertag can't be matched to a left-strip row, return partial identity."""

    def test_partial_identity_returned_when_no_row_match(self):
        """Gamertag found in top-right but no matching left-strip row → partial SubjectIdentity."""
        lines = [
            _gamertag_line_top_right("UnknownPlayer"),
            # Left strip has rows, but none match "UnknownPlayer"
            _pos_line("LW", 300.0), _gamertag_line_left("OtherPlayer1", 300.0),
            _pos_line("RW", 390.0), _gamertag_line_left("OtherPlayer2", 390.0),
        ]
        result = extract_subject_identity(_DUMMY_IMAGE, ocr_lines=lines)
        self.assertIsNotNone(result)
        # Gamertag is set from top-right
        self.assertEqual(result.gamertag, "UnknownPlayer")
        # Position is not set (no row match)
        self.assertIsNone(result.position)
        # Observability reflects inability to match row
        self.assertIn(result.observability, ("observable", "not_observable_from_source"))

    def test_gamertag_still_populated_from_top_right(self):
        """Even without a row match, gamertag reflects the top-right OCR."""
        lines = [
            _gamertag_line_top_right("SomeUnmatchedTag", conf=0.85),
        ]
        result = extract_subject_identity(_DUMMY_IMAGE, ocr_lines=lines)
        self.assertIsNotNone(result)
        self.assertEqual(result.gamertag, "SomeUnmatchedTag")


# ---------------------------------------------------------------------------
# Test: observability classification
# ---------------------------------------------------------------------------


class TestSubjectObservability(unittest.TestCase):
    """Observability reflects the quality of the identified subject."""

    def test_observable_when_gamertag_high_confidence(self):
        lines = [
            _gamertag_line_top_right("PlayerA", conf=0.95),
            _pos_line("C", 300.0),
            _gamertag_line_left("PlayerA", 300.0, conf=0.92),
        ]
        result = extract_subject_identity(_DUMMY_IMAGE, ocr_lines=lines)
        self.assertIsNotNone(result)
        self.assertEqual(result.observability, "observable")

    def test_low_quality_when_all_confidence_below_threshold(self):
        lines = [
            _gamertag_line_top_right("PlayerA", conf=0.10),
            _pos_line("C", 300.0, conf=0.10),
            _gamertag_line_left("PlayerA", 300.0, conf=0.10),
        ]
        result = extract_subject_identity(_DUMMY_IMAGE, ocr_lines=lines)
        self.assertIsNotNone(result)
        self.assertIn(result.observability, ("low_quality", "not_observable_from_source"))

    def test_not_observable_when_no_row_match_and_low_confidence(self):
        lines = [
            _gamertag_line_top_right("XYZ", conf=0.10),
        ]
        result = extract_subject_identity(_DUMMY_IMAGE, ocr_lines=lines)
        self.assertIsNotNone(result)
        self.assertEqual(result.observability, "not_observable_from_source")


# ---------------------------------------------------------------------------
# Test: SubjectIdentity dataclass contract
# ---------------------------------------------------------------------------


class TestSubjectIdentityDataclass(unittest.TestCase):
    """SubjectIdentity is a frozen dataclass with the required fields."""

    def test_subject_identity_is_frozen(self):
        si = SubjectIdentity(gamertag="TestPlayer", gamertag_confidence=0.9)
        with self.assertRaises((TypeError, AttributeError)):
            si.gamertag = "changed"  # type: ignore[misc]

    def test_optional_fields_default_none(self):
        si = SubjectIdentity(gamertag="TestPlayer", gamertag_confidence=0.9)
        self.assertIsNone(si.position)
        self.assertIsNone(si.position_confidence)
        self.assertIsNone(si.jersey_number)
        self.assertIsNone(si.jersey_confidence)
        self.assertIsNone(si.player_name_full)
        self.assertIsNone(si.player_name_confidence)
        self.assertIsNone(si.is_captain)
        self.assertIsNone(si.is_captain_confidence)
        self.assertIsNone(si.build_class_raw)
        self.assertIsNone(si.build_class_confidence)
        self.assertIsNone(si.anchor_y)

    def test_default_observability_is_observable(self):
        si = SubjectIdentity(gamertag="TestPlayer", gamertag_confidence=0.9)
        self.assertEqual(si.observability, "observable")


# ---------------------------------------------------------------------------
# Test: internal helpers
# ---------------------------------------------------------------------------


class TestNormalizeTag(unittest.TestCase):
    """_normalize_tag strips non-alphanumeric and lowercases."""

    def test_lowercase(self):
        self.assertEqual(_normalize_tag("StickMenace"), "stickmenace")

    def test_strips_special_chars(self):
        self.assertEqual(_normalize_tag("Stick-Menace!"), "stickmenace")

    def test_empty_string(self):
        self.assertEqual(_normalize_tag(""), "")


class TestLevenshtein(unittest.TestCase):
    """_levenshtein computes edit distance correctly."""

    def test_identical_strings(self):
        self.assertEqual(_levenshtein("hello", "hello"), 0)

    def test_one_deletion(self):
        self.assertEqual(_levenshtein("hello", "helo"), 1)

    def test_one_substitution(self):
        self.assertEqual(_levenshtein("hello", "hxllo"), 1)

    def test_empty_strings(self):
        self.assertEqual(_levenshtein("", ""), 0)

    def test_one_empty(self):
        self.assertEqual(_levenshtein("abc", ""), 3)


class TestFuzzyGamertag(unittest.TestCase):
    """_fuzzy_gamertag_match handles substring and edit-distance matching."""

    def test_exact_match(self):
        self.assertTrue(_fuzzy_gamertag_match("stickm", "stickmenace"))

    def test_substring_match(self):
        self.assertTrue(_fuzzy_gamertag_match("henry", "henrythebobjr"))

    def test_no_match(self):
        self.assertFalse(_fuzzy_gamertag_match("zzzzzz", "stickmenace"))

    def test_empty_query(self):
        self.assertFalse(_fuzzy_gamertag_match("", "stickmenace"))

    def test_one_typo_match(self):
        """'stickm' vs 'sticCm' — 1 substitution in 6-char prefix → match."""
        self.assertTrue(_fuzzy_gamertag_match("stickm", "sticCm"))


if __name__ == "__main__":
    unittest.main()
