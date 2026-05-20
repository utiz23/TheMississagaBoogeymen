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

    def test_trains_rejects_binary_corpus(self):
        n = len(self.sm.states)
        feats = [
            _fake_features(0.001, 0.4, 20.0, anchor_idx=0, n_states=n),
            _fake_features(0.001, 0.4, 20.0, anchor_idx=1, n_states=n),
        ]
        labels = [self.sm.states[0], self.sm.states[1]]
        with self.assertRaises(ValueError) as cm:
            train_screen_classifier(feats, labels, self.sm)
        self.assertIn("at least 3 distinct states", str(cm.exception))

    def test_trains_rejects_missing_states(self):
        # Cover 16 of 17 states — miss "end_of_video".
        states_to_cover = [s for s in self.sm.states if s != "end_of_video"]
        feats = [
            _fake_features(0.001, 0.4, 20.0, anchor_idx=self.sm.state_index(s),
                           n_states=len(self.sm.states))
            for s in states_to_cover
        ]
        labels = list(states_to_cover)
        with self.assertRaises(ValueError) as cm:
            train_screen_classifier(feats, labels, self.sm)
        self.assertIn("missing states", str(cm.exception))
        self.assertIn("end_of_video", str(cm.exception))


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

    def test_init_rejects_decoder_version_mismatch(self):
        n = len(self.sm.states)
        # Train a valid classifier.
        feats = [
            _fake_features(0.001, 0.4, 20.0, anchor_idx=i, n_states=n)
            for i in range(n)
        ]
        labels = list(self.sm.states)
        clf = train_screen_classifier(feats, labels, self.sm)
        # Craft a weights object with mismatched decoder_version.
        bad_weights = ScreenClassifierWeights(
            version=clf.weights.version,
            decoder_version="hmm-viterbi-vSOMETHING-ELSE",
            classes=clf.weights.classes,
            intercept=clf.weights.intercept,
            coef=clf.weights.coef,
        )
        with self.assertRaises(ValueError) as cm:
            ScreenClassifier(bad_weights, self.sm)
        self.assertIn("decoder_version", str(cm.exception))
