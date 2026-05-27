"""S5.5 proving bench: per-clip accuracy gate for the v2 screen classifier.

Loads `tools/video_ingest/tests/fixtures/screen-classifier-proving-bench/labels.json`,
runs the v2 Pass-1 pipeline (compute_frame_features_v2_from_image →
ScreenClassifierV2 → build_log_emissions_v2 → Viterbi decode) at 1 fps on
each clip, and asserts:

  - **Per-clip ≥ 90% per-frame accuracy.** A frame "matches" when the
    predicted state equals the expected state, OR when the expected state
    is in `deferred_classes_relaxed` (currently menu_club_management,
    player_loadout_landing — see S5 sparse-class deferral) AND the
    prediction is `unknown_or_transition`. Both fallbacks are safe for
    downstream typed extractors.
  - **Match-968 hard-zero rule.** If the labeled spans include any of
    {menu_club_management, player_loadout_landing, player_loadout_view,
    menu_world_of_chel}, ZERO frames in those spans may classify as
    `pre_game_lobby_state_2` — that was the original v1 contamination
    bug this whole rework exists to fix.

Clips with an empty `labels` array are SKIPPED with a warning (operator
labeling is still pending). Once labels.json is populated, the clip
starts gating CI.

Gated `RUN_CLASSIFIER_E2E=1` — loads RapidOCR (~2s cold start) + walks
~60 frames per clip × ~1s per frame OCR ≈ 1 min per clip.
"""

from __future__ import annotations

import json
import os
import unittest
import warnings
from pathlib import Path

import cv2  # noqa: F401 — opencv pulled in by frame_pipeline_v2 anyway
import numpy as np


RUN_E2E = os.environ.get("RUN_CLASSIFIER_E2E", "0") == "1"


REPO_ROOT = Path(__file__).resolve().parents[3]
BENCH_DIR = (
    REPO_ROOT
    / "tools" / "video_ingest" / "tests" / "fixtures"
    / "screen-classifier-proving-bench"
)
LABELS_PATH = BENCH_DIR / "labels.json"

# The "hard-zero" rule applies to expected-state spans where v1 famously
# leaked into pre_game_lobby_state_2. Even with relaxed deferred classes,
# we never allow that specific misclassification on these spans.
HARD_ZERO_EXPECTED_STATES = frozenset({
    "menu_club_management",
    "player_loadout_landing",
    "player_loadout_view",
    "menu_world_of_chel",
})

CONTAMINATION_STATE = "pre_game_lobby_state_2"

PER_CLIP_ACCURACY_THRESHOLD = 0.90


def _load_labels():
    if not LABELS_PATH.exists():
        raise FileNotFoundError(f"missing proving-bench labels: {LABELS_PATH}")
    return json.loads(LABELS_PATH.read_text())


def _resolve_clip_path(rel_or_abs: str) -> Path:
    p = Path(rel_or_abs)
    if p.is_absolute():
        return p
    return (LABELS_PATH.parent / p).resolve()


def _expected_at_second(labels: list[dict], t_sec: int) -> str | None:
    """Walk run-length entries to find the label covering t_sec
    (inclusive on both ends). Returns None when no span covers it."""
    for entry in labels:
        if int(entry["t_start_sec"]) <= t_sec <= int(entry["t_end_sec"]):
            return str(entry["expected"])
    return None


def _run_v2_pipeline_per_frame(clip_path: Path) -> list[str]:
    """Read 1-fps frames from `clip_path`, run the v2 Pass-1 pipeline end
    to end (including Viterbi decode), return predicted state per frame in
    sample-index order."""
    # Local imports keep test discovery cheap when RUN_CLASSIFIER_E2E is off.
    from game_ocr.emissions import EmissionWeights
    from game_ocr.frame_pipeline_v2 import compute_frame_features_v2_from_image
    from game_ocr.ocr import RapidOCRBackend
    from game_ocr.regex_priors import load_regex_priors
    from game_ocr.screen_classifier import load_screen_classifier
    from game_ocr.state_machine import load_state_machine
    from video_ingest.pass1_classify import _iter_raw_bgr_frames
    from video_ingest.pass1_segment import decode_segments_v2

    sm = load_state_machine("nhl26")
    regex_priors = load_regex_priors("nhl26")
    weights_path = (
        REPO_ROOT
        / "tools" / "game_ocr" / "game_ocr" / "weights"
        / "nhl26-screen-classifier-v2.json"
    )
    if not weights_path.exists():
        raise unittest.SkipTest(
            f"missing v2 weights at {weights_path}; run "
            "`python3 tools/game_ocr/scripts/train_screen_classifier.py --engine viterbi_v2`"
        )
    clf = load_screen_classifier(weights_path, sm)
    ocr = RapidOCRBackend(use_gpu=False)

    feats = []
    for frame in _iter_raw_bgr_frames(clip_path, sample_fps=1.0):
        feats.append(
            compute_frame_features_v2_from_image(
                frame, regex_priors=regex_priors, ocr_backend=ocr,
            )
        )
    segments = decode_segments_v2(
        features=feats,
        classifier=clf,
        state_machine=sm,
        regex_priors=regex_priors,
        weights=EmissionWeights(),
    )

    # Stamp the decoded state onto each per-frame slot (default unknown
    # for frames the Viterbi path dropped via min-duration enforcement).
    per_frame = ["unknown_or_transition"] * len(feats)
    for seg in segments:
        for i in range(seg.start_index, seg.end_index + 1):
            per_frame[i] = seg.screen_type
    return per_frame


@unittest.skipUnless(RUN_E2E, "set RUN_CLASSIFIER_E2E=1 to enable")
class TestScreenClassifierProvingBench(unittest.TestCase):
    """One subTest per clip in labels.json. Empty-labels clips warn-and-skip."""

    @classmethod
    def setUpClass(cls):
        cls.bench = _load_labels()
        cls.deferred = frozenset(cls.bench.get("deferred_classes_relaxed", []))

    def test_each_clip_meets_threshold(self):
        for clip in self.bench["clips"]:
            with self.subTest(clip=clip["name"]):
                labels = clip.get("labels", [])
                if not labels:
                    warnings.warn(
                        f"clip {clip['name']!r} has no labels yet — skipping. "
                        f"Populate labels in {LABELS_PATH} per the operator workflow.",
                        stacklevel=2,
                    )
                    self.skipTest("operator labels pending")

                clip_path = _resolve_clip_path(clip["path"])
                self.assertTrue(
                    clip_path.exists(),
                    f"missing clip file: {clip_path}",
                )

                predicted = _run_v2_pipeline_per_frame(clip_path)

                matches = 0
                total = 0
                contamination_violations: list[tuple[int, str]] = []
                for t_sec in range(len(predicted)):
                    expected = _expected_at_second(labels, t_sec)
                    if expected is None:
                        continue  # frame not covered by any label span
                    total += 1
                    pred = predicted[t_sec]

                    if pred == expected:
                        matches += 1
                    elif expected in self.deferred and pred == "unknown_or_transition":
                        # Relaxed match: deferred-class span falling back to
                        # unknown is acceptable (per S5 sparse-class deferral).
                        matches += 1

                    # Hard-zero rule: spans where v1 famously leaked into
                    # pre_game_lobby_state_2 must NEVER classify there.
                    if expected in HARD_ZERO_EXPECTED_STATES and pred == CONTAMINATION_STATE:
                        contamination_violations.append((t_sec, expected))

                self.assertGreater(total, 0, f"no labeled frames in clip {clip['name']!r}")
                accuracy = matches / total
                self.assertGreaterEqual(
                    accuracy,
                    PER_CLIP_ACCURACY_THRESHOLD,
                    f"clip {clip['name']!r}: per-frame accuracy {accuracy:.1%} "
                    f"< {PER_CLIP_ACCURACY_THRESHOLD:.0%} (matches={matches}/{total})",
                )

                self.assertFalse(
                    contamination_violations,
                    f"clip {clip['name']!r}: {len(contamination_violations)} frames in "
                    f"{sorted(HARD_ZERO_EXPECTED_STATES)} spans classified as "
                    f"{CONTAMINATION_STATE} — v1 contamination bug regressed.\n"
                    f"Violations (t_sec, expected_state): {contamination_violations[:10]}"
                    + ("..." if len(contamination_violations) > 10 else ""),
                )


if __name__ == "__main__":
    unittest.main()
