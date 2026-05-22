"""Phase 2B-2: sklearn LR training script for closed-vocab loadout classifiers.

Reads labeled crops from the corpus created by label_loadout_crops.py:
    tools/game_ocr/calibration/extras/loadout/crops/<family>/<canonical>/*.png

Extracts a compact feature vector from each crop:
    - HSV histogram (8-bin H × 4-bin S × 4-bin V = 128 features)
    - Pixel intensity statistics: mean, std (2 features)
    - Aspect ratio (width / height, 1 feature)
    - Log1p of Laplacian variance (blur score, 1 feature)
    Total: 132 features

Fits a multinomial LogisticRegression per family and writes a JSON weights
file at:
    tools/game_ocr/game_ocr/weights/nhl26-loadout-<family>-classifier.json

JSON shape (mirrors nhl26-screen-classifier.json):
    {
        "schema_version": 1,
        "version": "nhl26",
        "family": "<family>",
        "classes": [<canonical names in row order>],
        "intercept": [...],
        "coef": [[...], ...]   # shape (n_classes, n_features)
    }

Usage
-----
    # Train build_class only:
    python tools/game_ocr/scripts/train_loadout_closed_vocab.py --family build_class

    # Train x_factor_name only:
    python tools/game_ocr/scripts/train_loadout_closed_vocab.py --family x_factor_name

    # Train both families:
    python tools/game_ocr/scripts/train_loadout_closed_vocab.py --all

    # With held-out evaluation (stratified k-fold, k=3):
    python tools/game_ocr/scripts/train_loadout_closed_vocab.py --family build_class --evaluate

Graceful behavior on sparse corpus:
    - If any class has <3 examples, a warning is printed and that class is skipped.
    - If after skipping the corpus is empty or has <2 classes, the script exits
      with a clear message directing the operator to run label_loadout_crops.py.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import warnings
from pathlib import Path
from typing import Sequence

import cv2
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold
from sklearn.preprocessing import LabelEncoder

REPO_ROOT = Path(__file__).resolve().parents[3]
GAME_OCR = REPO_ROOT / "tools" / "game_ocr"
sys.path.insert(0, str(GAME_OCR))

CORPUS_ROOT = GAME_OCR / "calibration" / "extras" / "loadout" / "crops"
WEIGHTS_DIR = GAME_OCR / "game_ocr" / "weights"

# Histogram bin layout: H × S × V
_HSV_BINS: tuple[int, int, int] = (8, 4, 4)  # 128 bins total
_N_FEATURES = _HSV_BINS[0] * _HSV_BINS[1] * _HSV_BINS[2] + 4  # 132

# Minimum examples per class for inclusion
MIN_EXAMPLES_PER_CLASS = 3


# ---------------------------------------------------------------------------
# Feature extraction
# ---------------------------------------------------------------------------


def extract_crop_features(image_bgr: np.ndarray) -> np.ndarray:
    """Extract a 132-d feature vector from a BGR crop image.

    Layout:
        [hsv_histogram(128) | pixel_mean | pixel_std | aspect_ratio | log1p_blur]

    The HSV histogram (8H × 4S × 4V = 128 bins) is the primary discriminator
    — following the Phase 1 screen-classifier precedent.  The four scalar
    appended features provide complementary shape/quality signals.

    Args:
        image_bgr: BGR uint8 ndarray.  Any size — resized internally to avoid
            scale bias.  Empty image raises ValueError.

    Returns:
        1-D float64 array of length 132.
    """
    if image_bgr is None or image_bgr.size == 0:
        raise ValueError("empty image passed to extract_crop_features")

    # Resize to a canonical size to remove scale dependency
    resized = cv2.resize(image_bgr, (64, 64), interpolation=cv2.INTER_AREA)

    # HSV histogram (128 bins)
    hsv = cv2.cvtColor(resized, cv2.COLOR_BGR2HSV)
    h_bins, s_bins, v_bins = _HSV_BINS
    hist = cv2.calcHist(
        [hsv], [0, 1, 2], None,
        [h_bins, s_bins, v_bins],
        [0, 180, 0, 256, 0, 256],
    )
    flat = hist.flatten().astype(np.float64)
    total = flat.sum()
    hist_norm = flat / total if total > 0 else flat

    # Pixel intensity statistics (on the original resize — grayscale)
    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY).astype(np.float64)
    pix_mean = gray.mean() / 255.0
    pix_std = gray.std() / 255.0

    # Aspect ratio (width / height)
    h, w = image_bgr.shape[:2]
    aspect = float(w) / float(h) if h > 0 else 1.0

    # Blur score: log1p of Laplacian variance
    lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    log_blur = math.log1p(max(0.0, lap_var))

    out = np.empty(_N_FEATURES, dtype=np.float64)
    out[:128] = hist_norm
    out[128] = pix_mean
    out[129] = pix_std
    out[130] = aspect
    out[131] = log_blur
    return out


# ---------------------------------------------------------------------------
# Corpus loading
# ---------------------------------------------------------------------------


def load_corpus(
    family: str,
    corpus_root: Path = CORPUS_ROOT,
) -> tuple[list[np.ndarray], list[str]]:
    """Load feature vectors and labels from the labeled crop corpus.

    Args:
        family: one of ``"build_class"``, ``"x_factor_name"``.
        corpus_root: path to the crops root.

    Returns:
        (features, labels) — parallel lists.
        features: list of 132-d float64 arrays.
        labels: list of canonical-name strings.

    Classes with fewer than MIN_EXAMPLES_PER_CLASS examples are excluded with
    a warning.  If the corpus directory does not exist, returns ([], []).
    """
    family_root = corpus_root / family
    if not family_root.exists():
        return [], []

    # Gather (feature_vec, canonical_label) pairs
    raw_by_class: dict[str, list[np.ndarray]] = {}
    for class_dir in sorted(family_root.iterdir()):
        if not class_dir.is_dir():
            continue
        canonical = class_dir.name
        for png in sorted(class_dir.glob("*.png")):
            img = cv2.imread(str(png))
            if img is None:
                print(f"warn: cv2.imread failed: {png}", file=sys.stderr)
                continue
            try:
                feat = extract_crop_features(img)
            except ValueError as e:
                print(f"warn: {e} for {png}", file=sys.stderr)
                continue
            raw_by_class.setdefault(canonical, []).append(feat)

    # Filter sparse classes
    features: list[np.ndarray] = []
    labels: list[str] = []
    for canonical, feats in sorted(raw_by_class.items()):
        if len(feats) < MIN_EXAMPLES_PER_CLASS:
            print(
                f"warn: class {canonical!r} has only {len(feats)} example(s) "
                f"(< {MIN_EXAMPLES_PER_CLASS} minimum) — skipped.  "
                f"Run label_loadout_crops.py to add more examples.",
                file=sys.stderr,
            )
            continue
        features.extend(feats)
        labels.extend([canonical] * len(feats))

    return features, labels


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------


def train_family(
    family: str,
    *,
    version: str = "nhl26",
    corpus_root: Path = CORPUS_ROOT,
    weights_dir: Path = WEIGHTS_DIR,
    evaluate: bool = False,
) -> Path | None:
    """Train a LogisticRegression for one family.  Returns the saved weights path, or None on failure.

    Args:
        family: ``"build_class"`` or ``"x_factor_name"``.
        version: NHL game version key (default ``"nhl26"``).
        corpus_root: root of the labeled crop corpus.
        weights_dir: directory to write the JSON weights file.
        evaluate: when True, run stratified k-fold cross-validation and print
            top-1 accuracy before fitting the full model.

    Returns:
        Path to the written JSON file, or None when corpus is insufficient.
    """
    print(f"\n{'─' * 60}", file=sys.stderr)
    print(f"Training: {version}-loadout-{family}-classifier", file=sys.stderr)

    features, labels = load_corpus(family, corpus_root=corpus_root)

    n_total = len(features)
    n_classes = len(set(labels))
    print(f"  Corpus: {n_total} examples, {n_classes} classes", file=sys.stderr)

    if n_total == 0:
        print(
            f"error: corpus is empty for family {family!r}.\n"
            "  Run: python tools/game_ocr/scripts/label_loadout_crops.py "
            f"--family {family}",
            file=sys.stderr,
        )
        return None

    if n_classes < 2:
        print(
            f"error: need at least 2 classes (got {n_classes}). "
            "Add more labeled crops.",
            file=sys.stderr,
        )
        return None

    X = np.stack(features)  # (n_samples, n_features)
    le = LabelEncoder()
    y = le.fit_transform(labels)  # integer-encoded, sorted alphabetically
    class_names: list[str] = list(le.classes_)

    # Optional held-out evaluation
    if evaluate:
        k = min(3, n_classes, min(np.bincount(y)))
        if k >= 2:
            kf = StratifiedKFold(n_splits=k, shuffle=True, random_state=42)
            fold_accuracies: list[float] = []
            for train_idx, test_idx in kf.split(X, y):
                X_tr, X_te = X[train_idx], X[test_idx]
                y_tr, y_te = y[train_idx], y[test_idx]
                lr_cv = LogisticRegression(solver="lbfgs", max_iter=1000, C=1.0)
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    lr_cv.fit(X_tr, y_tr)
                fold_accuracies.append(float((lr_cv.predict(X_te) == y_te).mean()))
            mean_acc = float(np.mean(fold_accuracies))
            print(f"  [evaluate] {k}-fold stratified CV top-1 accuracy: {mean_acc:.3f}", file=sys.stderr)
        else:
            print(
                f"  [evaluate] skipped — some classes have too few examples for {k}-fold CV",
                file=sys.stderr,
            )

    # Fit on full corpus
    lr = LogisticRegression(solver="lbfgs", max_iter=1000, C=1.0)
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message=".*unique classes.*", category=UserWarning)
        warnings.filterwarnings("ignore", category=UserWarning)
        lr.fit(X, y)

    # sklearn coef_ rows are sorted by lr.classes_ (== sorted integer labels == le.classes_ order)
    # since we used LabelEncoder which also sorts alphabetically, they already match class_names order.
    coef = lr.coef_  # shape (n_classes, n_features); (1, n_features) for binary — handle below
    intercept = lr.intercept_

    if coef.shape[0] == 1:
        # Binary LR: sklearn squeezes to (1, n_features). Expand to (2, n_features)
        # by mirroring the sign: class 0 = -coef, class 1 = +coef
        coef = np.vstack([-coef, coef])
        intercept = np.array([-intercept[0], intercept[0]])

    payload = {
        "schema_version": 1,
        "version": version,
        "family": family,
        "feature_dim": _N_FEATURES,
        "hsv_bins": list(_HSV_BINS),
        "classes": class_names,
        "intercept": intercept.tolist(),
        "coef": coef.tolist(),
    }

    weights_dir.mkdir(parents=True, exist_ok=True)
    out_path = weights_dir / f"{version}-loadout-{family}-classifier.json"
    out_path.write_text(json.dumps(payload, indent=2))
    print(f"  Wrote: {out_path}", file=sys.stderr)
    return out_path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


AVAILABLE_FAMILIES = ["build_class", "x_factor_name"]


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Train sklearn LR classifiers for closed-vocab loadout fields.",
    )
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--family",
        choices=AVAILABLE_FAMILIES,
        help="Train a single family.",
    )
    group.add_argument(
        "--all",
        action="store_true",
        help=f"Train all families: {AVAILABLE_FAMILIES}.",
    )
    ap.add_argument(
        "--version",
        default="nhl26",
        help="NHL version key (default: nhl26).",
    )
    ap.add_argument(
        "--evaluate",
        action="store_true",
        help="Run stratified k-fold cross-validation and print top-1 accuracy.",
    )
    ap.add_argument(
        "--corpus-root",
        type=Path,
        default=CORPUS_ROOT,
        help=f"Labeled crop corpus root (default: {CORPUS_ROOT}).",
    )
    ap.add_argument(
        "--weights-dir",
        type=Path,
        default=WEIGHTS_DIR,
        help=f"Output directory for JSON weight files (default: {WEIGHTS_DIR}).",
    )
    args = ap.parse_args()

    families = AVAILABLE_FAMILIES if args.all else [args.family]
    failures = 0
    for fam in families:
        result = train_family(
            fam,
            version=args.version,
            corpus_root=args.corpus_root,
            weights_dir=args.weights_dir,
            evaluate=args.evaluate,
        )
        if result is None:
            failures += 1

    if failures:
        print(
            f"\n{failures} family(ies) failed — see warnings above.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
