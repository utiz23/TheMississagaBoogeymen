"""
Driver: run extract_club_team_stats.py over every NHL 22–25 club-stats
playlist pair and assemble a review queue.

Output:
  - One reviewable JSON per (title, playlist) at
    `tools/historical_import/club_team_stats/<title>__<playlist>.extract.json`
  - A `_review_index.json` aggregating per-playlist metric counts,
    confidence, label-glue null fields, and arithmetic-sanity flags so
    the human reviewer can prioritise.

Hand-keyed pilots (e.g. nhl25_eashl_6v6_pilot.json) are NOT overwritten —
extractor outputs live alongside them under a distinct filename.

Run:
  python run_review_queue.py
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
SCREENSHOT_BASE = ROOT / "research" / "Previous_NHL_Stats"
OUTPUT_DIR = ROOT / "tools" / "historical_import" / "club_team_stats"
EXTRACTOR = OUTPUT_DIR / "extract_club_team_stats.py"

TITLE_DIRS: dict[str, str] = {
    "nhl22": "NHL_22",
    "nhl23": "NHL_23",
    "nhl24": "NHL_24",
    "nhl25": "NHL_25",
}

PNG_RE = re.compile(r"^club_stats__(?P<playlist>.+)__(?P<idx>\d{2})\.png$")


def discover_playlists(title_slug: str) -> list[tuple[str, Path, Path]]:
    """Return [(playlist, image_01_path, image_02_path), ...]."""
    sub = TITLE_DIRS[title_slug]
    d = SCREENSHOT_BASE / sub
    if not d.exists():
        return []
    pngs: dict[str, dict[str, Path]] = {}
    for p in sorted(d.glob("club_stats__*.png")):
        m = PNG_RE.match(p.name)
        if not m:
            continue
        pl = m.group("playlist")
        pngs.setdefault(pl, {})[m.group("idx")] = p
    out: list[tuple[str, Path, Path]] = []
    for pl, parts in sorted(pngs.items()):
        if "01" in parts and "02" in parts:
            out.append((pl, parts["01"], parts["02"]))
        else:
            print(f"  WARN: {title_slug} {pl} missing 01 or 02; skipping", file=sys.stderr)
    return out


def run_extractor(title_slug: str, playlist: str, p01: Path, p02: Path) -> Path:
    out_path = OUTPUT_DIR / f"{title_slug}__{playlist}.extract.json"
    cmd = [
        sys.executable,
        str(EXTRACTOR),
        str(p01),
        str(p02),
        "--title-slug", title_slug,
        "--playlist", playlist,
        "--output", str(out_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"Extractor failed for {title_slug}/{playlist}: {result.stderr}"
        )
    return out_path


def summarise_extract(path: Path) -> dict[str, Any]:
    """Build a compact summary entry for the review index."""
    j = json.loads(path.read_text(encoding="utf-8"))
    rec = j["records"][0]
    metrics: dict[str, Any] = rec["metrics"]
    raw01: dict[str, Any] = rec["rawExtract"]["screenshot01"]
    raw02: dict[str, Any] = rec["rawExtract"]["screenshot02"]

    # Label-glue null entries: detected label but no value paired locally.
    glue_nulls_01 = [k for k, v in raw01.items() if v is None]
    glue_nulls_02 = [k for k, v in raw02.items() if v is None]

    # Arithmetic checks (non-fatal — purely informational).
    arith_flags: list[str] = []
    gf = metrics.get("goals_for")
    ga = metrics.get("goals_against")
    gd = metrics.get("goal_difference")
    if isinstance(gf, (int, float)) and isinstance(ga, (int, float)):
        if isinstance(gd, (int, float)) and gd != gf - ga:
            arith_flags.append(
                f"goal_difference {gd} != goals_for-goals_against ({gf}-{ga}={gf-ga})"
            )
    # GP-vs-rates: if avg_goals_for and goals_for are present, derive games
    # and compare to the captured games_played.
    avg_gf = metrics.get("avg_goals_for")
    gp = metrics.get("games_played")
    if isinstance(gf, (int, float)) and isinstance(avg_gf, (int, float)) and avg_gf > 0:
        derived_gp = round(gf / avg_gf)
        if isinstance(gp, (int, float)) and abs(gp - derived_gp) > 1:
            arith_flags.append(
                f"games_played {gp} != round(goals_for / avg_goals_for) = {derived_gp}"
            )

    # Suspiciously-high counts that often mean an OCR shape error.
    pim = metrics.get("pim")
    if isinstance(pim, (int, float)) and pim > 100000:
        arith_flags.append(f"pim {pim} looks suspiciously high")
    return {
        "outputFile": str(path.relative_to(OUTPUT_DIR)),
        "titleSlug": rec["titleSlug"],
        "playlist": rec["playlist"],
        "confidenceScore": rec["confidenceScore"],
        "metricsCount": len(metrics),
        "rawScreenshot01Count": len(raw01),
        "rawScreenshot02Count": len(raw02),
        "labelGlueNulls": {
            "screenshot01": glue_nulls_01,
            "screenshot02": glue_nulls_02,
        },
        "arithmeticFlags": arith_flags,
        "notes": rec.get("notes", ""),
    }


def main() -> int:
    print(f"Driver: {EXTRACTOR}")
    queue: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    for title_slug in TITLE_DIRS:
        playlists = discover_playlists(title_slug)
        if not playlists:
            print(f"[skip] {title_slug}: no playlist pairs")
            continue
        print(f"[{title_slug}] {len(playlists)} playlist(s): {[p[0] for p in playlists]}")
        for playlist, p01, p02 in playlists:
            print(f"  -> extracting {title_slug}/{playlist} ...", flush=True)
            try:
                out_path = run_extractor(title_slug, playlist, p01, p02)
                queue.append(summarise_extract(out_path))
            except Exception as e:
                failures.append({
                    "titleSlug": title_slug,
                    "playlist": playlist,
                    "error": str(e),
                })
                print(f"     FAILED: {e}", file=sys.stderr)

    index = {
        "_comment": (
            "Review queue index for the club_stats__* extractor. Each entry "
            "is a generated reviewable JSON; the user reviews and corrects "
            "before promoting to import. Hand-keyed pilots in this directory "
            "(*_pilot.json) are independent and untouched."
        ),
        "totalPlaylists": len(queue),
        "extractorFailures": failures,
        "queue": queue,
    }
    (OUTPUT_DIR / "_review_index.json").write_text(
        json.dumps(index, indent=2), encoding="utf-8"
    )
    print()
    print(f"Wrote {OUTPUT_DIR / '_review_index.json'}")
    print(f"Generated {len(queue)} reviewable JSON(s); {len(failures)} failure(s)")
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
