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

Weights artifact format (JSON) — schema_version dispatch:

  schema_version=1 (v1, hmm-viterbi-v1):
    {
      "schema_version": 1,
      "version": "nhl26",
      "decoder_version": "hmm-viterbi-v1",
      "classes": [<state names in row order>],
      "intercept": [...],
      "coef": [[...], [...]]   # shape (n_states, n_features)
    }

  schema_version=2 (v2, hmm-viterbi-v2):
    {
      "schema_version": 2,
      "version": "nhl26",
      "decoder_version": "hmm-viterbi-v2",
      "classes": [<state names in row order>],
      "n_priors": <int>,        # regex_priors.n_priors() at train time
      "intercept": [...],
      "coef": [[...], [...]]
    }
"""

from __future__ import annotations

import json
import math
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
from sklearn.linear_model import LogisticRegression

from game_ocr.frame_features import FrameFeatures, FrameFeaturesV2
from game_ocr.regex_priors import RegexPriorsConfig
from game_ocr.state_machine import StateMachine


WEIGHTS_DIR = Path(__file__).resolve().parent / "weights"

MISSING_STATE_INTERCEPT = -10.0


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
        if weights.decoder_version != state_machine.decoder_version:
            raise ValueError(
                f"weights decoder_version {weights.decoder_version!r} != "
                f"state machine {state_machine.decoder_version!r}"
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
    *,
    allow_missing_states: bool = False,
) -> ScreenClassifier:
    """Fit a multinomial LogisticRegression over FrameFeatures.

    Args:
        features: per-fixture FrameFeatures.
        labels: parallel list of state-machine state names.
        state_machine: the StateMachine whose state ordering defines
            the row order of the trained `coef`/`intercept` arrays.
        allow_missing_states: when False (default), raises ValueError if any
            state-machine state is absent from `labels`. When True, missing
            states are assigned `intercept=MISSING_STATE_INTERCEPT` (~-10.0)
            and all-zero coefs so they cannot win on classifier signal alone;
            the emission combiner's anchor bonus can still surface them via
            anchor flags.

    Returns:
        ScreenClassifier wrapping the trained weights, with row order matching
        `state_machine.states` (NOT sklearn's sorted classes order).

    Raises:
        ValueError: when features/labels length mismatch, the corpus is empty,
            a label is not in `state_machine.states`, fewer than 3 distinct
            labels appear (binary LR shape mismatch), or — with
            `allow_missing_states=False` — any state is missing from labels.
    """
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
    unique_labels = set(labels_list)
    n_seen = len(unique_labels)
    if n_seen < 3:
        raise ValueError(
            f"training corpus must cover at least 3 distinct states (got {n_seen}); "
            "binary LogisticRegression produces a (1, n_features) coef_ that "
            "breaks the row-reorder mapping"
        )
    missing = sorted(set(state_machine.states) - unique_labels)
    if missing and not allow_missing_states:
        raise ValueError(
            f"training corpus missing states {missing!r}; "
            "all state-machine states must appear at least once OR "
            "call with allow_missing_states=True (missing states get "
            f"intercept={MISSING_STATE_INTERCEPT} so anchor signals can still surface them)"
        )
    y = np.array([label_to_idx[lbl] for lbl in labels_list], dtype=np.int64)

    # Build a matrix in state-machine order so coef rows align with states.
    # sklearn fits classes by sorted unique label values; we sort indices,
    # then re-order coef/intercept back to state-machine order below.
    lr = LogisticRegression(
        solver="lbfgs",
        max_iter=1000,
        C=1.0,
    )
    # sklearn warns when len(unique_labels)/len(samples) is high. For a
    # purpose-built multi-class corpus (≤30 fixtures, 17 states) the ratio
    # is intentionally high; the warning is a false positive here.
    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore",
            message=".*unique classes.*",
            category=UserWarning,
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

    # Missing-state fallback: states that were not in the training corpus get a
    # strongly negative intercept so they never win on classifier signal alone.
    # The emission combiner's anchor_bonus can still surface them via per-state
    # anchor flags (Round 4 §4 — learned classifier is one signal among many).
    if missing:
        for state in missing:
            i = state_machine.state_index(state)
            intercept_full[i] = MISSING_STATE_INTERCEPT

    weights = ScreenClassifierWeights(
        version=state_machine.version,
        decoder_version=state_machine.decoder_version,
        classes=state_machine.states,
        intercept=intercept_full,
        coef=coef_full,
    )
    return ScreenClassifier(weights, state_machine)


def _load_v1(raw: dict, state_machine: StateMachine) -> ScreenClassifier:
    weights = ScreenClassifierWeights(
        version=str(raw["version"]),
        decoder_version=str(raw["decoder_version"]),
        classes=tuple(raw["classes"]),
        intercept=np.asarray(raw["intercept"], dtype=np.float64),
        coef=np.asarray(raw["coef"], dtype=np.float64),
    )
    return ScreenClassifier(weights, state_machine)


def _load_v2(raw: dict, state_machine: StateMachine) -> "ScreenClassifierV2":
    if "n_priors" not in raw:
        raise ValueError("schema_version=2 weights missing required 'n_priors' field")
    weights = ScreenClassifierV2Weights(
        version=str(raw["version"]),
        decoder_version=str(raw["decoder_version"]),
        classes=tuple(raw["classes"]),
        n_priors=int(raw["n_priors"]),
        intercept=np.asarray(raw["intercept"], dtype=np.float64),
        coef=np.asarray(raw["coef"], dtype=np.float64),
    )
    return ScreenClassifierV2(weights, state_machine)


def load_screen_classifier(
    path: Path, state_machine: StateMachine
) -> "ScreenClassifier | ScreenClassifierV2":
    """Dispatch on schema_version. Returns v1 or v2 classifier accordingly.

    Caller is responsible for ensuring `state_machine.decoder_version`
    matches the schema family being loaded (the per-version `__init__`
    checks fire on mismatch).
    """
    raw = json.loads(Path(path).read_text())
    sv = int(raw.get("schema_version", 0))
    if sv == 1:
        return _load_v1(raw, state_machine)
    if sv == 2:
        return _load_v2(raw, state_machine)
    raise ValueError(f"unsupported screen_classifier schema_version: {sv}")


# ─── v2 classifier (schema_version=2, hmm-viterbi-v2) ────────────────────────


# Fixed-width portion of the v2 feature vector. The total dim is
# _V2_FIXED_DIMS + n_priors (the regex-priors count is config-dependent).
#   full_frame_hsv (48) + quadrant_hsvs (4*48=192) +
#   quadrant_brightness (4) + log1p(quadrant_blur)(4) +
#   quadrant_edge_density (4) + ocr_presence_flags (3) = 255
_V2_FIXED_DIMS = 48 + 4 * 48 + 4 + 4 + 4 + 3


def feature_vector_v2(
    features: FrameFeaturesV2,
    state_machine: StateMachine,
    *,
    n_priors: int,
) -> np.ndarray:
    """Concatenate v2 signals into a single 1-D float vector.

    Layout (insertion-stable; treated as the model's training-time contract):
      [full_frame_hsv(48)
       || quadrant_hsvs[0..3](4*48=192)
       || quadrant_brightness(4)
       || log1p(quadrant_blur)(4)
       || quadrant_edge_density(4)
       || regex_prior_flags(n_priors)
       || ocr_presence_flags(3)]

    The `state_machine` arg is accepted for parity with v1 + future state-aware
    extensions; it is unused here (v2 has no per-state anchor flags — regex
    priors replace that signal).
    """
    del state_machine  # reserved for future use
    if features.regex_prior_flags.shape[0] != n_priors:
        raise ValueError(
            f"regex_prior_flags has {features.regex_prior_flags.shape[0]} dims, "
            f"expected {n_priors}"
        )
    total = _V2_FIXED_DIMS + n_priors
    out = np.empty(total, dtype=np.float64)
    i = 0
    out[i:i + 48] = features.full_frame_hsv; i += 48
    for q in features.quadrant_hsvs:
        out[i:i + 48] = q; i += 48
    out[i:i + 4] = features.quadrant_brightness; i += 4
    out[i:i + 4] = np.log1p(np.maximum(0.0, features.quadrant_blur)); i += 4
    out[i:i + 4] = features.quadrant_edge_density; i += 4
    out[i:i + n_priors] = features.regex_prior_flags; i += n_priors
    out[i:i + 3] = features.ocr_presence_flags; i += 3
    assert i == total, f"feature_vector_v2 packed {i} dims, expected {total}"
    return out


@dataclass(frozen=True)
class ScreenClassifierV2Weights:
    version: str
    decoder_version: str
    classes: tuple[str, ...]
    n_priors: int
    intercept: np.ndarray
    coef: np.ndarray


class ScreenClassifierV2:
    """v2 multinomial LR head over FrameFeaturesV2."""

    def __init__(
        self,
        weights: ScreenClassifierV2Weights,
        state_machine: StateMachine,
    ) -> None:
        if weights.version != state_machine.version:
            raise ValueError(
                f"weights version {weights.version!r} != state machine {state_machine.version!r}"
            )
        if weights.decoder_version != state_machine.decoder_version:
            raise ValueError(
                f"weights decoder_version {weights.decoder_version!r} != "
                f"state machine {state_machine.decoder_version!r}"
            )
        if weights.classes != state_machine.states:
            raise ValueError(
                "weights.classes do not match state machine.states ordering"
            )
        expected_cols = _V2_FIXED_DIMS + weights.n_priors
        if weights.coef.shape[1] != expected_cols:
            raise ValueError(
                f"weights.coef has {weights.coef.shape[1]} cols, "
                f"expected {expected_cols} for n_priors={weights.n_priors}"
            )
        self.weights = weights
        self.state_machine = state_machine

    def predict_log_probs(self, features: FrameFeaturesV2) -> np.ndarray:
        x = feature_vector_v2(features, self.state_machine, n_priors=self.weights.n_priors)
        logits = self.weights.coef @ x + self.weights.intercept
        m = float(logits.max())
        log_sum_exp = m + math.log(float(np.exp(logits - m).sum()))
        return logits - log_sum_exp

    def save(self, path: Path) -> None:
        payload = {
            "schema_version": 2,
            "version": self.weights.version,
            "decoder_version": self.weights.decoder_version,
            "classes": list(self.weights.classes),
            "n_priors": self.weights.n_priors,
            "intercept": self.weights.intercept.tolist(),
            "coef": self.weights.coef.tolist(),
        }
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2))


def train_screen_classifier_v2(
    features: Iterable[FrameFeaturesV2],
    labels: Iterable[str],
    state_machine: StateMachine,
    regex_priors: RegexPriorsConfig,
    *,
    allow_missing_states: bool = False,
) -> ScreenClassifierV2:
    """Fit a multinomial LogisticRegression over FrameFeaturesV2. Mirror of
    `train_screen_classifier` with the v2 feature vectorizer.
    """
    features_list = list(features)
    labels_list = list(labels)
    if len(features_list) != len(labels_list):
        raise ValueError("features and labels length mismatch")
    if len(features_list) == 0:
        raise ValueError("cannot train on empty corpus")

    n_priors = regex_priors.n_priors()
    X = np.stack(
        [feature_vector_v2(f, state_machine, n_priors=n_priors) for f in features_list]
    )
    label_to_idx = {s: i for i, s in enumerate(state_machine.states)}
    for lbl in labels_list:
        if lbl not in label_to_idx:
            raise ValueError(f"unknown label {lbl!r} not in state machine")
    unique_labels = set(labels_list)
    n_seen = len(unique_labels)
    if n_seen < 3:
        raise ValueError(
            f"training corpus must cover at least 3 distinct states (got {n_seen}); "
            "binary LogisticRegression produces a (1, n_features) coef_ that "
            "breaks the row-reorder mapping"
        )
    missing = sorted(set(state_machine.states) - unique_labels)
    if missing and not allow_missing_states:
        raise ValueError(
            f"training corpus missing states {missing!r}; "
            "all state-machine states must appear at least once OR "
            "call with allow_missing_states=True (missing states get "
            f"intercept={MISSING_STATE_INTERCEPT} so anchor signals can still surface them)"
        )
    y = np.array([label_to_idx[lbl] for lbl in labels_list], dtype=np.int64)

    # max_iter bumped from 1000 to 3000 on 2026-05-27 (S5.5): the original
    # training run hit the cap with a ConvergenceWarning. 3000 lets LBFGS
    # actually converge on the 998-sample × 272-feature problem.
    lr = LogisticRegression(solver="lbfgs", max_iter=3000, C=1.0)
    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore", message=".*unique classes.*", category=UserWarning,
        )
        lr.fit(X, y)

    sklearn_order = list(lr.classes_)
    coef_full = np.zeros((len(state_machine.states), X.shape[1]), dtype=np.float64)
    intercept_full = np.zeros(len(state_machine.states), dtype=np.float64)
    for row, cls in enumerate(sklearn_order):
        coef_full[cls] = lr.coef_[row]
        intercept_full[cls] = lr.intercept_[row]

    if missing:
        for state in missing:
            i = state_machine.state_index(state)
            intercept_full[i] = MISSING_STATE_INTERCEPT

    weights = ScreenClassifierV2Weights(
        version=state_machine.version,
        decoder_version=state_machine.decoder_version,
        classes=state_machine.states,
        n_priors=n_priors,
        intercept=intercept_full,
        coef=coef_full,
    )
    return ScreenClassifierV2(weights, state_machine)
