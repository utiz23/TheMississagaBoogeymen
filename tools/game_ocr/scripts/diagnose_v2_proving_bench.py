"""S5.5 diagnostic — per-frame v2 signals for a proving-bench clip.

Runs the v2 Pass-1 pipeline on every 1-fps frame of a clip and writes a JSON
dump with everything needed to root-cause a misclassification offline:

  - t_sec
  - expected (from labels.json span, or null)
  - predicted (post-Viterbi state)
  - top_bar_text, side_strip_text (raw OCR output)
  - fired_priors: list of {prior_name, owning_state}
  - classifier_top3: list of {state, log_prob} (BEFORE emission combiner)

OCR is the slow step (~1s/frame on CPU). Dumping once + iterating on fixes
offline avoids re-running OCR for each hypothesis.

Usage:
  set -a && source .env && set +a
  PYTHONPATH=tools/video_ingest:tools/game_ocr \\
    python3 tools/game_ocr/scripts/diagnose_v2_proving_bench.py \\
      --clip-name match-250-lobby-loadout \\
      --out tools/game_ocr/diagnostics/s5-5/match-250.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

_REPO_ROOT = Path(__file__).resolve().parents[3]
_VIDEO_INGEST_SRC = _REPO_ROOT / "tools" / "video_ingest"
_GAME_OCR_SRC = _REPO_ROOT / "tools" / "game_ocr"
for p in (_VIDEO_INGEST_SRC, _GAME_OCR_SRC):
    sp = str(p)
    if sp not in sys.path:
        sys.path.insert(0, sp)

from game_ocr.emissions import EmissionWeights  # noqa: E402
from game_ocr.frame_pipeline_v2 import compute_frame_features_v2_from_image  # noqa: E402
from game_ocr.ocr import RapidOCRBackend  # noqa: E402
from game_ocr.regex_priors import load_regex_priors  # noqa: E402
from game_ocr.screen_classifier import load_screen_classifier  # noqa: E402
from game_ocr.state_machine import load_state_machine  # noqa: E402
from video_ingest.pass1_classify import _iter_raw_bgr_frames  # noqa: E402
from video_ingest.pass1_segment import decode_segments_v2  # noqa: E402


BENCH_DIR = (
    _REPO_ROOT
    / "tools" / "video_ingest" / "tests" / "fixtures"
    / "screen-classifier-proving-bench"
)


def _expected_at_second(labels: list[dict], t_sec: int) -> str | None:
    for entry in labels:
        if int(entry["t_start_sec"]) <= t_sec <= int(entry["t_end_sec"]):
            return str(entry["expected"])
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--clip-name", required=True, help="Clip `name` field in labels.json.")
    ap.add_argument("--out", required=True, help="Output JSON path.")
    ap.add_argument("--version", default="nhl26")
    args = ap.parse_args()

    bench = json.loads((BENCH_DIR / "labels.json").read_text())
    clip = next((c for c in bench["clips"] if c["name"] == args.clip_name), None)
    if clip is None:
        names = [c["name"] for c in bench["clips"]]
        print(f"clip {args.clip_name!r} not found; available: {names}", file=sys.stderr)
        return 2

    clip_path = (BENCH_DIR / clip["path"]).resolve()
    if not clip_path.exists():
        print(f"clip file missing: {clip_path}", file=sys.stderr)
        return 2

    sm = load_state_machine(args.version)
    regex_priors = load_regex_priors(args.version)
    weights_path = (
        _REPO_ROOT
        / "tools" / "game_ocr" / "game_ocr" / "weights"
        / f"{args.version}-screen-classifier-v2.json"
    )
    clf = load_screen_classifier(weights_path, sm)
    ocr = RapidOCRBackend(use_gpu=False)

    feats = []
    print(f"Reading frames from {clip_path}…", file=sys.stderr)
    for i, frame in enumerate(_iter_raw_bgr_frames(clip_path, sample_fps=1.0)):
        feats.append(
            compute_frame_features_v2_from_image(
                frame, regex_priors=regex_priors, ocr_backend=ocr,
            )
        )
        if (i + 1) % 10 == 0:
            print(f"  …frame {i + 1}", file=sys.stderr)

    segments = decode_segments_v2(
        features=feats,
        classifier=clf,
        state_machine=sm,
        regex_priors=regex_priors,
        weights=EmissionWeights(),
    )
    decoded = ["unknown_or_transition"] * len(feats)
    for seg in segments:
        for i in range(seg.start_index, seg.end_index + 1):
            decoded[i] = seg.screen_type

    labels = clip.get("labels", [])

    rows = []
    for t, f in enumerate(feats):
        fired = []
        for i, prior in enumerate(regex_priors.priors_flat):
            if f.regex_prior_flags[i] == 1.0:
                fired.append({"prior_name": prior.name, "owning_state": prior.state})

        lp = clf.predict_log_probs(f)
        order = np.argsort(lp)[::-1]
        top3 = [
            {"state": sm.states[idx], "log_prob": float(lp[idx])}
            for idx in order[:3]
        ]
        all_log_probs = {sm.states[i]: float(lp[i]) for i in range(len(sm.states))}

        rows.append({
            "t_sec": t,
            "expected": _expected_at_second(labels, t),
            "predicted": decoded[t],
            "top_bar_text": f.top_bar_text,
            "side_strip_text": f.side_strip_text,
            "fired_priors": fired,
            "classifier_top3": top3,
            "classifier_log_probs": all_log_probs,
        })

    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({
        "clip": clip["name"],
        "clip_path": str(clip_path),
        "version": args.version,
        "n_frames": len(rows),
        "states": list(sm.states),
        "frames": rows,
    }, indent=2))
    print(f"wrote {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
