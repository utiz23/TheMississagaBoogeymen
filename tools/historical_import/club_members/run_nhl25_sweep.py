"""
Run the club-member screenshot extractor over the full member-table set
for one title. One artifact per screenshot, written next to the image as
<image_stem>.extract.json.

Sweep is sequential and reuses one cv2 process. RapidOCR is instantiated
fresh per call by extract(), but the model load is amortised by Python's
in-process caching after the first call.

Usage:
  run_nhl25_sweep.py                 # default: NHL 25
  run_nhl25_sweep.py --title nhl24   # any title with the same source family
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools" / "historical_import" / "club_members"))

from extract_member_table import extract  # noqa: E402


# Map title slug → (research subdir name, default game mode).
TITLE_DIRS: dict[str, tuple[str, str]] = {
    "nhl25": ("NHL_25", "6s"),
    "nhl24": ("NHL_24", "6s"),
    "nhl23": ("NHL_23", "6s"),
    "nhl22": ("NHL_22", "6s"),
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--title", default="nhl25", choices=sorted(TITLE_DIRS))
    args = parser.parse_args()

    subdir, default_mode = TITLE_DIRS[args.title]
    screenshot_dir = ROOT / "research" / "Previous_NHL_Stats" / subdir
    title_slug = args.title

    files = sorted(screenshot_dir.glob("team_leaderboard__*.png"))
    if not files:
        print(f"No team_leaderboard__*.png under {screenshot_dir}", file=sys.stderr)
        return 1

    print(f"Sweeping {len(files)} screenshot(s) under {screenshot_dir}")
    summary: list[dict[str, object]] = []
    for i, path in enumerate(files, start=1):
        t0 = time.time()
        # role-group is derived from the view config when applicable;
        # we pass a default that gets overridden when the sort label is recognised.
        result = extract(
            image_path=path,
            title_slug=title_slug,
            game_mode=default_mode,
            role_group="skater",
        )
        elapsed = time.time() - t0
        out_path = path.with_suffix(".extract.json")
        out_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
        info = {
            "file": path.name,
            "sortedByMetricLabel": result["sortedByMetricLabel"],
            "roleGroup": result["roleGroup"],
            "rowCount": len(result["rows"]),
            "canonicalMappingApplied": result["canonicalMappingApplied"],
            "visibleMetricNames": result["visibleMetricNames"],
            "elapsedSec": round(elapsed, 1),
        }
        summary.append(info)
        print(f"[{i}/{len(files)}] {path.name} -> {info}")

    summary_path = screenshot_dir / "_sweep_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"Wrote summary {summary_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
