"""Unit tests for the pure per-field benchmark scoring core.

The scoring core (game_ocr.benchmark.field_scoring) compares a predicted
field value against a labeled ground-truth value and classifies the outcome,
then aggregates outcomes per field into precision/recall/F1. It is pure (no
DB, no extractor, no filesystem) so it can be exercised in isolation.
"""

import math

from game_ocr.benchmark.field_scoring import (
    CORRECT,
    MISSING,
    SKIP,
    WRONG,
    ConfusionMatrix,
    FieldAggregate,
    compare_value,
    delta_sign,
    mean_absolute_error,
)


def test_categorical_exact_match_is_correct():
    assert compare_value("categorical", "Playmaker", "Playmaker") == CORRECT


def test_categorical_mismatch_is_wrong():
    assert compare_value("categorical", "Sniper", "Playmaker") == WRONG


def test_truth_absent_is_skip_even_when_predicted():
    # Unlabeled ground truth (None) is never scored, regardless of prediction.
    assert compare_value("categorical", "Sniper", None) == SKIP


def test_predicted_absent_but_truth_present_is_missing():
    assert compare_value("categorical", None, "Playmaker") == MISSING


def test_numeric_tolerance_within_band_is_correct():
    assert compare_value("numeric_tol", 81, 80, tolerance=1) == CORRECT


def test_numeric_tolerance_outside_band_is_wrong():
    assert compare_value("numeric_tol", 83, 80, tolerance=1) == WRONG


def test_numeric_exact_off_by_one_is_wrong():
    assert compare_value("numeric_exact", 18, 17) == WRONG


def test_field_aggregate_precision_recall_f1_accuracy():
    agg = FieldAggregate()
    for outcome in [CORRECT, CORRECT, CORRECT, WRONG, MISSING, SKIP]:
        agg.add(outcome)
    # scored = correct(3) + wrong(1) + missing(1) = 5; SKIP excluded
    assert agg.scored == 5
    assert agg.precision == 0.75               # correct / (correct + wrong)
    assert agg.recall == 0.6                    # correct / (correct + wrong + missing)
    assert agg.accuracy == 0.6                  # correct / scored
    assert math.isclose(agg.f1, 2 * 0.75 * 0.6 / (0.75 + 0.6))


def test_field_aggregate_with_no_scored_cells_is_zero_not_nan():
    agg = FieldAggregate()
    agg.add(SKIP)
    assert agg.scored == 0
    assert agg.precision == 0.0
    assert agg.recall == 0.0
    assert agg.f1 == 0.0


def test_captain_confusion_matrix_separates_false_positive_from_false_negative():
    cm = ConfusionMatrix()
    # The documented FP-LW case: a non-captain predicted captain.
    cm.add(predicted=True, truth=False)   # false positive
    cm.add(predicted=False, truth=True)   # false negative (a real captain missed)
    cm.add(predicted=True, truth=True)    # true positive
    cm.add(predicted=False, truth=False)  # true negative
    assert (cm.tp, cm.fp, cm.fn, cm.tn) == (1, 1, 1, 1)
    assert cm.precision == 0.5             # tp / (tp + fp)
    assert cm.recall == 0.5                # tp / (tp + fn)


def test_delta_sign_maps_to_minus_zero_plus():
    assert delta_sign(-3) == "-"
    assert delta_sign(0) == "0"
    assert delta_sign(5) == "+"


def test_mean_absolute_error_ignores_unlabeled_pairs():
    # (pred, truth) pairs; None truth skipped.
    pairs = [(80, 80), (79, 81), (50, None)]
    assert mean_absolute_error(pairs) == 1.0  # |80-80| + |79-81| over 2 scored = 2/2
