"""Reduce evidence records to per-subject field maps and align to truth.

Pure (no DB / extractor / filesystem). Used by score_field_benchmark.py.
"""

from __future__ import annotations

import re
from typing import Optional


def normalize_tag(tag: Optional[str]) -> str:
    """Lowercase, strip every non-alphanumeric char — tolerant gamertag key."""
    if not tag:
        return ""
    return re.sub(r"[^a-z0-9]", "", tag.lower())


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def records_to_subjects(records) -> dict[str, dict]:
    """Group records by subject_slot_key; pick the best candidate per field.

    Returns ``{slot_key: {field_key: candidate_value}}``. "Best" = lowest
    candidate_rank, then highest raw_confidence — the same precedence the
    promotion gate applies. (The golden can carry two rank-0 records for one
    field, e.g. a null/low-quality one and the real observable value; the
    higher-confidence one must win.)
    """
    # (rank, -confidence) sort key; lower is better.
    best_key: dict[tuple[str, str], tuple[int, float]] = {}
    out: dict[str, dict] = {}
    for r in records:
        slot = r.get("subject_slot_key")
        field = r.get("field_key")
        if slot is None or field is None:
            continue
        rank = r.get("candidate_rank", 0)
        conf = r.get("raw_confidence") or 0.0
        sort_key = (rank, -conf)
        key = (slot, field)
        if key not in best_key or sort_key < best_key[key]:
            best_key[key] = sort_key
            out.setdefault(slot, {})[field] = r.get("candidate_value")
    return out


def align_by_gamertag(
    pred_subjects: dict[str, dict],
    truth_subjects: dict[str, dict],
    *,
    max_distance: int = 3,
) -> dict[str, Optional[str]]:
    """Map each truth subject key → the best-matching predicted slot key.

    Matches on normalized gamertag, tolerating OCR drift up to ``max_distance``
    edits. Each predicted slot is consumed at most once (best truth wins). A
    truth subject with no close predicted tag maps to ``None`` (a missed slot).
    """
    pred_norm = {slot: normalize_tag(f.get("gamertag")) for slot, f in pred_subjects.items()}

    # Score every (truth, pred) pairing, then assign greedily by closest match.
    candidates: list[tuple[int, str, str]] = []
    for tkey, tfields in truth_subjects.items():
        tnorm = normalize_tag(tfields.get("gamertag"))
        if not tnorm:
            continue
        for slot, pnorm in pred_norm.items():
            if not pnorm:
                continue
            dist = _levenshtein(tnorm, pnorm)
            if dist <= max_distance:
                candidates.append((dist, tkey, slot))

    candidates.sort(key=lambda c: c[0])
    aligned: dict[str, Optional[str]] = {tkey: None for tkey in truth_subjects}
    used_slots: set[str] = set()
    for _dist, tkey, slot in candidates:
        if aligned.get(tkey) is None and slot not in used_slots:
            aligned[tkey] = slot
            used_slots.add(slot)
    return aligned
