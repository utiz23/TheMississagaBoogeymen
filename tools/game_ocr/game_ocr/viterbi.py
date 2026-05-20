"""Pure-function log-space Viterbi decoder.

Given per-frame emission log-likelihoods, a transition log-prob matrix, and
initial-state log-probs, returns the most likely state sequence. Math only —
no I/O, no fixtures, no global state.

Shape contract:
  log_emit:  (T, N)  per-frame emission log-likelihood for each of N states
  log_trans: (N, N)  log P(dst | src); diagonal = self-loop
  log_init:  (N,)    log P(state at t=0)

Returns:
  path:      (T,) int64 — state index per frame
"""

from __future__ import annotations

import numpy as np


def viterbi_decode(
    log_emit: np.ndarray,
    log_trans: np.ndarray,
    log_init: np.ndarray,
) -> np.ndarray:
    if log_emit.ndim != 2:
        raise ValueError(f"log_emit must be 2-D, got shape {log_emit.shape}")
    T, N = log_emit.shape
    if log_trans.shape != (N, N):
        raise ValueError(f"log_trans shape {log_trans.shape} != expected ({N},{N})")
    if log_init.shape != (N,):
        raise ValueError(f"log_init shape {log_init.shape} != expected ({N},)")
    for _name, _arr in (("log_emit", log_emit), ("log_trans", log_trans), ("log_init", log_init)):
        if np.any(np.isnan(_arr)):
            raise ValueError(f"{_name} contains NaN — check upstream emission combiner")
    if T == 0:
        return np.zeros(0, dtype=np.int64)

    delta = np.full((T, N), -np.inf, dtype=np.float64)
    backptr = np.zeros((T, N), dtype=np.int64)

    delta[0] = log_init + log_emit[0]
    for t in range(1, T):
        # For each destination state, find the best (source, score).
        # scores[i, j] = delta[t-1, i] + log_trans[i, j]
        scores = delta[t - 1][:, None] + log_trans   # (N, N)
        backptr[t] = np.argmax(scores, axis=0)
        delta[t] = scores[backptr[t], np.arange(N)] + log_emit[t]

    path = np.zeros(T, dtype=np.int64)
    path[-1] = int(np.argmax(delta[-1]))
    for t in range(T - 1, 0, -1):
        path[t - 1] = backptr[t, path[t]]
    return path
