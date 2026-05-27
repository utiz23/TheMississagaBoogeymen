"""Tests for the Phase 1 emission combiner."""

from __future__ import annotations

import math
import unittest

import numpy as np

from game_ocr.emissions import (
    EmissionWeights,
    build_log_emissions,
    build_log_emissions_v2,
)
from game_ocr.frame_features import FrameFeatures, FrameFeaturesV2
from game_ocr.regex_priors import load_regex_priors
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
        # These tests cover the v1 emissions combiner with 17-class fixtures.
        # Load the v1 state machine explicitly so test asserts on `(5, 17)`
        # shapes survive S5.1's 18-state v2 bump on the unsuffixed nhl26.yaml.
        self.sm = load_state_machine("nhl26-v1")
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

    def test_classifier_wrong_shape_raises(self):
        feats = [_feats(17, anchor_idx=None)]
        clf = _MockClassifier({0: np.full(16, -math.log(17))})  # wrong N
        with self.assertRaises(ValueError) as cm:
            build_log_emissions(feats, clf, self.sm, self.weights)
        self.assertIn("shape", str(cm.exception))

    def test_classifier_nan_raises(self):
        feats = [_feats(17, anchor_idx=None)]
        bad = np.full(17, -1.0)
        bad[3] = float("nan")
        clf = _MockClassifier({0: bad})
        with self.assertRaises(ValueError) as cm:
            build_log_emissions(feats, clf, self.sm, self.weights)
        self.assertIn("NaN", str(cm.exception))


# ─── v2 emissions tests ──────────────────────────────────────────────────────


_PRIORS = load_regex_priors("nhl26")


def _feats_v2(n_priors: int, fired_prior_idx: int | None = None) -> FrameFeaturesV2:
    """Synthetic FrameFeaturesV2 with optional single prior fired."""
    flags = np.zeros(n_priors, dtype=np.float64)
    if fired_prior_idx is not None:
        flags[fired_prior_idx] = 1.0
    return FrameFeaturesV2(
        full_frame_hsv=np.ones(48, dtype=np.float64) / 48,
        quadrant_hsvs=tuple(np.ones(48, dtype=np.float64) / 48 for _ in range(4)),
        quadrant_brightness=np.array([0.4, 0.4, 0.4, 0.4], dtype=np.float64),
        quadrant_blur=np.array([10.0, 10.0, 10.0, 10.0], dtype=np.float64),
        quadrant_edge_density=np.array([0.1, 0.1, 0.1, 0.1], dtype=np.float64),
        regex_prior_flags=flags,
        ocr_presence_flags=np.array([1.0, 0.0, 0.0], dtype=np.float64),
        top_bar_text="",
        side_strip_text="",
    )


class _MockClassifierV2:
    """Stub returning prebuilt log-probs for FrameFeaturesV2 inputs."""

    def __init__(self, default_lp: np.ndarray):
        self.default_lp = default_lp
        self.calls = 0

    def predict_log_probs(self, features: FrameFeaturesV2) -> np.ndarray:
        self.calls += 1
        return self.default_lp


class TestBuildLogEmissionsV2(unittest.TestCase):
    def setUp(self):
        # v2 emissions read the v2 state machine (post-S5.1: 18 classes incl. menu_world_of_chel).
        self.sm = load_state_machine("nhl26")
        self.n = len(self.sm.states)
        self.priors = _PRIORS
        self.weights = EmissionWeights(
            classifier_weight=1.0, anchor_bonus=2.0, reject_floor=-20.0,
        )

    def test_shape(self):
        feats = [_feats_v2(self.priors.n_priors()) for _ in range(3)]
        clf = _MockClassifierV2(np.full(self.n, -math.log(self.n)))
        em = build_log_emissions_v2(feats, clf, self.sm, self.priors, self.weights)
        self.assertEqual(em.shape, (3, self.n))

    def test_reject_prior_pins_unknown(self):
        # The "customize" prior is a reject anchor (unknown_or_transition state).
        reject_pos = next(
            i for i, p in enumerate(self.priors.priors_flat)
            if p.state == "unknown_or_transition" and p.name == "customize"
        )
        feats = [_feats_v2(self.priors.n_priors(), fired_prior_idx=reject_pos)]
        clf = _MockClassifierV2(np.full(self.n, 0.0))
        em = build_log_emissions_v2(feats, clf, self.sm, self.priors, self.weights)
        unk_idx = self.sm.state_index("unknown_or_transition")
        # All non-unknown states clamped at reject_floor.
        for i in range(self.n):
            if i != unk_idx:
                self.assertLessEqual(em[0, i], -20.0 + 1e-9)
        # Unknown wins.
        self.assertEqual(int(np.argmax(em[0])), unk_idx)

    def test_anchor_bonus_lifts_priors_state(self):
        # The "title" prior in menu_world_of_chel — firing it should lift that state.
        woc_pos = next(
            i for i, p in enumerate(self.priors.priors_flat)
            if p.state == "menu_world_of_chel" and p.name == "title"
        )
        feats = [_feats_v2(self.priors.n_priors(), fired_prior_idx=woc_pos)]
        clf = _MockClassifierV2(np.full(self.n, -math.log(self.n)))
        em = build_log_emissions_v2(feats, clf, self.sm, self.priors, self.weights)
        woc_idx = self.sm.state_index("menu_world_of_chel")
        # menu_world_of_chel should have the highest emission (baseline + anchor_bonus * 1).
        self.assertEqual(int(np.argmax(em[0])), woc_idx)

    def test_classifier_wrong_shape_raises(self):
        feats = [_feats_v2(self.priors.n_priors())]
        # Return shape (n-1) instead of (n).
        clf = _MockClassifierV2(np.full(self.n - 1, 0.0))
        with self.assertRaises(ValueError) as cm:
            build_log_emissions_v2(feats, clf, self.sm, self.priors, self.weights)
        self.assertIn("shape", str(cm.exception))

    def test_classifier_nan_raises(self):
        feats = [_feats_v2(self.priors.n_priors())]
        bad = np.full(self.n, -1.0)
        bad[3] = float("nan")
        clf = _MockClassifierV2(bad)
        with self.assertRaises(ValueError) as cm:
            build_log_emissions_v2(feats, clf, self.sm, self.priors, self.weights)
        self.assertIn("NaN", str(cm.exception))

    def test_priors_for_deferred_states_silently_dropped(self):
        # `player_loadout_landing` and `menu_club_management` priors exist in YAML
        # but the state machine doesn't include those states (S5 sparse-class
        # deferral). Firing one of their priors should NOT raise — just contribute
        # nothing to the anchor bonus.
        landing_pos = next(
            i for i, p in enumerate(self.priors.priors_flat)
            if p.state == "player_loadout_landing"
        )
        feats = [_feats_v2(self.priors.n_priors(), fired_prior_idx=landing_pos)]
        clf = _MockClassifierV2(np.full(self.n, -math.log(self.n)))
        em = build_log_emissions_v2(feats, clf, self.sm, self.priors, self.weights)
        # No state should have a higher emission than the baseline classifier output.
        baseline = -math.log(self.n) * self.weights.classifier_weight
        # All emissions equal baseline (no anchor bonus applied for deferred states).
        self.assertTrue(np.allclose(em[0], baseline))
