"""Phase D: loadout captain resolution by visual gold-★ score.

Covers the two loadout-path changes:
  - loadout_bundle._merge_identities collapses captain by cross-frame ARGMAX of
    the star score (not first-True), with a legacy first-True fallback when no
    frame was scored;
  - loadout_extractors.slot_identity._score_row_captain_star builds the row ROI
    and returns None without a frame image.

Synthetic only — no committed fixture renders the captain star (real proof is
deferred to the Phase G re-ingest).
"""

from __future__ import annotations

import unittest

import cv2
import numpy as np

from game_ocr.loadout_bundle import _merge_identities
from game_ocr.loadout_extractors.slot_identity import (
    _CAPTAIN_STAR_X_INSET,
    _ROW_CONTENT_X_MIN,
    SubjectIdentity,
    _score_row_captain_star,
)

GOLD_BGR = (0, 200, 255)


def _identity(**overrides) -> SubjectIdentity:
    defaults = dict(gamertag="tag", gamertag_confidence=0.95, position="C")
    defaults.update(overrides)
    return SubjectIdentity(**defaults)


class MergeCaptainArgmaxTests(unittest.TestCase):
    def test_argmax_picks_highest_star_not_first_true(self) -> None:
        # Both frames report is_captain=True, but the second has a stronger star.
        # Argmax must take the higher-scoring observation's confidence.
        identities = [
            _identity(is_captain=True, is_captain_confidence=0.55, captain_star_score=0.55),
            _identity(is_captain=True, is_captain_confidence=0.95, captain_star_score=0.95),
        ]
        merged = _merge_identities(identities)
        self.assertIs(merged.is_captain, True)
        self.assertEqual(merged.is_captain_confidence, 0.95)
        self.assertEqual(merged.captain_star_score, 0.95)

    def test_star_absent_frame_does_not_win_over_star_frame(self) -> None:
        # Frame order: a starless (False) frame first, a real star frame second.
        # The old first-True/None-order collapse could mis-resolve; argmax must
        # select the star frame regardless of order.
        for order in ([0, 1], [1, 0]):
            starless = _identity(is_captain=False, is_captain_confidence=0.0, captain_star_score=0.0)
            starred = _identity(is_captain=True, is_captain_confidence=0.9, captain_star_score=0.9)
            pair = [starless, starred]
            identities = [pair[i] for i in order]
            merged = _merge_identities(identities)
            self.assertIs(merged.is_captain, True, f"order={order}")
            self.assertEqual(merged.captain_star_score, 0.9)

    def test_frameless_falls_back_to_first_true(self) -> None:
        # No frame scored (captain_star_score all None) → legacy first-True.
        identities = [
            _identity(is_captain=None, is_captain_confidence=None, captain_star_score=None),
            _identity(is_captain=True, is_captain_confidence=0.8, captain_star_score=None),
        ]
        merged = _merge_identities(identities)
        self.assertIs(merged.is_captain, True)
        self.assertEqual(merged.is_captain_confidence, 0.8)
        self.assertIsNone(merged.captain_star_score)

    def test_all_starless_resolves_not_captain(self) -> None:
        identities = [
            _identity(is_captain=False, is_captain_confidence=0.0, captain_star_score=0.0),
            _identity(is_captain=False, is_captain_confidence=0.0, captain_star_score=0.0),
        ]
        merged = _merge_identities(identities)
        self.assertIs(merged.is_captain, False)
        self.assertEqual(merged.captain_star_score, 0.0)


class ScoreRowCaptainStarTests(unittest.TestCase):
    def test_none_image_returns_none(self) -> None:
        self.assertIsNone(_score_row_captain_star(None, 300))

    def test_none_anchor_returns_none(self) -> None:
        frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
        self.assertIsNone(_score_row_captain_star(frame, None))

    def test_gold_star_at_row_roi_scores_high(self) -> None:
        anchor_y = 300
        cx = int(_ROW_CONTENT_X_MIN + _CAPTAIN_STAR_X_INSET)
        frame = np.full((1080, 1920, 3), (20, 20, 20), dtype=np.uint8)
        cv2.circle(frame, (cx, anchor_y), 12, GOLD_BGR, -1)
        score = _score_row_captain_star(frame, anchor_y)
        self.assertIsNotNone(score)
        self.assertGreaterEqual(score, 0.5)

    def test_no_star_scores_zero(self) -> None:
        frame = np.full((1080, 1920, 3), (20, 20, 20), dtype=np.uint8)
        self.assertEqual(_score_row_captain_star(frame, 300), 0.0)


if __name__ == "__main__":
    unittest.main()
