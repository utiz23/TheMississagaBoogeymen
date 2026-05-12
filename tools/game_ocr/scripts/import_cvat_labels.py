"""Import CVAT point annotations into match_events.x/y.

CVAT export shape:
  /tmp/cvat-export/annotations.xml
    <image name="vlcsnap-….png" width="1920" height="1080">
      <points label="selected_marker" points="px,py" />
    </image>

For each annotated image:
  1. Find the matching `ocr_extractions` row by source_path filename.
  2. Pull `raw_result_json.events[0]` — the *selected* event (the highlighted
     row in the Action Tracker list, which is what the yellow marker on the
     rink represents).
  3. Convert pixel (px, py) → hockey (x, y) using the rink calibration JSON.
  4. UPDATE the matching `match_events` row via dedup key
     (match_id, period_number, event_type, clock, lower(actor)).

Usage:
  python3 tools/game_ocr/scripts/import_cvat_labels.py \\
    --xml /tmp/cvat-export/annotations.xml [--dry-run]

Exit codes:
  0 — success
  1 — fatal error
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
CALIB_PATH = REPO_ROOT / 'tools/game_ocr/game_ocr/configs/rink/post_game_action_tracker.json'


@dataclass
class Annotation:
    filename: str
    pixel_x: float
    pixel_y: float
    hockey_x: float
    hockey_y: float
    zone: str  # 'offensive' | 'defensive' | 'neutral'


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--xml', required=True, help='Path to annotations.xml from CVAT export')
    parser.add_argument('--container', default='eanhl-team-website-db-1')
    parser.add_argument('--db-user', default='eanhl')
    parser.add_argument('--db-name', default='eanhl')
    parser.add_argument('--dry-run', action='store_true', help='Print what would be updated, write nothing')
    args = parser.parse_args()

    calib = json.loads(CALIB_PATH.read_text())
    box = calib['rink_pixel_box']
    half_w_px = (box['x2'] - box['x1']) / 2
    half_h_px = (box['y2'] - box['y1']) / 2
    center_px_x = (box['x1'] + box['x2']) / 2
    center_px_y = (box['y1'] + box['y2']) / 2
    mirror = -1.0 if calib.get('bgm_attacks') == 'left' else 1.0

    print(
        f'Calibration: half_w_px={half_w_px:.1f}, half_h_px={half_h_px:.1f}, '
        f'centre_px=({center_px_x:.1f}, {center_px_y:.1f}), '
        f'bgm_attacks={calib.get("bgm_attacks", "right")}',
        file=sys.stderr,
    )

    annotations: list[Annotation] = []
    tree = ET.parse(args.xml)
    for image in tree.findall('.//image'):
        name = image.get('name') or ''
        point_el = image.find('points')
        if point_el is None:
            continue  # frame was skipped during annotation
        pts = point_el.get('points') or ''
        if ',' not in pts:
            continue
        x_str, y_str = pts.split(',')
        px = float(x_str)
        py = float(y_str)

        x_norm = (px - center_px_x) / half_w_px  # [-1, +1]
        y_norm = (py - center_px_y) / half_h_px  # [-1, +1]
        x_hockey = round(mirror * x_norm * 100.0, 2)
        y_hockey = round(-y_norm * 42.5, 2)  # SVG y grows down; flip for hockey-standard
        if x_hockey > 25:
            zone = 'offensive'
        elif x_hockey < -25:
            zone = 'defensive'
        else:
            zone = 'neutral'

        annotations.append(
            Annotation(
                filename=name,
                pixel_x=px,
                pixel_y=py,
                hockey_x=x_hockey,
                hockey_y=y_hockey,
                zone=zone,
            )
        )

    print(f'Parsed {len(annotations)} annotated frames', file=sys.stderr)
    if not annotations:
        print('Nothing to import.', file=sys.stderr)
        return 0

    # Build a VALUES list and issue one query.
    values_sql = ',\n  '.join(
        "('{name}', {x}::numeric, {y}::numeric, '{zone}')".format(
            name=a.filename.replace("'", "''"),
            x=a.hockey_x,
            y=a.hockey_y,
            zone=a.zone,
        )
        for a in annotations
    )

    if args.dry_run:
        # Show first 5 + summary
        for a in annotations[:5]:
            print(
                f'  {a.filename} pixel=({a.pixel_x:.1f},{a.pixel_y:.1f}) '
                f'→ hockey=({a.hockey_x:+.2f},{a.hockey_y:+.2f}) zone={a.zone}',
                file=sys.stderr,
            )
        if len(annotations) > 5:
            print(f'  … and {len(annotations) - 5} more', file=sys.stderr)
        return 0

    # `selected_event_index` is the row the new white-border detector identified
    # as the highlighted card in the Action Tracker list. If it is NULL the
    # detector did not find a selected row (typically the bottom of the list
    # was cut off in the screenshot) — we MUST NOT fall back to events[0]
    # because that produced the wrong-row mismapping that this rewrite fixes.
    # Such captures need a manual override (handled outside this importer).
    update_sql = f"""
WITH input(filename, x, y, zone) AS (
  VALUES
  {values_sql}
),
ext AS (
  SELECT
    input.x AS px, input.y AS py, input.zone,
    oe.match_id,
    oe.raw_result_json->'events'->
      ((oe.raw_result_json->>'selected_event_index')::int) AS sel_event
  FROM input
  JOIN ocr_extractions oe ON oe.source_path LIKE '%/' || input.filename
  WHERE oe.raw_result_json->'events' IS NOT NULL
    AND oe.raw_result_json->>'selected_event_index' IS NOT NULL
    AND oe.raw_result_json->>'selected_event_index' <> 'null'
)
UPDATE match_events me
SET x = ext.px, y = ext.py, rink_zone = ext.zone
FROM ext
WHERE ext.sel_event IS NOT NULL
  AND me.match_id = ext.match_id
  AND me.period_number = (ext.sel_event->>'period_number')::int
  AND me.event_type = ext.sel_event->>'event_type'
  AND me.source = 'ocr'
  AND coalesce(me.clock, '') = COALESCE(ext.sel_event->'clock'->>'value', '')
  AND lower(coalesce(me.actor_gamertag_snapshot, '')) =
      lower(COALESCE(ext.sel_event->'actor_snapshot'->>'value', ''));
"""

    proc = subprocess.run(
        ['docker', 'exec', '-i', args.container,
         'psql', '-U', args.db_user, '-d', args.db_name, '-c', update_sql],
        capture_output=True, text=True, check=False,
    )
    if proc.returncode != 0:
        print('psql failed:', file=sys.stderr)
        print(proc.stderr.strip(), file=sys.stderr)
        return 1
    print(proc.stdout.strip(), file=sys.stderr)

    # Verify
    verify = subprocess.run(
        ['docker', 'exec', '-i', args.container,
         'psql', '-U', args.db_user, '-d', args.db_name, '-At', '-c',
         "SELECT COUNT(*) FROM match_events WHERE match_id = 250 AND x IS NOT NULL"],
        capture_output=True, text=True, check=False,
    )
    if verify.returncode == 0:
        print(f'Positioned events for match 250: {verify.stdout.strip()}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
