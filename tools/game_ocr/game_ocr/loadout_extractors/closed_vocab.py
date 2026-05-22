"""Phase 2A/2B closed-vocabulary loader and extractor for the player_loadout_view screen family.

Public API
----------
load_closed_vocab(family, version="nhl26") -> ClosedVocab
    Load an entries:-schema YAML (x_factors, build_classes, positions,
    platforms, x_factor_tiers).

load_attribute_keys(version="nhl26") -> dict[str, list[str]]
    Load attribute_keys.yaml (groups:-schema) as {group_name: [key, ...]}.

ClosedVocab.match_canonical(raw) -> tuple[str, float] | None
    Return (canonical, confidence) for a noisy OCR string, or None.
    Confidence 1.0 = exact alias regex full-match.
    Confidence 0.5 = Levenshtein edit-distance ≤ 2 fuzzy fallback.

ClosedVocab.predict_log_probs(crop) -> np.ndarray
    Phase 2B LR-head classifier.  Loads trained weights from the JSON
    artifact at game_ocr/weights/nhl26-loadout-<family>-classifier.json.
    Returns a float64 array of log-probabilities (one entry per class, in
    the order of self.entries).  Raises NotImplementedError when the weights
    file has not been produced yet (forward-compatible with Phase 2A deployments).

ClosedVocabCandidate
    Typed result record emitted by LoadoutClosedVocabExtractor.

LoadoutClosedVocabExtractor
    Phase 2A/2B extractor.  Phase 2A uses alias-regex (rank 0) only.
    Phase 2B adds LR-head image classifiers (rank 1) as second-chance
    candidates when weights are available.

    New in Phase 2B:
        classify_build_class_from_image(crop_bgr) -> list[ClosedVocabCandidate]
        classify_x_factor_name_from_image(crop_bgr) -> list[ClosedVocabCandidate]
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Optional

import numpy as np
import yaml

CONFIG_ROOT = Path(__file__).parent.parent / "configs" / "closed_vocab"
WEIGHTS_DIR = Path(__file__).parent.parent / "weights"

# Family identifier used in the weights filename.
# The YAML family strings (build_classes, x_factors) are mapped to the
# shorter user-facing keys (build_class, x_factor_name) used by the CLI.
_YAML_FAMILY_TO_LR_KEY: dict[str, str] = {
    "build_classes": "build_class",
    "x_factors": "x_factor_name",
}


@dataclass(frozen=True)
class ClosedVocabEntry:
    """One canonical name + its compiled alias regex patterns."""

    canonical: str
    alias_patterns: tuple[re.Pattern[str], ...]


@dataclass(frozen=True)
class ClosedVocab:
    """Closed-vocabulary dictionary for one loadout field family.

    Attributes
    ----------
    family:  YAML ``family`` value (e.g. ``"build_classes"``).
    version: YAML ``version`` value (e.g. ``"nhl26"``).
    entries: Tuple of ClosedVocabEntry objects, order preserved from YAML.
    """

    family: str
    version: str
    entries: tuple[ClosedVocabEntry, ...]

    def match_canonical(self, raw: str) -> Optional[tuple[str, float]]:
        """Return ``(canonical, confidence)`` for a noisy OCR string, or ``None``.

        Confidence semantics
        --------------------
        - ``1.0``: at least one alias regex full-matches ``raw``.
        - ``0.5``: best alias has Levenshtein edit-distance ≤ 2 to ``raw``
          (case-insensitive, stripped).  Returned only when no exact match exists.
        - ``None``: no alias is within edit-distance 2 of ``raw``.

        Exact alias match is always preferred over fuzzy match regardless of
        edit-distance rankings.
        """
        # Pass 1 — exact alias regex full-match → confidence 1.0
        for entry in self.entries:
            for pattern in entry.alias_patterns:
                if pattern.fullmatch(raw):
                    return (entry.canonical, 1.0)

        # Pass 2 — Levenshtein fuzzy fallback against canonical strings
        normalized_raw = raw.strip().lower()
        best_canonical: Optional[str] = None
        best_distance = 3  # anything ≤ 2 will beat this sentinel
        for entry in self.entries:
            distance = _levenshtein(normalized_raw, entry.canonical.strip().lower())
            if distance < best_distance:
                best_distance = distance
                best_canonical = entry.canonical

        if best_canonical is not None and best_distance <= 2:
            return (best_canonical, 0.5)
        return None

    def predict_log_probs(self, crop: "np.ndarray") -> "np.ndarray":
        """Phase 2B LR-head image classifier.

        Loads trained weights from
        ``game_ocr/weights/<version>-loadout-<family_key>-classifier.json``
        (produced by ``train_loadout_closed_vocab.py``).

        Args:
            crop: BGR uint8 ndarray — the image region to classify.

        Returns:
            float64 array of log-probabilities, one entry per class in
            ``self.entries`` order.  Classes not present in the trained
            weights receive ``log(1e-10)`` (near-zero probability).

        Raises:
            NotImplementedError: when the weights file has not been produced
                yet.  This preserves forward compatibility with Phase 2A
                deployments where training has not run.
        """
        weights = _load_lr_weights(
            version=self.version,
            family=self.family,
            weights_dir=WEIGHTS_DIR,
        )
        if weights is None:
            raise NotImplementedError(
                f"predict_log_probs: weights file not found for "
                f"version={self.version!r}, family={self.family!r}. "
                "Run: python tools/game_ocr/scripts/train_loadout_closed_vocab.py"
            )

        feat = _extract_lr_features(crop)  # (n_features,)
        logits = weights["coef"] @ feat + weights["intercept"]  # (n_classes_trained,)

        # Map trained class names → self.entries order.
        # Classes in self.entries not in the trained set get log(1e-10).
        trained_classes: list[str] = weights["classes"]
        trained_idx = {name: i for i, name in enumerate(trained_classes)}

        _LOG_NEAR_ZERO = math.log(1e-10)
        log_probs_trained = _log_softmax(logits)

        n_entries = len(self.entries)
        out = np.full(n_entries, _LOG_NEAR_ZERO, dtype=np.float64)
        for i, entry in enumerate(self.entries):
            j = trained_idx.get(entry.canonical)
            if j is not None:
                out[i] = log_probs_trained[j]
        return out


# ---------------------------------------------------------------------------
# Internal helpers — LR head (Phase 2B)
# ---------------------------------------------------------------------------

# HSV histogram bins — must match train_loadout_closed_vocab.py
_LR_HSV_BINS: tuple[int, int, int] = (8, 4, 4)  # 128 total
_LR_N_FEATURES = _LR_HSV_BINS[0] * _LR_HSV_BINS[1] * _LR_HSV_BINS[2] + 4  # 132


@lru_cache(maxsize=8)
def _load_lr_weights(
    version: str,
    family: str,
    weights_dir: Path,
) -> Optional[dict]:
    """Load and cache LR weights JSON for one (version, family) pair.

    The file is looked up at:
        ``<weights_dir>/<version>-loadout-<family_key>-classifier.json``

    where ``family_key`` is the short user-facing name (e.g. ``"build_class"``)
    derived from the YAML family string (e.g. ``"build_classes"``).

    Returns the parsed JSON dict (with coef/intercept as numpy arrays), or
    None when the file does not exist.
    """
    lr_key = _YAML_FAMILY_TO_LR_KEY.get(family, family)
    path = weights_dir / f"{version}-loadout-{lr_key}-classifier.json"
    if not path.exists():
        return None
    raw = json.loads(path.read_text())
    return {
        "classes": raw["classes"],
        "coef": np.asarray(raw["coef"], dtype=np.float64),
        "intercept": np.asarray(raw["intercept"], dtype=np.float64),
    }


def _extract_lr_features(image_bgr: "np.ndarray") -> "np.ndarray":
    """Extract the 132-d feature vector used by the LR head.

    Mirrors ``extract_crop_features`` in ``train_loadout_closed_vocab.py``
    exactly: 8×4×4 HSV histogram + pixel mean + pixel std + aspect ratio +
    log1p(Laplacian variance).  Imported here via cv2 directly to avoid
    importing the script module.
    """
    import cv2  # local to avoid hard dep at module import time

    if image_bgr is None or image_bgr.size == 0:
        raise ValueError("empty image passed to _extract_lr_features")

    resized = cv2.resize(image_bgr, (64, 64), interpolation=cv2.INTER_AREA)

    hsv = cv2.cvtColor(resized, cv2.COLOR_BGR2HSV)
    h_bins, s_bins, v_bins = _LR_HSV_BINS
    hist = cv2.calcHist(
        [hsv], [0, 1, 2], None,
        [h_bins, s_bins, v_bins],
        [0, 180, 0, 256, 0, 256],
    )
    flat = hist.flatten().astype(np.float64)
    total = flat.sum()
    hist_norm = flat / total if total > 0 else flat

    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY).astype(np.float64)
    pix_mean = gray.mean() / 255.0
    pix_std = gray.std() / 255.0

    h_orig, w_orig = image_bgr.shape[:2]
    aspect = float(w_orig) / float(h_orig) if h_orig > 0 else 1.0

    lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    log_blur = math.log1p(max(0.0, lap_var))

    out = np.empty(_LR_N_FEATURES, dtype=np.float64)
    out[:128] = hist_norm
    out[128] = pix_mean
    out[129] = pix_std
    out[130] = aspect
    out[131] = log_blur
    return out


def _log_softmax(logits: "np.ndarray") -> "np.ndarray":
    """Numerically stable log-softmax."""
    m = float(logits.max())
    return logits - (m + math.log(float(np.exp(logits - m).sum())))


# ---------------------------------------------------------------------------
# Internal helpers — Levenshtein (Phase 2A)
# ---------------------------------------------------------------------------


def _levenshtein(a: str, b: str) -> int:
    """Standard Levenshtein edit distance (single-row DP)."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        curr = [i] + [0] * len(b)
        for j, cb in enumerate(b, start=1):
            cost = 0 if ca == cb else 1
            curr[j] = min(
                curr[j - 1] + 1,   # insertion
                prev[j] + 1,       # deletion
                prev[j - 1] + cost,  # substitution
            )
        prev = curr
    return prev[-1]


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------


def load_closed_vocab(family: str, version: str = "nhl26") -> ClosedVocab:
    """Load a closed-vocabulary dictionary from its YAML file.

    Parameters
    ----------
    family:
        One of ``"x_factors"``, ``"build_classes"``, ``"positions"``,
        ``"platforms"``, ``"x_factor_tiers"``.  (Use :func:`load_attribute_keys`
        for ``attribute_keys.yaml``, which has a different ``groups:`` schema.)
    version:
        NHL game version key matching the config subdirectory (default ``"nhl26"``).

    Returns
    -------
    ClosedVocab

    Raises
    ------
    FileNotFoundError: if the YAML file does not exist.
    ValueError: if the YAML uses a ``groups:`` schema (i.e. ``attribute_keys``).
    """
    path = CONFIG_ROOT / version / f"{family}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"closed-vocab dictionary not found: {path}")

    with path.open() as fp:
        data = yaml.safe_load(fp)

    if "entries" not in data:
        raise ValueError(
            f"{path} does not have an 'entries' schema. "
            f"For attribute_keys use load_attribute_keys() instead."
        )

    compiled_entries: list[ClosedVocabEntry] = []
    for entry in data["entries"]:
        compiled_entries.append(
            ClosedVocabEntry(
                canonical=entry["canonical"],
                alias_patterns=tuple(re.compile(alias) for alias in entry["aliases"]),
            )
        )

    return ClosedVocab(
        family=data["family"],
        version=data["version"],
        entries=tuple(compiled_entries),
    )


# ---------------------------------------------------------------------------
# Phase 2A-4: Typed candidate shape + extractor
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ClosedVocabCandidate:
    """One candidate value for a closed-vocab field, ready to be promoted to ocr_field_evidence.

    Attributes
    ----------
    value:
        Canonical value (e.g. ``"Sniper"``, ``"Wheels"``, ``"C"``).
    raw_confidence:
        Confidence from the matcher: ``1.0`` for exact alias-regex match,
        ``0.5`` for Levenshtein ≤2 fuzzy fallback.
    calibrated_confidence:
        Equal to ``raw_confidence`` in Phase 2A. Phase 3+ will apply Platt
        scaling or isotonic calibration behind this field.
    roi_bbox:
        Normalised bounding box ``{x, y, w, h}`` of the region that was
        classified, or ``None`` when not applicable (text-only path).
    """

    value: str
    raw_confidence: float
    calibrated_confidence: float
    roi_bbox: Optional[dict[str, float]] = None


class LoadoutClosedVocabExtractor:
    """Closed-vocab extractor for loadout-view fields.

    Phase 2A uses alias-regex matching only (via :meth:`ClosedVocab.match_canonical`).
    Returns top-1 candidate per field (N=1 hardcoded). Phase 2B activates the
    LR-head path and unlocks N>1 ranked candidates behind the same interface.

    Parameters
    ----------
    version:
        NHL game version key matching the config subdirectory (default ``"nhl26"``).
    """

    EXTRACTOR_VERSION = "closed-vocab-v2"  # Phase 2B: LR head + alias-regex

    def __init__(self, *, version: str = "nhl26") -> None:
        self._build_classes = load_closed_vocab("build_classes", version=version)
        self._x_factors = load_closed_vocab("x_factors", version=version)
        self._positions = load_closed_vocab("positions", version=version)
        self._platforms = load_closed_vocab("platforms", version=version)
        self._tiers = load_closed_vocab("x_factor_tiers", version=version)

    # ------------------------------------------------------------------
    # Text-based classifiers (alias-regex → ClosedVocabCandidate)
    # ------------------------------------------------------------------

    def classify_build_class(
        self,
        ocr_text: str,
        *,
        roi_bbox: Optional[dict[str, float]] = None,
    ) -> list[ClosedVocabCandidate]:
        """Classify a build-class OCR string to a canonical name.

        Returns a list of 0 or 1 :class:`ClosedVocabCandidate`.

        Empty list means no canonical match within edit-distance 2. The
        extractor never misclassifies as the nearest canonical — it emits no
        evidence instead, preserving the downstream decision to reject or
        escalate.
        """
        return self._match_to_candidates(self._build_classes, ocr_text, roi_bbox=roi_bbox)

    def classify_x_factor_name(
        self,
        ocr_text: str,
        *,
        roi_bbox: Optional[dict[str, float]] = None,
    ) -> list[ClosedVocabCandidate]:
        """Classify an X-Factor name OCR string. Returns 0 or 1 candidate."""
        return self._match_to_candidates(self._x_factors, ocr_text, roi_bbox=roi_bbox)

    def classify_position(
        self,
        ocr_text: str,
        *,
        roi_bbox: Optional[dict[str, float]] = None,
    ) -> list[ClosedVocabCandidate]:
        """Classify a position OCR string (C/LW/RW/LD/RD/G). Returns 0 or 1 candidate."""
        return self._match_to_candidates(self._positions, ocr_text, roi_bbox=roi_bbox)

    def classify_platform(
        self,
        ocr_text: str,
        *,
        roi_bbox: Optional[dict[str, float]] = None,
    ) -> list[ClosedVocabCandidate]:
        """Classify a platform OCR string. Returns 0 or 1 candidate."""
        return self._match_to_candidates(self._platforms, ocr_text, roi_bbox=roi_bbox)

    # ------------------------------------------------------------------
    # Image-based classifiers — Phase 2B LR head (second-chance candidates)
    # ------------------------------------------------------------------

    def classify_build_class_from_image(
        self,
        crop_bgr,  # noqa: ANN001 — numpy ndarray; avoid hard dep at class level
        *,
        roi_bbox: Optional[dict[str, float]] = None,
    ) -> list[ClosedVocabCandidate]:
        """Classify a build-class title-bar crop using the LR head.

        Intended as a **second-chance** classifier that the orchestrator calls
        when :meth:`classify_build_class` (alias-regex, rank 0) returns no
        match or a low-confidence match.

        Returns 0 or 1 :class:`ClosedVocabCandidate` (the argmax class):

        - Confidence is the softmax-probability of the argmax class
          (``exp(log_prob[argmax])``).
        - The candidate's ``roi_bbox`` is set to the supplied value.

        Returns ``[]`` when:
        - The weights file is absent (Phase 2B not bootstrapped yet).
        - ``crop_bgr`` is None or empty.
        - The argmax softmax probability is below the 0.50 threshold.

        Forward-compatible: when weights are absent, this method silently
        returns ``[]`` (no error), preserving the Phase 2A alias-regex path.
        """
        return self._lr_classify(self._build_classes, crop_bgr, roi_bbox=roi_bbox)

    def classify_x_factor_name_from_image(
        self,
        crop_bgr,  # noqa: ANN001 — numpy ndarray; avoid hard dep at class level
        *,
        roi_bbox: Optional[dict[str, float]] = None,
    ) -> list[ClosedVocabCandidate]:
        """Classify an X-Factor name icon-label crop using the LR head.

        Same contract as :meth:`classify_build_class_from_image` but operates
        on the X-Factor icon-label strip rather than the title bar.

        Returns ``[]`` when weights are absent, crop is empty, or confidence
        is below the 0.50 threshold.
        """
        return self._lr_classify(self._x_factors, crop_bgr, roi_bbox=roi_bbox)

    # LR head confidence threshold: below this the LR result is discarded
    _LR_CONFIDENCE_THRESHOLD: float = 0.50

    @staticmethod
    def _lr_classify(
        vocab: ClosedVocab,
        crop_bgr,  # noqa: ANN001
        *,
        roi_bbox: Optional[dict[str, float]],
    ) -> list[ClosedVocabCandidate]:
        """Internal: run vocab.predict_log_probs on a crop and return top-1 candidate."""
        if crop_bgr is None:
            return []
        try:
            log_probs = vocab.predict_log_probs(crop_bgr)
        except NotImplementedError:
            return []
        except Exception:  # noqa: BLE001 — defensive: don't crash the pipeline on LR errors
            return []

        argmax_idx = int(np.argmax(log_probs))
        prob = float(np.exp(log_probs[argmax_idx]))
        if prob < LoadoutClosedVocabExtractor._LR_CONFIDENCE_THRESHOLD:
            return []

        canonical = vocab.entries[argmax_idx].canonical
        return [
            ClosedVocabCandidate(
                value=canonical,
                raw_confidence=prob,
                calibrated_confidence=prob,
                roi_bbox=roi_bbox,
            )
        ]

    # ------------------------------------------------------------------
    # Image-based classifier (HSV color sampling via legacy parsers.py)
    # ------------------------------------------------------------------

    def classify_x_factor_tier_from_image(
        self,
        image_bgr,  # noqa: ANN001 — numpy ndarray; avoid hard dep at class level
        *,
        cx: int,
        cy: int,
        radius: int = 35,
        roi_bbox: Optional[dict[str, float]] = None,
    ) -> list[ClosedVocabCandidate]:
        """Classify an X-Factor tier by HSV color sampling at the given centroid.

        Wraps :func:`game_ocr.parsers._classify_xfactor_tier` verbatim.
        The legacy function takes the full image plus a centroid ``(cx, cy)``
        and a ``radius`` (default 35 px) — it crops internally.

        Returns 0 or 1 :class:`ClosedVocabCandidate`:

        - ``"Elite"`` (red hue cluster)
        - ``"All Star"`` (blue hue cluster)
        - ``"Specialist"`` (yellow hue cluster)
        - ``[]`` when the HSV sampling finds no saturated icon (transitional
          capture) or when ``image_bgr`` is ``None``.

        HSV color sampling yields high confidence (1.0) when it returns at
        all — the hue clusters are well-separated.
        """
        from ..parsers import _classify_xfactor_tier  # local to avoid circular import

        tier = _classify_xfactor_tier(image_bgr, cx, cy, radius)
        if tier is None:
            return []
        return [
            ClosedVocabCandidate(
                value=tier,
                raw_confidence=1.0,
                calibrated_confidence=1.0,
                roi_bbox=roi_bbox,
            )
        ]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _match_to_candidates(
        vocab: ClosedVocab,
        ocr_text: str,
        *,
        roi_bbox: Optional[dict[str, float]],
    ) -> list[ClosedVocabCandidate]:
        """Run match_canonical and wrap the result in a ClosedVocabCandidate list."""
        result = vocab.match_canonical(ocr_text)
        if result is None:
            return []
        value, confidence = result
        return [
            ClosedVocabCandidate(
                value=value,
                raw_confidence=confidence,
                calibrated_confidence=confidence,
                roi_bbox=roi_bbox,
            )
        ]


def load_attribute_keys(version: str = "nhl26") -> dict[str, list[str]]:
    """Load ``attribute_keys.yaml`` as ``{group_name: [attribute_key, ...]}``.

    This file uses a ``groups:`` schema distinct from the ``entries:`` schema
    used by all other closed-vocab families.  Group ordering from the YAML is
    preserved in the returned dict.

    Parameters
    ----------
    version:
        NHL game version key matching the config subdirectory (default ``"nhl26"``).

    Returns
    -------
    dict[str, list[str]]

    Raises
    ------
    FileNotFoundError: if the YAML file does not exist.
    ValueError: if the YAML is missing the ``groups`` key.
    """
    path = CONFIG_ROOT / version / "attribute_keys.yaml"
    if not path.exists():
        raise FileNotFoundError(f"attribute_keys dictionary not found: {path}")

    with path.open() as fp:
        data = yaml.safe_load(fp)

    if "groups" not in data:
        raise ValueError(f"{path} is missing the 'groups' key")

    return dict(data["groups"])
