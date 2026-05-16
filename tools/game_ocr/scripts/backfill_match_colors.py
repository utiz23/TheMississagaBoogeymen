#!/usr/bin/env python3
"""One-off backfill of matches.{bgm_color_hex, opp_color_hex, bgm_team_abbr,
opp_team_abbr, bgm_was_home} for a single match.

Used to seed match 250 (the canonical OCR-ingested match) without having to
re-run the full OCR pipeline against its existing capture batches. For matches
ingested AFTER this script lands, the worker's `applyMatchColors` runs as part
of `ingestOcrBatch` and this script is unnecessary.

Strategy:
  1. Pull every `post_game_action_tracker` source_path for the match from the
     DB. Sample the trapezoid colours with `color_extractor.sample_team_colors`
     and aggregate to a per-side hex.
  2. Pull every `home_label` / `away_label` rawText from net_chart / faceoff_map
     extractions. Strip the "(H)" / "(A)" suffix via `_strip_label_side_marker`
     and mode-aggregate to per-side abbreviations.
  3. Pick the BGM/opp assignment by matching each abbreviation against
     a small BGM-alias set; whichever side matches is BGM.
  4. UPDATE the matches row.

Usage:
  set -a && source .env && set +a
  uv run --project tools/game_ocr python tools/game_ocr/scripts/backfill_match_colors.py 250
"""
from __future__ import annotations

import os
import sys
from collections import Counter
from pathlib import Path
from typing import Sequence

import cv2
import psycopg

# Make the game_ocr package importable when running this script directly.
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent))

from game_ocr.color_extractor import (
    aggregate_team_color,
    sample_team_colors,
)
from game_ocr.parsers import _strip_label_side_marker

BGM_ALIASES = {"bgm", "boogeymen", "the boogeymen", "bm"}


def main() -> None:
    if len(sys.argv) < 2:
        print(f"usage: {sys.argv[0]} <match_id>", file=sys.stderr)
        sys.exit(1)
    match_id = int(sys.argv[1])
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL must be set (source .env first)", file=sys.stderr)
        sys.exit(1)

    with psycopg.connect(dsn) as conn:
        action_paths = _action_tracker_paths(conn, match_id)
        labels = _team_labels(conn, match_id)

    print(f"[backfill] match={match_id}")
    print(f"[backfill] action_tracker frames: {len(action_paths)}")
    print(f"[backfill] label rows: {len(labels)}")

    home_color, away_color = _aggregate_colours(action_paths)
    home_abbr, away_abbr = _aggregate_abbrs(labels)

    print(f"[backfill] sampled HOME hex={home_color} AWAY hex={away_color}")
    print(f"[backfill] sampled HOME abbr={home_abbr} AWAY abbr={away_abbr}")

    bgm_was_home, bgm_abbr, opp_abbr, bgm_color, opp_color = _resolve_sides(
        home_abbr, away_abbr, home_color, away_color
    )
    print(
        f"[backfill] resolved bgm_was_home={bgm_was_home} bgm={bgm_abbr}/{bgm_color}"
        f" opp={opp_abbr}/{opp_color}"
    )

    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE matches
            SET bgm_team_abbr = %s,
                opp_team_abbr = %s,
                bgm_color_hex = %s,
                opp_color_hex = %s,
                bgm_was_home  = COALESCE(%s, bgm_was_home)
            WHERE id = %s
            """,
            (bgm_abbr, opp_abbr, bgm_color, opp_color, bgm_was_home, match_id),
        )
        conn.commit()
        print(f"[backfill] UPDATE matches → rowcount={cur.rowcount}")


def _action_tracker_paths(conn: psycopg.Connection, match_id: int) -> list[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT source_path FROM ocr_extractions
            WHERE match_id = %s AND screen_type = 'post_game_action_tracker'
            """,
            (match_id,),
        )
        return [row[0] for row in cur.fetchall()]


def _team_labels(conn: psycopg.Connection, match_id: int) -> list[tuple[str, str]]:
    """Return (field_key, raw_text) for every home_label / away_label row."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT oef.field_key, oef.raw_text
            FROM ocr_extraction_fields oef
            JOIN ocr_extractions oe ON oef.extraction_id = oe.id
            WHERE oe.match_id = %s
              AND oe.screen_type IN ('post_game_net_chart', 'post_game_faceoff_map')
              AND oef.field_key IN ('home_label', 'away_label')
              AND oef.raw_text IS NOT NULL
            """,
            (match_id,),
        )
        return [(row[0], row[1]) for row in cur.fetchall()]


def _aggregate_colours(paths: Sequence[str]) -> tuple[str | None, str | None]:
    home_samples = []
    away_samples = []
    for path in paths:
        img = cv2.imread(path)
        if img is None:
            continue
        try:
            colors = sample_team_colors(img)
        except Exception as exc:  # noqa: BLE001
            print(f"  warn: failed {path}: {exc}", file=sys.stderr)
            continue
        home_samples.append(colors.home)
        away_samples.append(colors.away)
    home = aggregate_team_color(home_samples)
    away = aggregate_team_color(away_samples)
    return home.hex_color, away.hex_color


def _aggregate_abbrs(
    labels: Sequence[tuple[str, str]]
) -> tuple[str | None, str | None]:
    home_counts: Counter[str] = Counter()
    away_counts: Counter[str] = Counter()
    for field_key, raw in labels:
        abbr, _side = _strip_label_side_marker(raw)
        if abbr is None:
            continue
        if field_key == "home_label":
            home_counts[abbr] += 1
        elif field_key == "away_label":
            away_counts[abbr] += 1
    home = home_counts.most_common(1)[0][0] if home_counts else None
    away = away_counts.most_common(1)[0][0] if away_counts else None
    return home, away


def _resolve_sides(
    home_abbr: str | None,
    away_abbr: str | None,
    home_color: str | None,
    away_color: str | None,
) -> tuple[bool | None, str | None, str | None, str | None, str | None]:
    """Map (home, away) → (bgm_was_home, bgm_abbr, opp_abbr, bgm_color, opp_color)."""
    def is_bgm(abbr: str | None) -> bool:
        return abbr is not None and abbr.lower() in BGM_ALIASES

    home_is_bgm = is_bgm(home_abbr)
    away_is_bgm = is_bgm(away_abbr)
    if home_is_bgm and not away_is_bgm:
        return (True, home_abbr, away_abbr, home_color, away_color)
    if away_is_bgm and not home_is_bgm:
        return (False, away_abbr, home_abbr, away_color, home_color)
    # Ambiguous — leave bgm_was_home unchanged.
    return (None, None, None, None, None)


if __name__ == "__main__":
    main()
