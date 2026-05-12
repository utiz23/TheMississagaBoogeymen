"""Respatialize an already-ingested match under the current calibration.

Re-runs only the SPATIAL part of the Action Tracker parser (HSV mask +
yellow-marker detection + pixel→hockey via the current calibration). Does
NOT re-run text OCR — the assumption is that the parsed events list is
already correct in `ocr_extractions.raw_result_json`, and we just want
to update the hockey coordinates of the selected (highlighted) event.

Pipeline:
  1. Read existing ocr_extractions rows for the match (from stdin JSON)
  2. For each: load source image, run extract_selected_event_position()
  3. Emit SQL UPDATE statements to stdout:
     - Updates raw_result_json.selected_event_{x,y,rink_zone,confidence}
     - Updates the matching match_events row's x/y/rink_zone/position_confidence

Usage:
  docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -tAc \\
    "SELECT json_agg(json_build_object('id', id, 'source_path', source_path,
                                        'raw_result_json', raw_result_json))
     FROM ocr_extractions
     WHERE match_id=250 AND screen_type='post_game_action_tracker'" \\
    | python3 tools/game_ocr/scripts/respatialize_match.py 250 \\
    | docker exec -i eanhl-team-website-db-1 psql -U eanhl -d eanhl

Idempotent — running twice produces the same final state.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Make the game_ocr package importable when run from repo root.
REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "tools" / "game_ocr"))

import cv2  # noqa: E402

from game_ocr.spatial import (  # noqa: E402
    detect_rink_markers,
    extract_selected_event_position,
    load_rink_calibration,
    pixel_to_hockey,
)


def sql_escape(s: str) -> str:
    return s.replace("'", "''")


def field_value(field) -> str:
    """Extract a string from either a raw string or an ExtractionField dict.

    The parser emits some event fields as `{value: str, confidence: float}`
    dicts (the ExtractionField shape used by the typed-OCR pipeline) and
    others as plain strings. The TS worker's stringValue() does the same
    normalization.
    """
    if field is None:
        return ""
    if isinstance(field, str):
        return field
    if isinstance(field, dict):
        v = field.get("value")
        return v if isinstance(v, str) else ""
    return str(field)


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: respatialize_match.py <match_id>", file=sys.stderr)
        return 2
    match_id = int(sys.argv[1])

    cal = load_rink_calibration("post_game_action_tracker")
    print(
        f"-- respatialize_match.py: match_id={match_id}, "
        f"landmarks={len(cal.landmarks)}",
        file=sys.stderr,
    )

    payload = sys.stdin.read().strip()
    if not payload or payload == "null":
        print("-- no input rows", file=sys.stderr)
        return 0
    rows = json.loads(payload)
    print(f"-- {len(rows)} extractions to respatialize", file=sys.stderr)

    print("BEGIN;")
    stats = {"updated": 0, "no_marker": 0, "no_image": 0, "no_event_match": 0}

    for row in rows:
        ext_id = row["id"]
        source_path = row["source_path"]
        raw = row["raw_result_json"]

        img = cv2.imread(source_path)
        if img is None:
            print(f"-- WARN: cannot read {source_path} (ext_id={ext_id})", file=sys.stderr)
            stats["no_image"] += 1
            continue

        spatial = extract_selected_event_position(img, cal)
        # Always emit the Layer-2 detected-markers payload, even when there's
        # no highlighted/selected marker.
        all_markers = detect_rink_markers(img, cal)
        detected_payload = []
        for m in all_markers:
            coord = pixel_to_hockey(m, cal)
            detected_payload.append({
                "pixel_x": round(m.pixel_x, 2),
                "pixel_y": round(m.pixel_y, 2),
                "hockey_x": coord.x,
                "hockey_y": coord.y,
                "rink_zone": coord.rink_zone,
                "confidence": coord.confidence,
                "color": m.color,
                "shape_type": m.shape_type,
                "fill_style": m.fill_style,
                "area_px": round(m.area_px, 1),
            })
        detected_json = json.dumps(detected_payload).replace("'", "''")

        if spatial.selected_coordinate is None:
            # Patch only detected_markers for captures with no highlighted marker.
            print(
                "UPDATE ocr_extractions SET raw_result_json = "
                f"jsonb_set(raw_result_json, '{{detected_markers}}', "
                f"'{detected_json}'::jsonb) "
                f"WHERE id={ext_id};"
            )
            stats["no_marker"] += 1
            continue

        new_x = spatial.selected_coordinate.x
        new_y = spatial.selected_coordinate.y
        new_zone = spatial.selected_coordinate.rink_zone
        new_conf = spatial.selected_coordinate.confidence

        # Patch raw_result_json with new spatial fields + detected_markers.
        print(
            "UPDATE ocr_extractions SET raw_result_json = "
            f"  jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(raw_result_json, "
            f"  '{{selected_event_x}}', '{new_x}'::jsonb), "
            f"  '{{selected_event_y}}', '{new_y}'::jsonb), "
            f"  '{{selected_event_rink_zone}}', '\"{new_zone}\"'::jsonb), "
            f"  '{{selected_event_confidence}}', '{new_conf}'::jsonb), "
            f"  '{{detected_markers}}', '{detected_json}'::jsonb) "
            f"WHERE id={ext_id};"
        )

        # Find the matching match_events row using the same keys the worker
        # promoter uses: (match_id, period, event_type, source='ocr', clock,
        # actor_gamertag_snapshot). The yellow marker corresponds to
        # events[selected_event_index] (NOT events[0] — the worker promoter
        # had this bug before 2026-05-13's reprocess fix).
        events = raw.get("events", [])
        if not events:
            stats["no_event_match"] += 1
            continue
        selected_idx = raw.get("selected_event_index")
        if isinstance(selected_idx, int) and 0 <= selected_idx < len(events):
            target_event = events[selected_idx]
        else:
            # Fall back to events[0] when the index is missing (rare).
            target_event = events[0]
        period = target_event.get("period_number")
        event_type = target_event.get("event_type", "unknown")
        clock = field_value(target_event.get("clock"))
        actor = field_value(target_event.get("actor_snapshot"))

        if (
            event_type == "unknown"
            or period is None
            or period < 1
            or not clock
            or not actor
        ):
            stats["no_event_match"] += 1
            continue

        confidence_label = "interpolated" if new_conf >= 0.5 else "extrapolated"
        print(
            f"UPDATE match_events SET x='{new_x}', y='{new_y}', "
            f"rink_zone='{new_zone}', position_confidence='{confidence_label}' "
            f"WHERE match_id={match_id} AND period_number={period} "
            f"AND event_type='{event_type}' AND source='ocr' "
            f"AND coalesce(clock, '') = '{sql_escape(clock)}' "
            f"AND coalesce(actor_gamertag_snapshot, '') = '{sql_escape(actor)}';"
        )
        stats["updated"] += 1

    print("COMMIT;")
    print(
        f"-- summary: updated={stats['updated']} no_marker={stats['no_marker']} "
        f"no_image={stats['no_image']} no_event_match={stats['no_event_match']}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
