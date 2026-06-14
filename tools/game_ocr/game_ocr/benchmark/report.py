"""Score a match's predicted evidence against its ground-truth labels.

Ties together the pure scoring core (field_scoring) and subject alignment
(subject_align) into a per-field benchmark report. Predicted "evidence" is a
flat list of FieldEvidenceRecord-shaped dicts (the extractor / golden output);
labels are the per-subject ground truth produced by import_v2_benchmark_md.py.
"""

from __future__ import annotations

import re
from typing import Optional

from game_ocr.benchmark.field_scoring import (
    ConfusionMatrix,
    FieldAggregate,
    compare_value,
    delta_sign,
    mean_absolute_error,
)
from game_ocr.benchmark.subject_align import (
    align_by_gamertag,
    normalize_tag,
    records_to_subjects,
)
from game_ocr.loadout_extractors.closed_vocab import load_closed_vocab

ATTRIBUTE_VALUE_TOLERANCE = 1

# label-field, evidence field_key, kind
SCALAR_FIELDS = [
    ("gamertag", "gamertag", "tag"),
    ("persona", "persona_raw", "tag"),
    ("player_number", "jersey_number", "int"),
    ("player_level", "player_level_raw", "level"),
    ("position", "position", "categorical"),
    ("build_class_canonical", "build_class", "build"),
    ("handedness", "handedness", "categorical"),
]

_BUILD = load_closed_vocab("build_classes")
_XF = load_closed_vocab("x_factors")
_TIER = load_closed_vocab("x_factor_tiers")


def _canon(vocab, raw):
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    hit = vocab.match_canonical(s)
    return hit[0] if hit else s


def _parse_int(raw) -> Optional[int]:
    if raw is None:
        return None
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return int(raw)
    m = re.search(r"-?\d+", str(raw))
    return int(m.group()) if m else None


def _parse_level(raw) -> Optional[int]:
    if raw is None:
        return None
    m = re.search(r"level\s*(\d+)", str(raw), re.IGNORECASE)
    if m:
        return int(m.group(1))
    return _parse_int(raw)


def _norm_scalar(kind: str, value):
    """Normalize a predicted/truth value for comparison by field kind."""
    if value is None:
        return None
    if kind == "tag":
        n = normalize_tag(str(value))
        return n or None
    if kind == "int":
        return _parse_int(value)
    if kind == "level":
        return _parse_level(value)
    if kind == "build":
        return _canon(_BUILD, value)
    if kind == "categorical":
        s = str(value).strip()
        return s or None
    return value


def _compare_kind(kind: str) -> str:
    return "numeric_exact" if kind in ("int", "level") else "categorical"


def score_match(labels: dict, records: list) -> dict:
    """Return a per-field benchmark report for one match."""
    truth = labels["subjects"]
    pred_subjects = records_to_subjects(records)
    aligned = align_by_gamertag(pred_subjects, truth)

    scalar = {lf: FieldAggregate() for lf, _, _ in SCALAR_FIELDS}
    xf_name = FieldAggregate()
    xf_tier = FieldAggregate()
    captain = ConfusionMatrix()
    attr_value = FieldAggregate()
    attr_delta_sign = FieldAggregate()
    delta_pairs: list[tuple] = []
    matched, unmatched = 0, 0

    for tkey, tfields in truth.items():
        slot = aligned.get(tkey)
        pred = pred_subjects.get(slot, {}) if slot else {}
        if slot:
            matched += 1
        else:
            unmatched += 1

        # Scalar fields.
        for lf, fk, kind in SCALAR_FIELDS:
            t = _norm_scalar(kind, tfields.get(lf))
            p = _norm_scalar(kind, pred.get(fk))
            scalar[lf].add(compare_value(_compare_kind(kind), p, t))

        # Captain confusion (truth is always labeled bool here).
        t_cap = tfields.get("is_captain")
        if isinstance(t_cap, bool):
            captain.add(predicted=(pred.get("is_captain") is True), truth=t_cap)

        # X-Factors per slot index (name + tier).
        for i, xf in enumerate(tfields.get("x_factors", [])):
            t_name = _canon(_XF, xf.get("name"))
            p_name = _canon(_XF, pred.get(f"x_factor_name_{i}"))
            xf_name.add(compare_value("categorical", p_name, t_name))
            t_tier = _canon(_TIER, xf.get("tier"))
            p_tier = _canon(_TIER, pred.get(f"x_factor_tier_{i}"))
            xf_tier.add(compare_value("categorical", p_tier, t_tier))

        # Attributes: value (±tol) and delta (sign + MAE).
        for akey, av in tfields.get("attributes", {}).items():
            t_val = av.get("value")
            p_val = _parse_int(pred.get(f"attribute_{akey}_value"))
            attr_value.add(
                compare_value("numeric_tol", p_val, t_val, tolerance=ATTRIBUTE_VALUE_TOLERANCE)
            )
            t_delta = av.get("delta")
            if t_delta is not None:
                p_delta = _parse_int(pred.get(f"attribute_{akey}_delta"))
                attr_delta_sign.add(
                    compare_value(
                        "categorical",
                        delta_sign(p_delta) if p_delta is not None else None,
                        delta_sign(t_delta),
                    )
                )
                delta_pairs.append((p_delta, t_delta))

    def agg(a: FieldAggregate) -> dict:
        return {
            "precision": round(a.precision, 4),
            "recall": round(a.recall, 4),
            "f1": round(a.f1, 4),
            "accuracy": round(a.accuracy, 4),
            "scored": a.scored,
            "correct": a.correct,
            "wrong": a.wrong,
            "missing": a.missing,
        }

    fields = {lf: agg(scalar[lf]) for lf, _, _ in SCALAR_FIELDS}
    fields["x_factor_name"] = agg(xf_name)
    fields["x_factor_tier"] = agg(xf_tier)
    fields["attribute_value"] = agg(attr_value)
    fields["attribute_delta_sign"] = agg(attr_delta_sign)

    return {
        "match_id": labels.get("match_id"),
        "split": labels.get("split"),
        "subjects": {"truth": len(truth), "matched": matched, "unmatched": unmatched},
        "fields": fields,
        "captain": {
            "tp": captain.tp,
            "fp": captain.fp,
            "fn": captain.fn,
            "tn": captain.tn,
            "precision": round(captain.precision, 4),
            "recall": round(captain.recall, 4),
            "f1": round(captain.f1, 4),
        },
        "attribute_delta_mae": round(mean_absolute_error(delta_pairs), 4),
    }


def format_table(report: dict) -> str:
    """Render a report dict as a compact fixed-width table."""
    lines = []
    m = report
    lines.append(
        f"match {m['match_id']} (split={m['split']}) — "
        f"subjects: {m['subjects']['matched']}/{m['subjects']['truth']} matched, "
        f"{m['subjects']['unmatched']} missing"
    )
    lines.append(f"{'field':<24}{'acc':>8}{'prec':>8}{'recall':>8}{'f1':>8}{'scored':>8}")
    for name, st in m["fields"].items():
        lines.append(
            f"{name:<24}{st['accuracy']:>8.3f}{st['precision']:>8.3f}"
            f"{st['recall']:>8.3f}{st['f1']:>8.3f}{st['scored']:>8d}"
        )
    c = m["captain"]
    lines.append(
        f"captain ★: tp={c['tp']} fp={c['fp']} fn={c['fn']} tn={c['tn']} "
        f"prec={c['precision']:.3f} recall={c['recall']:.3f}"
    )
    lines.append(f"attribute_delta_mae: {m['attribute_delta_mae']:.3f}")
    return "\n".join(lines)
