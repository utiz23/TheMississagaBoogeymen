"""Train the Phase 1 learned screen classifier from labeled fixtures.

Walks the canonical ScreenShots/ + calibration/extras/ corpora plus a small
labeled slice of the match-250 60s clip fixture to cover catch-all states
(unknown_or_transition, loading_or_intro). Runs the RapidOCR backend once
per fixture to compute anchor-text (or both v2 ROIs), builds frame features,
fits sklearn LogisticRegression, and writes the JSON weights artifact.

S5: --engine flag dispatches between v1 (legacy single-anchor pipeline)
and v2 (per-quadrant HSV + regex priors + both-ROI OCR). Each engine
reads its own state machine YAML and writes its own weights file:

  --engine viterbi      → load nhl26-v1.yaml, save nhl26-screen-classifier-v1.json
  --engine viterbi_v2   → load nhl26.yaml,    save nhl26-screen-classifier-v2.json

States the corpus genuinely cannot cover today (e.g. end_of_video,
post_game_box_score_shots, post_game_box_score_faceoffs) get the
MISSING_STATE_INTERCEPT fallback so they never win on classifier signal
alone — anchor flags + emission_bonus surface them downstream.

Idempotent: re-running overwrites the engine's weights file. Commit the
regenerated weights as part of the same change.

Usage:
    PYTHONPATH=tools/game_ocr python3 tools/game_ocr/scripts/train_screen_classifier.py [--engine viterbi_v2] [--version nhl26]
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Literal

import cv2
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[3]
GAME_OCR = REPO_ROOT / "tools" / "game_ocr"
sys.path.insert(0, str(GAME_OCR))

from game_ocr.classifier import _scale_roi  # noqa: E402 -- internal helper
from game_ocr.frame_features import compute_frame_features  # noqa: E402
from game_ocr.frame_pipeline_v2 import compute_frame_features_v2_from_image  # noqa: E402
from game_ocr.ocr import RapidOCRBackend  # noqa: E402
from game_ocr.regex_priors import load_regex_priors  # noqa: E402
from game_ocr.screen_classifier import (  # noqa: E402
    train_screen_classifier,
    train_screen_classifier_v2,
)
from game_ocr.state_machine import load_state_machine  # noqa: E402
from game_ocr.utils import normalize_text  # noqa: E402


SCREENSHOTS = GAME_OCR / "ScreenShots"
EXTRAS = GAME_OCR / "calibration" / "extras"

CLIP_FIXTURE = REPO_ROOT / "tools" / "video_ingest" / "tests" / "fixtures" / "match-250-clip.mkv"


# Canonical-fixture filename → state label.
CANONICAL: dict[str, str] = {
    "Pre-Game Lobby State 1.png": "pre_game_lobby_state_1",
    "Pre-Game Lobby State 2.png": "pre_game_lobby_state_2",
    "Player Loadout View.png": "player_loadout_view",
    "Post Game Player Summary.png": "post_game_player_summary",
    "Post Game Box Score.png": "post_game_box_score_goals",
    "Post Game Events.png": "post_game_events",
    "Post Game Action tracker (All-Goals + Hits + Shots + Penalties + Faceoffs).png": "post_game_action_tracker",
    "Post Game Event Map Faceoffs.png": "post_game_faceoff_map",
    "Post Game Event Map Net-Chart.png": "post_game_net_chart",
    "In Game Clock.png": "in_game_clock",
    "In Game Goal Part 1.png": "in_game_goal_state_1",
    "In Game Goal Part 2.png": "in_game_goal_state_2",
}

CLIP_FRAMES: list[tuple[float, str]] = [
    (3.0, "unknown_or_transition"),    # FINDING OPPONENT matchmaking screen
    (51.0, "loading_or_intro"),        # WORLD CHEL splash transition
]


def _read_image(path: Path) -> np.ndarray:
    img = cv2.imread(str(path))
    if img is None:
        raise FileNotFoundError(f"cv2.imread failed: {path}")
    if img.shape[0] != 1080 or img.shape[1] != 1920:
        img = cv2.resize(img, (1920, 1080), interpolation=cv2.INTER_AREA)
    return img


def _read_anchor_text(img: np.ndarray, ocr: RapidOCRBackend, roi: tuple[int, int, int, int]) -> str:
    rx1, ry1, rx2, ry2 = _scale_roi(roi, img.shape[:2])
    crop = img[ry1:ry2, rx1:rx2]
    lines = ocr.read(crop)
    return " ".join(normalize_text(line.text) for line in lines if line.text).lower()


def _extras_label(filename: str) -> str | None:
    """Filename convention: <state>__match<N>_t<T>_vs_<opp>.png — leading state slug."""
    head = filename.split("__", 1)[0]
    return head or None


def _extract_clip_frame(clip_path: Path, seconds: float, out_path: Path) -> bool:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        [
            "ffmpeg", "-nostdin", "-v", "error",
            "-ss", str(seconds), "-i", str(clip_path),
            "-frames:v", "1", "-vf", "scale=1920:1080",
            "-y", str(out_path),
        ],
        capture_output=True, text=True,
    )
    return r.returncode == 0 and out_path.exists()


def _resolve_state_machine_version(version: str, engine: str) -> str:
    """v1 engine reads {version}-v1.yaml; v2 engine reads {version}.yaml."""
    if engine == "viterbi":
        return f"{version}-v1"
    if engine == "viterbi_v2":
        return version
    raise ValueError(f"unknown engine: {engine!r}")


def _weights_path(version: str, engine: str) -> Path:
    suffix = "v1" if engine == "viterbi" else "v2"
    return GAME_OCR / "game_ocr" / "weights" / f"{version}-screen-classifier-{suffix}.json"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default="nhl26")
    ap.add_argument(
        "--engine",
        choices=("viterbi", "viterbi_v2"),
        default="viterbi_v2",
        help="Pass-1 decoder family. viterbi=v1 (anchor-text only), viterbi_v2=v2 (per-quadrant HSV + regex priors + both-ROI OCR).",
    )
    ap.add_argument("--anchor-roi", type=int, nargs=4, default=[0, 0, 1920, 200],
                    help="(v1 only) anchor-text ROI in 1920x1080 native coords.")
    args = ap.parse_args()

    sm_version = _resolve_state_machine_version(args.version, args.engine)
    sm = load_state_machine(sm_version)
    ocr = RapidOCRBackend(use_gpu=False)

    # v2 needs regex priors for feature-vector position contract.
    regex_priors = load_regex_priors(args.version) if args.engine == "viterbi_v2" else None

    print(f"engine={args.engine}  state_machine={sm_version}  decoder_version={sm.decoder_version}", file=sys.stderr)
    if regex_priors is not None:
        print(f"regex priors: {regex_priors.n_priors()} flags across {len(regex_priors.priors_by_state)} states", file=sys.stderr)

    feats: list = []
    labels: list[str] = []
    skipped: list[str] = []

    def _featurize(img: np.ndarray):
        if args.engine == "viterbi_v2":
            return compute_frame_features_v2_from_image(
                img, regex_priors=regex_priors, ocr_backend=ocr,
            )
        anchor = _read_anchor_text(img, ocr, tuple(args.anchor_roi))
        return compute_frame_features(img, anchor_text=anchor, state_machine=sm)

    # Canonical fixtures.
    for fname, label in CANONICAL.items():
        path = SCREENSHOTS / fname
        if not path.exists():
            skipped.append(str(path))
            continue
        if label not in sm.states:
            print(f"warn: canonical label {label!r} not in state machine, skipping", file=sys.stderr)
            continue
        img = _read_image(path)
        feats.append(_featurize(img))
        labels.append(label)
        print(f"  + canonical {label}  ←  {fname}", file=sys.stderr)

    # Extras (the labeled corpus from calibration/extras/).
    extras_count = 0
    for path in sorted(EXTRAS.glob("*.png")):
        lbl = _extras_label(path.name)
        if lbl is None or lbl not in sm.states:
            continue  # silently skip — deferred classes leave PNGs in extras/
        img = _read_image(path)
        feats.append(_featurize(img))
        labels.append(lbl)
        extras_count += 1
    print(f"  + extras: {extras_count} labeled PNGs", file=sys.stderr)

    # Clip frames for catch-all states.
    if CLIP_FIXTURE.exists():
        with tempfile.TemporaryDirectory() as td:
            tdp = Path(td)
            for seconds, lbl in CLIP_FRAMES:
                if lbl not in sm.states:
                    continue
                out = tdp / f"clip-{int(seconds):05d}.png"
                if not _extract_clip_frame(CLIP_FIXTURE, seconds, out):
                    print(f"warn: ffmpeg failed at t={seconds}s; skipping", file=sys.stderr)
                    continue
                img = _read_image(out)
                feats.append(_featurize(img))
                labels.append(lbl)
                print(f"  + clip {lbl}  ←  t={int(seconds)}s", file=sys.stderr)
    else:
        print(f"warn: clip fixture not found at {CLIP_FIXTURE}; "
              f"catch-all states will use the missing-state fallback", file=sys.stderr)

    if not feats:
        print("error: no training data found", file=sys.stderr)
        return 1

    covered = set(labels)
    missing = sorted(set(sm.states) - covered)

    if args.engine == "viterbi_v2":
        clf = train_screen_classifier_v2(
            feats, labels, sm, regex_priors, allow_missing_states=True,
        )
    else:
        clf = train_screen_classifier(feats, labels, sm, allow_missing_states=True)

    out_path = _weights_path(args.version, args.engine)
    clf.save(out_path)
    print(f"\ntrained on {len(feats)} samples covering {len(covered)} of {len(sm.states)} states", file=sys.stderr)
    if missing:
        print(f"missing states (using fallback intercept): {missing}", file=sys.stderr)
    print(f"wrote {out_path}")
    if skipped:
        print(f"\nskipped {len(skipped)} missing fixtures:")
        for s in skipped:
            print(f"  - {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
