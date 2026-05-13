"""Dump shape-classifier geometry diagnostics across a match's captures.

For every non-yellow rink marker detected across all action-tracker
captures of a match, emit a CSV row with:
    capture_id, source_path, color, fill_style, n_vertices, angle_norm,
    circularity, area_px, perimeter_px, classified_shape

This is a one-off diagnostic for figuring out why hit recall is low.
The shape classifier in `tools/game_ocr/game_ocr/spatial.py:_classify_shape`
uses approxPolyDP + minAreaRect; markers can fall into 'unknown' for
several reasons (wrong vertex count, wrong angle, low circularity).
By dumping the raw geometry of every marker, we can see the actual
distribution and pick informed thresholds.

Usage:
  python3 tools/game_ocr/scripts/dump_shape_geometry.py <match_id> > /tmp/geom.csv
"""

from __future__ import annotations

import csv
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "tools" / "game_ocr"))

from game_ocr.spatial import (  # noqa: E402
    load_rink_calibration,
    _color_mask,
    _morphological_clean,
    _circularity,
    _classify_shape,
    _classify_fill,
)


def query_extractions(match_id: int) -> list[dict]:
    sql = (
        "SELECT json_agg(json_build_object("
        "'id', id, 'source_path', source_path)) "
        f"FROM ocr_extractions WHERE match_id={match_id} "
        "AND screen_type='post_game_action_tracker'"
    )
    res = subprocess.run(
        ["docker", "exec", "eanhl-team-website-db-1",
         "psql", "-U", "eanhl", "-d", "eanhl", "-tAc", sql],
        check=True, capture_output=True, text=True,
    )
    data = res.stdout.strip()
    return json.loads(data) if data and data != "null" else []


def dump_capture(cap_id: int, img_path: str, calibration, writer: csv.writer) -> None:
    img = cv2.imread(img_path)
    if img is None:
        return
    fname = Path(img_path).name
    # Mirror detect_rink_markers' crop + per-color contour loop.
    box = calibration.rink_pixel_box
    h, w = img.shape[:2]
    x1 = max(0, min(w, box.x1))
    x2 = max(0, min(w, box.x2))
    y1 = max(0, min(h, box.y1))
    y2 = max(0, min(h, box.y2))
    if x2 <= x1 or y2 <= y1:
        return
    crop = img[y1:y2, x1:x2]
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    mf = calibration.marker_filter

    for color_name, threshold in calibration.color_thresholds.items():
        if color_name == "yellow":
            continue  # yellow markers are shape-unknown by design
        mask = _color_mask(hsv, threshold)
        mask = _morphological_clean(mask)
        contours, _ = cv2.findContours(
            mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE,
        )
        for c in contours:
            area = float(cv2.contourArea(c))
            if area < mf.area_min or area > mf.area_max:
                continue
            perim = float(cv2.arcLength(c, closed=True))
            if perim <= 0:
                continue
            circ = _circularity(area, perim)
            if circ < mf.circularity_min:
                continue
            epsilon = 0.025 * perim
            approx = cv2.approxPolyDP(c, epsilon, closed=True)
            n_vertices = len(approx)
            (_cx, _cy), (_rw, _rh), angle = cv2.minAreaRect(c)
            normalized = abs(angle)
            if normalized > 45:
                normalized = 90 - normalized
            shape = _classify_shape(c, area, perim)
            fill = _classify_fill(crop, c, (x1, y1))
            writer.writerow([
                cap_id, fname, color_name, fill,
                n_vertices, f"{normalized:.2f}",
                f"{circ:.3f}", f"{area:.1f}", f"{perim:.1f}",
                shape,
            ])


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: dump_shape_geometry.py <match_id>", file=sys.stderr)
        return 2
    match_id = int(sys.argv[1])
    cal = load_rink_calibration("post_game_action_tracker")
    rows = query_extractions(match_id)
    print(f"# {len(rows)} captures for match {match_id}", file=sys.stderr)

    writer = csv.writer(sys.stdout)
    writer.writerow([
        "capture_id", "source_file", "color", "fill_style",
        "n_vertices", "angle_norm", "circularity", "area_px", "perimeter_px",
        "classified_shape",
    ])
    for row in rows:
        # Skip yellow markers — they aren't shape-classified.
        dump_capture(row["id"], row["source_path"], cal, writer)
    return 0


if __name__ == "__main__":
    sys.exit(main())
