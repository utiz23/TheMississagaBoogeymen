"""Tests for the Phase 1 emission combiner."""

from __future__ import annotations

import math
import unittest

import numpy as np

from game_ocr.emissions import EmissionWeights, build_log_emissions
from game_ocr.frame_features import FrameFeatures
from game_ocr.state_machine import load_state_machine


def _feats(n_states: int, *, anchor_idx: int | None, brightness: float = 0.4,
           blur: float = 50.0, reject: bool = False) -> FrameFeatures:
    flags = np.zeros(n_states, dtype=np.float64)
    if anchor_idx is not None:
        flags[anchor_idx] = 1.0
    return FrameFeatures(
        hsv_histogram=np.full(192, 1.0 / 192, dtype=np.float64),
        anchor_flags=flags,
        anchor_text="",
        reject_anchor_present=reject,
        brightness=brightness,
        blur_score=blur,
    )


class _MockClassifier:
    """Stub for testing emissions without invoking sklearn."""

    def __init__(self, log_probs_for: dict[int, np.ndarray]):
        self.log_probs_for = log_probs_for
        self.calls = 0

    def predict_log_probs(self, features: FrameFeatures) -> np.ndarray:
        out = self.log_probs_for.get(self.calls, np.full(17, -math.log(17)))
        self.calls += 1
        return out


class TestBuildLogEmissions(unittest.TestCase):
    def setUp(self):
        self.sm = load_state_machine("nhl26")
        self.weights = EmissionWeights(
            classifier_weight=1.0,
            anchor_bonus=2.0,
            reject_floor=-20.0,
        )

    def test_shape(self):
        feats = [_feats(17, anchor_idx=2) for _ in range(5)]
        clf = _MockClassifier({})
        em = build_log_emissions(feats, clf, self.sm, self.weights)
        self.assertEqual(em.shape, (5, 17))

    def test_anchor_bonus_lifts_matching_state(self):
        feats = [_feats(17, anchor_idx=self.sm.state_index("player_loadout_view"))]
        clf = _MockClassifier({0: np.full(17, -math.log(17))})
        em = build_log_emissions(feats, clf, self.sm, self.weights)
        target = self.sm.state_index("player_loadout_view")
        # All other states get the classifier baseline; target gets baseline + anchor_bonus.
        for i in range(17):
            if i == target:
                self.assertGreater(em[0, i], em[0, (i + 1) % 17])

    def test_reject_anchor_pins_unknown(self):
        feats = [_feats(17, anchor_idx=None, reject=True)]
        clf = _MockClassifier({0: np.full(17, -math.log(17))})
        em = build_log_emissions(feats, clf, self.sm, self.weights)
        unk = self.sm.state_index("unknown_or_transition")
        # All non-unknown states clamped at reject_floor.
        for i in range(17):
            if i != unk:
                self.assertLessEqual(em[0, i], -20.0 + 1e-9)
        # Unknown is the highest.
        self.assertEqual(int(np.argmax(em[0])), unk)

    def test_classifier_weight_scales_logits(self):
        feats = [_feats(17, anchor_idx=None)]
        # Classifier strongly prefers state 3.
        lp = np.full(17, -10.0)
        lp[3] = 0.0
        clf = _MockClassifier({0: lp})
        em = build_log_emissions(feats, clf, self.sm, self.weights)
        # State 3 should win because the classifier weight is positive.
        self.assertEqual(int(np.argmax(em[0])), 3)
