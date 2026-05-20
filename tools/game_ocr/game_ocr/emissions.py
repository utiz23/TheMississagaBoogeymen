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

import math
from dataclasses import dataclass
from typing import Iterable, Protocol

import numpy as np

from game_ocr.frame_features import FrameFeatures
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
        out[t, :] = weights.classifier_weight * lp + weights.anchor_bonus * f.anchor_flags
    return out
