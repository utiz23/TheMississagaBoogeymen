"""Phase 2A closed-vocabulary loader and extractor for the player_loadout_view screen family.

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

ClosedVocab.predict_log_probs(crop)
    Phase 2B stub — always raises NotImplementedError.

ClosedVocabCandidate
    Typed result record emitted by LoadoutClosedVocabExtractor.

LoadoutClosedVocabExtractor
    Phase 2A extractor: wraps ClosedVocab.match_canonical to produce
    ClosedVocabCandidate records. Returns top-1 (N=1 hardcoded in 2A).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import yaml

CONFIG_ROOT = Path(__file__).parent.parent / "configs" / "closed_vocab"


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

    def predict_log_probs(self, crop):  # noqa: ANN001
        """Phase 2B LR-head classifier stub.

        Phase 2A uses alias-regex matching only via :meth:`match_canonical`.
        This method is reserved for Phase 2B, which will wire in a trained
        sklearn LogisticRegression head behind the same interface.

        Raises
        ------
        NotImplementedError: always, in Phase 2A.
        """
        raise NotImplementedError(
            "predict_log_probs is a Phase 2B feature; "
            "Phase 2A uses ClosedVocab.match_canonical (alias regex) only."
        )


# ---------------------------------------------------------------------------
# Internal helpers
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

    EXTRACTOR_VERSION = "closed-vocab-alias-v1"

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
