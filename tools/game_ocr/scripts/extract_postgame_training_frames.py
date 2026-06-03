"""WS6 Tier-B: extract labeled post-game training frames from a match recording.

Labels come from the canonical Pass-1 OCR header reads already stored in the
run's segments.json (`classifications[].anchor_text` + `source_time_seconds`),
so each frame's label is grounded in the real on-screen header, not guessed.
Frames land in calibration/extras/ under the `<state>__match<N>_t<ms>_vs_<opp>.png`
convention the trainer auto-walks (no train-script change needed).

Only DATA-BEARING post-game screens are emitted (action_tracker, box-score tabs,
events, net_chart, faceoff_map). The "END OF GAME" team-stats tab has no state and
is intentionally skipped. Long same-label runs are densified to ~3 fps across their
interior; single-second screens (fast tab switches) contribute one frame — the
regex prior carries the discrimination, the frames teach the visual + prior weights.

Usage:
  cd tools/video_ingest && PYTHONPATH=.:../game_ocr ../../.venv-1/bin/python \
    ../game_ocr/scripts/extract_postgame_training_frames.py \
      --segments <segments.json> --video <src.mkv> --match 2582 --opp rr
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
EXTRAS = REPO / "tools/game_ocr/calibration/extras"

# anchor_text (normalized, lowercased, space-collapsed) → state. Order matters:
# the first match wins, so the more-specific patterns precede the broad ones.
RULES: list[tuple[str, str]] = [
    (r"all\s*events", "post_game_action_tracker"),
    (r"goals?\s*summary", "post_game_box_score_goals"),
    (r"shots?\s*summary", "post_game_box_score_shots"),
    (r"face\s*-?\s*off\s*summary", "post_game_box_score_faceoffs"),
    (r"net\s*chart", "post_game_net_chart"),
    (r"face\s*-?\s*off", "post_game_faceoff_map"),   # after faceoff-summary
    (r"\ball\b", "post_game_events"),                # bare "all" (scoring summary)
]
# Headers that mean "no trainable state here" — skip (team-stats / category menu).
SKIP = (r"endofgame", r"playersummary", r"summarycategory", r"selectcategory")


def label_for(anchor: str) -> str | None:
    if not anchor:
        return None
    if any(re.search(p, anchor) for p in SKIP):
        return None
    for pat, state in RULES:
        if re.search(pat, anchor):
            return state
    return None


def extract_frame(video: Path, t: float, out: Path) -> bool:
    """Decode-accurate still: fast-seek to t-2 then accurate-decode 2s."""
    pre = max(0.0, t - 2.0)
    out.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{pre:.3f}", "-i", str(video),
         "-ss", f"{t - pre:.3f}", "-frames:v", "1", "-vf", "scale=1920:1080",
         "-y", str(out)],
        capture_output=True, text=True,
    )
    return r.returncode == 0 and out.exists()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--segments", required=True, type=Path)
    ap.add_argument("--video", required=True, type=Path)
    ap.add_argument("--match", required=True)
    ap.add_argument("--opp", default="rr")
    ap.add_argument("--fps", type=float, default=3.0, help="densify long runs to this fps")
    args = ap.parse_args()

    d = json.loads(args.segments.read_text())
    cls = d.get("frame_classifications") or d.get("classifications") or []
    # (second, label) for labeled post-game seconds
    labeled: list[tuple[float, str]] = []
    for c in cls:
        t = c.get("source_time_seconds", c.get("seconds"))
        lbl = label_for((c.get("anchor_text") or "").lower())
        if t is not None and lbl is not None:
            labeled.append((float(t), lbl))
    labeled.sort()

    # Group into maximal same-label runs of consecutive seconds.
    runs: list[tuple[float, float, str]] = []
    for t, lbl in labeled:
        if runs and runs[-1][2] == lbl and t - runs[-1][1] <= 1.5:
            runs[-1] = (runs[-1][0], t, lbl)
        else:
            runs.append((t, t, lbl))

    counts: dict[str, int] = {}
    step = 1.0 / args.fps
    for start, end, lbl in runs:
        # densify the interior; single-second runs → one frame at the midpoint
        if end - start < 0.5:
            times = [start]
        else:
            lo, hi = start + 0.4, end - 0.4
            times = []
            x = lo
            while x <= hi + 1e-6:
                times.append(round(x, 2))
                x += step
        for t in times:
            ms = int(round(t * 1000))
            out = EXTRAS / f"{lbl}__match{args.match}_t{ms:07d}_vs_{args.opp}.png"
            if extract_frame(args.video, t, out):
                counts[lbl] = counts.get(lbl, 0) + 1

    print("extracted per state:")
    for k in sorted(counts):
        print(f"  {k:32s} {counts[k]}")
    print(f"total: {sum(counts.values())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
