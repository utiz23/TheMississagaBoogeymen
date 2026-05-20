"""Operator-driven corpus expansion for the Phase 1 state machine.

Like video_ingest/annotate.py but covers all 17 states (annotate.py only knew
the legacy 8). Reads a Pass-1 segments.json (legacy or HMM), picks the top-N
frames where the decoder was unconfident, opens each frame in the OS image
viewer, and accepts a numeric label that maps to one of the 17 states.

Output: a labeled PNG written to tools/game_ocr/calibration/extras/ using the
existing naming convention `<state>__match<N>_t<T>_vs_<opp>.png`. Re-run
train_screen_classifier.py to fold the new labels into the weights artifact.

Usage:
    python3 tools/game_ocr/scripts/label_state_machine_corpus.py \\
        --segments /tmp/vi-canonical/<sha>/segments.json \\
        --video /mnt/k/NHL/NHL26/<file>.mkv \\
        --match-id 250 \\
        --opp 4thline
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
GAME_OCR = REPO_ROOT / "tools" / "game_ocr"
sys.path.insert(0, str(GAME_OCR))

from game_ocr.state_machine import load_state_machine  # noqa: E402


def _slugify(s: str) -> str:
    out = re.sub(r"[^a-zA-Z0-9]+", "-", (s or "").strip().lower()).strip("-")
    return out or "unknown"


def _open_image(path: Path) -> None:
    for opener in ("xdg-open", "wslview", "explorer.exe"):
        if shutil.which(opener):
            subprocess.Popen(
                [opener, str(path)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            return


def _extract_frame(video: Path, seconds: float, out_path: Path) -> bool:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        [
            "ffmpeg", "-nostdin", "-v", "error",
            "-ss", str(seconds), "-i", str(video),
            "-frames:v", "1",
            "-vf", "scale=1920:1080",
            "-y", str(out_path),
        ],
        capture_output=True, text=True,
    )
    return r.returncode == 0 and out_path.exists()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--segments", type=Path, required=True)
    ap.add_argument("--video", type=Path, required=True)
    ap.add_argument("--version", default="nhl26")
    ap.add_argument("--match-id", type=int, default=None)
    ap.add_argument("--opp", default="unknown")
    ap.add_argument("--top-n", type=int, default=20)
    ap.add_argument(
        "--extras-dir",
        type=Path,
        default=GAME_OCR / "calibration" / "extras",
    )
    args = ap.parse_args()

    sm = load_state_machine(args.version)
    data = json.loads(args.segments.read_text())
    fc = data.get("frame_classifications", [])
    if not fc:
        print("no frame_classifications in segments.json", file=sys.stderr)
        return 1

    # Candidate selection: frames marked unknown OR low-confidence anchored.
    candidates = [f for f in fc if f.get("screen_type") in ("unknown_screen", "unknown_or_transition")]
    candidates.sort(key=lambda f: -float(f.get("color_score", 0.0)))
    candidates = candidates[: args.top_n]

    print(f"\nState menu:")
    for i, s in enumerate(sm.states):
        print(f"  {i:>2}  {s}")
    print(f"   s   skip   q   quit\n")

    tmp_dir = Path("/tmp/label-corpus-tmp")
    tmp_dir.mkdir(exist_ok=True)
    labeled = skipped = 0
    for i, f in enumerate(candidates, 1):
        seconds = float(f["seconds"])
        tmp_png = tmp_dir / f"cand-{int(seconds):05d}.png"
        if not _extract_frame(args.video, seconds, tmp_png):
            print(f"[{i}/{len(candidates)}] ffmpeg failed; skip"); continue
        anchor = (f.get("anchor_text") or "")[:80]
        print(f"[{i}/{len(candidates)}] t={seconds:.0f}s  anchor={anchor!r}")
        _open_image(tmp_png)
        choice = input("  label: ").strip().lower()
        if choice == "q":
            break
        if choice == "s" or not choice:
            skipped += 1
            continue
        try:
            idx = int(choice)
        except ValueError:
            skipped += 1
            print("  not a number, skip"); continue
        if idx < 0 or idx >= len(sm.states):
            skipped += 1
            print(f"  index {idx} out of range, skip"); continue
        klass = sm.states[idx]
        match_part = f"match{args.match_id}" if args.match_id else "match-unknown"
        out_name = f"{klass}__{match_part}_t{int(seconds)}_vs_{_slugify(args.opp)}.png"
        out_path = args.extras_dir / out_name
        out_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(tmp_png, out_path)
        print(f"  → saved {out_name}")
        labeled += 1

    print(f"\nlabeled={labeled} skipped={skipped}")
    if labeled:
        print(f"Run train_screen_classifier.py to fold new labels into weights.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
