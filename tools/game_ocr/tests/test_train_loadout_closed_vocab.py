"""Unit tests for Phase 2B-2 train_loadout_closed_vocab.

Covers:
  - extract_crop_features: correct output shape (132-d), normalized HSV
    histogram sums to ≤1, handles various crop sizes
  - load_corpus: discovers labeled crops by class, filters sparse classes,
    handles missing corpus root gracefully
  - train_family: fits successfully on synthetic 5-class × 3-example corpus;
    JSON weights file has correct schema (classes, coef shape, intercept shape);
    --evaluate returns without error; sparse corpus exits cleanly
  - binary LR expansion: 2-class corpus produces coef shape (2, n_features)

Does NOT test against real weights or real corpus images.
"""

from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np


GAME_OCR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(GAME_OCR))

from scripts.train_loadout_closed_vocab import (  # noqa: E402
    MIN_EXAMPLES_PER_CLASS,
    _N_FEATURES,
    _parse_crop_match_id,
    extract_crop_features,
    load_corpus,
    train_family,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _synthetic_crop(h: int = 65, w: int = 700, color_bgr: tuple = (80, 120, 200)) -> np.ndarray:
    """Create a solid-color BGR crop."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:, :] = color_bgr
    return img


def _write_crops(corpus_root: Path, family: str, class_name: str, n: int, color_bgr: tuple) -> None:
    """Write `n` synthetic PNG crops for the given class."""
    class_dir = corpus_root / family / class_name
    class_dir.mkdir(parents=True, exist_ok=True)
    for i in range(n):
        img = _synthetic_crop(color_bgr=color_bgr)
        cv2.imwrite(str(class_dir / f"crop_{i:03d}_title_bar.png"), img)


def _write_named_crop(corpus_root: Path, family: str, class_name: str, filename: str,
                      color_bgr: tuple = (80, 120, 200)) -> None:
    """Write a single synthetic PNG crop under an explicit filename.

    Used by the leakage-guard tests to control the ``m<id>_`` provenance prefix.
    """
    class_dir = corpus_root / family / class_name
    class_dir.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(class_dir / filename), _synthetic_crop(color_bgr=color_bgr))


def _write_manifest(path: Path, held_out: list[int]) -> None:
    """Write a minimal benchmark manifest with the given held-out split."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"schema_version": 1, "splits": {"held_out": held_out}}))


# ---------------------------------------------------------------------------
# extract_crop_features
# ---------------------------------------------------------------------------


class TestExtractCropFeatures(unittest.TestCase):
    def test_output_shape(self) -> None:
        crop = _synthetic_crop()
        feat = extract_crop_features(crop)
        self.assertEqual(feat.shape, (_N_FEATURES,))
        self.assertEqual(feat.dtype, np.float64)

    def test_feature_dim_is_132(self) -> None:
        # 8 × 4 × 4 HSV bins = 128, plus 4 scalars = 132
        self.assertEqual(_N_FEATURES, 132)

    def test_hsv_histogram_sums_to_one(self) -> None:
        crop = _synthetic_crop()
        feat = extract_crop_features(crop)
        hist_sum = feat[:128].sum()
        self.assertAlmostEqual(hist_sum, 1.0, places=6)

    def test_handles_various_crop_sizes(self) -> None:
        for h, w in [(65, 700), (60, 400), (100, 100), (30, 200)]:
            crop = np.random.randint(0, 255, (h, w, 3), dtype=np.uint8)
            feat = extract_crop_features(crop)
            self.assertEqual(feat.shape, (_N_FEATURES,))

    def test_aspect_ratio_feature(self) -> None:
        # Aspect ratio = w/h, stored at index 130
        crop = _synthetic_crop(h=64, w=128)
        feat = extract_crop_features(crop)
        self.assertAlmostEqual(feat[130], 2.0, places=3)

    def test_different_colors_produce_different_features(self) -> None:
        # Two very different colors should produce different HSV histograms
        blue = _synthetic_crop(color_bgr=(200, 0, 0))
        red = _synthetic_crop(color_bgr=(0, 0, 200))
        feat_blue = extract_crop_features(blue)
        feat_red = extract_crop_features(red)
        self.assertFalse(np.allclose(feat_blue[:128], feat_red[:128]))

    def test_raises_on_empty_image(self) -> None:
        with self.assertRaises(ValueError):
            extract_crop_features(np.zeros((0, 0, 3), dtype=np.uint8))


# ---------------------------------------------------------------------------
# load_corpus
# ---------------------------------------------------------------------------


class TestLoadCorpus(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.corpus_root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_missing_corpus_root_returns_empty(self) -> None:
        feats, labels = load_corpus("build_class", corpus_root=self.corpus_root / "does_not_exist")
        self.assertEqual(feats, [])
        self.assertEqual(labels, [])

    def test_empty_corpus_dir_returns_empty(self) -> None:
        (self.corpus_root / "build_class").mkdir()
        feats, labels = load_corpus("build_class", corpus_root=self.corpus_root)
        self.assertEqual(feats, [])
        self.assertEqual(labels, [])

    def test_sparse_class_is_excluded(self) -> None:
        # Class A: 1 example (< MIN_EXAMPLES_PER_CLASS) → excluded
        # Class B: 3 examples → included
        _write_crops(self.corpus_root, "build_class", "ClassA", 1, (0, 0, 200))
        _write_crops(self.corpus_root, "build_class", "ClassB", MIN_EXAMPLES_PER_CLASS, (200, 0, 0))
        feats, labels = load_corpus("build_class", corpus_root=self.corpus_root)
        self.assertNotIn("ClassA", labels)
        self.assertIn("ClassB", labels)

    def test_loads_multiple_classes(self) -> None:
        colors = [(0, 0, 200), (0, 200, 0), (200, 0, 0), (100, 100, 0), (0, 100, 100)]
        for i, color in enumerate(colors):
            _write_crops(self.corpus_root, "build_class", f"Class{i}", MIN_EXAMPLES_PER_CLASS, color)
        feats, labels = load_corpus("build_class", corpus_root=self.corpus_root)
        self.assertEqual(len(feats), len(labels))
        self.assertEqual(len(set(labels)), 5)
        self.assertEqual(len(feats), 5 * MIN_EXAMPLES_PER_CLASS)

    def test_feature_shape_from_corpus(self) -> None:
        _write_crops(self.corpus_root, "x_factor_name", "Wheels", MIN_EXAMPLES_PER_CLASS, (50, 150, 200))
        _write_crops(self.corpus_root, "x_factor_name", "Rocket", MIN_EXAMPLES_PER_CLASS, (200, 50, 50))
        feats, labels = load_corpus("x_factor_name", corpus_root=self.corpus_root)
        self.assertTrue(all(f.shape == (_N_FEATURES,) for f in feats))


# ---------------------------------------------------------------------------
# train_family
# ---------------------------------------------------------------------------


class TestTrainFamily(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.corpus_root = Path(self._tmp.name) / "crops"
        self.weights_dir = Path(self._tmp.name) / "weights"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _make_synthetic_corpus(self, family: str, n_classes: int = 5, n_per_class: int = 3) -> None:
        colors = [
            (200, 0, 0), (0, 200, 0), (0, 0, 200),
            (100, 100, 0), (0, 100, 100), (100, 0, 100),
        ]
        for i in range(n_classes):
            color = colors[i % len(colors)]
            # Vary the color slightly per example to avoid identical features
            _write_crops(self.corpus_root, family, f"ClassLabel{i}", n_per_class, color)

    def test_train_returns_path_on_success(self) -> None:
        self._make_synthetic_corpus("build_class", n_classes=5, n_per_class=MIN_EXAMPLES_PER_CLASS)
        result = train_family(
            "build_class",
            corpus_root=self.corpus_root,
            weights_dir=self.weights_dir,
        )
        self.assertIsNotNone(result)
        self.assertTrue(result.exists())

    def test_weights_json_schema(self) -> None:
        """JSON has schema_version, classes, coef (n_classes, n_features), intercept (n_classes,)."""
        self._make_synthetic_corpus("build_class", n_classes=5, n_per_class=MIN_EXAMPLES_PER_CLASS)
        result = train_family(
            "build_class",
            corpus_root=self.corpus_root,
            weights_dir=self.weights_dir,
        )
        data = json.loads(result.read_text())

        self.assertEqual(data["schema_version"], 1)
        self.assertEqual(data["family"], "build_class")
        self.assertIn("classes", data)
        self.assertIn("coef", data)
        self.assertIn("intercept", data)

        n_classes = len(data["classes"])
        coef = np.array(data["coef"])
        intercept = np.array(data["intercept"])
        self.assertEqual(coef.shape, (n_classes, _N_FEATURES))
        self.assertEqual(intercept.shape, (n_classes,))

    def test_all_five_classes_predictable_post_fit(self) -> None:
        """After fitting, the LR head must correctly predict at least training labels."""
        n_classes = 5
        # Use clearly distinct color hues to ensure the LR can separate them
        hues = [0, 30, 60, 90, 120]
        for i, hue in enumerate(hues):
            # Build a solid-hue image in HSV then convert to BGR
            hsv_img = np.zeros((65, 700, 3), dtype=np.uint8)
            hsv_img[:, :, 0] = hue  # H channel (0-179 in OpenCV)
            hsv_img[:, :, 1] = 200  # S channel
            hsv_img[:, :, 2] = 200  # V channel
            bgr_img = cv2.cvtColor(hsv_img, cv2.COLOR_HSV2BGR)
            class_dir = self.corpus_root / "x_factor_name" / f"XFactor{i}"
            class_dir.mkdir(parents=True, exist_ok=True)
            for j in range(MIN_EXAMPLES_PER_CLASS):
                cv2.imwrite(str(class_dir / f"crop_{j:03d}_xf_slot0.png"), bgr_img)

        result = train_family(
            "x_factor_name",
            corpus_root=self.corpus_root,
            weights_dir=self.weights_dir,
        )
        data = json.loads(result.read_text())
        coef = np.array(data["coef"])
        intercept = np.array(data["intercept"])
        class_names = data["classes"]

        # Run predict on one example of each class and verify argmax matches label
        from sklearn.preprocessing import LabelEncoder
        le = LabelEncoder()
        le.fit(class_names)

        for i, hue in enumerate(hues):
            hsv_test = np.zeros((65, 700, 3), dtype=np.uint8)
            hsv_test[:, :, 0] = hue
            hsv_test[:, :, 1] = 200
            hsv_test[:, :, 2] = 200
            bgr_test = cv2.cvtColor(hsv_test, cv2.COLOR_HSV2BGR)
            feat = extract_crop_features(bgr_test)
            logits = coef @ feat + intercept
            pred_idx = int(np.argmax(logits))
            pred_class = class_names[pred_idx]
            expected = f"XFactor{i}"
            self.assertEqual(
                pred_class, expected,
                f"class {expected}: predicted {pred_class!r} instead",
            )

    def test_evaluate_does_not_raise(self) -> None:
        self._make_synthetic_corpus("build_class", n_classes=5, n_per_class=MIN_EXAMPLES_PER_CLASS)
        result = train_family(
            "build_class",
            corpus_root=self.corpus_root,
            weights_dir=self.weights_dir,
            evaluate=True,
        )
        self.assertIsNotNone(result)

    def test_empty_corpus_returns_none(self) -> None:
        result = train_family(
            "build_class",
            corpus_root=self.corpus_root,
            weights_dir=self.weights_dir,
        )
        self.assertIsNone(result)

    def test_single_class_returns_none(self) -> None:
        _write_crops(self.corpus_root, "build_class", "OnlyClass", MIN_EXAMPLES_PER_CLASS, (100, 100, 100))
        result = train_family(
            "build_class",
            corpus_root=self.corpus_root,
            weights_dir=self.weights_dir,
        )
        self.assertIsNone(result)

    def test_binary_coef_expanded_to_n_classes_rows(self) -> None:
        """2-class corpus → sklearn binary LR → coef expanded to (2, n_features)."""
        for i, color in enumerate([(200, 0, 0), (0, 0, 200)]):
            _write_crops(self.corpus_root, "build_class", f"BinClass{i}", MIN_EXAMPLES_PER_CLASS, color)
        result = train_family(
            "build_class",
            corpus_root=self.corpus_root,
            weights_dir=self.weights_dir,
        )
        data = json.loads(result.read_text())
        coef = np.array(data["coef"])
        intercept = np.array(data["intercept"])
        self.assertEqual(coef.shape, (2, _N_FEATURES))
        self.assertEqual(intercept.shape, (2,))

    def test_version_key_in_filename(self) -> None:
        self._make_synthetic_corpus("build_class", n_classes=3, n_per_class=MIN_EXAMPLES_PER_CLASS)
        result = train_family(
            "build_class",
            version="nhl26",
            corpus_root=self.corpus_root,
            weights_dir=self.weights_dir,
        )
        self.assertIsNotNone(result)
        self.assertEqual(result.name, "nhl26-loadout-build_class-classifier.json")


# ---------------------------------------------------------------------------
# Deliverable 1 — CV report persistence
# ---------------------------------------------------------------------------


class TestCvReport(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.corpus_root = Path(self._tmp.name) / "crops"
        self.weights_dir = Path(self._tmp.name) / "weights"
        self.report_dir = Path(self._tmp.name) / "reports"
        colors = [(200, 0, 0), (0, 200, 0), (0, 0, 200), (100, 100, 0), (0, 100, 100)]
        for i, color in enumerate(colors):
            _write_crops(self.corpus_root, "build_class", f"Class{i}", MIN_EXAMPLES_PER_CLASS, color)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_cv_report_written_with_schema(self) -> None:
        train_family(
            "build_class",
            corpus_root=self.corpus_root,
            weights_dir=self.weights_dir,
            evaluate=True,
            cv_report_path=self.report_dir,
        )
        report_file = self.report_dir / "cv-nhl26-build_class.json"
        self.assertTrue(report_file.exists(), f"expected CV report at {report_file}")
        data = json.loads(report_file.read_text())

        for key in (
            "schema_version", "version", "family", "n_examples", "n_classes",
            "min_class_size", "class_counts", "k_folds", "fold_accuracies",
            "mean_cv_accuracy", "note",
        ):
            self.assertIn(key, data, f"missing key {key!r}")

        self.assertEqual(data["schema_version"], 1)
        self.assertEqual(data["version"], "nhl26")
        self.assertEqual(data["family"], "build_class")
        self.assertEqual(data["n_examples"], 5 * MIN_EXAMPLES_PER_CLASS)
        self.assertEqual(data["n_classes"], 5)
        self.assertEqual(sum(data["class_counts"].values()), data["n_examples"])

    def test_mean_cv_accuracy_in_unit_interval(self) -> None:
        train_family(
            "build_class",
            corpus_root=self.corpus_root,
            weights_dir=self.weights_dir,
            evaluate=True,
            cv_report_path=self.report_dir,
        )
        data = json.loads((self.report_dir / "cv-nhl26-build_class.json").read_text())
        self.assertIsNotNone(data["mean_cv_accuracy"])
        self.assertGreaterEqual(data["mean_cv_accuracy"], 0.0)
        self.assertLessEqual(data["mean_cv_accuracy"], 1.0)
        self.assertEqual(len(data["fold_accuracies"]), data["k_folds"])

    def test_explicit_json_path_is_used_verbatim(self) -> None:
        target = self.report_dir / "custom-name.json"
        train_family(
            "build_class",
            corpus_root=self.corpus_root,
            weights_dir=self.weights_dir,
            evaluate=True,
            cv_report_path=target,
        )
        self.assertTrue(target.exists())

    def test_no_report_written_without_evaluate(self) -> None:
        train_family(
            "build_class",
            corpus_root=self.corpus_root,
            weights_dir=self.weights_dir,
            evaluate=False,
            cv_report_path=self.report_dir,
        )
        self.assertFalse(self.report_dir.exists() and any(self.report_dir.iterdir()))


# ---------------------------------------------------------------------------
# Deliverable 2 — held-out leakage guard (crop provenance)
# ---------------------------------------------------------------------------


class TestParseCropMatchId(unittest.TestCase):
    def test_parses_prefix(self) -> None:
        self.assertEqual(_parse_crop_match_id("m250_00004_title_bar.png"), 250)
        self.assertEqual(_parse_crop_match_id("m463_00001_xf_slot0.png"), 463)

    def test_unprefixed_returns_none(self) -> None:
        self.assertIsNone(_parse_crop_match_id("00004_title_bar.png"))


class TestLeakageGuard(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.corpus_root = Path(self._tmp.name) / "crops"
        self.manifest = Path(self._tmp.name) / "benchmark" / "manifest.json"
        _write_manifest(self.manifest, held_out=[463])
        # One held-out (m463) class and one validation (m250) class.
        _write_named_crop(self.corpus_root, "build_class", "HeldOut",
                          "m463_00001_title_bar.png", (0, 0, 200))
        _write_named_crop(self.corpus_root, "build_class", "Good",
                          "m250_00001_title_bar.png", (200, 0, 0))

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_held_out_crop_excluded_validation_included(self) -> None:
        feats, labels = load_corpus(
            "build_class",
            corpus_root=self.corpus_root,
            min_examples_per_class=1,
            manifest_path=self.manifest,
        )
        self.assertIn("Good", labels)
        self.assertNotIn("HeldOut", labels)

    def test_allow_held_out_includes_both(self) -> None:
        feats, labels = load_corpus(
            "build_class",
            corpus_root=self.corpus_root,
            min_examples_per_class=1,
            manifest_path=self.manifest,
            allow_held_out=True,
        )
        self.assertIn("Good", labels)
        self.assertIn("HeldOut", labels)

    def test_unprefixed_legacy_included_with_warning(self) -> None:
        _write_named_crop(self.corpus_root, "build_class", "Legacy",
                          "00007_title_bar.png", (0, 200, 0))
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            feats, labels = load_corpus(
                "build_class",
                corpus_root=self.corpus_root,
                min_examples_per_class=1,
                manifest_path=self.manifest,
            )
        self.assertIn("Legacy", labels)  # unknown provenance → fail-open include
        self.assertIn("provenance unknown", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
