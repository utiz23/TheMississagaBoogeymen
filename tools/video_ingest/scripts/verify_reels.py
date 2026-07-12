"""Diagnostic: group a cached segments.json into per-match reels and print them.

Feeds a Pass-1 `segments.json` (from `video-ingest classify-only` / `ingest`)
through `match_split.group_into_reels` + `write_reels_json`, writing reels.json
next to it and printing a human-readable reel summary. Pure (no GPU/decode) —
used for the Milestone ① reel-count evidence and handy for any multi-match
sanity check.

Run (the repo-root .venv-1 is the pytest/python runner; the GPU tools/
video_ingest/.venv has no pytest — see [[reference_gpu_ocr_venv]]):

    cd tools/video_ingest && PYTHONPATH=.:../game_ocr \\
      ../../.venv-1/bin/python scripts/verify_reels.py /path/to/<sha>/segments.json
"""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

from video_ingest.match_split import group_into_reels, write_reels_json
from video_ingest.pass1_classify import load_segments_json


def main(segments_json: Path) -> None:
    loaded = load_segments_json(segments_json)
    segments = loaded.segments
    sha_root = segments_json.parent

    print(f"segments.json: {segments_json}")
    print(f"video_sha256:  {loaded.video_sha256}")
    print(f"total Pass-1 segments: {len(segments)}")
    counts = Counter(s.screen_type for s in segments)
    print("segment screen_type histogram:")
    for st, n in sorted(counts.items()):
        print(f"    {n:4d}  {st}")

    dropped: list[tuple[int, str]] = []
    reels = group_into_reels(segments, dropped=dropped)
    path = write_reels_json(sha_root, reels, dropped=dropped)

    print()
    print(f"==> {len(reels)} REEL(S)  (reels.json written to {path})")
    for r in reels:
        inv = {k: v for k, v in r.screen_inventory.items() if v}
        print(
            f"  reel {r.reel_index}: segs {r.segment_indices[0]}..{r.segment_indices[-1]} "
            f"({len(r.segment_indices)} segs)  {r.start_s:.0f}s..{r.end_s:.0f}s  "
            f"conf={r.boundary_confidence}"
        )
        print(f"      has: {', '.join(sorted(inv)) or '(none)'}")
        if r.completeness_flags:
            print(f"      flags: {', '.join(r.completeness_flags)}")
    if dropped:
        print(f"  dropped {len(dropped)} segment(s):")
        for idx, reason in dropped:
            print(f"      seg {idx}: {reason}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        raise SystemExit(2)
    main(Path(sys.argv[1]))
