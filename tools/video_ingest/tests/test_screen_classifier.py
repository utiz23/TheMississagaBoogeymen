"""Tests for the small learned screen classifier."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from game_ocr.frame_features import FrameFeatures
from game_ocr.screen_classifier import (
    ScreenClassifier,
    ScreenClassifierWeights,
    feature_vector,
    load_screen_classifier,
    train_screen_classifier,
)
from game_ocr.state_machine import load_state_machine


def _fake_features(hist_value: float, brightness: float, blur: float, anchor_idx: int | None, n_states: int) -> FrameFeatures:
    hist = np.full(192, hist_value, dtype=np.float64)
    flags = np.zeros(n_states, dtype=np.float64)
    if anchor_idx is not None:
        flags[anchor_idx] = 1.0
    return FrameFeatures(
        hsv_histogram=hist,
        anchor_flags=flags,
        anchor_text="",
        reject_anchor_present=False,
        brightness=brightness,
        blur_score=blur,
    )


class TestFeatureVector(unittest.TestCase):
    def setUp(self):
        self.sm = load_state_machine("nhl26")

    def test_vector_concatenates_signals(self):
        feats = _fake_features(0.01, 0.5, 50.0, anchor_idx=2, n_states=len(self.sm.states))
        vec = feature_vector(feats, self.sm)
        # 192 hist + 17 anchor flags + 1 brightness + 1 log-blur + 1 reject = 212.
        self.assertEqual(vec.shape, (192 + len(self.sm.states) + 3,))
        # First 192 entries are the histogram.
        self.assertAlmostEqual(float(vec[0]), 0.01)


class TestScreenClassifierTrainAndPredict(unittest.TestCase):
    def setUp(self):
        self.sm = load_state_machine("nhl26")

    def test_trains_and_predicts_top_class(self):
        # Synthetic training data: per state, one feature vector with the
        # anchor flag set for that state. Trivially separable.
        feats_train = []
        labels_train = []
        for i, state in enumerate(self.sm.states):
            feats_train.append(
                _fake_features(0.001, 0.4, 20.0, anchor_idx=i, n_states=len(self.sm.states))
            )
            labels_train.append(state)

        clf = train_screen_classifier(feats_train, labels_train, self.sm)
        # Predict on the same point — must recover the state.
        target_idx = self.sm.state_index("player_loadout_view")
        test_feats = _fake_features(0.001, 0.4, 20.0, anchor_idx=target_idx, n_states=len(self.sm.states))
        logits = clf.predict_log_probs(test_feats)
        self.assertEqual(logits.shape, (len(self.sm.states),))
        self.assertEqual(int(np.argmax(logits)), target_idx)


class TestScreenClassifierIO(unittest.TestCase):
    def setUp(self):
        self.sm = load_state_machine("nhl26")

    def test_save_and_load_weights_roundtrip(self):
        feats_train = []
        labels_train = []
        for i, state in enumerate(self.sm.states):
            feats_train.append(
                _fake_features(0.001, 0.4, 20.0, anchor_idx=i, n_states=len(self.sm.states))
            )
            labels_train.append(state)
        clf = train_screen_classifier(feats_train, labels_train, self.sm)

        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "weights.json"
            clf.save(path)
            self.assertTrue(path.exists())
            loaded = load_screen_classifier(path, self.sm)
            # Same prediction on the same input.
            test_feats = _fake_features(0.001, 0.4, 20.0, anchor_idx=3, n_states=len(self.sm.states))
            np.testing.assert_allclose(
                clf.predict_log_probs(test_feats),
                loaded.predict_log_probs(test_feats),
                atol=1e-9,
            )
