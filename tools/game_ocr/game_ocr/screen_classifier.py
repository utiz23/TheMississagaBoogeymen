"""Phase 1 learned screen classifier — a multinomial logistic regression
over a compact feature vector. Replaces the single-prototype HSV-cosine
classifier as the primary per-frame signal feeding the Viterbi decoder
(Round 4 §1 disagreement-3 adjudication, §12 — HSV-cosine demoted).

Why sklearn LR rather than a CNN: Phase 1's effort budget is 40-80 hours and
the calibration corpus has ~12-30 fixtures, not thousands. A linear model
over hand-engineered features is appropriate at this corpus scale, trains
in seconds, and exports to a stable JSON artifact that's reviewable in git.
Phase 5 can swap for a CNN/CLIP head behind the same `predict_log_probs`
interface if the corpus grows enough to justify it.

Weights artifact format (JSON):
  {
    "schema_version": 1,
    "version": "nhl26",
    "decoder_version": "hmm-viterbi-v1",
    "classes": [<state names in row order>],
    "intercept": [...],
    "coef": [[...], [...]]   # shape (n_states, n_features)
  }
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
from sklearn.linear_model import LogisticRegression

from game_ocr.frame_features import FrameFeatures
from game_ocr.state_machine import StateMachine


WEIGHTS_DIR = Path(__file__).resolve().parent / "weights"


@dataclass(frozen=True)
class ScreenClassifierWeights:
    version: str
    decoder_version: str
    classes: tuple[str, ...]
    intercept: np.ndarray
    coef: np.ndarray


def feature_vector(features: FrameFeatures, state_machine: StateMachine) -> np.ndarray:
    """Concatenate signals into a single 1-D vector.

    Layout: [hsv_histogram(192) || anchor_flags(N) || brightness || log1p(blur) || reject_flag]
    Length: 192 + N + 3.
    """
    n = len(state_machine.states)
    out = np.empty(192 + n + 3, dtype=np.float64)
    out[:192] = features.hsv_histogram
    out[192:192 + n] = features.anchor_flags
    out[192 + n + 0] = features.brightness
    out[192 + n + 1] = math.log1p(max(0.0, features.blur_score))
    out[192 + n + 2] = 1.0 if features.reject_anchor_present else 0.0
    return out


class ScreenClassifier:
    """Wrapper around sklearn LR exposing predict_log_probs over the state set."""

    def __init__(self, weights: ScreenClassifierWeights, state_machine: StateMachine) -> None:
        if weights.version != state_machine.version:
            raise ValueError(
                f"weights version {weights.version!r} != state machine {state_machine.version!r}"
            )
        if weights.classes != state_machine.states:
            raise ValueError(
                "weights.classes do not match state machine.states ordering"
            )
        self.weights = weights
        self.state_machine = state_machine

    def predict_log_probs(self, features: FrameFeatures) -> np.ndarray:
        x = feature_vector(features, self.state_machine)
        # logits = coef @ x + intercept, then log-softmax.
        logits = self.weights.coef @ x + self.weights.intercept
        # log-softmax for numerical stability.
        m = float(logits.max())
        log_sum_exp = m + math.log(float(np.exp(logits - m).sum()))
        return logits - log_sum_exp

    def save(self, path: Path) -> None:
        payload = {
            "schema_version": 1,
            "version": self.weights.version,
            "decoder_version": self.weights.decoder_version,
            "classes": list(self.weights.classes),
            "intercept": self.weights.intercept.tolist(),
            "coef": self.weights.coef.tolist(),
        }
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2))


def train_screen_classifier(
    features: Iterable[FrameFeatures],
    labels: Iterable[str],
    state_machine: StateMachine,
) -> ScreenClassifier:
    features_list = list(features)
    labels_list = list(labels)
    if len(features_list) != len(labels_list):
        raise ValueError("features and labels length mismatch")
    if len(features_list) == 0:
        raise ValueError("cannot train on empty corpus")

    X = np.stack([feature_vector(f, state_machine) for f in features_list])
    # Map labels to ordered class indices to keep the row ordering aligned
    # with state_machine.states.
    label_to_idx = {s: i for i, s in enumerate(state_machine.states)}
    for lbl in labels_list:
        if lbl not in label_to_idx:
            raise ValueError(f"unknown label {lbl!r} not in state machine")
    y = np.array([label_to_idx[lbl] for lbl in labels_list], dtype=np.int64)

    # Build a matrix in state-machine order so coef rows align with states.
    # sklearn fits classes by sorted unique label values; we sort indices,
    # then re-order coef/intercept back to state-machine order below.
    lr = LogisticRegression(
        solver="lbfgs",
        max_iter=1000,
        C=1.0,
    )
    lr.fit(X, y)

    # sklearn returns coef/intercept ordered by lr.classes_; re-order so
    # row i corresponds to state_machine.states[i].
    sklearn_order = list(lr.classes_)
    coef_full = np.zeros((len(state_machine.states), X.shape[1]), dtype=np.float64)
    intercept_full = np.zeros(len(state_machine.states), dtype=np.float64)
    for row, cls in enumerate(sklearn_order):
        coef_full[cls] = lr.coef_[row]
        intercept_full[cls] = lr.intercept_[row]

    weights = ScreenClassifierWeights(
        version=state_machine.version,
        decoder_version=state_machine.decoder_version,
        classes=state_machine.states,
        intercept=intercept_full,
        coef=coef_full,
    )
    return ScreenClassifier(weights, state_machine)


def load_screen_classifier(path: Path, state_machine: StateMachine) -> ScreenClassifier:
    raw = json.loads(Path(path).read_text())
    if int(raw.get("schema_version", 0)) != 1:
        raise ValueError(f"unsupported screen_classifier schema_version: {raw.get('schema_version')}")
    weights = ScreenClassifierWeights(
        version=str(raw["version"]),
        decoder_version=str(raw["decoder_version"]),
        classes=tuple(raw["classes"]),
        intercept=np.asarray(raw["intercept"], dtype=np.float64),
        coef=np.asarray(raw["coef"], dtype=np.float64),
    )
    return ScreenClassifier(weights, state_machine)
