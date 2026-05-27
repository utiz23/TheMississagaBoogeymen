"""Unit tests for the v2 screen classifier (schema_version=2).

Covers:
  - feature_vector_v2 layout invariants (shape, ordering, log1p on blur).
  - ScreenClassifierV2 constructor validation (version, decoder_version,
    classes order, n_priors↔coef shape).
  - train_screen_classifier_v2 round-trip: synthetic corpus → fit → save →
    load → identical predict_log_probs.
  - load_screen_classifier dispatch (v1 → ScreenClassifier, v2 → ScreenClassifierV2).

No real RapidOCR — synthetic FrameFeaturesV2 throughout.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from game_ocr.frame_features import FrameFeaturesV2
from game_ocr.regex_priors import load_regex_priors
from game_ocr.screen_classifier import (
    ScreenClassifier,
    ScreenClassifierV2,
    ScreenClassifierV2Weights,
    _V2_FIXED_DIMS,
    feature_vector_v2,
    load_screen_classifier,
    train_screen_classifier_v2,
)
from game_ocr.state_machine import load_state_machine


# Use the v1 state machine for these tests — same shape, decoder_version="v1".
# When v2 weights are constructed here, we override decoder_version to v2 manually
# (we're testing the trainer/loader, not the YAML's decoder field).
SM = load_state_machine("nhl26-v1")
PRIORS = load_regex_priors("nhl26")


def _synthetic_features(*, top_prior_idx: int | None = None) -> FrameFeaturesV2:
    """Build a synthetic FrameFeaturesV2 with shape matching PRIORS.n_priors().

    `top_prior_idx`, if set, fires that single regex prior — useful for
    spreading per-state signal across the synthetic corpus.
    """
    n = PRIORS.n_priors()
    prior_flags = np.zeros(n, dtype=np.float64)
    if top_prior_idx is not None:
        prior_flags[top_prior_idx] = 1.0
    return FrameFeaturesV2(
        full_frame_hsv=np.ones(48, dtype=np.float64) / 48,
        quadrant_hsvs=tuple(np.ones(48, dtype=np.float64) / 48 for _ in range(4)),
        quadrant_brightness=np.array([0.5, 0.5, 0.5, 0.5], dtype=np.float64),
        quadrant_blur=np.array([10.0, 10.0, 10.0, 10.0], dtype=np.float64),
        quadrant_edge_density=np.array([0.1, 0.1, 0.1, 0.1], dtype=np.float64),
        regex_prior_flags=prior_flags,
        ocr_presence_flags=np.array([1.0, 0.0, 0.0], dtype=np.float64),
        top_bar_text="",
        side_strip_text="",
    )


class TestFeatureVectorV2(unittest.TestCase):
    def test_shape_matches_fixed_plus_priors(self) -> None:
        f = _synthetic_features()
        v = feature_vector_v2(f, SM, n_priors=PRIORS.n_priors())
        self.assertEqual(v.shape, (_V2_FIXED_DIMS + PRIORS.n_priors(),))

    def test_log1p_applied_to_blur(self) -> None:
        f = _synthetic_features()
        v = feature_vector_v2(f, SM, n_priors=PRIORS.n_priors())
        # quadrant_blur occupies dims 48 + 192 + 4 .. 48 + 192 + 4 + 4
        start = 48 + 192 + 4
        np.testing.assert_allclose(v[start:start + 4], np.log1p(10.0))

    def test_raises_on_priors_mismatch(self) -> None:
        f = _synthetic_features()
        with self.assertRaises(ValueError):
            feature_vector_v2(f, SM, n_priors=PRIORS.n_priors() + 5)

    def test_prior_flag_position_matches_priors_flat_order(self) -> None:
        # Firing prior i should land at fixed_dims_so_far + i in the vector.
        n = PRIORS.n_priors()
        f = _synthetic_features(top_prior_idx=3)
        v = feature_vector_v2(f, SM, n_priors=n)
        # Priors block starts at 48 + 192 + 4 + 4 + 4 = 252.
        priors_block_start = 48 + 4 * 48 + 4 + 4 + 4
        self.assertEqual(v[priors_block_start + 3], 1.0)
        # All other prior positions are zero.
        priors_block = v[priors_block_start:priors_block_start + n]
        self.assertEqual(float(priors_block.sum()), 1.0)


class TestScreenClassifierV2Constructor(unittest.TestCase):
    def _make_weights(
        self,
        *,
        decoder_version: str = "hmm-viterbi-v1",
        n_priors: int = None,
    ) -> ScreenClassifierV2Weights:
        if n_priors is None:
            n_priors = PRIORS.n_priors()
        cols = _V2_FIXED_DIMS + n_priors
        n_classes = len(SM.states)
        return ScreenClassifierV2Weights(
            version=SM.version,
            decoder_version=decoder_version,
            classes=SM.states,
            n_priors=n_priors,
            intercept=np.zeros(n_classes, dtype=np.float64),
            coef=np.zeros((n_classes, cols), dtype=np.float64),
        )

    def test_decoder_version_mismatch_raises(self) -> None:
        weights = self._make_weights(decoder_version="hmm-viterbi-v2")
        with self.assertRaises(ValueError):
            ScreenClassifierV2(weights, SM)  # SM is v1

    def test_n_priors_coef_shape_mismatch_raises(self) -> None:
        # n_priors says 5 but coef cols imply different.
        n_classes = len(SM.states)
        bogus = ScreenClassifierV2Weights(
            version=SM.version,
            decoder_version=SM.decoder_version,
            classes=SM.states,
            n_priors=5,
            intercept=np.zeros(n_classes, dtype=np.float64),
            coef=np.zeros((n_classes, _V2_FIXED_DIMS + 99), dtype=np.float64),
        )
        with self.assertRaises(ValueError):
            ScreenClassifierV2(bogus, SM)


class TestTrainScreenClassifierV2(unittest.TestCase):
    def _synthetic_corpus(self, per_class: int = 2):
        """Generate per_class features per state, all distinct via the firing
        prior index — gives sklearn enough signal to fit something.
        """
        features = []
        labels = []
        for class_idx, state in enumerate(SM.states):
            for _ in range(per_class):
                # Tie a single prior to each class so the LR can learn.
                features.append(_synthetic_features(top_prior_idx=class_idx % PRIORS.n_priors()))
                labels.append(state)
        return features, labels

    def test_trains_and_predicts(self) -> None:
        features, labels = self._synthetic_corpus()
        clf = train_screen_classifier_v2(features, labels, SM, PRIORS, allow_missing_states=False)
        self.assertIsInstance(clf, ScreenClassifierV2)
        logp = clf.predict_log_probs(features[0])
        self.assertEqual(logp.shape, (len(SM.states),))

    def test_round_trip_save_load(self) -> None:
        features, labels = self._synthetic_corpus()
        clf = train_screen_classifier_v2(features, labels, SM, PRIORS, allow_missing_states=False)
        before = clf.predict_log_probs(features[0])

        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "weights.json"
            clf.save(path)
            loaded = load_screen_classifier(path, SM)
            self.assertIsInstance(loaded, ScreenClassifierV2)
            after = loaded.predict_log_probs(features[0])
            np.testing.assert_allclose(before, after)

    def test_save_writes_schema_version_2(self) -> None:
        features, labels = self._synthetic_corpus()
        clf = train_screen_classifier_v2(features, labels, SM, PRIORS, allow_missing_states=False)
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "weights.json"
            clf.save(path)
            raw = json.loads(path.read_text())
            self.assertEqual(raw["schema_version"], 2)
            self.assertEqual(raw["n_priors"], PRIORS.n_priors())


class TestLoadScreenClassifierDispatch(unittest.TestCase):
    """The single entry point dispatches based on schema_version."""

    def test_loads_v1_weights_as_screen_classifier(self) -> None:
        v1_path = (
            Path(__file__).resolve().parents[1]
            / "game_ocr" / "weights" / "nhl26-screen-classifier-v1.json"
        )
        clf = load_screen_classifier(v1_path, SM)
        self.assertIsInstance(clf, ScreenClassifier)
        self.assertNotIsInstance(clf, ScreenClassifierV2)

    def test_unsupported_schema_version_raises(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "bogus.json"
            path.write_text(json.dumps({"schema_version": 99}))
            with self.assertRaises(ValueError):
                load_screen_classifier(path, SM)


if __name__ == "__main__":
    unittest.main()
