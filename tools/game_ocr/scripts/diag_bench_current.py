"""Investigation diagnostic (investigate/proving-bench-red): dump per-frame
v2 signals using the CURRENT iter_sampled_frames (canonical-PTS) path — the
exact path test_screen_classifier_proving_bench.py uses today.

Per second: expected (label), predicted (post-Viterbi), source_time_seconds,
sample_index, top_bar_text, side_strip_text, classifier top3. Lets us tell
PTS/label misalignment (content shifted vs label notes) from a weights
regression (content matches label but classifier is wrong).

Usage:
  PYTHONPATH=tools/video_ingest:tools/game_ocr \\
    .venv-1/bin/python tools/game_ocr/scripts/diag_bench_current.py \\
      --clip-name match-968-menu-sequence --out /tmp/diag-968.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

_REPO_ROOT = Path(__file__).resolve().parents[3]
for p in (_REPO_ROOT / "tools" / "video_ingest", _REPO_ROOT / "tools" / "game_ocr"):
    sp = str(p)
    if sp not in sys.path:
        sys.path.insert(0, sp)

from game_ocr.emissions import EmissionWeights  # noqa: E402
from game_ocr.frame_pipeline_v2 import compute_frame_features_v2_from_image  # noqa: E402
from game_ocr.ocr import RapidOCRBackend  # noqa: E402
from game_ocr.regex_priors import load_regex_priors  # noqa: E402
from game_ocr.screen_classifier import load_screen_classifier  # noqa: E402
from game_ocr.state_machine import load_state_machine  # noqa: E402
from video_ingest.pass1_classify import iter_sampled_frames  # noqa: E402
from video_ingest.pass1_segment import decode_segments_v2  # noqa: E402

BENCH_DIR = (
    _REPO_ROOT / "tools" / "video_ingest" / "tests"
    / "fixtures" / "screen-classifier-proving-bench"
)


def _expected_at_second(labels, t_sec):
    for entry in labels:
        if int(entry["t_start_sec"]) <= t_sec <= int(entry["t_end_sec"]):
            return str(entry["expected"])
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--clip-name", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--version", default="nhl26")
    args = ap.parse_args()

    bench = json.loads((BENCH_DIR / "labels.json").read_text())
    clip = next(c for c in bench["clips"] if c["name"] == args.clip_name)
    clip_path = (BENCH_DIR / clip["path"]).resolve()

    sm = load_state_machine(args.version)
    regex_priors = load_regex_priors(args.version)
    weights_path = (
        _REPO_ROOT / "tools" / "game_ocr" / "game_ocr" / "weights"
        / f"{args.version}-screen-classifier-v2.json"
    )
    clf = load_screen_classifier(weights_path, sm)
    ocr = RapidOCRBackend(use_gpu=False)

    feats, frame_meta = [], []
    print(f"Reading {clip_path}…", file=sys.stderr)
    for sf in iter_sampled_frames(clip_path, sample_fps=1.0):
        feats.append(
            compute_frame_features_v2_from_image(
                sf.image, regex_priors=regex_priors, ocr_backend=ocr,
            )
        )
        frame_meta.append((sf.sample_index, sf.source_time_seconds))

    segments = decode_segments_v2(
        features=feats, classifier=clf, state_machine=sm,
        regex_priors=regex_priors, weights=EmissionWeights(),
    )
    decoded = ["unknown_or_transition"] * len(feats)
    for seg in segments:
        for i in range(seg.start_index, seg.end_index + 1):
            decoded[i] = seg.screen_type

    labels = clip.get("labels", [])
    deferred = set(bench.get("deferred_classes_relaxed", []))
    rows = []
    for t, f in enumerate(feats):
        lp = clf.predict_log_probs(f)
        order = np.argsort(lp)[::-1]
        top3 = [{"state": sm.states[i], "lp": round(float(lp[i]), 2)} for i in order[:3]]
        exp = _expected_at_second(labels, t)
        pred = decoded[t]
        ok = (pred == exp) or (exp in deferred and pred == "unknown_or_transition")
        rows.append({
            "t": t,
            "sample_index": frame_meta[t][0],
            "src_t": round(float(frame_meta[t][1]), 3),
            "expected": exp,
            "predicted": pred,
            "match": ok,
            "top_bar_text": f.top_bar_text[:90],
            "side_strip_text": f.side_strip_text[:60],
            "top3": top3,
        })

    Path(args.out).write_text(json.dumps({"clip": clip["name"], "frames": rows}, indent=2))
    n_bad = sum(1 for r in rows if r["expected"] is not None and not r["match"])
    n_lab = sum(1 for r in rows if r["expected"] is not None)
    print(f"wrote {args.out}  ({n_lab - n_bad}/{n_lab} match)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
