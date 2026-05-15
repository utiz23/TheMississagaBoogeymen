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
# Density-aware default (overridden by --cluster-radius-px):
#   - sparse capture sets (≤30 captures/period, 1-fps manual screenshots):
#     keep 15px — the original calibration covers OCR jitter without
#     over-merging neighboring events.
#   - dense capture sets (video-pipeline output sampling at ≥5 fps × 75s
#     per period, ~375 captures/period): tighten to ~8px so that two
#     events whose true positions sit ~20px apart don't collapse into a
#     single cluster. Higher capture density means more sub-pixel
#     averaging is possible.
# Default scaling formula picks a radius from the per-period capture
# density when --cluster-radius-px is not given.


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
    # Panel events from the same capture, grouped by event_type:
    # {event_type: [(actor_snapshot_value, clock_value), ...]}.
    # Used by the consensus matcher to attribute the cluster to a specific
    # match_events row by (actor, clock) frequency across captures.
    panel_by_type: dict = None  # type: ignore[assignment]


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

    def candidate_pair_counts(self) -> Counter:
        """Counter of (actor, clock) pairs from source captures' panels of
        matching shape. The cluster's true event will appear in many panels;
        unrelated events appear in fewer. Used as the attribution signal."""
        shape = self.shape_vote()
        c: Counter = Counter()
        for m in self.markers:
            panel = m.panel_by_type or {}
            for actor, clock in panel.get(shape, []):
                c[(actor, clock)] += 1
        return c


def cluster_markers(
    markers: list[MarkerObservation],
    radius_px: float = CLUSTER_RADIUS_PX,
) -> list[Cluster]:
    """Greedy spatial clustering — markers within `radius_px` are merged."""
    clusters: list[Cluster] = []
    r2 = radius_px * radius_px
    for m in markers:
        # Find an existing cluster whose centroid is within radius.
        best_cluster = None
        for c in clusters:
            mx, my = c.median_pixel()
            if (m.pixel_x - mx) ** 2 + (m.pixel_y - my) ** 2 < r2:
                best_cluster = c
                break
        if best_cluster is None:
            clusters.append(Cluster(markers=[m]))
        else:
            best_cluster.markers.append(m)
    return clusters


def density_aware_radius_px(markers_per_period: float) -> float:
    """Pick a sensible cluster radius from per-period MARKER density.

    Calibrated to existing match-250 manual-screenshot batches (~220
    markers/period) and the projected dense-AT video-pipeline regime
    (~5000+ markers/period at 5 fps × 75s × ~10 markers/frame).

    Reference points:
      - ≤300  markers/period → 15.0 px (sparse, current production)
      - 1500  markers/period → 10.0 px
      - ≥5000 markers/period →  8.0 px (with a 6 px floor)

    Linear interpolation between anchors; clamp at the extremes. The
    floor at 6 px is intentional: tighter risks splitting real
    clusters across legitimate OCR jitter.
    """
    if markers_per_period <= 300:
        return 15.0
    if markers_per_period <= 1500:
        # 300..1500 → 15.0..10.0
        t = (markers_per_period - 300) / 1200.0
        return 15.0 - 5.0 * t
    if markers_per_period <= 5000:
        # 1500..5000 → 10.0..8.0
        t = (markers_per_period - 1500) / 3500.0
        return 10.0 - 2.0 * t
    return max(6.0, 8.0 - (markers_per_period - 5000) / 10000.0)


def period_from_path(source_path: str) -> int | None:
    """Derive period number from the parent directory name in the capture path.

    Handles: '1st-Period-Events' → 1, '2nd-Period-Events' → 2,
             '3rd-Period-Events' → 3, 'OT-Events' / 'OT' → 4.
    """
    # Normalise separators, take the immediate parent directory name.
    parts = source_path.replace("\\", "/").rstrip("/").rsplit("/", 2)
    folder = parts[-2] if len(parts) >= 2 else ""
    folder_lower = folder.lower()
    if "1st" in folder_lower:
        return 1
    if "2nd" in folder_lower:
        return 2
    if "3rd" in folder_lower:
        return 3
    if "ot" in folder_lower:
        return 4
    return None


def select_capture_period(raw: dict, source_path: str = "") -> int | None:
    """Extract the period number this capture is showing.

    Strategy (in order of reliability):
    1. events[selected_event_index].period_number  — the highlighted event
    2. Parent directory of source_path             — folder name is ground truth
    3. events[0].period_number                     — last-resort fallback
    """
    events = raw.get("events", []) or []
    idx = raw.get("selected_event_index")

    # 1. Preferred: the explicitly highlighted event.
    if isinstance(idx, int) and 0 <= idx < len(events):
        p = events[idx].get("period_number")
        if isinstance(p, int) and p >= 1:
            return p

    # 2. Path-based: folder name is reliable even when OCR misreads the period.
    if source_path:
        path_period = period_from_path(source_path)
        if path_period is not None:
            return path_period

    # 3. Last resort: first event in the list.
    if events:
        p = events[0].get("period_number")
        if isinstance(p, int) and p >= 1:
            return p

    return None


def get_match_events(match_id: int) -> list[dict]:
    """All match_events for this match that are plottable, with current
    position status. We need positioned rows too — clusters that already
    correspond to a positioned event must be excluded from assignment
    so they don't 'steal' an unpositioned event's position."""
    sql = (
        "SELECT json_agg(json_build_object("
        "'id', id, 'period_number', period_number, 'event_type', event_type, "
        "'team_side', team_side, 'clock', clock, "
        "'actor', actor_gamertag_snapshot, "
        "'x', x, 'y', y)) "
        f"FROM match_events WHERE match_id={match_id} "
        "AND source='ocr' "
        "AND event_type IN ('shot', 'hit', 'goal', 'penalty')"
    )
    res = subprocess.run(
        ["docker", "exec", "eanhl-team-website-db-1",
         "psql", "-U", "eanhl", "-d", "eanhl", "-tAc", sql],
        check=True, capture_output=True, text=True,
    )
    data = res.stdout.strip()
    return json.loads(data) if data and data != "null" else []


def pair_weight(cands: Counter, actor: str | None, clock: str | None) -> float:
    """Score how well a cluster's candidate (actor, clock) bag matches a
    target match_events row's (actor, clock). Higher = better."""
    if not cands:
        return 0.0
    exact = cands.get((actor, clock), 0)
    clock_total = sum(v for (a, c), v in cands.items() if c == clock)
    actor_total = sum(v for (a, c), v in cands.items() if a == actor)
    # Exact pair is the strongest signal; clock-only is next (clock OCR is
    # more reliable than actor names); actor-only is the weakest tie-breaker.
    return 2.0 * exact + 1.0 * (clock_total - exact) + 0.5 * (actor_total - exact)


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description="Tier-2 inventory consensus matcher for OCR rink markers."
    )
    parser.add_argument("match_id", type=int, help="match_id to position")
    parser.add_argument(
        "--cluster-radius-px",
        type=float,
        default=None,
        help=(
            "Override greedy-cluster radius in pixels. When omitted, the "
            "radius is picked from per-period capture density (15px for "
            "≤20 cap/period, scaling down to 8px at ≥375 cap/period)."
        ),
    )
    args = parser.parse_args()
    match_id = args.match_id

    payload = sys.stdin.read().strip()
    if not payload or payload == "null":
        print("-- no input", file=sys.stderr)
        return 0
    rows = json.loads(payload)
    print(f"-- inventory_consensus: match_id={match_id}, captures={len(rows)}",
          file=sys.stderr)

    # 1+2+3. Collect markers grouped by period, plus per-capture panel events
    # keyed by event_type. The panel info travels with each observation so the
    # matcher can later score (cluster, event) pairs by (actor, clock) frequency.
    by_period: dict[int, list[MarkerObservation]] = {}
    for row in rows:
        ext_id = row["id"]
        raw = row["raw_result_json"]
        period = select_capture_period(raw, row.get("source_path", ""))
        if period is None:
            continue
        panel_by_type: dict[str, list[tuple[str | None, str | None]]] = {}
        for e in raw.get("events", []) or []:
            et = e.get("event_type")
            clk = e.get("clock")
            cv = clk.get("value") if isinstance(clk, dict) else None
            ac = e.get("actor_snapshot")
            av = ac.get("value") if isinstance(ac, dict) else None
            if not et or not cv:
                continue
            panel_by_type.setdefault(et, []).append((av, cv))
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
                panel_by_type=panel_by_type,
            )
            by_period.setdefault(period, []).append(obs)

    # 4+5+6. Cluster per period, classify each cluster.
    # Density-aware radius: averaged over periods present in this batch.
    if by_period:
        avg_captures_per_period = sum(len(v) for v in by_period.values()) / len(by_period)
    else:
        avg_captures_per_period = 0.0
    radius_px = (
        float(args.cluster_radius_px)
        if args.cluster_radius_px is not None
        else density_aware_radius_px(avg_captures_per_period)
    )
    print(
        f"-- cluster_radius_px={radius_px:.2f} "
        f"(avg {avg_captures_per_period:.1f} markers/period, "
        f"{'user-specified' if args.cluster_radius_px is not None else 'density-aware default'})",
        file=sys.stderr,
    )
    clusters_by_period: dict[int, list[Cluster]] = {}
    clusters_permissive_by_period: dict[int, list[Cluster]] = {}
    for period, observations in by_period.items():
        clusters = cluster_markers(observations, radius_px=radius_px)
        # Two pools per period:
        #  - strict: ≥2 obs (high-confidence; primary matching pool)
        #  - permissive: exactly 1 obs (single-observation rink markers; used as
        #    a fallback for unpositioned events that have no strict cluster but
        #    whose (actor, clock) appears in the single capture's panel)
        strict = [c for c in clusters if c.shape_vote() != "unknown" and len(c.markers) >= 2]
        permissive = [c for c in clusters if c.shape_vote() != "unknown" and len(c.markers) == 1]
        clusters_by_period[period] = strict
        clusters_permissive_by_period[period] = permissive
        print(
            f"-- period {period}: {len(observations)} obs → {len(clusters)} clusters → "
            f"{len(strict)} strict (≥2 obs) + {len(permissive)} permissive (1 obs)",
            file=sys.stderr,
        )

    # 7. Match clusters to unpositioned match_events.
    #
    # Two-stage process per (period, event_type, team_side) bucket:
    #
    # Stage A — dedup. Each cluster's (actor, clock) candidate bag is scored
    # against ALL match_events in that bucket (positioned and unpositioned).
    # If a cluster's best match is an already-positioned event, that cluster
    # is set aside — it represents an event whose position is already in the
    # table, and using it to position a different unpositioned event would
    # spread the wrong location.
    #
    # Stage B — greedy max-weight assignment. Remaining clusters are matched
    # to unpositioned events by descending pair-frequency weight. Ties are
    # broken deterministically by cluster pixel centroid so a re-run is
    # idempotent. Clusters/events with no signal fall through to FCFS so the
    # script still positions at least the heatmap (matching today's behavior
    # for buckets where actor/clock OCR failed).
    all_events = get_match_events(match_id)
    print(f"-- loaded {len(all_events)} total ocr match_events", file=sys.stderr)

    unpositioned_count = sum(1 for e in all_events if e.get("x") is None)
    print(f"-- {unpositioned_count} unpositioned match_events to match",
          file=sys.stderr)

    # Bucket events by (period, event_type, team_side).
    events_by_bucket: dict[tuple, list[dict]] = {}
    for e in all_events:
        key = (e["period_number"], e["event_type"], e["team_side"])
        events_by_bucket.setdefault(key, []).append(e)

    # Bucket clusters by (period, shape_vote, team_side).
    clusters_by_bucket: dict[tuple, list[Cluster]] = {}
    for period, cs in clusters_by_period.items():
        for c in cs:
            key = (period, c.shape_vote(), c.team_side())
            clusters_by_bucket.setdefault(key, []).append(c)

    print("BEGIN;")
    matched = 0
    fcfs_fallback = 0
    cluster_to_positioned = 0

    for key, events in events_by_bucket.items():
        clusters = list(clusters_by_bucket.get(key, []))
        if not clusters:
            continue

        # Precompute candidate pair counts per cluster, once.
        cands = [c.candidate_pair_counts() for c in clusters]
        positioned = [e for e in events if e.get("x") is not None]
        unpositioned = [e for e in events if e.get("x") is None]
        all_bucket_events = positioned + unpositioned  # combined event list
        is_positioned = [True] * len(positioned) + [False] * len(unpositioned)

        # Global greedy max-weight matching across (clusters × all events).
        # The cluster's best match wins — whether the matched event is already
        # positioned (no-op) or unpositioned (emit UPDATE). A cluster matched
        # to a positioned event is properly "consumed" and not reused.
        triples = []  # (weight, cluster_idx, event_idx)
        for i in range(len(clusters)):
            for j, e in enumerate(all_bucket_events):
                w = pair_weight(cands[i], e.get("actor"), e.get("clock"))
                if w > 0:
                    triples.append((w, i, j))
        triples.sort(key=lambda t: (-t[0], clusters[t[1]].median_pixel()))

        assigned_event: set[int] = set()
        assigned_cluster: set[int] = set()
        for w, i, j in triples:
            if i in assigned_cluster or j in assigned_event:
                continue
            assigned_cluster.add(i)
            assigned_event.add(j)
            if is_positioned[j]:
                cluster_to_positioned += 1
                continue
            chosen = clusters[i]
            hx, hy, zone = chosen.median_hockey()
            conf = chosen.confidence()
            label = "interpolated" if conf >= 0.5 else "extrapolated"
            print(
                f"UPDATE match_events SET x='{hx}', y='{hy}', "
                f"rink_zone='{zone}', position_confidence='{label}' "
                f"WHERE id={all_bucket_events[j]['id']};"
            )
            matched += 1

        if positioned or unpositioned:
            print(
                f"-- bucket {key}: clusters={len(clusters)}, "
                f"positioned={len(positioned)}, unpositioned={len(unpositioned)}, "
                f"to_positioned={sum(1 for j in assigned_event if is_positioned[j])}, "
                f"to_unpositioned={sum(1 for j in assigned_event if not is_positioned[j])}",
                file=sys.stderr,
            )

        # Permissive-tier fallback: try single-observation clusters for any
        # event that didn't match a strict cluster. Require an EXACT (actor,
        # clock) match (weight >= 2.0) so single-obs noise doesn't get used.
        # A single-obs cluster's panel comes from one capture, so an exact
        # pair match means that capture's panel showed the target event —
        # very strong evidence that this marker really is for it.
        perm_clusters = list(clusters_permissive_by_period.get(key[0], []))
        perm_clusters = [c for c in perm_clusters
                         if c.shape_vote() == key[1] and c.team_side() == key[2]]
        leftover_events = [
            j for j in range(len(positioned), len(all_bucket_events))
            if j not in assigned_event
        ]
        if perm_clusters and leftover_events:
            perm_cands = [c.candidate_pair_counts() for c in perm_clusters]
            used_perm: set[int] = set()
            for j in leftover_events:
                e = all_bucket_events[j]
                best_w, best_i = 0.0, -1
                for i, c in enumerate(perm_clusters):
                    if i in used_perm:
                        continue
                    w = pair_weight(perm_cands[i], e.get("actor"), e.get("clock"))
                    if w > best_w:
                        best_w, best_i = w, i
                if best_i >= 0 and best_w >= 2.0:
                    used_perm.add(best_i)
                    chosen = perm_clusters[best_i]
                    hx, hy, zone = chosen.median_hockey()
                    # Single-obs clusters are inherently lower confidence.
                    print(
                        f"UPDATE match_events SET x='{hx}', y='{hy}', "
                        f"rink_zone='{zone}', position_confidence='extrapolated' "
                        f"WHERE id={e['id']};"
                    )
                    matched += 1
                    fcfs_fallback += 1

    print("COMMIT;")
    print(
        f"-- summary: matched {matched} of {unpositioned_count} unpositioned events "
        f"({fcfs_fallback} via FCFS fallback; "
        f"{cluster_to_positioned} clusters absorbed by already-positioned events)",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
