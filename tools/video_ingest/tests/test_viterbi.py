"""Tests for the pure-function log-space Viterbi decoder."""

from __future__ import annotations

import math
import unittest

import numpy as np

from game_ocr.viterbi import viterbi_decode


class TestViterbiDecode(unittest.TestCase):
    def test_single_frame_picks_max_emission(self):
        # 1 frame, 3 states. State 1 has the highest emission → it wins.
        log_emit = np.array([[-2.0, -0.1, -3.0]])
        log_trans = np.full((3, 3), -1.0)
        log_init = np.array([0.0, 0.0, 0.0])
        path = viterbi_decode(log_emit, log_trans, log_init)
        self.assertEqual(path.tolist(), [1])

    def test_self_loop_dominates_when_strong(self):
        # 5 frames. State 0 has slightly weaker emissions at frames 2,3 but
        # high self-loop and very negative cross-transition means decoder
        # stays in state 0.
        log_emit = np.array([
            [-0.1, -1.0, -3.0],
            [-0.1, -1.0, -3.0],
            [-0.3, -0.2, -3.0],  # frame 2: state 1 slightly better
            [-0.3, -0.2, -3.0],  # frame 3: state 1 slightly better
            [-0.1, -1.0, -3.0],
        ])
        log_trans = np.array([
            [-0.05, -5.0, -5.0],   # 0→0 high, 0→1 low
            [-5.0,  -0.05, -5.0],
            [-5.0,  -5.0,  -0.05],
        ])
        log_init = np.array([0.0, -10.0, -10.0])
        path = viterbi_decode(log_emit, log_trans, log_init)
        self.assertEqual(path.tolist(), [0, 0, 0, 0, 0])

    def test_transition_through_states(self):
        # Three states, three frames. Emissions force 0 → 1 → 2.
        log_emit = np.array([
            [0.0, -5.0, -5.0],
            [-5.0, 0.0, -5.0],
            [-5.0, -5.0, 0.0],
        ])
        log_trans = np.array([
            [-0.05, -0.5, -10.0],
            [-10.0, -0.05, -0.5],
            [-10.0, -10.0, -0.05],
        ])
        log_init = np.array([0.0, -10.0, -10.0])
        path = viterbi_decode(log_emit, log_trans, log_init)
        self.assertEqual(path.tolist(), [0, 1, 2])

    def test_illegal_transition_blocks_path(self):
        # Two states. State 1 has much better emission at frame 1 but
        # the transition 0→1 is illegal (-inf). Decoder must stay in 0.
        log_emit = np.array([
            [0.0, -5.0],
            [-5.0, 0.0],
            [-5.0, 0.0],
        ])
        log_trans = np.array([
            [-0.05, -math.inf],
            [-math.inf, -0.05],
        ])
        log_init = np.array([0.0, -math.inf])
        path = viterbi_decode(log_emit, log_trans, log_init)
        # State 1 unreachable from state 0; path stays in 0 the whole time.
        self.assertEqual(path.tolist(), [0, 0, 0])

    def test_returns_int_path(self):
        log_emit = np.array([[-1.0, -2.0]])
        log_trans = np.zeros((2, 2))
        log_init = np.zeros(2)
        path = viterbi_decode(log_emit, log_trans, log_init)
        self.assertEqual(path.dtype, np.int64)

    def test_shape_mismatch_raises(self):
        log_emit = np.zeros((3, 4))         # 4 states
        log_trans = np.zeros((3, 3))        # 3 states — mismatch
        log_init = np.zeros(3)
        with self.assertRaises(ValueError):
            viterbi_decode(log_emit, log_trans, log_init)

    def test_empty_emissions_returns_empty(self):
        log_emit = np.zeros((0, 3))
        log_trans = np.zeros((3, 3))
        log_init = np.zeros(3)
        path = viterbi_decode(log_emit, log_trans, log_init)
        self.assertEqual(path.tolist(), [])

    def test_log_init_shape_mismatch_raises(self):
        log_emit = np.zeros((2, 3))
        log_trans = np.zeros((3, 3))
        log_init = np.zeros(4)  # wrong N=4 vs 3
        with self.assertRaises(ValueError):
            viterbi_decode(log_emit, log_trans, log_init)

    def test_nan_in_emissions_raises(self):
        log_emit = np.array([[0.0, float("nan")], [-1.0, -2.0]])
        log_trans = np.zeros((2, 2))
        log_init = np.zeros(2)
        with self.assertRaises(ValueError):
            viterbi_decode(log_emit, log_trans, log_init)

    def test_nan_in_transitions_raises(self):
        log_emit = np.zeros((2, 2))
        log_trans = np.array([[0.0, float("nan")], [-1.0, -2.0]])
        log_init = np.zeros(2)
        with self.assertRaises(ValueError):
            viterbi_decode(log_emit, log_trans, log_init)
