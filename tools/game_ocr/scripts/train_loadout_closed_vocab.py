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
import re
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


# Crop provenance prefix written by label_loadout_crops.py --source-match <ID>,
# e.g. "m250_00004_title_bar.png".
_CROP_PROVENANCE_RE = re.compile(r"^m(\d+)_")


def _parse_crop_match_id(png_name: str) -> int | None:
    """Parse the ``m<id>_`` provenance prefix from a crop filename, or None."""
    m = _CROP_PROVENANCE_RE.match(png_name)
    return int(m.group(1)) if m else None


def _read_held_out_matches(manifest_path: Path) -> set[int]:
    """Read the held-out match-id set from a benchmark manifest.

    Returns an empty set (and warns) when the manifest is missing or
    unreadable — the guard then operates in transitional fail-open mode so a
    label run against a temp/uninitialized corpus is not silently dropped.
    """
    try:
        data = json.loads(manifest_path.read_text())
    except (OSError, json.JSONDecodeError) as e:
        print(
            f"warn: leakage guard could not read manifest {manifest_path} ({e}); "
            "held-out enforcement disabled for this run.",
            file=sys.stderr,
        )
        return set()
    held = data.get("splits", {}).get("held_out", []) or []
    return {int(x) for x in held}


def load_corpus(
    family: str,
    corpus_root: Path = CORPUS_ROOT,
    min_examples_per_class: int = MIN_EXAMPLES_PER_CLASS,
    *,
    manifest_path: Path | None = None,
    allow_held_out: bool = False,
    strict_provenance: bool = False,
) -> tuple[list[np.ndarray], list[str]]:
    """Load feature vectors and labels from the labeled crop corpus.

    Args:
        family: one of ``"build_class"``, ``"x_factor_name"``.
        corpus_root: path to the crops root.
        min_examples_per_class: minimum labels required per class
            (default 3). Lower (e.g. 1) for sparse bootstrap corpora.
        manifest_path: benchmark manifest whose ``splits.held_out`` list drives
            the leakage guard.  Defaults to
            ``corpus_root.parent / "benchmark" / "manifest.json"``.
        allow_held_out: debug override — when True, held-out crops are included
            instead of skipped.
        strict_provenance: when True, crops with no ``m<id>_`` provenance prefix
            are refused (skipped + loud-warned) instead of the transitional
            fail-open include.  Safe to enable once the corpus is uniformly
            prefixed; guarantees no unknown-provenance crop taints training.

    Returns:
        (features, labels) — parallel lists.
        features: list of 132-d float64 arrays.
        labels: list of canonical-name strings.

    Leakage guard (crop provenance):
        Each crop filename may carry an ``m<id>_`` prefix naming its source
        match.  Crops whose match id is in the manifest's ``held_out`` split are
        skipped with a loud warning (unless ``allow_held_out``).  Unprefixed
        legacy crops have unknown provenance: included with a one-time warning by
        default (transitional fail-open), or refused under ``strict_provenance``
        (fail-closed).

    Classes with fewer than min_examples_per_class examples are excluded with
    a warning.  If the corpus directory does not exist, returns ([], []).
    """
    family_root = corpus_root / family
    if not family_root.exists():
        return [], []

    if manifest_path is None:
        manifest_path = corpus_root.parent / "benchmark" / "manifest.json"
    held_out: set[int] = set() if allow_held_out else _read_held_out_matches(manifest_path)

    # Gather (feature_vec, canonical_label) pairs
    warned_unknown = False
    raw_by_class: dict[str, list[np.ndarray]] = {}
    for class_dir in sorted(family_root.iterdir()):
        if not class_dir.is_dir():
            continue
        canonical = class_dir.name
        for png in sorted(class_dir.glob("*.png")):
            match_id = _parse_crop_match_id(png.name)
            if match_id is None:
                if strict_provenance:
                    # Unknown provenance under strict mode → fail-closed refuse.
                    print(
                        f"WARN: STRICT PROVENANCE — refusing unprefixed crop {png} "
                        "(no m<id>_ prefix; provenance unknown). Re-label with "
                        "label_loadout_crops.py --source-match <ID>, or drop "
                        "--strict-provenance to include it.",
                        file=sys.stderr,
                    )
                    continue
                # Unknown provenance → transitional fail-open (include + warn once).
                if not warned_unknown:
                    print(
                        f"warn: crop provenance unknown (no m<id>_ prefix), e.g. {png.name} — "
                        "verify these are not from a held-out match. Re-label with "
                        "label_loadout_crops.py --source-match <ID> to tag them.",
                        file=sys.stderr,
                    )
                    warned_unknown = True
            elif match_id in held_out:
                # Proven held-out → fail-closed (skip + loud warn).
                print(
                    f"WARN: LEAKAGE GUARD — skipping held-out crop {png} "
                    f"(match {match_id} in held_out split). "
                    "Pass --allow-held-out to override.",
                    file=sys.stderr,
                )
                continue
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
        if len(feats) < min_examples_per_class:
            print(
                f"warn: class {canonical!r} has only {len(feats)} example(s) "
                f"(< {min_examples_per_class} minimum) — skipped.  "
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


def _resolve_cv_report_path(cv_report_path: Path, version: str, family: str) -> Path:
    """Resolve a ``--cv-report`` argument to a concrete file path.

    If the argument names a JSON file (``.json`` suffix) it is used verbatim;
    otherwise it is treated as a directory and the canonical filename
    ``cv-<version>-<family>.json`` is appended.
    """
    if cv_report_path.suffix.lower() == ".json":
        return cv_report_path
    return cv_report_path / f"cv-{version}-{family}.json"


def train_family(
    family: str,
    *,
    version: str = "nhl26",
    corpus_root: Path = CORPUS_ROOT,
    weights_dir: Path = WEIGHTS_DIR,
    evaluate: bool = False,
    min_examples_per_class: int = MIN_EXAMPLES_PER_CLASS,
    cv_report_path: Path | None = None,
    manifest_path: Path | None = None,
    allow_held_out: bool = False,
    strict_provenance: bool = False,
) -> Path | None:
    """Train a LogisticRegression for one family.  Returns the saved weights path, or None on failure.

    Args:
        family: ``"build_class"`` or ``"x_factor_name"``.
        version: NHL game version key (default ``"nhl26"``).
        corpus_root: root of the labeled crop corpus.
        weights_dir: directory to write the JSON weights file.
        evaluate: when True, run stratified k-fold cross-validation and print
            top-1 accuracy before fitting the full model.
        min_examples_per_class: minimum labels required per class. Default 3
            for robust training; lower to 1-2 for sparse bootstrap corpora.
        cv_report_path: when set together with ``evaluate``, persist a CV
            summary JSON here.  If the path names a directory, the file is
            written as ``cv-<version>-<family>.json`` inside it.
        manifest_path: benchmark manifest whose ``splits.held_out`` list drives
            the crop-provenance leakage guard.  Defaults to a path derived from
            ``corpus_root`` (see ``load_corpus``).
        allow_held_out: debug override — include crops from held-out matches
            instead of skipping them.
        strict_provenance: refuse (skip + loud-warn) crops with no ``m<id>_``
            provenance prefix instead of the transitional fail-open include.

    Returns:
        Path to the written JSON file, or None when corpus is insufficient.
    """
    print(f"\n{'─' * 60}", file=sys.stderr)
    print(f"Training: {version}-loadout-{family}-classifier", file=sys.stderr)

    features, labels = load_corpus(
        family,
        corpus_root=corpus_root,
        min_examples_per_class=min_examples_per_class,
        manifest_path=manifest_path,
        allow_held_out=allow_held_out,
        strict_provenance=strict_provenance,
    )

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

    if cv_report_path is not None and not evaluate:
        print("  note: --cv-report is ignored without --evaluate", file=sys.stderr)

    # Optional held-out evaluation
    if evaluate:
        k = int(min(3, n_classes, int(np.min(np.bincount(y)))))
        fold_accuracies: list[float] = []
        mean_acc: float | None = None
        if k >= 2:
            kf = StratifiedKFold(n_splits=k, shuffle=True, random_state=42)
            for train_idx, test_idx in kf.split(X, y):
                X_tr, X_te = X[train_idx], X[test_idx]
                y_tr, y_te = y[train_idx], y[test_idx]
                lr_cv = LogisticRegression(solver="lbfgs", max_iter=1000, C=1.0)
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    lr_cv.fit(X_tr, y_tr)
                fold_accuracies.append(float((lr_cv.predict(X_te) == y_te).mean()))
            mean_acc = float(np.mean(fold_accuracies))
            cv_note = (
                f"{k}-fold stratified CV top-1 accuracy over {n_total} examples "
                f"/ {n_classes} classes (min_class_size={min_examples_per_class})."
            )
            print(f"  [evaluate] {k}-fold stratified CV top-1 accuracy: {mean_acc:.3f}", file=sys.stderr)
        else:
            cv_note = (
                f"CV skipped - smallest class has too few examples for {k}-fold CV."
            )
            print(
                f"  [evaluate] skipped — some classes have too few examples for {k}-fold CV",
                file=sys.stderr,
            )

        # Persist CV metrics next to the benchmark reports (the retrain baseline).
        if cv_report_path is not None:
            class_counts = {name: int((y == idx).sum()) for idx, name in enumerate(class_names)}
            cv_report = {
                "schema_version": 1,
                "version": version,
                "family": family,
                "n_examples": n_total,
                "n_classes": n_classes,
                "min_class_size": min_examples_per_class,
                "class_counts": class_counts,
                "k_folds": k,
                "fold_accuracies": fold_accuracies,
                "mean_cv_accuracy": mean_acc,
                "note": cv_note,
            }
            cv_out = _resolve_cv_report_path(cv_report_path, version, family)
            cv_out.parent.mkdir(parents=True, exist_ok=True)
            cv_out.write_text(json.dumps(cv_report, indent=2))
            print(f"  [evaluate] wrote CV report: {cv_out}", file=sys.stderr)

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
    ap.add_argument(
        "--min-class-size",
        type=int,
        default=MIN_EXAMPLES_PER_CLASS,
        help=f"Minimum labels per class to include in training (default: {MIN_EXAMPLES_PER_CLASS}). "
             f"Lower (e.g. 1) for sparse bootstrap corpora.",
    )
    ap.add_argument(
        "--cv-report",
        type=Path,
        default=None,
        metavar="PATH",
        help="With --evaluate, persist a CV summary JSON. If PATH is a directory "
             "(or lacks a .json suffix), the file is written as "
             "cv-<version>-<family>.json inside it.",
    )
    ap.add_argument(
        "--manifest",
        type=Path,
        default=None,
        metavar="PATH",
        help="Benchmark manifest for the held-out leakage guard (default: derived "
             "as <corpus-root>/../benchmark/manifest.json).",
    )
    ap.add_argument(
        "--allow-held-out",
        action="store_true",
        help="Debug override: include crops from held-out matches instead of "
             "skipping them (default off).",
    )
    ap.add_argument(
        "--strict-provenance",
        action="store_true",
        help="Refuse (skip + loud-warn) crops with no m<id>_ provenance prefix "
             "instead of the transitional fail-open include. Safe once the "
             "corpus is uniformly prefixed (default off).",
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
            min_examples_per_class=args.min_class_size,
            cv_report_path=args.cv_report,
            manifest_path=args.manifest,
            allow_held_out=args.allow_held_out,
            strict_provenance=args.strict_provenance,
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
