"""Unit tests for the Phase 1 state machine loader."""

from __future__ import annotations

import math
import unittest

from game_ocr.state_machine import (
    StateMachine,
    StateMachineConfigError,
    load_state_machine,
)


class TestStateMachineLoader(unittest.TestCase):
    def test_loads_nhl26_config(self):
        sm = load_state_machine("nhl26")
        self.assertEqual(sm.version, "nhl26")
        self.assertEqual(sm.decoder_version, "hmm-viterbi-v1")
        self.assertIn("player_loadout_view", sm.states)
        self.assertIn("post_game_box_score_shots", sm.states)
        self.assertIn("end_of_video", sm.states)
        # All 17 states from Round 4 §4 present.
        self.assertEqual(len(sm.states), 17)

    def test_min_duration_lookup(self):
        sm = load_state_machine("nhl26")
        self.assertAlmostEqual(sm.min_duration_seconds("player_loadout_view"), 0.5)
        self.assertAlmostEqual(sm.min_duration_seconds("in_game_clock"), 5.0)

    def test_self_loop_log_prob(self):
        sm = load_state_machine("nhl26")
        # log_self_loop_prior = -0.05 in the YAML.
        self.assertAlmostEqual(sm.log_transition("player_loadout_view", "player_loadout_view"), -0.05)

    def test_illegal_transition_is_neg_inf(self):
        sm = load_state_machine("nhl26")
        # in_game_clock cannot directly transition to pre_game_lobby_state_2.
        lp = sm.log_transition("in_game_clock", "pre_game_lobby_state_2")
        self.assertTrue(math.isinf(lp) and lp < 0)

    def test_legal_transition_uses_default_prior(self):
        sm = load_state_machine("nhl26")
        # post_game_player_summary → post_game_box_score_goals is listed.
        self.assertAlmostEqual(
            sm.log_transition("post_game_player_summary", "post_game_box_score_goals"),
            -3.0,
        )

    def test_initial_log_prob_listed(self):
        sm = load_state_machine("nhl26")
        # pre_game_lobby_state_2 = -1.5 per YAML.
        self.assertAlmostEqual(sm.initial_log_prob("pre_game_lobby_state_2"), -1.5)

    def test_initial_log_prob_missing_is_neg_inf(self):
        sm = load_state_machine("nhl26")
        # post_game_action_tracker is not a legal opener.
        lp = sm.initial_log_prob("post_game_action_tracker")
        self.assertTrue(math.isinf(lp) and lp < 0)

    def test_anchor_substrings_lookup(self):
        sm = load_state_machine("nhl26")
        self.assertIn("player loadouts", sm.anchor_substrings("player_loadout_view"))
        self.assertEqual(sm.anchor_substrings("in_game_clock"), ())

    def test_unknown_state_raises(self):
        sm = load_state_machine("nhl26")
        with self.assertRaises(KeyError):
            sm.min_duration_seconds("nonexistent_state")

    def test_missing_config_raises(self):
        with self.assertRaises(FileNotFoundError):
            load_state_machine("not_a_real_version")
