"""Unit tests for surface-agnostic persona scoring in the benchmark report.

A persona is rendered two ways depending on the source surface: the lobby and
the hand labels carry the full name ("Evgeni Wanhg"), while the loadout card —
and therefore the production `--from-consolidated` / `--from-db` surface —
abbreviates the first name to an initial ("E. WANHG") or drops it ("-. Silky").
`_persona_match` reconciles the two so the full-name golden and the abbreviated
consolidated surface clear the *same* persona floor, while a genuinely wrong
player (different first initial on the same surname) still scores WRONG.
"""

from game_ocr.benchmark.field_scoring import CORRECT, MISSING, SKIP, WRONG
from game_ocr.benchmark.report import _compare_persona, _persona_match, score_match


# --- _persona_match: the reconciliation contract ---------------------------


def test_initial_abbreviation_matches_full_name():
    # The core case: the loadout card's "E. WANHG" is the same player as the
    # lobby/label "Evgeni Wanhg" (same surname, first initial prefixes first name).
    assert _persona_match("E. WANHG", "Evgeni Wanhg") is True
    assert _persona_match("M. RANTANEN", "Mikko Rantanen") is True


def test_dropped_first_name_matches_on_surname():
    # A bare surname ("TOEWS") or a dash-prefixed one ("-. Toews") reconciles
    # with a fuller rendering that shares the surname.
    assert _persona_match("TOEWS", "-. Toews") is True
    assert _persona_match("Silky", "-. Silky") is True


def test_ocr_merged_tokens_still_match():
    # Exact normalized-blob equality (the pre-existing behavior) must survive:
    # OCR sometimes drops the space ("SergeiZubov" == "Sergei Zubov").
    assert _persona_match("SergeiZubov", "Sergei Zubov") is True


def test_wrong_first_initial_same_surname_is_mismatch():
    # A different first initial on the same surname is a different player and
    # must NOT reconcile — this is what keeps the gate honest.
    assert _persona_match("J. RANTANEN", "Mikko Rantanen") is False


def test_different_surname_is_mismatch():
    assert _persona_match("E. WANHG", "Evgeni Jenkins") is False


def test_full_first_names_that_differ_do_not_match():
    # Both sides carry a full (non-initial) first name; they must match exactly.
    assert _persona_match("Robert Smith", "Roger Smith") is False


def test_both_absent_match_neither_present():
    assert _persona_match(None, None) is True
    assert _persona_match("E. WANHG", None) is False


# --- _compare_persona: the outcome contract (mirrors compare_value) ---------


def test_unlabeled_truth_is_skip():
    assert _compare_persona("E. WANHG", None) == SKIP
    assert _compare_persona("E. WANHG", "-.") == SKIP  # punctuation-only truth


def test_absent_prediction_against_labeled_truth_is_missing():
    assert _compare_persona(None, "Evgeni Wanhg") == MISSING


def test_abbreviated_prediction_is_correct():
    assert _compare_persona("E. WANHG", "Evgeni Wanhg") == CORRECT


def test_wrong_player_is_wrong():
    assert _compare_persona("J. RANTANEN", "Mikko Rantanen") == WRONG


# --- score_match: end-to-end persona field on an abbreviated surface --------


def _rec(slot, field, value):
    return {
        "subject_slot_key": slot,
        "field_key": field,
        "candidate_value": value,
        "candidate_rank": 0,
        "raw_confidence": 1.0,
    }


def test_score_match_abbreviated_surface_scores_persona_correct():
    labels = {
        "match_id": 9001,
        "split": "test",
        "subjects": {
            "for_C": {"gamertag": "MrHomicide", "persona": "Evgeni Wanhg"},
            "for_LW": {"gamertag": "Stick Menace", "persona": "Mikko Rantanen"},
        },
    }
    # Predicted surface renders both personas as loadout-card abbreviations.
    records = [
        _rec("for_C", "gamertag", "MrHomicide"),
        _rec("for_C", "persona_raw", "E. WANHG"),
        _rec("for_LW", "gamertag", "Stick Menace"),
        _rec("for_LW", "persona_raw", "M. RANTANEN"),
    ]
    report = score_match(labels, records)
    assert report["fields"]["persona"]["accuracy"] == 1.0


def test_score_match_wrong_player_is_not_reconciled():
    labels = {
        "match_id": 9002,
        "split": "test",
        "subjects": {
            "for_LW": {"gamertag": "Stick Menace", "persona": "Mikko Rantanen"},
        },
    }
    records = [
        _rec("for_LW", "gamertag", "Stick Menace"),
        _rec("for_LW", "persona_raw", "J. RANTANEN"),  # wrong first initial
    ]
    report = score_match(labels, records)
    assert report["fields"]["persona"]["accuracy"] == 0.0
