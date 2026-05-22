"""Phase 3a diagnostic — per-frame classifier signals for HMM routing investigation.

Streams frames from a video at the configured sample_fps, computes the same
FrameFeatures + LR-head log-probs + anchor flags the production Viterbi
decoder uses, and writes a TSV with one row per sampled frame. Designed to
answer: which OCR substrings co-occur with frames currently mis-routed to
`player_loadout_view` so we can pick evidence-backed anchor patches for
`tools/game_ocr/game_ocr/configs/state_machine/nhl26.yaml`.

Usage:
  PYTHONPATH=tools/video_ingest:tools/game_ocr \
    python3 tools/game_ocr/scripts/diagnose_segments.py \
      --video <path.mkv> \
      --segments-json <segments.json> \
      [--gt-ranges "0-25=pre_game_lobby_state_1,40-90=player_loadout_view"] \
      [--version nhl26] \
      [--out tools/game_ocr/diagnostics/phase-3a/match<id>.tsv]

Output columns (tab-separated):
  t_sec, viterbi_screen, gt_screen, top1, top1_lp, top2, top2_lp,
  lp_state_1, lp_state_2, lp_loadout, anchor_flags, anchor_text, reject

`viterbi_screen` comes from the supplied segments.json (the production
decode); if the JSON's `screen_type` is `unknown_or_transition` the column
is filled with that. `top1/top2` are the LR head's own argmax columns
BEFORE the emission combiner's anchor_bonus is applied, so the operator can
see how far the classifier-only prediction sits from the Viterbi output.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# Repo layout: tools/game_ocr/ and tools/video_ingest/ are siblings; this
# script lives in tools/game_ocr/scripts/. The orchestrator computes the
# weights path the same way (parents[2] / game_ocr / game_ocr / weights).
_REPO_ROOT = Path(__file__).resolve().parents[3]
_VIDEO_INGEST_SRC = _REPO_ROOT / "tools" / "video_ingest"
_GAME_OCR_SRC = _REPO_ROOT / "tools" / "game_ocr"
for p in (_VIDEO_INGEST_SRC, _GAME_OCR_SRC):
    sp = str(p)
    if sp not in sys.path:
        sys.path.insert(0, sp)

from game_ocr.classifier import Classifier, load_classifier_config  # noqa: E402
from game_ocr.frame_features import compute_frame_features  # noqa: E402
from game_ocr.screen_classifier import load_screen_classifier  # noqa: E402
from game_ocr.state_machine import load_state_machine  # noqa: E402
from video_ingest.pass1_classify import _iter_raw_bgr_frames  # noqa: E402


@dataclass(frozen=True)
class GroundTruthInterval:
    start_sec: float
    end_sec: float
    screen: str


def parse_gt_ranges(spec: str | None) -> list[GroundTruthInterval]:
    if not spec:
        return []
    out: list[GroundTruthInterval] = []
    for raw in spec.split(","):
        raw = raw.strip()
        if not raw:
            continue
        try:
            interval, screen = raw.split("=", 1)
            lo, hi = interval.split("-", 1)
            out.append(GroundTruthInterval(float(lo), float(hi), screen.strip()))
        except ValueError as exc:
            raise SystemExit(f"could not parse --gt-ranges entry {raw!r}: {exc}")
    return out


def gt_screen_at(t_sec: float, intervals: list[GroundTruthInterval]) -> str:
    for iv in intervals:
        if iv.start_sec <= t_sec <= iv.end_sec:
            return iv.screen
    return ""


def load_segments(path: Path, sample_period: float) -> dict[int, str]:
    """Returns {frame_index: viterbi_screen_type} from a segments.json file.

    Frame index is computed as `start_index + offset` per Segment row, so
    each frame between start_index and end_index inclusive gets stamped.
    """
    raw = json.loads(path.read_text())
    out: dict[int, str] = {}
    # Tolerate the production Segment shape (`start_index`/`end_index`) and
    # the hand-labeled fixture shape (`start_frame`/`end_frame`).
    for seg in raw.get("segments", raw):
        start = int(seg.get("start_index", seg.get("start_frame")))
        end = int(seg.get("end_index", seg.get("end_frame")))
        screen = str(seg["screen_type"])
        for i in range(start, end + 1):
            out[i] = screen
    return out


def diagnose(
    *,
    video_path: Path,
    segments_json: Path | None,
    gt_ranges: list[GroundTruthInterval],
    version: str,
    out_path: Path,
    max_frames: int | None = None,
) -> None:
    sm = load_state_machine(version)
    weights_path = _GAME_OCR_SRC / "game_ocr" / "weights" / f"{version}-screen-classifier.json"
    if not weights_path.exists():
        raise SystemExit(f"missing classifier weights: {weights_path}")
    clf = load_screen_classifier(weights_path, sm)
    legacy_cfg = load_classifier_config(version)
    # CPU OCR is fine for a diagnostic pass — anchor ROI is a tiny crop.
    legacy = Classifier(legacy_cfg, use_gpu=False)

    sample_period = 1.0 / sm.sample_fps
    viterbi_by_index: dict[int, str] = (
        load_segments(segments_json, sample_period) if segments_json else {}
    )

    state_1 = "pre_game_lobby_state_1"
    state_2 = "pre_game_lobby_state_2"
    loadout = "player_loadout_view"
    idx_state_1 = sm.state_index(state_1)
    idx_state_2 = sm.state_index(state_2)
    idx_loadout = sm.state_index(loadout)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    header = (
        "t_sec\tviterbi_screen\tgt_screen\ttop1\ttop1_lp\ttop2\ttop2_lp\t"
        f"lp_{state_1}\tlp_{state_2}\tlp_{loadout}\t"
        "anchor_flags\tanchor_text\treject"
    )

    rows_written = 0
    with out_path.open("w") as fh:
        print(header, file=fh)
        for idx, frame in enumerate(_iter_raw_bgr_frames(video_path, sm.sample_fps)):
            if max_frames is not None and idx >= max_frames:
                break
            t_sec = idx * sample_period
            anchor_text = legacy._read_anchor(frame)
            feats = compute_frame_features(frame, anchor_text=anchor_text, state_machine=sm)
            lp = clf.predict_log_probs(feats)
            order = np.argsort(lp)[::-1]
            top1_idx, top2_idx = int(order[0]), int(order[1])
            top1 = sm.states[top1_idx]
            top2 = sm.states[top2_idx]
            anchor_bitmap = "".join("1" if feats.anchor_flags[i] else "0" for i in range(len(sm.states)))
            viterbi_screen = viterbi_by_index.get(idx, "")
            gt_screen = gt_screen_at(t_sec, gt_ranges)
            # Tab-separate; replace tabs in anchor_text to keep TSV regular.
            safe_anchor = anchor_text.replace("\t", " ").replace("\n", " ")
            row = (
                f"{t_sec:.3f}\t{viterbi_screen}\t{gt_screen}\t"
                f"{top1}\t{lp[top1_idx]:.3f}\t{top2}\t{lp[top2_idx]:.3f}\t"
                f"{lp[idx_state_1]:.3f}\t{lp[idx_state_2]:.3f}\t{lp[idx_loadout]:.3f}\t"
                f"{anchor_bitmap}\t{safe_anchor}\t"
                f"{int(feats.reject_anchor_present)}"
            )
            print(row, file=fh)
            rows_written += 1
            if rows_written % 60 == 0:
                print(f"[diagnose] {rows_written} frames processed", file=sys.stderr)

    print(f"[diagnose] wrote {rows_written} rows → {out_path}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--segments-json", type=Path, default=None,
                        help="Optional Pass-1 segments.json. When present, the viterbi_screen "
                             "column is populated per-frame from its segments[].screen_type.")
    parser.add_argument("--gt-ranges", default="",
                        help='Comma-separated ground-truth intervals: '
                             '"0-25=pre_game_lobby_state_1,40-90=player_loadout_view"')
    parser.add_argument("--version", default="nhl26")
    parser.add_argument("--out", type=Path, required=True,
                        help="Output TSV path (e.g. tools/game_ocr/diagnostics/phase-3a/match250.tsv)")
    parser.add_argument("--max-frames", type=int, default=None,
                        help="Stop after N sampled frames. Useful for the pre-game window only.")
    args = parser.parse_args(argv)

    if not args.video.exists():
        raise SystemExit(f"video not found: {args.video}")
    if args.segments_json is not None and not args.segments_json.exists():
        raise SystemExit(f"segments-json not found: {args.segments_json}")

    diagnose(
        video_path=args.video,
        segments_json=args.segments_json,
        gt_ranges=parse_gt_ranges(args.gt_ranges),
        version=args.version,
        out_path=args.out,
        max_frames=args.max_frames,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
