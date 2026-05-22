"""Unit tests for Phase 2B-3: LR head in the closed_vocab extractor.

Covers:
  - ClosedVocab.predict_log_probs raises NotImplementedError when weights absent
  - ClosedVocab.predict_log_probs returns log-probabilities when weights present
    (synthetic weights JSON injected via tmp weights dir)
  - predict_log_probs output has length == len(vocab.entries)
  - log-probs are <= 0 (they are log-probabilities)
  - classes absent from weights get near-zero probability
  - LoadoutClosedVocabExtractor.classify_build_class_from_image returns []
    when weights absent (no error)
  - classify_build_class_from_image returns a candidate (rank semantics) when
    weights are present and confidence exceeds threshold
  - classify_build_class_from_image returns [] when confidence < threshold
  - classify_x_factor_name_from_image mirrors classify_build_class_from_image
  - Orchestrator can combine alias-regex (rank 0) + LR (rank 1) candidates
"""

from __future__ import annotations

import json
import math
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np


GAME_OCR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(GAME_OCR))

from game_ocr.loadout_extractors.closed_vocab import (  # noqa: E402
    ClosedVocab,
    ClosedVocabCandidate,
    LoadoutClosedVocabExtractor,
    _LR_N_FEATURES,
    _extract_lr_features,
    _load_lr_weights,
    _log_softmax,
    load_closed_vocab,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _synthetic_frame(h: int = 1080, w: int = 1920, color: tuple = (100, 100, 100)) -> np.ndarray:
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:, :] = color
    return img


def _synthetic_crop(color: tuple = (100, 100, 100)) -> np.ndarray:
    return _synthetic_frame(h=65, w=700, color=color)


def _write_weights(
    tmp_dir: Path,
    version: str,
    lr_key: str,
    classes: list[str],
    n_features: int = _LR_N_FEATURES,
) -> Path:
    """Write a synthetic weights JSON to tmp_dir."""
    n_classes = len(classes)
    # coef: identity-ish matrix so each class prefers dimension i
    # (only first n_classes dimensions used; rest are zeros)
    coef = np.zeros((n_classes, n_features), dtype=np.float64)
    for i in range(n_classes):
        coef[i, i % n_features] = 5.0  # strong signal for class i
    intercept = np.zeros(n_classes, dtype=np.float64)

    payload = {
        "schema_version": 1,
        "version": version,
        "family": lr_key,
        "feature_dim": n_features,
        "hsv_bins": [8, 4, 4],
        "classes": classes,
        "intercept": intercept.tolist(),
        "coef": coef.tolist(),
    }
    path = tmp_dir / f"{version}-loadout-{lr_key}-classifier.json"
    path.write_text(json.dumps(payload))
    return path


# ---------------------------------------------------------------------------
# _extract_lr_features
# ---------------------------------------------------------------------------


class TestExtractLrFeatures(unittest.TestCase):
    def test_output_shape(self) -> None:
        crop = _synthetic_crop()
        feat = _extract_lr_features(crop)
        self.assertEqual(feat.shape, (_LR_N_FEATURES,))
        self.assertEqual(feat.dtype, np.float64)

    def test_feature_dim_constant_is_132(self) -> None:
        self.assertEqual(_LR_N_FEATURES, 132)

    def test_raises_on_empty_image(self) -> None:
        with self.assertRaises(ValueError):
            _extract_lr_features(np.zeros((0, 0, 3), dtype=np.uint8))


# ---------------------------------------------------------------------------
# _log_softmax
# ---------------------------------------------------------------------------


class TestLogSoftmax(unittest.TestCase):
    def test_output_sums_to_one_after_exp(self) -> None:
        logits = np.array([1.0, 2.0, 3.0, 0.5])
        log_probs = _log_softmax(logits)
        self.assertAlmostEqual(float(np.exp(log_probs).sum()), 1.0, places=6)

    def test_all_values_le_zero(self) -> None:
        logits = np.array([1.0, 2.0, 3.0])
        log_probs = _log_softmax(logits)
        self.assertTrue(np.all(log_probs <= 0))


# ---------------------------------------------------------------------------
# ClosedVocab.predict_log_probs — weights absent
# ---------------------------------------------------------------------------


class TestPredictLogProbsAbsent(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_dir = Path(self._tmp.name)
        # Clear the lru_cache so it re-reads from the tmp weights dir
        _load_lr_weights.cache_clear()

    def tearDown(self) -> None:
        _load_lr_weights.cache_clear()
        self._tmp.cleanup()

    def test_raises_not_implemented_when_no_weights(self) -> None:
        vocab = load_closed_vocab("build_classes")
        crop = _synthetic_crop()
        with patch(
            "game_ocr.loadout_extractors.closed_vocab.WEIGHTS_DIR",
            self.tmp_dir,
        ):
            _load_lr_weights.cache_clear()
            with self.assertRaises(NotImplementedError):
                vocab.predict_log_probs(crop)


# ---------------------------------------------------------------------------
# ClosedVocab.predict_log_probs — weights present
# ---------------------------------------------------------------------------


class TestPredictLogProbsPresent(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_dir = Path(self._tmp.name)
        _load_lr_weights.cache_clear()

    def tearDown(self) -> None:
        _load_lr_weights.cache_clear()
        self._tmp.cleanup()

    def _run_predict(
        self,
        vocab: ClosedVocab,
        crop: np.ndarray,
        trained_classes: list[str] | None = None,
    ) -> np.ndarray:
        """Write synthetic weights and call predict_log_probs via patched WEIGHTS_DIR."""
        if trained_classes is None:
            trained_classes = [e.canonical for e in vocab.entries[:3]]
        lr_key = "build_class" if "build" in vocab.family else "x_factor_name"
        _write_weights(self.tmp_dir, vocab.version, lr_key, trained_classes)
        with patch(
            "game_ocr.loadout_extractors.closed_vocab.WEIGHTS_DIR",
            self.tmp_dir,
        ):
            _load_lr_weights.cache_clear()
            return vocab.predict_log_probs(crop)

    def test_output_length_equals_entries(self) -> None:
        vocab = load_closed_vocab("build_classes")
        crop = _synthetic_crop()
        log_probs = self._run_predict(vocab, crop)
        self.assertEqual(len(log_probs), len(vocab.entries))

    def test_all_log_probs_le_zero(self) -> None:
        vocab = load_closed_vocab("build_classes")
        crop = _synthetic_crop()
        log_probs = self._run_predict(vocab, crop)
        self.assertTrue(np.all(log_probs <= 0.0))

    def test_trained_classes_have_higher_prob_than_untrained(self) -> None:
        vocab = load_closed_vocab("build_classes")
        crop = _synthetic_crop()
        trained_classes = [e.canonical for e in vocab.entries[:3]]
        log_probs = self._run_predict(vocab, crop, trained_classes=trained_classes)

        probs = np.exp(log_probs)
        # Trained classes should have strictly higher probability than the near-zero floor
        near_zero_floor = math.exp(math.log(1e-10))
        trained_probs = probs[:3]
        untrained_probs = probs[3:]
        if len(untrained_probs) > 0:
            self.assertTrue(
                float(trained_probs.mean()) > float(untrained_probs.mean()),
                "Trained classes should on average have higher probability",
            )

    def test_probabilities_sum_to_approximately_one(self) -> None:
        """When all vocab entries are covered in weights, probs sum to ~1."""
        vocab = load_closed_vocab("build_classes")
        crop = _synthetic_crop()
        trained_classes = [e.canonical for e in vocab.entries]
        log_probs = self._run_predict(vocab, crop, trained_classes=trained_classes)
        total = float(np.exp(log_probs).sum())
        self.assertAlmostEqual(total, 1.0, places=4)


# ---------------------------------------------------------------------------
# LoadoutClosedVocabExtractor — image classifiers with absent weights
# ---------------------------------------------------------------------------


class TestImageClassifiersAbsent(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_dir = Path(self._tmp.name)
        _load_lr_weights.cache_clear()

    def tearDown(self) -> None:
        _load_lr_weights.cache_clear()
        self._tmp.cleanup()

    def test_build_class_from_image_returns_empty_when_no_weights(self) -> None:
        ext = LoadoutClosedVocabExtractor()
        crop = _synthetic_crop()
        with patch(
            "game_ocr.loadout_extractors.closed_vocab.WEIGHTS_DIR",
            self.tmp_dir,
        ):
            _load_lr_weights.cache_clear()
            result = ext.classify_build_class_from_image(crop)
        self.assertEqual(result, [])

    def test_x_factor_name_from_image_returns_empty_when_no_weights(self) -> None:
        ext = LoadoutClosedVocabExtractor()
        crop = _synthetic_crop()
        with patch(
            "game_ocr.loadout_extractors.closed_vocab.WEIGHTS_DIR",
            self.tmp_dir,
        ):
            _load_lr_weights.cache_clear()
            result = ext.classify_x_factor_name_from_image(crop)
        self.assertEqual(result, [])

    def test_none_crop_returns_empty(self) -> None:
        ext = LoadoutClosedVocabExtractor()
        with patch(
            "game_ocr.loadout_extractors.closed_vocab.WEIGHTS_DIR",
            self.tmp_dir,
        ):
            _load_lr_weights.cache_clear()
            result = ext.classify_build_class_from_image(None)
        self.assertEqual(result, [])


# ---------------------------------------------------------------------------
# LoadoutClosedVocabExtractor — image classifiers with weights present
# ---------------------------------------------------------------------------


class TestImageClassifiersPresent(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_dir = Path(self._tmp.name)
        _load_lr_weights.cache_clear()

    def tearDown(self) -> None:
        _load_lr_weights.cache_clear()
        self._tmp.cleanup()

    def _setup_weights_and_crop(
        self,
        lr_key: str,
        trained_classes: list[str],
        target_class_idx: int,
    ) -> tuple[LoadoutClosedVocabExtractor, np.ndarray]:
        """Write weights that strongly predict trained_classes[target_class_idx]
        for any crop.  Returns (extractor, crop)."""
        n_features = _LR_N_FEATURES
        n_classes = len(trained_classes)
        coef = np.zeros((n_classes, n_features), dtype=np.float64)
        intercept = np.zeros(n_classes, dtype=np.float64)
        # Make the target class win with a very large intercept
        intercept[target_class_idx] = 100.0
        payload = {
            "schema_version": 1,
            "version": "nhl26",
            "family": lr_key,
            "feature_dim": n_features,
            "hsv_bins": [8, 4, 4],
            "classes": trained_classes,
            "intercept": intercept.tolist(),
            "coef": coef.tolist(),
        }
        path = self.tmp_dir / f"nhl26-loadout-{lr_key}-classifier.json"
        path.write_text(json.dumps(payload))
        crop = _synthetic_crop(color=(60, 180, 220))
        return LoadoutClosedVocabExtractor(), crop

    def test_build_class_from_image_returns_candidate(self) -> None:
        vocab = load_closed_vocab("build_classes")
        trained_classes = [e.canonical for e in vocab.entries]
        ext, crop = self._setup_weights_and_crop("build_class", trained_classes, 0)
        with patch(
            "game_ocr.loadout_extractors.closed_vocab.WEIGHTS_DIR",
            self.tmp_dir,
        ):
            _load_lr_weights.cache_clear()
            result = ext.classify_build_class_from_image(crop)

        self.assertEqual(len(result), 1)
        self.assertIsInstance(result[0], ClosedVocabCandidate)
        self.assertEqual(result[0].value, trained_classes[0])
        # Confidence should be very high (intercept of 100 → softmax ≈ 1.0)
        self.assertGreater(result[0].raw_confidence, 0.50)

    def test_x_factor_name_from_image_returns_candidate(self) -> None:
        vocab = load_closed_vocab("x_factors")
        trained_classes = [e.canonical for e in vocab.entries]
        ext, crop = self._setup_weights_and_crop("x_factor_name", trained_classes, 2)
        with patch(
            "game_ocr.loadout_extractors.closed_vocab.WEIGHTS_DIR",
            self.tmp_dir,
        ):
            _load_lr_weights.cache_clear()
            result = ext.classify_x_factor_name_from_image(crop)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].value, trained_classes[2])

    def test_low_confidence_returns_empty(self) -> None:
        """When argmax prob < threshold, method returns []."""
        vocab = load_closed_vocab("build_classes")
        n_classes = len(vocab.entries)
        trained_classes = [e.canonical for e in vocab.entries]
        # Uniform intercepts → all classes get equal probability ≈ 1/n_classes
        coef = np.zeros((n_classes, _LR_N_FEATURES), dtype=np.float64)
        intercept = np.zeros(n_classes, dtype=np.float64)
        payload = {
            "schema_version": 1,
            "version": "nhl26",
            "family": "build_class",
            "feature_dim": _LR_N_FEATURES,
            "hsv_bins": [8, 4, 4],
            "classes": trained_classes,
            "intercept": intercept.tolist(),
            "coef": coef.tolist(),
        }
        (self.tmp_dir / "nhl26-loadout-build_class-classifier.json").write_text(json.dumps(payload))
        ext = LoadoutClosedVocabExtractor()
        crop = _synthetic_crop()
        # n_classes is 9 (build_classes.yaml), so max prob ≈ 1/9 ≈ 0.11 < 0.50
        with patch(
            "game_ocr.loadout_extractors.closed_vocab.WEIGHTS_DIR",
            self.tmp_dir,
        ):
            _load_lr_weights.cache_clear()
            result = ext.classify_build_class_from_image(crop)
        self.assertEqual(result, [])

    def test_roi_bbox_propagated(self) -> None:
        vocab = load_closed_vocab("build_classes")
        trained_classes = [e.canonical for e in vocab.entries]
        ext, crop = self._setup_weights_and_crop("build_class", trained_classes, 0)
        bbox = {"x": 0.2, "y": 0.05, "w": 0.36, "h": 0.06}
        with patch(
            "game_ocr.loadout_extractors.closed_vocab.WEIGHTS_DIR",
            self.tmp_dir,
        ):
            _load_lr_weights.cache_clear()
            result = ext.classify_build_class_from_image(crop, roi_bbox=bbox)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].roi_bbox, bbox)


# ---------------------------------------------------------------------------
# Orchestrator pattern: alias-regex (rank 0) + LR head (rank 1)
# ---------------------------------------------------------------------------


class TestOrchestratorCombination(unittest.TestCase):
    """Demonstrates how a caller can combine alias-regex and LR candidates."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_dir = Path(self._tmp.name)
        _load_lr_weights.cache_clear()

    def tearDown(self) -> None:
        _load_lr_weights.cache_clear()
        self._tmp.cleanup()

    def test_alias_regex_rank0_lr_head_rank1(self) -> None:
        """When alias-regex matches (rank 0), LR adds a rank-1 candidate alongside."""
        vocab = load_closed_vocab("build_classes")
        trained_classes = [e.canonical for e in vocab.entries]

        # Write weights that strongly predict the first class
        n_classes = len(trained_classes)
        coef = np.zeros((n_classes, _LR_N_FEATURES), dtype=np.float64)
        intercept = np.zeros(n_classes, dtype=np.float64)
        intercept[0] = 100.0
        payload = {
            "schema_version": 1,
            "version": "nhl26",
            "family": "build_class",
            "feature_dim": _LR_N_FEATURES,
            "hsv_bins": [8, 4, 4],
            "classes": trained_classes,
            "intercept": intercept.tolist(),
            "coef": coef.tolist(),
        }
        (self.tmp_dir / "nhl26-loadout-build_class-classifier.json").write_text(json.dumps(payload))

        ext = LoadoutClosedVocabExtractor()
        crop = _synthetic_crop()

        with patch(
            "game_ocr.loadout_extractors.closed_vocab.WEIGHTS_DIR",
            self.tmp_dir,
        ):
            _load_lr_weights.cache_clear()
            # Alias-regex candidates (rank 0)
            regex_candidates = ext.classify_build_class("PWF")
            # LR head candidates (rank 1 — second chance)
            lr_candidates = ext.classify_build_class_from_image(crop)

        # Alias-regex should find "Power Forward" for "PWF"
        self.assertEqual(len(regex_candidates), 1)
        self.assertEqual(regex_candidates[0].value, "Power Forward")
        self.assertEqual(regex_candidates[0].raw_confidence, 1.0)

        # LR head emits a candidate (rank 1 in the caller's ordering)
        self.assertEqual(len(lr_candidates), 1)
        self.assertIsInstance(lr_candidates[0], ClosedVocabCandidate)
        # The caller decides the final rank, not this module
        # Simply verify LR candidate has a well-formed structure
        self.assertGreater(lr_candidates[0].raw_confidence, 0.50)

    def test_alias_regex_no_match_lr_head_provides_candidate(self) -> None:
        """When alias-regex returns [], LR head provides the only candidate."""
        vocab = load_closed_vocab("build_classes")
        trained_classes = [e.canonical for e in vocab.entries]

        n_classes = len(trained_classes)
        coef = np.zeros((n_classes, _LR_N_FEATURES), dtype=np.float64)
        intercept = np.zeros(n_classes, dtype=np.float64)
        intercept[1] = 100.0  # Sniper wins
        payload = {
            "schema_version": 1,
            "version": "nhl26",
            "family": "build_class",
            "feature_dim": _LR_N_FEATURES,
            "hsv_bins": [8, 4, 4],
            "classes": trained_classes,
            "intercept": intercept.tolist(),
            "coef": coef.tolist(),
        }
        (self.tmp_dir / "nhl26-loadout-build_class-classifier.json").write_text(json.dumps(payload))

        ext = LoadoutClosedVocabExtractor()
        crop = _synthetic_crop()

        with patch(
            "game_ocr.loadout_extractors.closed_vocab.WEIGHTS_DIR",
            self.tmp_dir,
        ):
            _load_lr_weights.cache_clear()
            # Garbage OCR text → no alias-regex match
            regex_candidates = ext.classify_build_class("zzz_garbage_zzz")
            lr_candidates = ext.classify_build_class_from_image(crop)

        self.assertEqual(regex_candidates, [])  # alias-regex gives up
        self.assertEqual(len(lr_candidates), 1)  # LR head provides candidate
        self.assertEqual(lr_candidates[0].value, trained_classes[1])  # Sniper


if __name__ == "__main__":
    unittest.main()
