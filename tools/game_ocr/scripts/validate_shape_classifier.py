"""Validate the Layer-2 shape classifier against the parsed events list.

Approach: for each Action Tracker capture, count detected marker shapes
(via `detect_rink_markers`) and compare against the event_type counts in
the same capture's events list (`raw_result_json.events`).

This is a soft validation — the events list is a scrollable window
showing the LATEST ~6 events, while the rink art shows ALL events in
the period. So detected counts should be ≥ events-list counts.
A capture where detected_shots < events_list_shots indicates a recall
problem in the classifier (or in marker detection).

The yellow-overlaid marker can't be classified visually (yellow is
opaque), so the classifier output for one marker per capture is
expected to be 'unknown'.

Usage:
  python3 tools/game_ocr/scripts/validate_shape_classifier.py 250
"""

from __future__ import annotations

import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

import cv2

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "tools" / "game_ocr"))

from game_ocr.spatial import (  # noqa: E402
    detect_rink_markers,
    load_rink_calibration,
)


def query_extractions(match_id: int) -> list[dict]:
    sql = (
        "SELECT json_agg(json_build_object("
        "'id', id, 'source_path', source_path, "
        "'raw_result_json', raw_result_json)) "
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


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: validate_shape_classifier.py <match_id>", file=sys.stderr)
        return 2
    match_id = int(sys.argv[1])
    cal = load_rink_calibration("post_game_action_tracker")
    rows = query_extractions(match_id)
    print(f"Loaded {len(rows)} extractions for match {match_id}")

    # Per-capture: (detected_counts, events_list_counts)
    overall_detected = Counter()
    overall_events = Counter()
    recall_problems: list[tuple[str, dict, dict]] = []

    for row in rows:
        path = row["source_path"]
        raw = row["raw_result_json"]
        img = cv2.imread(path)
        if img is None:
            continue

        markers = detect_rink_markers(img, cal)
        det_counts: Counter[str] = Counter()
        for m in markers:
            if m.color == "yellow":
                continue  # overlay obscures the underlying marker
            if m.shape_type != "unknown":
                det_counts[m.shape_type] += 1

        events = raw.get("events", []) or []
        ev_counts: Counter[str] = Counter()
        for e in events:
            etype = e.get("event_type", "unknown")
            if etype in ("shot", "hit", "goal", "penalty"):
                ev_counts[etype] += 1

        overall_detected.update(det_counts)
        overall_events.update(ev_counts)

        # Recall problem: detected < events for any type
        deficits = {
            t: ev_counts[t] - det_counts.get(t, 0)
            for t in ("shot", "hit", "goal", "penalty")
            if ev_counts[t] > det_counts.get(t, 0)
        }
        if deficits:
            recall_problems.append((Path(path).name, dict(det_counts), dict(ev_counts)))

    print("\n=== Aggregate counts across all captures ===")
    print(f"  detected: {dict(overall_detected)}")
    print(f"  events:   {dict(overall_events)}")

    # Per-type ratio: how many detections per event-list mention.
    # Should be > 1 (the rink has all-period markers; the events list is a
    # 6-item scroll window).
    print("\n  ratio (detected / events_list):")
    for t in ("shot", "hit", "goal", "penalty"):
        d = overall_detected.get(t, 0)
        e = overall_events.get(t, 0)
        ratio = (d / e) if e > 0 else float("inf") if d > 0 else 0
        print(f"    {t:8s}: {d:4d} / {e:4d} = {ratio:.2f}")

    print(f"\n=== Captures with recall deficits ({len(recall_problems)} of {len(rows)}) ===")
    for name, det, ev in recall_problems[:10]:
        print(f"  {name}: detected={det} events={ev}")
    if len(recall_problems) > 10:
        print(f"  … and {len(recall_problems) - 10} more")

    return 0


if __name__ == "__main__":
    sys.exit(main())
