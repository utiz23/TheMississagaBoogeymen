"""Inventory consensus matcher — position match_events from cross-frame marker votes.

Reads detected_markers (Layer-2 output) from all ocr_extractions for a
match, groups them by period, clusters spatially, votes on shape +
color, then assigns each cluster to an unpositioned match_events row.

This is the payoff of Checkpoint 2 — every match_events row in a period
gets positioned from inventory consensus, not just the events that
happened to be highlighted in some capture.

Pipeline:
  1. Load all ocr_extractions for the match with detected_markers
  2. For each capture, identify its period
  3. Group markers across captures by period
  4. Within each period, cluster markers by pixel proximity
  5. For each cluster: vote shape (event type) + color (team side)
  6. Compute consensus hockey coord (median across cluster)
  7. Match clusters to unpositioned match_events rows
  8. Emit UPDATE SQL

Usage:
  docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -tAc \\
    "SELECT json_agg(json_build_object('id', id, 'source_path', source_path,
                                        'raw_result_json', raw_result_json))
     FROM ocr_extractions WHERE match_id=250
       AND screen_type='post_game_action_tracker'" \\
    | python3 tools/game_ocr/scripts/inventory_consensus_match.py 250 \\
    | docker exec -i eanhl-team-website-db-1 psql -U eanhl -d eanhl
"""

from __future__ import annotations

import json
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass


CLUSTER_RADIUS_PX = 15.0  # markers within this distance considered same event


@dataclass
class MarkerObservation:
    """A single marker detection from one capture."""
    capture_id: int
    pixel_x: float
    pixel_y: float
    hockey_x: float
    hockey_y: float
    color: str
    shape_type: str
    fill_style: str
    confidence: float
    period: int


@dataclass
class Cluster:
    """A spatially-clustered group of marker observations representing one event."""
    markers: list[MarkerObservation]

    def median_pixel(self) -> tuple[float, float]:
        xs = sorted(m.pixel_x for m in self.markers)
        ys = sorted(m.pixel_y for m in self.markers)
        return (xs[len(xs) // 2], ys[len(ys) // 2])

    def median_hockey(self) -> tuple[float, float, str]:
        xs = sorted(m.hockey_x for m in self.markers)
        ys = sorted(m.hockey_y for m in self.markers)
        hx = xs[len(xs) // 2]
        hy = ys[len(ys) // 2]
        if hx > 25:
            zone = "offensive"
        elif hx < -25:
            zone = "defensive"
        else:
            zone = "neutral"
        return (hx, hy, zone)

    def shape_vote(self) -> str:
        votes = Counter(m.shape_type for m in self.markers if m.shape_type != "unknown")
        return votes.most_common(1)[0][0] if votes else "unknown"

    def color_vote(self) -> str:
        # yellow is an overlay, ignore it
        votes = Counter(m.color for m in self.markers if m.color != "yellow")
        return votes.most_common(1)[0][0] if votes else "unknown"

    def team_side(self) -> str:
        """red ring (BGM outlined) → 'for'; standalone white (opp solid) → 'against'."""
        c = self.color_vote()
        if c == "red":
            return "for"
        if c == "white":
            return "against"
        return "unknown"

    def confidence(self) -> float:
        # In-hull if any observation was in-hull; cluster confidence = max.
        return max(m.confidence for m in self.markers)


def cluster_markers(markers: list[MarkerObservation]) -> list[Cluster]:
    """Greedy spatial clustering — markers within CLUSTER_RADIUS_PX are merged."""
    clusters: list[Cluster] = []
    for m in markers:
        # Find an existing cluster whose centroid is within radius.
        best_cluster = None
        for c in clusters:
            mx, my = c.median_pixel()
            if (m.pixel_x - mx) ** 2 + (m.pixel_y - my) ** 2 < CLUSTER_RADIUS_PX**2:
                best_cluster = c
                break
        if best_cluster is None:
            clusters.append(Cluster(markers=[m]))
        else:
            best_cluster.markers.append(m)
    return clusters


def select_capture_period(raw: dict) -> int | None:
    """Extract the period number this capture is showing."""
    events = raw.get("events", []) or []
    idx = raw.get("selected_event_index")
    if isinstance(idx, int) and 0 <= idx < len(events):
        target = events[idx]
    elif events:
        target = events[0]
    else:
        return None
    p = target.get("period_number")
    return int(p) if isinstance(p, int) else None


def get_unpositioned_match_events(match_id: int) -> list[dict]:
    """match_events for a match with NO x/y, grouped by period."""
    sql = (
        "SELECT json_agg(json_build_object("
        "'id', id, 'period_number', period_number, 'event_type', event_type, "
        "'team_side', team_side, 'clock', clock, "
        "'actor', actor_gamertag_snapshot)) "
        f"FROM match_events WHERE match_id={match_id} "
        "AND source='ocr' AND x IS NULL "
        "AND event_type IN ('shot', 'hit', 'goal', 'penalty')"
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
        print("usage: inventory_consensus_match.py <match_id>", file=sys.stderr)
        return 2
    match_id = int(sys.argv[1])

    payload = sys.stdin.read().strip()
    if not payload or payload == "null":
        print("-- no input", file=sys.stderr)
        return 0
    rows = json.loads(payload)
    print(f"-- inventory_consensus: match_id={match_id}, captures={len(rows)}",
          file=sys.stderr)

    # 1+2+3. Collect markers grouped by period.
    by_period: dict[int, list[MarkerObservation]] = {}
    for row in rows:
        ext_id = row["id"]
        raw = row["raw_result_json"]
        period = select_capture_period(raw)
        if period is None:
            continue
        for m in raw.get("detected_markers", []) or []:
            if m.get("color") == "yellow":
                continue  # overlay obscures the underlying marker
            obs = MarkerObservation(
                capture_id=ext_id,
                pixel_x=float(m["pixel_x"]),
                pixel_y=float(m["pixel_y"]),
                hockey_x=float(m["hockey_x"]),
                hockey_y=float(m["hockey_y"]),
                color=str(m.get("color", "")),
                shape_type=str(m.get("shape_type", "unknown")),
                fill_style=str(m.get("fill_style", "unknown")),
                confidence=float(m.get("confidence", 1.0)),
                period=period,
            )
            by_period.setdefault(period, []).append(obs)

    # 4+5+6. Cluster per period, classify each cluster.
    clusters_by_period: dict[int, list[Cluster]] = {}
    for period, observations in by_period.items():
        clusters = cluster_markers(observations)
        # Keep only clusters with a non-unknown shape vote AND ≥ 2 observations
        # (single-observation clusters are likely noise or one-off detections).
        good = [c for c in clusters if c.shape_vote() != "unknown" and len(c.markers) >= 2]
        clusters_by_period[period] = good
        print(
            f"-- period {period}: {len(observations)} obs → {len(clusters)} clusters → "
            f"{len(good)} usable (shape + ≥2 obs)",
            file=sys.stderr,
        )

    # 7. Match clusters to unpositioned match_events.
    unpositioned = get_unpositioned_match_events(match_id)
    print(f"-- {len(unpositioned)} unpositioned match_events to match",
          file=sys.stderr)

    print("BEGIN;")
    matched = 0
    by_period_unpos: dict[int, list[dict]] = {}
    for e in unpositioned:
        by_period_unpos.setdefault(e["period_number"], []).append(e)

    # Greedy match: for each period, iterate match_events; for each, find a
    # free cluster of matching (shape, team_side); pop it; emit SQL.
    for period, events in by_period_unpos.items():
        avail = list(clusters_by_period.get(period, []))
        # Bucket free clusters by (shape, team_side) for O(1) match.
        buckets: dict[tuple[str, str], list[Cluster]] = {}
        for c in avail:
            buckets.setdefault((c.shape_vote(), c.team_side()), []).append(c)
        for event in events:
            key = (event["event_type"], event["team_side"])
            pool = buckets.get(key, [])
            if not pool:
                continue
            chosen = pool.pop(0)
            hx, hy, zone = chosen.median_hockey()
            conf = chosen.confidence()
            label = "interpolated" if conf >= 0.5 else "extrapolated"
            print(
                f"UPDATE match_events SET x='{hx}', y='{hy}', "
                f"rink_zone='{zone}', position_confidence='{label}' "
                f"WHERE id={event['id']};"
            )
            matched += 1

    print("COMMIT;")
    print(f"-- summary: matched {matched} of {len(unpositioned)} unpositioned events",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
