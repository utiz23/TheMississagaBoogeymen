"""Calibrate the screen-type classifier config from labeled ScreenShots.

For each canonical screen_type we know about, compute the average HSV
histogram of its labeled fixture(s) and emit a YAML config at
`tools/game_ocr/game_ocr/configs/classifier/<version>.yaml`.

Anchor ROI + per-class anchor substrings are hand-coded below — they're
the cheap-to-tune part that drives most of the OOD-gate behavior.

Usage:
    python3 tools/game_ocr/scripts/calibrate_classifier.py [--version nhl26]

The script is idempotent and overwrites the output YAML each run.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
import yaml


REPO_ROOT = Path(__file__).resolve().parents[3]
GAME_OCR = REPO_ROOT / "tools" / "game_ocr"
sys.path.insert(0, str(GAME_OCR))

from game_ocr.classifier import hsv_histogram  # noqa: E402

SCREENSHOTS = GAME_OCR / "ScreenShots"
EXTRAS = GAME_OCR / "calibration" / "extras"

HIST_BINS: tuple[int, int, int] = (12, 4, 4)
ANCHOR_ROI: tuple[int, int, int, int] = (0, 0, 1920, 200)  # top 200px
COLOR_THRESHOLD = 0.55
FUZZY_MAX_DISTANCE = 1

# Map of canonical screen_type → (list of contributing ScreenShots filenames,
# list of anchor substrings expected in OCR of ANCHOR_ROI). Empty
# anchor_substrings means color-only match (allowed but downweighted via
# the classifier's OOD logic when no anchor evidence is available).
CLASSES: dict[str, dict] = {
    "pre_game_lobby_state_2": {
        # Multi-opponent calibration: canonical fixtures use TRIPORT CHUGS,
        # the match-250 clip extras add 4TH LINE. Averaging across opponents
        # gives a centroid less coupled to a specific opponent's jersey colors.
        "fixtures": [
            "Pre-Game Lobby State 1.png",
            "Pre-Game Lobby State 2.png",
        ],
        "extras": [
            "pre_game_lobby_state_2__match250_t10_vs_4thline.png",
            "pre_game_lobby_state_2__match250_t30_vs_4thline.png",
            "pre_game_lobby_state_2__match250_t40_vs_4thline.png",
        ],
        # 'eashl' (from the EASHL 6V6 mode badge) is robustly present in
        # every lobby frame OCR but absent on splash transitions and
        # post-game tabs. With the anchor-priority classifier, this
        # gives lobby a deterministic claim on dark+red+EASHL frames
        # without relying on (non-discriminative) color matching.
        "anchor_substrings": ["eashl"],
    },
    "player_loadout_view": {
        "fixtures": ["Player Loadout View.png"],
        "anchor_substrings": ["player loadouts"],
    },
    "post_game_player_summary": {
        "fixtures": ["Post Game Player Summary.png"],
        "anchor_substrings": ["player summary"],
    },
    "post_game_box_score_goals": {
        "fixtures": ["Post Game Box Score.png"],
        "anchor_substrings": ["goal summary"],
    },
    "post_game_events": {
        "fixtures": ["Post Game Events.png"],
        # The Events screen's color signature matches several other dark
        # post-game tabs (player_summary, box_score) at 0.94-0.99 cosine,
        # so a color-only match dominates spuriously. The "ALL" filter
        # pill in the top-left is the one consistent in-ROI anchor.
        # Other tabs' anchors (player summary, goal summary, all events,
        # etc.) compete against this and win when their text is present.
        "anchor_substrings": ["all"],
    },
    "post_game_action_tracker": {
        "fixtures": [
            "Post Game Action tracker (All-Goals + Hits + Shots + Penalties + Faceoffs).png",
        ],
        "anchor_substrings": ["all events"],
    },
    "post_game_faceoff_map": {
        "fixtures": ["Post Game Event Map Faceoffs.png"],
        "anchor_substrings": ["faceoff"],
    },
    "post_game_net_chart": {
        "fixtures": ["Post Game Event Map Net-Chart.png"],
        "anchor_substrings": ["net chart"],
    },
}


def _load_image(path: Path) -> np.ndarray:
    img = cv2.imread(str(path))
    if img is None:
        raise FileNotFoundError(f"cv2.imread failed: {path}")
    # Normalize to 1920x1080 (centroids are calibrated at that resolution).
    if img.shape[0] != 1080 or img.shape[1] != 1920:
        img = cv2.resize(img, (1920, 1080), interpolation=cv2.INTER_AREA)
    return img


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default="nhl26")
    args = ap.parse_args()

    classes_out: dict[str, dict] = {}
    for screen_type, spec in CLASSES.items():
        hists: list[np.ndarray] = []
        sources: list[tuple[Path, str]] = []
        sources.extend((SCREENSHOTS / f, "canonical") for f in spec.get("fixtures", []))
        sources.extend((EXTRAS / f, "extra") for f in spec.get("extras", []))
        for path, kind in sources:
            img = _load_image(path)
            hists.append(hsv_histogram(img, HIST_BINS))
            print(f"  {screen_type}  ←  [{kind}] {path.name}", file=sys.stderr)
        if not hists:
            print(f"warn: no fixtures for {screen_type}", file=sys.stderr)
            continue
        centroid = np.mean(np.stack(hists, axis=0), axis=0)
        # Re-normalize the averaged centroid so cosine-sim is well-defined.
        s = centroid.sum()
        if s > 0:
            centroid = centroid / s
        classes_out[screen_type] = {
            "anchor_substrings": list(spec["anchor_substrings"]),
            "centroid": [float(x) for x in centroid.tolist()],
        }

    out = {
        "version": args.version,
        "hist_bins": list(HIST_BINS),
        "anchor_roi": list(ANCHOR_ROI),
        "color_threshold": COLOR_THRESHOLD,
        "fuzzy_max_distance": FUZZY_MAX_DISTANCE,
        # Anchor substrings that force UNKNOWN when present in the top-bar
        # OCR, overriding any color or anchor match. Used to reject UI
        # states that visually resemble enumerated screen types but
        # aren't worth processing:
        #   - matchmaking screen tabs (visually similar to lobby)
        #   - mid-game "WAITING FOR ALL USERS TO RESUME" intermission
        #     screens (dark dual-roster palette, fuzzy-matches "all"
        #     anchor for events tab)
        "reject_anchor_substrings": [
            "customize",
            "seasonpass",
            "rewards",
            "waiting for",
        ],
        "classes": classes_out,
    }

    out_dir = GAME_OCR / "game_ocr" / "configs" / "classifier"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{args.version}.yaml"
    with out_path.open("w") as f:
        yaml.safe_dump(out, f, sort_keys=False, default_flow_style=None)
    print(f"\nwrote {out_path} ({len(classes_out)} classes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
