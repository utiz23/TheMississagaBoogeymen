"""Lock the additive `n_prefilter_features` extension to the v2 classifier.

Verifies:
  - FrameFeaturesV2 constructs with a zero-length `prefilter_features` by
    default (so legacy callers like `compute_frame_features_v2` are unchanged).
  - feature_vector_v2 with default n_prefilter_features=0 produces the legacy
    255+n_priors length and content.
  - feature_vector_v2 with n_prefilter_features=K appends K floats from
    `features.prefilter_features` at the tail of the vector.
  - feature_vector_v2 raises on prefilter_features shape mismatch.
  - ScreenClassifierV2Weights defaults n_prefilter_features=0.
  - ScreenClassifierV2.__init__ validates
    coef.shape[1] == _V2_FIXED_DIMS + n_priors + n_prefilter_features.
  - Legacy JSON weights (no `n_prefilter_features` key) load with the field
    defaulted to 0; validation continues to work.
  - Round-trip: train with n_prefilter_features>0 → save → load preserves the
    field and predict_log_probs matches bit-identical.
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
    ScreenClassifierV2,
    ScreenClassifierV2Weights,
    _V2_FIXED_DIMS,
    _load_v2,
    feature_vector_v2,
    train_screen_classifier_v2,
)
from game_ocr.state_machine import load_state_machine


SM = load_state_machine("nhl26-v1")
PRIORS = load_regex_priors("nhl26")


def _features(*, n_prefilter: int = 0, prior_idx: int | None = None) -> FrameFeaturesV2:
    n_priors = PRIORS.n_priors()
    prior_flags = np.zeros(n_priors, dtype=np.float64)
    if prior_idx is not None:
        prior_flags[prior_idx] = 1.0
    prefilter = (
        np.arange(n_prefilter, dtype=np.float64) * 0.1
        if n_prefilter > 0
        else np.zeros(0, dtype=np.float64)
    )
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
        prefilter_features=prefilter,
    )


class TestFrameFeaturesV2Default(unittest.TestCase):
    def test_default_prefilter_features_is_empty(self) -> None:
        f = FrameFeaturesV2(
            full_frame_hsv=np.ones(48, dtype=np.float64) / 48,
            quadrant_hsvs=tuple(np.ones(48, dtype=np.float64) / 48 for _ in range(4)),
            quadrant_brightness=np.zeros(4, dtype=np.float64),
            quadrant_blur=np.zeros(4, dtype=np.float64),
            quadrant_edge_density=np.zeros(4, dtype=np.float64),
            regex_prior_flags=np.zeros(PRIORS.n_priors(), dtype=np.float64),
            ocr_presence_flags=np.zeros(3, dtype=np.float64),
            top_bar_text="",
            side_strip_text="",
        )
        self.assertEqual(f.prefilter_features.shape, (0,))
        self.assertEqual(f.prefilter_features.dtype, np.float64)


class TestFeatureVectorV2BackwardCompat(unittest.TestCase):
    def test_default_n_prefilter_features_preserves_legacy_length(self) -> None:
        f = _features()
        v = feature_vector_v2(f, SM, n_priors=PRIORS.n_priors())
        self.assertEqual(v.shape, (_V2_FIXED_DIMS + PRIORS.n_priors(),))

    def test_default_kwarg_validates_empty_prefilter_features(self) -> None:
        # Legacy callers leave n_prefilter_features at the default 0; features
        # carry an empty prefilter_features → no validation error.
        f = _features()
        feature_vector_v2(f, SM, n_priors=PRIORS.n_priors())


class TestFeatureVectorV2NewLayout(unittest.TestCase):
    def test_appends_prefilter_features_at_end(self) -> None:
        n_pref = 5
        f = _features(n_prefilter=n_pref)
        v = feature_vector_v2(
            f, SM, n_priors=PRIORS.n_priors(), n_prefilter_features=n_pref,
        )
        expected_total = _V2_FIXED_DIMS + PRIORS.n_priors() + n_pref
        self.assertEqual(v.shape, (expected_total,))
        np.testing.assert_allclose(v[-n_pref:], f.prefilter_features)

    def test_layout_preserved_before_prefilter_segment(self) -> None:
        # The new segment must not perturb any prior offset. Compare the
        # n_pref=0 vector to the head of the n_pref=K vector.
        n_pref = 3
        f0 = _features(n_prefilter=0, prior_idx=2)
        fk = _features(n_prefilter=n_pref, prior_idx=2)
        v0 = feature_vector_v2(f0, SM, n_priors=PRIORS.n_priors())
        vk = feature_vector_v2(
            fk, SM, n_priors=PRIORS.n_priors(), n_prefilter_features=n_pref,
        )
        np.testing.assert_allclose(vk[: v0.shape[0]], v0)

    def test_raises_on_prefilter_shape_mismatch(self) -> None:
        f = _features(n_prefilter=3)
        with self.assertRaises(ValueError):
            feature_vector_v2(
                f, SM, n_priors=PRIORS.n_priors(), n_prefilter_features=5,
            )

    def test_raises_on_features_carrying_unexpected_prefilter(self) -> None:
        # Features have prefilter but caller forgot the kwarg → mismatch.
        f = _features(n_prefilter=3)
        with self.assertRaises(ValueError):
            feature_vector_v2(f, SM, n_priors=PRIORS.n_priors())


class TestScreenClassifierV2WeightsDefault(unittest.TestCase):
    def test_default_n_prefilter_features_is_zero(self) -> None:
        n_classes = len(SM.states)
        n_priors = PRIORS.n_priors()
        weights = ScreenClassifierV2Weights(
            version=SM.version,
            decoder_version=SM.decoder_version,
            classes=SM.states,
            n_priors=n_priors,
            intercept=np.zeros(n_classes, dtype=np.float64),
            coef=np.zeros((n_classes, _V2_FIXED_DIMS + n_priors), dtype=np.float64),
        )
        self.assertEqual(weights.n_prefilter_features, 0)
        # Should construct without error using the existing expected_cols.
        ScreenClassifierV2(weights, SM)


class TestScreenClassifierV2ConstructorExpectedCols(unittest.TestCase):
    def _weights(self, n_pref: int, coef_cols: int) -> ScreenClassifierV2Weights:
        n_classes = len(SM.states)
        return ScreenClassifierV2Weights(
            version=SM.version,
            decoder_version=SM.decoder_version,
            classes=SM.states,
            n_priors=PRIORS.n_priors(),
            intercept=np.zeros(n_classes, dtype=np.float64),
            coef=np.zeros((n_classes, coef_cols), dtype=np.float64),
            n_prefilter_features=n_pref,
        )

    def test_accepts_new_layout(self) -> None:
        n_pref = 4
        weights = self._weights(
            n_pref=n_pref,
            coef_cols=_V2_FIXED_DIMS + PRIORS.n_priors() + n_pref,
        )
        ScreenClassifierV2(weights, SM)  # no raise

    def test_rejects_legacy_cols_when_n_pref_positive(self) -> None:
        weights = self._weights(
            n_pref=4,
            coef_cols=_V2_FIXED_DIMS + PRIORS.n_priors(),  # missing 4 cols
        )
        with self.assertRaises(ValueError):
            ScreenClassifierV2(weights, SM)


class TestLegacyWeightsLoad(unittest.TestCase):
    """Old weights files have no `n_prefilter_features` key. Loading must
    default to 0 and continue to validate against the legacy expected_cols."""

    def test_legacy_payload_defaults_n_pref_to_zero(self) -> None:
        n_classes = len(SM.states)
        n_priors = PRIORS.n_priors()
        legacy_payload = {
            "schema_version": 2,
            "version": SM.version,
            "decoder_version": SM.decoder_version,
            "classes": list(SM.states),
            "n_priors": n_priors,
            "intercept": np.zeros(n_classes, dtype=np.float64).tolist(),
            "coef": np.zeros(
                (n_classes, _V2_FIXED_DIMS + n_priors), dtype=np.float64
            ).tolist(),
            # NOTE: no `n_prefilter_features` key.
        }
        clf = _load_v2(legacy_payload, SM)
        self.assertEqual(clf.weights.n_prefilter_features, 0)


class TestRoundTripWithNPref(unittest.TestCase):
    """train_screen_classifier_v2 with n_prefilter_features>0 → save → load
    preserves the field and predict_log_probs matches."""

    def _corpus(self, *, n_pref: int, per_class: int = 2):
        features = []
        labels = []
        n_priors = PRIORS.n_priors()
        for class_idx, state in enumerate(SM.states):
            for _ in range(per_class):
                features.append(
                    _features(
                        n_prefilter=n_pref,
                        prior_idx=class_idx % n_priors,
                    )
                )
                labels.append(state)
        return features, labels

    def test_round_trip(self) -> None:
        n_pref = 3
        features, labels = self._corpus(n_pref=n_pref)
        clf = train_screen_classifier_v2(
            features, labels, SM, PRIORS,
            allow_missing_states=False,
            n_prefilter_features=n_pref,
        )
        self.assertEqual(clf.weights.n_prefilter_features, n_pref)
        self.assertEqual(
            clf.weights.coef.shape[1],
            _V2_FIXED_DIMS + PRIORS.n_priors() + n_pref,
        )

        before = clf.predict_log_probs(features[0])

        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "weights.json"
            clf.save(path)
            raw = json.loads(path.read_text())
            self.assertEqual(raw["n_prefilter_features"], n_pref)

            from game_ocr.screen_classifier import load_screen_classifier
            loaded = load_screen_classifier(path, SM)
            self.assertEqual(loaded.weights.n_prefilter_features, n_pref)
            after = loaded.predict_log_probs(features[0])
            np.testing.assert_allclose(before, after)


if __name__ == "__main__":
    unittest.main()
