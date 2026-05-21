"""Phase 2A closed-vocabulary loader for the player_loadout_view screen family.

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
