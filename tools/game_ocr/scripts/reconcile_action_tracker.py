"""Period-level Action Tracker reconciliation — recover missing event POSITIONS.

When the operator scrolls the post-game Action Tracker list too fast, an event's
list card and its rink marker are never co-visible in one frame, so the existing
positioning pass (`inventory_consensus_match.py`) — which binds a marker to an
event only via co-observed (actor, clock) panel evidence — cannot place it. This
pass closes that gap: it unions markers across the whole period (favouring clean
faceoff "census" frames), then binds leftover ORPHAN markers to GAP (unpositioned)
events by event-type + team + elimination.

Scope (v1): UPDATE positions of EXISTING unpositioned match_events rows only. It
does NOT insert new event identities — this pass reads the same stored `events[]`
the TS promoter reads, so it cannot mint an identity the promoter didn't promote;
true row-gaps are report-only. See the project plan for the deferred INSERT path.

Trust: every binding here is an INFERENCE (pair_weight co-occurrence or
elimination), never a direct observation, so positions are written with
`position_confidence='extrapolated'` and `review_status` is NEVER changed. The
UPDATE guard refuses to touch positioned or `manual` rows.

I/O contract (pure core + thin shell):
  stdin  = one JSON object {"extractions": [...], "match_events": [...]}
           extractions: [{id, source_path, raw_result_json}, ...]
           match_events: [{id, period_number, event_type, team_side, clock,
                           actor, x, y, position_confidence}, ...]
  stdout = one `BEGIN; … COMMIT;` block of UPDATE statements (empty if nothing).
  stderr = a human-readable reconciliation report.

Usage:
  docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -tAc \\
    "SELECT json_build_object(
        'extractions', (SELECT json_agg(json_build_object(
            'id', id, 'source_path', source_path, 'raw_result_json', raw_result_json))
          FROM ocr_extractions
          WHERE match_id=250 AND screen_type='post_game_action_tracker'),
        'match_events', (SELECT json_agg(json_build_object(
            'id', id, 'period_number', period_number, 'event_type', event_type,
            'team_side', team_side, 'clock', clock,
            'actor', actor_gamertag_snapshot, 'x', x, 'y', y,
            'position_confidence', position_confidence))
          FROM match_events
          WHERE match_id=250 AND source='ocr'
            AND event_type IN ('shot','hit','goal','penalty')))" \\
    | python3 tools/game_ocr/scripts/reconcile_action_tracker.py 250 \\
    | docker exec -i eanhl-team-website-db-1 psql -U eanhl -d eanhl

Add --dry-run to print only the report (no SQL). Idempotent: a fully-reconciled
period re-run emits an empty BEGIN/COMMIT.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

# Sibling scripts live in this directory; make them importable both when run
# directly (script dir is auto on sys.path) and when imported from tests.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from inventory_consensus_match import (  # noqa: E402
    Cluster,
    MarkerObservation,
    cluster_markers,
    density_aware_radius_px,
    pair_weight,
    select_capture_period,
)


# ─── tiny helpers (copied, not imported — keep this module dependency-light) ──


def field_value(field_obj) -> str | None:
    """Extract `.value` from an ExtractionField dict, or pass through a str."""
    if field_obj is None:
        return None
    if isinstance(field_obj, str):
        return field_obj or None
    if isinstance(field_obj, dict):
        v = field_obj.get("value")
        return v if isinstance(v, str) and v else None
    return None


def clock_to_seconds(clock: str | None) -> int:
    """MM:SS → seconds. Period clocks count DOWN, so higher = earlier."""
    if not clock or ":" not in clock:
        return -1
    try:
        m, s = clock.split(":", 1)
        return int(m) * 60 + int(s)
    except ValueError:
        return -1


def hockey_zone(hx: float) -> str:
    if hx > 25:
        return "offensive"
    if hx < -25:
        return "defensive"
    return "neutral"


def normalize_clock(raw: str | None) -> str:
    """Canonicalize a clock to zero-padded MM:SS for dedup keying."""
    if not raw:
        return ""
    m = re.match(r"^(\d{1,2}):(\d{2})$", raw.strip())
    if m:
        return f"{int(m.group(1)):02d}:{m.group(2)}"
    return raw.strip()


def normalize_actor(raw: str | None) -> str:
    """Lowercase, strip ornaments/punctuation — mirrors the promoter's
    normalizeSnapshot closely enough for canonical-event dedup."""
    if not raw:
        return ""
    return re.sub(r"[^a-z0-9]", "", raw.lower())


_COLOR_TO_SIDE = {"red": "for", "white": "against"}

# Orphan markers within this many hockey-units of an already-positioned event
# are re-detections of that event, not new locations → pruned before binding.
PRUNE_RADIUS = 5.0


# ─── census frames ──────────────────────────────────────────────────────────


def is_scroll_past_frame(raw: dict) -> bool:
    """A 'scrolled too fast' frame: a marker IS selected (yellow present) but
    its list card is off-screen, so `selected_event_index` is None/out-of-range.
    The yellow marker's position is a selected event whose identity is unknown."""
    events = raw.get("events", []) or []
    idx = raw.get("selected_event_index")
    has_yellow = any(m.get("color") == "yellow"
                     for m in raw.get("detected_markers", []) or [])
    card_offscreen = not (isinstance(idx, int) and 0 <= idx < len(events))
    return has_yellow and card_offscreen


def build_yellow_salvage_clusters(
    extractions: list[dict], radius_px: float | None = None
) -> dict[int, list[Cluster]]:
    """Cluster yellow (selected) marker positions from scroll-past frames.
    Position is known; shape/team are obscured by the yellow overlay."""
    by_period: dict[int, list[MarkerObservation]] = {}
    for row in extractions:
        raw = row.get("raw_result_json", {}) or {}
        if not is_scroll_past_frame(raw):
            continue
        period = select_capture_period(raw, row.get("source_path", ""))
        if period is None:
            continue
        for m in raw.get("detected_markers", []) or []:
            if m.get("color") != "yellow":
                continue
            by_period.setdefault(period, []).append(
                MarkerObservation(
                    capture_id=row.get("id", 0),
                    pixel_x=float(m["pixel_x"]), pixel_y=float(m["pixel_y"]),
                    hockey_x=float(m["hockey_x"]), hockey_y=float(m["hockey_y"]),
                    color="yellow", shape_type="unknown", fill_style="unknown",
                    confidence=float(m.get("confidence", 1.0)),
                    period=period, panel_by_type={},
                )
            )
    out: dict[int, list[Cluster]] = {}
    for period, markers in by_period.items():
        r = radius_px if radius_px is not None else density_aware_radius_px(len(markers))
        out[period] = cluster_markers(markers, r)
    return out


def is_census_frame(raw: dict) -> bool:
    """A clean group-photo of the rink: a faceoff is selected (so no event
    marker is highlighted) AND no yellow marker is present."""
    events = raw.get("events", []) or []
    idx = raw.get("selected_event_index")
    if not isinstance(idx, int) or not (0 <= idx < len(events)):
        return False
    if events[idx].get("event_type") != "faceoff":
        return False
    markers = raw.get("detected_markers", []) or []
    return not any(m.get("color") == "yellow" for m in markers)


def census_marker_counts(raw: dict) -> dict[tuple[str, str], int]:
    """Per (event_type, team_side) marker count for one census frame."""
    counts: Counter = Counter()
    for m in raw.get("detected_markers", []) or []:
        side = _COLOR_TO_SIDE.get(m.get("color", ""))
        shape = m.get("shape_type", "unknown")
        if side is None or shape == "unknown":
            continue
        counts[(shape, side)] += 1
    return dict(counts)


# ─── canonical event union ────────────────────────────────────────────────


def build_canonical_events(extractions: list[dict]) -> dict[int, list[dict]]:
    """Union ALL event cards across every frame (selected and non-selected),
    dedup by (period, event_type, normalized clock, normalized actor). Returns
    per-period lists sorted by clock (earliest-in-real-time first)."""
    seen: set[tuple] = set()
    by_period: dict[int, list[dict]] = {}
    for row in extractions:
        raw = row.get("raw_result_json", {}) or {}
        for e in raw.get("events", []) or []:
            et = e.get("event_type")
            period = e.get("period_number")
            clock = field_value(e.get("clock"))
            actor = field_value(e.get("actor_snapshot"))
            if not et or et == "unknown" or not isinstance(period, int) or period < 1:
                continue
            key = (period, et, normalize_clock(clock), normalize_actor(actor))
            if key in seen:
                continue
            seen.add(key)
            by_period.setdefault(period, []).append(
                {"event_type": et, "clock": clock, "actor": actor, "period": period}
            )
    for p in by_period:
        by_period[p].sort(key=lambda e: clock_to_seconds(e.get("clock")), reverse=True)
    return by_period


# ─── marker clustering per period ──────────────────────────────────────────


def build_period_clusters(
    extractions: list[dict], radius_px: float | None = None
) -> dict[int, list[Cluster]]:
    """Group non-yellow markers by period and cluster them spatially."""
    by_period: dict[int, list[MarkerObservation]] = {}
    for row in extractions:
        raw = row.get("raw_result_json", {}) or {}
        period = select_capture_period(raw, row.get("source_path", ""))
        if period is None:
            continue
        panel_by_type: dict[str, list[tuple[str | None, str | None]]] = {}
        for e in raw.get("events", []) or []:
            et = e.get("event_type")
            clk = field_value(e.get("clock"))
            ac = field_value(e.get("actor_snapshot"))
            if not et or not clk:
                continue
            panel_by_type.setdefault(et, []).append((ac, clk))
        for m in raw.get("detected_markers", []) or []:
            if m.get("color") == "yellow":
                continue
            by_period.setdefault(period, []).append(
                MarkerObservation(
                    capture_id=row.get("id", 0),
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
            )
    out: dict[int, list[Cluster]] = {}
    for period, markers in by_period.items():
        r = radius_px if radius_px is not None else density_aware_radius_px(len(markers))
        out[period] = cluster_markers(markers, r)
    return out


# ─── binding engine ────────────────────────────────────────────────────────


@dataclass
class Update:
    event_id: int
    x: float
    y: float
    rink_zone: str
    confidence_label: str
    method: str  # 'pairweight' | 'elimination'


@dataclass
class ReconResult:
    period: int = 0
    updates: list[Update] = field(default_factory=list)
    orphans: list[Cluster] = field(default_factory=list)        # markers with no event
    gaps: list[dict] = field(default_factory=list)              # unpositioned events with no marker
    ambiguous: list[tuple] = field(default_factory=list)        # (bucket_key, n_orphans, n_gaps)
    already_positioned: list[dict] = field(default_factory=list)


def _near_any(hx: float, hy: float, points: list[tuple[float, float]],
              radius: float) -> bool:
    return any((hx - px) ** 2 + (hy - py) ** 2 < radius * radius for px, py in points)


def reconcile_period(
    period: int, clusters: list[Cluster], match_events: list[dict],
    yellow_clusters: list[Cluster] | None = None, prune_radius: float = PRUNE_RADIUS,
) -> ReconResult:
    """Bind orphan markers to gap events for one period.

    Stage A: pair_weight greedy assignment (cluster ↔ event by co-observed
    (actor, clock)). Positioned events consume their cluster but produce no
    update. Unpositioned matches → Update(method='pairweight').
    Prune: orphan clusters co-located with a positioned event are re-detections
    → dropped (not orphan/ambiguous).
    Stage B: leftover orphan markers ↔ leftover gap events, by
    (event_type, team_side) bucket — bind ONLY the unambiguous 1:1 case;
    flag >1×>1 (or 1×>1 / >1×1) as ambiguous.
    Stage C: yellow-salvage — a single remaining period gap bound to a single
    remaining yellow-salvage cluster (scroll-past selected marker), by elimination.
    """
    res = ReconResult(period=period)
    res.already_positioned = [e for e in match_events if e.get("x") is not None]

    # Bucket clusters and events by (event_type/shape, team_side).
    clusters_by_bucket: dict[tuple[str, str], list[Cluster]] = {}
    for c in clusters:
        clusters_by_bucket.setdefault((c.shape_vote(), c.team_side()), []).append(c)
    events_by_bucket: dict[tuple[str, str], list[dict]] = {}
    for e in match_events:
        events_by_bucket.setdefault((e.get("event_type"), e.get("team_side")), []).append(e)

    for key in set(clusters_by_bucket) | set(events_by_bucket):
        bclusters = list(clusters_by_bucket.get(key, []))
        bevents = list(events_by_bucket.get(key, []))
        positioned = [e for e in bevents if e.get("x") is not None]
        unpositioned = [e for e in bevents if e.get("x") is None]
        all_events = positioned + unpositioned
        is_pos = [True] * len(positioned) + [False] * len(unpositioned)

        cands = [c.candidate_pair_counts() for c in bclusters]

        # Stage A — pair_weight greedy max-weight assignment.
        triples = []
        for i in range(len(bclusters)):
            for j, e in enumerate(all_events):
                w = pair_weight(cands[i], e.get("actor"), e.get("clock"))
                if w > 0:
                    triples.append((w, i, j))
        triples.sort(key=lambda t: (-t[0], bclusters[t[1]].median_pixel()))
        assigned_cluster: set[int] = set()
        assigned_event: set[int] = set()
        for w, i, j in triples:
            if i in assigned_cluster or j in assigned_event:
                continue
            assigned_cluster.add(i)
            assigned_event.add(j)
            if is_pos[j]:
                continue  # already positioned — consume the cluster, no update
            hx, hy, zone = bclusters[i].median_hockey()
            res.updates.append(Update(
                event_id=all_events[j]["id"], x=round(hx, 2), y=round(hy, 2),
                rink_zone=zone, confidence_label="extrapolated", method="pairweight",
            ))

        # Prune: orphan clusters sitting on an already-positioned event are
        # re-detections of that event, not new locations.
        positioned_pts = [(float(e["x"]), float(e["y"])) for e in positioned]
        orphan_idxs = []
        for i in range(len(bclusters)):
            if i in assigned_cluster:
                continue
            hx, hy, _ = bclusters[i].median_hockey()
            if _near_any(hx, hy, positioned_pts, prune_radius):
                continue  # re-detection of a positioned event — prune
            orphan_idxs.append(i)

        # Stage B — leftover orphan clusters ↔ leftover gap events by elimination.
        gap_js = [j for j in range(len(all_events))
                  if not is_pos[j] and j not in assigned_event]
        if len(orphan_idxs) == 1 and len(gap_js) == 1:
            c = bclusters[orphan_idxs[0]]
            e = all_events[gap_js[0]]
            hx, hy, zone = c.median_hockey()
            res.updates.append(Update(
                event_id=e["id"], x=round(hx, 2), y=round(hy, 2),
                rink_zone=zone, confidence_label="extrapolated", method="elimination",
            ))
        elif orphan_idxs and gap_js:
            res.ambiguous.append((key, len(orphan_idxs), len(gap_js)))
            res.orphans.extend(bclusters[i] for i in orphan_idxs)
            res.gaps.extend(all_events[j] for j in gap_js)
        else:
            res.orphans.extend(bclusters[i] for i in orphan_idxs)
            res.gaps.extend(all_events[j] for j in gap_js)

    # Stage C — yellow-salvage: a lone remaining gap ↔ a lone yellow-selected
    # position (scroll-past frame). Type/team are unknown for yellow markers, so
    # this only fires on a period-level 1:1 after type/team bucketing.
    if yellow_clusters:
        skip_pts = [(u.x, u.y) for u in res.updates]
        skip_pts += [(float(e["x"]), float(e["y"])) for e in res.already_positioned]
        salvage = []
        for c in yellow_clusters:
            hx, hy, _ = c.median_hockey()
            if _near_any(hx, hy, skip_pts, prune_radius):
                continue  # this selected position already accounted for
            salvage.append(c)
        if len(salvage) == 1 and len(res.gaps) == 1:
            c = salvage[0]
            e = res.gaps[0]
            hx, hy, zone = c.median_hockey()
            res.updates.append(Update(
                event_id=e["id"], x=round(hx, 2), y=round(hy, 2),
                rink_zone=zone, confidence_label="extrapolated", method="yellow_salvage",
            ))
            res.gaps = []
        elif salvage and res.gaps:
            res.ambiguous.append(("yellow_salvage", len(salvage), len(res.gaps)))

    return res


# ─── SQL emission ──────────────────────────────────────────────────────────


def emit_update_sql(u: Update) -> str:
    """Guarded position UPDATE. Never overwrites a positioned or manual row,
    and never touches review_status."""
    return (
        f"UPDATE match_events SET x='{u.x}', y='{u.y}', "
        f"rink_zone='{u.rink_zone}', position_confidence='{u.confidence_label}' "
        f"WHERE id={u.event_id} "
        f"AND x IS NULL AND position_confidence IS DISTINCT FROM 'manual';"
    )


# ─── report ────────────────────────────────────────────────────────────────


def build_report(match_id: int, results: list[ReconResult],
                 canonical: dict[int, list[dict]],
                 census_by_period: dict[int, dict[tuple[str, str], int]]) -> str:
    lines = [f"Action Tracker reconciliation — match {match_id}", "=" * 52]
    total_updates = sum(len(r.updates) for r in results)
    for r in sorted(results, key=lambda r: r.period):
        lines.append(f"\nPeriod {r.period}:")
        by_method = Counter(u.method for u in r.updates)
        lines.append(f"  positions recovered: {len(r.updates)} "
                     f"(pairweight={by_method.get('pairweight', 0)}, "
                     f"elimination={by_method.get('elimination', 0)}, "
                     f"yellow_salvage={by_method.get('yellow_salvage', 0)})")
        lines.append(f"  already positioned : {len(r.already_positioned)}")
        lines.append(f"  orphan markers     : {len(r.orphans)}")
        lines.append(f"  gap events (no marker): {len(r.gaps)}")
        if r.ambiguous:
            for key, no, ng in r.ambiguous:
                lines.append(f"  AMBIGUOUS {key}: {no} orphan markers ↔ {ng} gap events — not bound")
        census = census_by_period.get(r.period)
        if census:
            lines.append(f"  census marker counts: {census}")
    lines.append(f"\nTotal positions recovered: {total_updates}")
    return "\n".join(lines)


# ─── main (thin shell) ───────────────────────────────────────────────────────


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("match_id", type=int)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--cluster-radius-px", type=float, default=None)
    args = parser.parse_args()

    payload_text = sys.stdin.read().strip()
    if not payload_text or payload_text == "null":
        print("-- no input", flush=True)
        return 0
    payload = json.loads(payload_text)
    extractions = payload.get("extractions") or []
    match_events = payload.get("match_events") or []

    me_by_period: dict[int, list[dict]] = {}
    for e in match_events:
        p = e.get("period_number")
        if isinstance(p, int):
            me_by_period.setdefault(p, []).append(e)

    clusters_by_period = build_period_clusters(extractions, args.cluster_radius_px)
    yellow_by_period = build_yellow_salvage_clusters(extractions, args.cluster_radius_px)
    canonical = build_canonical_events(extractions)

    census_by_period: dict[int, dict[tuple[str, str], int]] = {}
    for row in extractions:
        raw = row.get("raw_result_json", {}) or {}
        if not is_census_frame(raw):
            continue
        period = select_capture_period(raw, row.get("source_path", ""))
        if period is None:
            continue
        counts = census_marker_counts(raw)
        prev = census_by_period.get(period, {})
        # Keep the per-key max across census frames (cleanest/most-complete).
        merged = dict(prev)
        for k, v in counts.items():
            merged[k] = max(merged.get(k, 0), v)
        census_by_period[period] = merged

    results: list[ReconResult] = []
    for period in sorted(set(clusters_by_period) | set(me_by_period)):
        results.append(reconcile_period(
            period,
            clusters_by_period.get(period, []),
            me_by_period.get(period, []),
            yellow_clusters=yellow_by_period.get(period, []),
        ))

    print(build_report(args.match_id, results, canonical, census_by_period), file=sys.stderr)

    if args.dry_run:
        return 0

    updates = [u for r in results for u in r.updates]
    print("BEGIN;")
    for u in updates:
        print(emit_update_sql(u))
    print("COMMIT;")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
