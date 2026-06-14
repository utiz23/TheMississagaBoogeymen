"""Unit tests for benchmark subject reduction + gamertag alignment.

These pure helpers turn a flat FieldEvidenceRecord list into one rank-0 field
map per subject slot, and align predicted slots to labeled (team_side,position)
subjects by gamertag. Misalignment would silently corrupt every metric, so the
alignment is fuzzy (tolerates OCR drift) but never crosses to an unrelated tag.
"""

from game_ocr.benchmark.subject_align import (
    align_by_gamertag,
    normalize_tag,
    records_to_subjects,
)


def test_normalize_tag_strips_case_and_nonalnum():
    assert normalize_tag("Stick Menace") == "stickmenace"
    assert normalize_tag("MrHomicide") == "mrhomicide"


def test_records_to_subjects_keeps_rank0_per_field():
    records = [
        {"subject_slot_key": "s0", "field_key": "gamertag", "candidate_value": "WRONG", "candidate_rank": 1},
        {"subject_slot_key": "s0", "field_key": "gamertag", "candidate_value": "MrHomicide", "candidate_rank": 0},
        {"subject_slot_key": "s0", "field_key": "position", "candidate_value": "C", "candidate_rank": 0},
    ]
    subjects = records_to_subjects(records)
    assert subjects["s0"]["gamertag"] == "MrHomicide"  # rank-0 wins
    assert subjects["s0"]["position"] == "C"


def test_records_to_subjects_breaks_rank_ties_by_confidence():
    # Two rank-0 records for the same field (a real quirk in the golden): a
    # null/low-confidence one and the real observable value. The reduction must
    # pick the higher-confidence candidate, like the promoter would.
    records = [
        {"subject_slot_key": "s0", "field_key": "x_factor_name_0", "candidate_value": None,
         "candidate_rank": 0, "raw_confidence": 0.0},
        {"subject_slot_key": "s0", "field_key": "x_factor_name_0", "candidate_value": "Wheels",
         "candidate_rank": 0, "raw_confidence": 0.62},
    ]
    subjects = records_to_subjects(records)
    assert subjects["s0"]["x_factor_name_0"] == "Wheels"


def test_align_matches_exact_and_fuzzy_gamertag():
    truth = {
        "for_C": {"gamertag": "MrHomicide"},
        "for_LW": {"gamertag": "Stick Menace"},
    }
    pred = {
        "s0": {"gamertag": "MrHomiecide"},   # 1-char OCR drift → still for_C
        "s1": {"gamertag": "StickMenace"},   # spacing drift → for_LW
    }
    aligned = align_by_gamertag(pred, truth)
    assert aligned["for_C"] == "s0"
    assert aligned["for_LW"] == "s1"


def test_align_leaves_truth_unmatched_when_no_close_tag():
    truth = {"for_C": {"gamertag": "MrHomicide"}}
    pred = {"s9": {"gamertag": "CompletelyDifferent"}}
    aligned = align_by_gamertag(pred, truth)
    assert aligned["for_C"] is None
