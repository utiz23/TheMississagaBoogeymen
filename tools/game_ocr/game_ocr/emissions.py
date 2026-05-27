"""Emission combiner: per-frame FrameFeatures + screen classifier → (T, N) log emissions.

Round 4 §4 — emissions feeding the Viterbi decoder are a weighted sum of
several signals. Here the recipe is:

  log_emit[t, s] =
      classifier_weight * classifier.predict_log_probs(features_t)[s]
    + anchor_bonus      * features_t.anchor_flags[s]

When features_t.reject_anchor_present is True, log_emit[t, s] is clamped to
reject_floor for every state except unknown_or_transition (which gets a
small positive bump so it strictly wins).

Quality signals (blur, brightness) are already inside the classifier's
feature vector, so they don't enter twice here.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Protocol

import numpy as np

from game_ocr.frame_features import FrameFeatures, FrameFeaturesV2
from game_ocr.regex_priors import RegexPriorsConfig
from game_ocr.state_machine import StateMachine


class _ClassifierProto(Protocol):
    def predict_log_probs(self, features: FrameFeatures) -> np.ndarray: ...


@dataclass(frozen=True)
class EmissionWeights:
    classifier_weight: float = 1.0
    anchor_bonus: float = 2.0
    reject_floor: float = -20.0


def build_log_emissions(
    features: Iterable[FrameFeatures],
    classifier: _ClassifierProto,
    state_machine: StateMachine,
    weights: EmissionWeights,
) -> np.ndarray:
    feats_list = list(features)
    n = len(state_machine.states)
    T = len(feats_list)
    out = np.full((T, n), 0.0, dtype=np.float64)
    unk_idx = state_machine.state_index("unknown_or_transition")
    for t, f in enumerate(feats_list):
        if f.reject_anchor_present:
            out[t, :] = weights.reject_floor
            out[t, unk_idx] = weights.reject_floor + 1.0
            continue
        lp = classifier.predict_log_probs(f)
        if lp.shape != (n,):
            raise ValueError(
                f"classifier returned shape {lp.shape}, expected ({n},)"
            )
        if np.any(np.isnan(lp)):
            raise ValueError(
                f"classifier returned NaN at frame {t}; check ScreenClassifier weights"
            )
        out[t, :] = weights.classifier_weight * lp + weights.anchor_bonus * f.anchor_flags
    return out


class _ClassifierV2Proto(Protocol):
    def predict_log_probs(self, features: FrameFeaturesV2) -> np.ndarray: ...


def build_log_emissions_v2(
    features: Iterable[FrameFeaturesV2],
    classifier: _ClassifierV2Proto,
    state_machine: StateMachine,
    regex_priors: RegexPriorsConfig,
    weights: EmissionWeights,
) -> np.ndarray:
    """v2 emission combiner. FrameFeaturesV2 has no `anchor_flags` /
    `reject_anchor_present`; we derive the same signals from
    `regex_prior_flags` (one bit per RegexPrior in priors_flat order).

    Anchor bonus per state = anchor_bonus * sum(fired priors targeting that state).
    Reject path fires when any prior whose owning state is
    `unknown_or_transition` matches (mirrors v1's reject_anchor_substrings
    role; the regex priors YAML's `unknown_or_transition` entries are the
    Phase-A catch-all reject anchors per its design comment).
    """
    feats_list = list(features)
    n = len(state_machine.states)
    T = len(feats_list)
    out = np.full((T, n), 0.0, dtype=np.float64)
    unk_idx = state_machine.state_index("unknown_or_transition")

    # Group prior positions by their owning state for the anchor-bonus sum.
    # Priors whose state isn't in the state machine (e.g. deferred classes
    # like player_loadout_landing) are dropped silently — they contribute
    # no anchor signal until S6 adds those states.
    state_to_positions: dict[str, list[int]] = {}
    for i, prior in enumerate(regex_priors.priors_flat):
        state_to_positions.setdefault(prior.state, []).append(i)
    reject_positions = state_to_positions.get("unknown_or_transition", [])

    # Pre-compute the (n_priors_for_state) sum vector contribution per state.
    state_indices = {s: state_machine.state_index(s) for s in state_machine.states}

    for t, f in enumerate(feats_list):
        if reject_positions and any(f.regex_prior_flags[i] == 1.0 for i in reject_positions):
            out[t, :] = weights.reject_floor
            out[t, unk_idx] = weights.reject_floor + 1.0
            continue
        lp = classifier.predict_log_probs(f)
        if lp.shape != (n,):
            raise ValueError(
                f"v2 classifier returned shape {lp.shape}, expected ({n},)"
            )
        if np.any(np.isnan(lp)):
            raise ValueError(
                f"v2 classifier returned NaN at frame {t}; check ScreenClassifierV2 weights"
            )
        anchor_bonus = np.zeros(n, dtype=np.float64)
        for state, positions in state_to_positions.items():
            if state == "unknown_or_transition" or state not in state_indices:
                continue
            anchor_bonus[state_indices[state]] = float(
                sum(f.regex_prior_flags[i] for i in positions)
            )
        out[t, :] = weights.classifier_weight * lp + weights.anchor_bonus * anchor_bonus
    return out
