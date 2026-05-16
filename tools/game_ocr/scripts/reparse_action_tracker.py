"""Re-OCR + re-parse all action_tracker captures for a match, updating
their raw_result_json with current-parser output. Emits SQL UPDATE
statements to stdout, designed to be piped into psql.

Sister to respatialize_match.py — that script reruns ONLY the spatial
(yellow-marker) step; this one runs the FULL parser including the text
OCR over the list panel, so it catches parser changes that affect row
grouping, relation regex, or event-type recognition (e.g. the
'SHDT' ↔ 'SHOT' OCR-typo fallback).

Usage:
  python3 tools/game_ocr/scripts/reparse_action_tracker.py <MATCH_ID> \
    | docker exec -i eanhl-team-website-db-1 psql -U eanhl -d eanhl

After running, follow with:
  pnpm --filter worker repromote-ocr --match <MATCH_ID> \
       --screen post_game_action_tracker
to push the refreshed events into match_events, then run
inventory_consensus_match.py to repopulate any (x, y) holes.

Skips ocr_extractions whose source_path is no longer readable on disk
(e.g. /tmp/ paths that were cleaned up after the initial ingest).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# Make game_ocr importable regardless of cwd.
SCRIPT_DIR = Path(__file__).resolve().parent
PKG_ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(PKG_ROOT))

import cv2  # noqa: E402

from game_ocr.config import load_screen_config  # noqa: E402
from game_ocr.image import crop_region, preprocess_image  # noqa: E402
from game_ocr.models import ExtractionMeta  # noqa: E402
from game_ocr.ocr import RapidOCRBackend  # noqa: E402
from game_ocr.parsers import parse_post_game_action_tracker  # noqa: E402

DOCKER_PSQL = [
    "docker", "exec", "eanhl-team-website-db-1",
    "psql", "-U", "eanhl", "-d", "eanhl", "-tAc",
]


def fetch_rows(match_id: int) -> list[dict]:
    out = subprocess.check_output(
        DOCKER_PSQL
        + [
            f"SELECT id, source_path FROM ocr_extractions "
            f"WHERE match_id = {match_id} "
            f"AND screen_type = 'post_game_action_tracker' "
            f"ORDER BY id"
        ]
    ).decode()
    rows: list[dict] = []
    for line in out.strip().splitlines():
        if "|" in line:
            id_str, path = line.split("|", 1)
            rows.append({"id": int(id_str.strip()), "source_path": path.strip()})
    return rows


def main() -> None:
    if len(sys.argv) < 2:
        print(f"usage: {sys.argv[0]} <match_id>", file=sys.stderr)
        sys.exit(1)
    match_id = int(sys.argv[1])

    screen = load_screen_config("post_game_action_tracker")
    backend = RapidOCRBackend()
    rows = fetch_rows(match_id)
    print(f"-- reparse_action_tracker: match_id={match_id} extractions={len(rows)}",
          file=sys.stderr)
    print("BEGIN;")

    parsed = missing = failed = 0
    for row in rows:
        path = row["source_path"]
        img = cv2.imread(path)
        if img is None:
            missing += 1
            continue
        try:
            regions = {}
            for name, region in screen.regions.items():
                cropped = crop_region(img, region)
                prepared = preprocess_image(cropped, region.preprocess)
                regions[name] = backend.read(prepared)
            meta = ExtractionMeta(
                screen_type="post_game_action_tracker",
                image_path=path,
                source_path=path,
                ocr_backend="rapidocr",
                extracted_at=datetime.now(timezone.utc),
                overall_confidence=0.95,
                image_sha1="",
            )
            result = parse_post_game_action_tracker(meta, regions, image=img)
            payload = result.model_dump(mode="json")
            payload_str = json.dumps(payload).replace("'", "''")
            print(
                f"UPDATE ocr_extractions SET "
                f"raw_result_json = '{payload_str}'::jsonb, "
                f"transform_status = 'pending' "
                f"WHERE id = {row['id']};"
            )
            parsed += 1
            if parsed % 25 == 0:
                print(f"-- progress: {parsed} parsed", file=sys.stderr)
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"-- skip id={row['id']}: {exc}", file=sys.stderr)

    print("COMMIT;")
    print(
        f"-- done: parsed={parsed} missing={missing} failed={failed}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
