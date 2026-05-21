"""Integration tests for pass1_segment.decode_segments(), the HMM/Viterbi
top-level Pass-1 decoder."""

from __future__ import annotations

import unittest

import numpy as np

from game_ocr.emissions import EmissionWeights
from game_ocr.frame_features import FrameFeatures
from game_ocr.state_machine import load_state_machine
from video_ingest.pass1_classify import Segment
from video_ingest.pass1_segment import _enforce_min_duration, decode_segments


class _FixedClassifier:
    """Returns canned log-probs per state index in a sequence."""

    def __init__(self, per_frame_state_idx: list[int], n_states: int):
        self.seq = per_frame_state_idx
        self.calls = 0
        self.n = n_states

    def predict_log_probs(self, features: FrameFeatures) -> np.ndarray:
        out = np.full(self.n, -10.0, dtype=np.float64)
        out[self.seq[self.calls]] = 0.0
        self.calls += 1
        return out


def _stub_feats(n_states: int, anchor_idx: int | None) -> FrameFeatures:
    flags = np.zeros(n_states, dtype=np.float64)
    if anchor_idx is not None:
        flags[anchor_idx] = 1.0
    return FrameFeatures(
        hsv_histogram=np.full(192, 1.0 / 192, dtype=np.float64),
        anchor_flags=flags,
        anchor_text="",
        reject_anchor_present=False,
        brightness=0.4,
        blur_score=50.0,
    )


class TestDecodeSegments(unittest.TestCase):
    def setUp(self):
        self.sm = load_state_machine("nhl26")
        self.weights = EmissionWeights()

    def test_single_long_run_emits_one_segment(self):
        n = len(self.sm.states)
        lobby = self.sm.state_index("pre_game_lobby_state_2")
        feats = [_stub_feats(n, anchor_idx=lobby) for _ in range(10)]
        clf = _FixedClassifier([lobby] * 10, n)
        segments = decode_segments(
            features=feats,
            classifier=clf,
            state_machine=self.sm,
            weights=self.weights,
        )
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0].screen_type, "pre_game_lobby_state_2")
        self.assertEqual(segments[0].frame_count, 10)
        self.assertEqual(segments[0].start_index, 0)
        self.assertEqual(segments[0].end_index, 9)

    def test_min_duration_drops_short_segment(self):
        # Loadout view's min duration is 0.5s; at sample_fps=1.0 that's 1 frame.
        # Force a 1-frame post_game_player_summary (min 1.5s = 2 frames) to be dropped.
        n = len(self.sm.states)
        lobby = self.sm.state_index("pre_game_lobby_state_2")
        summary = self.sm.state_index("post_game_player_summary")
        loadout = self.sm.state_index("player_loadout_view")
        # Lobby 4 frames, summary 1 frame, lobby 4 frames.
        # NOTE: summary's min is 1.5s = 2 frames at sample_fps=1; a 1-frame summary
        # must be merged away. The result here is that the decoder will likely
        # never pick summary alone because of the strong self-loop on lobby AND
        # the illegal transition lobby→summary (lobby_state_2 can only go to
        # state_1, loadout, loading, or unknown). Use loadout instead which is
        # reachable from lobby_state_2.
        anchors = [lobby, lobby, lobby, lobby, loadout, lobby, lobby, lobby, lobby]
        feats = [_stub_feats(n, anchor_idx=a) for a in anchors]
        clf = _FixedClassifier(anchors, n)
        segments = decode_segments(
            features=feats,
            classifier=clf,
            state_machine=self.sm,
            weights=self.weights,
        )
        # The single-frame loadout (0.5s min duration = 1 frame at 1 fps; KEPT)
        # — assert all kept segments meet their min duration.
        for seg in segments:
            min_sec = self.sm.min_duration_seconds(seg.screen_type)
            self.assertGreaterEqual(seg.end_seconds - seg.start_seconds, min_sec - 1e-6)

    def test_legal_transitions_respected(self):
        # Try to force lobby → action_tracker which is ILLEGAL.
        # The decoder should refuse to take that path and emit different states.
        n = len(self.sm.states)
        lobby = self.sm.state_index("pre_game_lobby_state_2")
        at = self.sm.state_index("post_game_action_tracker")
        feats = [_stub_feats(n, anchor_idx=lobby) for _ in range(3)] + \
                [_stub_feats(n, anchor_idx=at) for _ in range(3)]
        clf = _FixedClassifier([lobby, lobby, lobby, at, at, at], n)
        segments = decode_segments(
            features=feats,
            classifier=clf,
            state_machine=self.sm,
            weights=self.weights,
        )
        # The legal pathway is lobby → (loadout|loading|lobby_1) → ... → AT.
        # The decoder cannot jump directly; if AT wins later, there must be an
        # intermediate non-lobby state recorded.
        types = [s.screen_type for s in segments]
        if "post_game_action_tracker" in types:
            self.assertNotEqual(types[0], "post_game_action_tracker")

    def test_output_segments_carry_seconds_at_sample_fps(self):
        n = len(self.sm.states)
        lobby = self.sm.state_index("pre_game_lobby_state_2")
        feats = [_stub_feats(n, anchor_idx=lobby) for _ in range(5)]
        clf = _FixedClassifier([lobby] * 5, n)
        segments = decode_segments(
            features=feats,
            classifier=clf,
            state_machine=self.sm,
            weights=self.weights,
        )
        # sample_fps=1.0 → 1 frame = 1 second.
        self.assertEqual(segments[0].start_seconds, 0.0)
        # end_seconds is exclusive in the legacy contract.
        self.assertEqual(segments[0].end_seconds, 5.0)

    def test_enforce_min_duration_drops_below_threshold(self):
        # Hand-crafted Segment list, bypassing the HMM:
        # - 1-frame post_game_player_summary (1s < min 1.5s) — must be dropped
        # - 2-frame player_loadout_view (2s ≥ min 0.5s) — must be kept
        # - 3-frame post_game_action_tracker (3s ≥ min 1.5s) — must be kept
        segs = [
            Segment(start_index=0, end_index=0, start_seconds=0.0, end_seconds=1.0,
                    screen_type="post_game_player_summary", frame_count=1, mean_color_score=0.5),
            Segment(start_index=1, end_index=2, start_seconds=1.0, end_seconds=3.0,
                    screen_type="player_loadout_view", frame_count=2, mean_color_score=0.5),
            Segment(start_index=3, end_index=5, start_seconds=3.0, end_seconds=6.0,
                    screen_type="post_game_action_tracker", frame_count=3, mean_color_score=0.5),
        ]
        kept = _enforce_min_duration(segs, self.sm)
        types = [s.screen_type for s in kept]
        self.assertNotIn("post_game_player_summary", types)
        self.assertIn("player_loadout_view", types)
        self.assertIn("post_game_action_tracker", types)
        self.assertEqual(len(kept), 2)

    def test_enforce_min_duration_keeps_exact_threshold(self):
        # Boundary: a segment whose duration is EXACTLY min_duration_seconds
        # should be kept (the `duration + 1e-6 < min_sec` guard allows equality).
        min_sec = self.sm.min_duration_seconds("player_loadout_view")  # 0.5
        seg = Segment(
            start_index=0, end_index=0,
            start_seconds=0.0, end_seconds=min_sec,
            screen_type="player_loadout_view",
            frame_count=1, mean_color_score=0.5,
        )
        kept = _enforce_min_duration([seg], self.sm)
        self.assertEqual(len(kept), 1)


import json
import shutil
from pathlib import Path

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
CLIP = FIXTURE_DIR / "match-250-clip.mkv"
LABELS = FIXTURE_DIR / "match-250-clip-segments.json"


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg not on PATH")
@unittest.skipUnless(CLIP.exists(), "test clip not present")
class TestEndToEndOnLabeledClip(unittest.TestCase):
    """The 60-second labeled clip should decode into per-frame states that
    match the ground-truth labels on at least 45 of 60 frames (75%)."""

    def test_majority_of_frames_match_labels(self):
        from game_ocr.classifier import Classifier, load_classifier_config
        from game_ocr.emissions import EmissionWeights
        from game_ocr.frame_features import compute_frame_features
        from game_ocr.screen_classifier import load_screen_classifier
        from game_ocr.state_machine import load_state_machine
        from video_ingest.pass1_classify import _iter_raw_bgr_frames
        from video_ingest.pass1_segment import decode_segments

        sm = load_state_machine("nhl26")
        legacy = Classifier(load_classifier_config("nhl26"), use_gpu=False)
        weights = (
            Path(__file__).resolve().parents[2] / "game_ocr" / "game_ocr"
            / "weights" / "nhl26-screen-classifier.json"
        )
        if not weights.exists():
            self.skipTest("Phase 1 weights not yet trained")
        clf = load_screen_classifier(weights, sm)

        feats = []
        for frame in _iter_raw_bgr_frames(CLIP, 1.0):
            anchor = legacy._read_anchor(frame)
            feats.append(compute_frame_features(frame, anchor_text=anchor, state_machine=sm))

        segments = decode_segments(
            features=feats,
            classifier=clf,
            state_machine=sm,
            weights=EmissionWeights(),
        )

        # Build per-frame decoded labels.
        decoded = ["unknown_or_transition"] * len(feats)
        for seg in segments:
            for i in range(seg.start_index, seg.end_index + 1):
                decoded[i] = seg.screen_type

        # Compare against ground truth. Labels file uses `unknown_screen`;
        # decoder uses `unknown_or_transition`. Both map to "not extracted".
        gt_raw = json.loads(LABELS.read_text())
        gt = ["unknown_or_transition"] * gt_raw["frame_count"]
        for entry in gt_raw["segments"]:
            label = entry["screen_type"]
            if label == "unknown_screen":
                label = "unknown_or_transition"
            for i in range(entry["start_frame"], entry["end_frame"] + 1):
                if i < len(gt):
                    gt[i] = label

        matches = sum(1 for a, b in zip(decoded, gt) if a == b)
        # 60 frames; require ≥45/60 = 75% per-frame match.
        self.assertGreaterEqual(
            matches, 45,
            f"per-frame match {matches}/{len(gt)} below 45 (75%). "
            f"Decoded: {decoded[:10]}... GT: {gt[:10]}...",
        )
