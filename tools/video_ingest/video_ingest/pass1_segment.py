"""HMM/Viterbi Pass-1 decoder — Phase 1 of the OCR pipeline redesign.

Replaces pass1_classify.build_segments() with a sequence model. Pass 1's
output contract (a list of Segment objects compatible with Pass 2 dispatch)
is unchanged so the orchestrator + dispatch wiring stay put. The internal
algorithm is:

  1. For each Pass-1 sampled frame, compute multi-signal features
     (frame_features.compute_frame_features).
  2. Feed those features to the learned screen classifier
     (screen_classifier.predict_log_probs) for per-state log-probs.
  3. Combine classifier output + anchor flags into a (T, N) log emission
     matrix (emissions.build_log_emissions).
  4. Build the (N, N) log transition matrix from the StateMachine.
  5. Decode the best state sequence (viterbi.viterbi_decode).
  6. Collapse runs of identical states into segments and drop runs shorter
     than the per-state minimum duration.

Frames belonging to non-extracted states (unknown_or_transition, in_game_*,
loading_or_intro, end_of_video) still produce Segment objects with the new
screen_type; pass2_extract filters them via the extract_screens config.
"""

from __future__ import annotations

from typing import Iterable, Protocol

import numpy as np

from game_ocr.emissions import (
    EmissionWeights,
    build_log_emissions,
    build_log_emissions_v2,
)
from game_ocr.frame_features import FrameFeatures, FrameFeaturesV2
from game_ocr.regex_priors import RegexPriorsConfig
from game_ocr.state_machine import StateMachine
from game_ocr.viterbi import viterbi_decode
from video_ingest.pass1_classify import Segment


class _ClassifierProto(Protocol):
    def predict_log_probs(self, features: FrameFeatures) -> np.ndarray: ...


class _ClassifierV2Proto(Protocol):
    def predict_log_probs(self, features: FrameFeaturesV2) -> np.ndarray: ...


def _build_log_transitions(state_machine: StateMachine) -> np.ndarray:
    n = len(state_machine.states)
    log_trans = np.full((n, n), 0.0, dtype=np.float64)
    for i, src in enumerate(state_machine.states):
        for j, dst in enumerate(state_machine.states):
            log_trans[i, j] = state_machine.log_transition(src, dst)
    return log_trans


def _build_log_initial(state_machine: StateMachine) -> np.ndarray:
    n = len(state_machine.states)
    out = np.full(n, 0.0, dtype=np.float64)
    for i, s in enumerate(state_machine.states):
        out[i] = state_machine.initial_log_prob(s)
    return out


def _collapse_to_segments(
    path: np.ndarray,
    state_machine: StateMachine,
    emissions: np.ndarray,
) -> list[Segment]:
    if len(path) == 0:
        return []
    period = 1.0 / state_machine.sample_fps
    segments: list[Segment] = []
    run_start = 0
    for t in range(1, len(path) + 1):
        if t == len(path) or path[t] != path[run_start]:
            state_idx = int(path[run_start])
            state_name = state_machine.states[state_idx]
            end = t - 1
            # Mean per-frame posterior over the assigned state (proxy: emission
            # value normalised against the row max). For the legacy Segment
            # contract we just store the mean emission magnitude on the assigned
            # state, scaled into [0, 1] via a sigmoid-style squash.
            block = emissions[run_start:end + 1, state_idx]
            mean_score = float(1.0 / (1.0 + np.exp(-block.mean())))
            segments.append(Segment(
                start_index=run_start,
                end_index=end,
                start_seconds=run_start * period,
                end_seconds=(end + 1) * period,
                screen_type=state_name,
                frame_count=end - run_start + 1,
                mean_color_score=mean_score,
            ))
            run_start = t
    return segments


def _enforce_min_duration(
    segments: list[Segment],
    state_machine: StateMachine,
) -> list[Segment]:
    out: list[Segment] = []
    for seg in segments:
        min_sec = state_machine.min_duration_seconds(seg.screen_type)
        duration = seg.end_seconds - seg.start_seconds
        if duration + 1e-6 < min_sec:
            continue
        out.append(seg)
    return out


def decode_segments(
    *,
    features: Iterable[FrameFeatures],
    classifier: _ClassifierProto,
    state_machine: StateMachine,
    weights: EmissionWeights,
) -> list[Segment]:
    feats_list = list(features)
    if not feats_list:
        return []
    log_emit = build_log_emissions(feats_list, classifier, state_machine, weights)
    log_trans = _build_log_transitions(state_machine)
    log_init = _build_log_initial(state_machine)
    path = viterbi_decode(log_emit, log_trans, log_init)
    segments = _collapse_to_segments(path, state_machine, log_emit)
    return _enforce_min_duration(segments, state_machine)


def decode_segments_v2(
    *,
    features: Iterable[FrameFeaturesV2],
    classifier: _ClassifierV2Proto,
    state_machine: StateMachine,
    regex_priors: RegexPriorsConfig,
    weights: EmissionWeights,
) -> list[Segment]:
    """v2 Viterbi decode. Same algorithm as decode_segments; only the
    emissions builder differs (regex-prior-derived anchor bonus + reject)."""
    feats_list = list(features)
    if not feats_list:
        return []
    log_emit = build_log_emissions_v2(
        feats_list, classifier, state_machine, regex_priors, weights,
    )
    log_trans = _build_log_transitions(state_machine)
    log_init = _build_log_initial(state_machine)
    path = viterbi_decode(log_emit, log_trans, log_init)
    segments = _collapse_to_segments(path, state_machine, log_emit)
    return _enforce_min_duration(segments, state_machine)
