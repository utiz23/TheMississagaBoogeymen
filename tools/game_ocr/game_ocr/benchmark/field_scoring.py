"""Pure per-field benchmark scoring core.

Compares a predicted field value against a labeled ground-truth value and
classifies the outcome. No DB / extractor / filesystem dependencies.
"""

from __future__ import annotations

from dataclasses import dataclass

# Outcome labels.
CORRECT = "correct"   # truth present, prediction present and matches
WRONG = "wrong"       # truth present, prediction present but mismatches
MISSING = "missing"   # truth present, prediction absent
SKIP = "skip"         # truth absent / unlabeled — never scored


def compare_value(kind: str, predicted, truth, *, tolerance: int = 0) -> str:
    """Classify a single predicted value against ground truth.

    ``truth is None`` means the cell is unlabeled and is never scored (SKIP).
    ``predicted is None`` with a labeled truth is a MISSING (a recall miss).

    Supported ``kind`` values:
      - ``categorical`` / ``numeric_exact`` / ``bool``: exact equality.
      - ``numeric_tol``: correct when ``abs(pred - truth) <= tolerance``.
    """
    if truth is None:
        return SKIP
    if predicted is None:
        return MISSING
    if kind == "numeric_tol":
        return CORRECT if abs(predicted - truth) <= tolerance else WRONG
    return CORRECT if predicted == truth else WRONG


@dataclass
class FieldAggregate:
    """Accumulates per-cell outcomes for one field into P/R/F1/accuracy.

    SKIP outcomes (unlabeled truth) are not counted toward any denominator.
      - precision = correct / (correct + wrong)        — of predictions made
      - recall    = correct / (correct + wrong + missing) — of known truths
      - accuracy  = correct / scored                   — scored = the recall denom
    """

    correct: int = 0
    wrong: int = 0
    missing: int = 0

    def add(self, outcome: str) -> None:
        if outcome == CORRECT:
            self.correct += 1
        elif outcome == WRONG:
            self.wrong += 1
        elif outcome == MISSING:
            self.missing += 1
        # SKIP: not counted.

    @property
    def scored(self) -> int:
        return self.correct + self.wrong + self.missing

    @property
    def precision(self) -> float:
        denom = self.correct + self.wrong
        return self.correct / denom if denom else 0.0

    @property
    def recall(self) -> float:
        return self.correct / self.scored if self.scored else 0.0

    @property
    def accuracy(self) -> float:
        return self.recall

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if (p + r) else 0.0


@dataclass
class ConfusionMatrix:
    """Binary confusion matrix for a bool field (e.g. captain ★).

    Keeps FP and FN distinct so a false-positive captain (the documented
    FP-LW case) is visible separately from a missed real captain.
    """

    tp: int = 0
    fp: int = 0
    fn: int = 0
    tn: int = 0

    def add(self, *, predicted: bool, truth: bool) -> None:
        if truth and predicted:
            self.tp += 1
        elif truth and not predicted:
            self.fn += 1
        elif not truth and predicted:
            self.fp += 1
        else:
            self.tn += 1

    @property
    def precision(self) -> float:
        denom = self.tp + self.fp
        return self.tp / denom if denom else 0.0

    @property
    def recall(self) -> float:
        denom = self.tp + self.fn
        return self.tp / denom if denom else 0.0

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if (p + r) else 0.0


def delta_sign(value: int) -> str:
    """Map a signed delta to its sign bucket: '-', '0', or '+'."""
    if value < 0:
        return "-"
    if value > 0:
        return "+"
    return "0"


def mean_absolute_error(pairs) -> float:
    """Mean |pred - truth| over (pred, truth) pairs; skips pairs with None."""
    scored = [(p, t) for p, t in pairs if t is not None and p is not None]
    if not scored:
        return 0.0
    return sum(abs(p - t) for p, t in scored) / len(scored)
