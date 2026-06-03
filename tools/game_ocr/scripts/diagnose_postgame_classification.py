"""WS6 post-game classifier diagnosis.

Reproduces the v2 per-frame screen-classification decision on a handful of
saved post-game frames (the WS6 evidence bundle), WITHOUT re-running the
40-minute full-video Pass-1. For each frame it prints:
  - the OCR top_bar/side_strip text actually read,
  - which regex priors fired (and whether any is a reject/unknown prior),
  - the classifier's top-k per-state log-probs + argmax,
  - the post-game state's rank/log-prob (the class that SHOULD win).

Usage:
  cd tools/video_ingest && PYTHONPATH=.:../game_ocr ../../.venv-1/bin/python \
    ../game_ocr/scripts/diagnose_postgame_classification.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

from game_ocr.frame_pipeline_v2 import compute_frame_features_v2_from_image
from game_ocr.ocr import RapidOCRBackend
from game_ocr.regex_priors import load_regex_priors
from game_ocr.screen_classifier import load_screen_classifier
from game_ocr.state_machine import load_state_machine

VERSION = "nhl26"
REPO = Path(__file__).resolve().parents[3]
WEIGHTS = REPO / "tools/game_ocr/game_ocr/weights/nhl26-screen-classifier-v2.json"
FRAMES = REPO / "tools/video_ingest/tests/fixtures/ws6-match2582-postgame/frames/canonical"

# frame filename -> the post_game_* class that SHOULD win (per the screen observed)
EXPECTED = {
    "t1900_end_of_game_summary.png": "post_game_player_summary",
    "t1925_action_tracker_2nd.png": "post_game_action_tracker",
    "t1942_action_tracker_ot.png": "post_game_action_tracker",
    "t1947_faceoff_map.png": "post_game_faceoff_map",
    "t1955_net_chart.png": "post_game_net_chart",
    "t1960_player_summary.png": "post_game_player_summary",
    "t1969_box_score_goalsummary.png": "post_game_box_score_goals",
    "t1971_box_score_faceoffsummary.png": "post_game_box_score_faceoffs",
    "t1975_scoring_summary_all.png": "post_game_events",
    "t1985_black_fade_transition.png": "unknown_or_transition",
    "t2000_woc_lobby_loadout.png": "player_loadout_view",
}


def main() -> int:
    sm = load_state_machine(VERSION)
    clf = load_screen_classifier(WEIGHTS, sm)
    rp = load_regex_priors(VERSION)
    ocr = RapidOCRBackend(use_gpu=True)
    states = list(sm.states)
    reject_prior_idx = {
        i for i, p in enumerate(rp.priors_flat) if p.state == "unknown_or_transition"
    }

    print(f"n_states={len(states)}  n_priors={len(rp.priors_flat)}")
    print(f"reject priors: {[rp.priors_flat[i].name for i in sorted(reject_prior_idx)]}\n")

    for fname in sorted(EXPECTED):
        path = FRAMES / fname
        img = cv2.imread(str(path))
        if img is None:
            print(f"!! could not read {path}")
            continue
        feats = compute_frame_features_v2_from_image(
            img, regex_priors=rp, ocr_backend=ocr
        )
        lp = clf.predict_log_probs(feats)
        order = np.argsort(lp)[::-1]
        pred = states[int(order[0])]
        want = EXPECTED[fname]
        want_idx = states.index(want)
        want_rank = int(np.where(order == want_idx)[0][0])

        fired = [
            (rp.priors_flat[i].name, rp.priors_flat[i].state)
            for i in range(len(rp.priors_flat))
            if float(feats.regex_prior_flags[i]) == 1.0
        ]
        reject_fired = any(
            float(feats.regex_prior_flags[i]) == 1.0 for i in reject_prior_idx
        )
        top5 = [(states[int(j)], round(float(lp[int(j)]), 2)) for j in order[:5]]

        print(f"=== {fname} ===")
        print(f"  top_bar OCR : {feats.top_bar_text!r}")
        print(f"  side OCR    : {feats.side_strip_text!r}")
        print(f"  fired priors: {fired or '(none)'}   reject_fired={reject_fired}")
        print(f"  PRED        : {pred}")
        print(f"  want         : {want}  -> rank {want_rank}, logprob {float(lp[want_idx]):.2f}")
        print(f"  top5        : {top5}")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
