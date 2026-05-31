"""Tests for scripts/reconcile_action_tracker.py — the period-level Action
Tracker reconciliation post-pass.

The matching core is a PURE function over in-memory dicts (no DB), so these
tests build synthetic `raw_result_json` frames + match_events rows directly.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import reconcile_action_tracker as rat  # noqa: E402


# ─── fixture builders ──────────────────────────────────────────────────────


def _ef(value):
    """Wrap a value as an ExtractionField dict (the typed-OCR shape)."""
    return {"value": value, "raw_text": value, "confidence": 0.95, "status": "ok"}


def _event(event_type, clock, actor, period, target=None):
    return {
        "event_type": event_type,
        "clock": _ef(clock),
        "actor_snapshot": _ef(actor),
        "target_snapshot": _ef(target),
        "period_number": period,
        "period_label": f"{period}",
    }


def _marker(color, shape, hx, hy, px, py, fill="solid", confidence=1.0):
    return {
        "color": color,
        "shape_type": shape,
        "fill_style": fill,
        "hockey_x": hx,
        "hockey_y": hy,
        "pixel_x": px,
        "pixel_y": py,
        "confidence": confidence,
        "area_px": 2000.0,
    }


def _frame(ext_id, period, events, selected_index, markers, source_path=""):
    return {
        "id": ext_id,
        "source_path": source_path,
        "raw_result_json": {
            "events": events,
            "selected_event_index": selected_index,
            "detected_markers": markers,
            "period_number": period,
            "period_label": f"{period}",
        },
    }


def _me(event_id, period, event_type, clock, actor, team_side,
        x=None, y=None, position_confidence=None):
    return {
        "id": event_id,
        "period_number": period,
        "event_type": event_type,
        "team_side": team_side,
        "clock": clock,
        "actor": actor,
        "x": x,
        "y": y,
        "position_confidence": position_confidence,
    }


# ─── normalization ─────────────────────────────────────────────────────────


class NormalizationTests(unittest.TestCase):
    def test_normalize_clock_zero_pads_minutes(self):
        self.assertEqual(rat.normalize_clock("0:42"), "00:42")
        self.assertEqual(rat.normalize_clock("19:43"), "19:43")
        self.assertEqual(rat.normalize_clock(None), "")

    def test_normalize_actor_strips_ornament_and_case(self):
        self.assertEqual(rat.normalize_actor("-. Silky"), "silky")
        self.assertEqual(rat.normalize_actor("TOEWS"), "toews")
        self.assertEqual(rat.normalize_actor(None), "")


# ─── canonical event union ─────────────────────────────────────────────────


class CanonicalEventTests(unittest.TestCase):
    def test_canonical_dedup_unions_overlapping_windows(self):
        # Two frames whose scrolling windows overlap on the SILKY hit; the
        # union must contain each distinct event exactly once.
        f1 = _frame(1, 2, [
            _event("hit", "13:43", "TOEWS", 2),
            _event("hit", "17:39", "TOEWS", 2),
        ], 0, [])
        f2 = _frame(2, 2, [
            _event("hit", "17:39", "TOEWS", 2),   # overlap with f1
            _event("hit", "19:43", "TOEWS", 2),   # only in f2
        ], 0, [])
        canon = rat.build_canonical_events([f1, f2])
        keys = {(e["event_type"], e["clock"], e["actor"]) for e in canon[2]}
        self.assertEqual(
            keys,
            {("hit", "13:43", "TOEWS"), ("hit", "17:39", "TOEWS"), ("hit", "19:43", "TOEWS")},
        )
        self.assertEqual(len(canon[2]), 3)  # no duplicate of 17:39


# ─── census frame detection ────────────────────────────────────────────────


class CensusFrameTests(unittest.TestCase):
    def test_faceoff_selected_zero_yellow_is_census(self):
        raw = _frame(1, 2, [_event("faceoff", "13:40", "E. WANHG", 2)], 0,
                     [_marker("red", "hit", 30.0, -34.0, 1450, 767),
                      _marker("white", "shot", -74.0, 17.0, 963, 523)])["raw_result_json"]
        self.assertTrue(rat.is_census_frame(raw))

    def test_nonfaceoff_selected_is_not_census(self):
        raw = _frame(1, 2, [_event("hit", "13:43", "TOEWS", 2)], 0,
                     [_marker("red", "hit", 30.0, -34.0, 1450, 767)])["raw_result_json"]
        self.assertFalse(rat.is_census_frame(raw))

    def test_yellow_marker_present_is_not_census(self):
        raw = _frame(1, 2, [_event("faceoff", "13:40", "E. WANHG", 2)], 0,
                     [_marker("yellow", "unknown", 10.0, -6.0, 1356, 639)])["raw_result_json"]
        self.assertFalse(rat.is_census_frame(raw))


# ─── completeness anchors ──────────────────────────────────────────────────


class AnchorTests(unittest.TestCase):
    def test_hit_anchor_from_census_count(self):
        # Census frame shows three red (for) hit markers.
        raw = _frame(1, 2, [_event("faceoff", "13:40", "E. WANHG", 2)], 0, [
            _marker("red", "hit", 30.0, -34.0, 1450, 767),
            _marker("red", "hit", 40.0, -25.0, 1489, 726),
            _marker("red", "hit", -74.0, 17.0, 963, 523),
            _marker("red", "shot", 25.0, 40.0, 1000, 200),
        ])["raw_result_json"]
        counts = rat.census_marker_counts(raw)
        self.assertEqual(counts[("hit", "for")], 3)
        self.assertEqual(counts[("shot", "for")], 1)


# ─── completeness anchors ──────────────────────────────────────────────────


class CompletenessTests(unittest.TestCase):
    def test_box_score_and_census_anchors_with_shortfall(self):
        canonical = {2: [
            {"event_type": "shot"}, {"event_type": "shot"},          # 2 shots found
            {"event_type": "hit"}, {"event_type": "hit"}, {"event_type": "hit"},
            {"event_type": "goal"},
            {"event_type": "faceoff"},
        ]}
        me = {2: [
            {"event_type": "shot", "x": 1.0}, {"event_type": "shot", "x": None},
            {"event_type": "hit", "x": 2.0}, {"event_type": "hit", "x": None},
            {"event_type": "hit", "x": None},
        ]}
        census = {2: {("hit", "for"): 1, ("hit", "against"): 2}}      # hit anchor 3
        ps = [{"period_number": 2, "goals_for": 1, "goals_against": 0,
               "shots_for": 2, "shots_against": 1,
               "faceoffs_for": 1, "faceoffs_against": 0}]
        comp = {(c.period, c.event_type): c
                for c in rat.build_completeness(canonical, me, census, ps)}
        self.assertEqual(comp[(2, "shot")].anchor, 3)               # 2 + 1
        self.assertEqual(comp[(2, "shot")].anchor_source, "box_score")
        self.assertEqual(comp[(2, "shot")].found, 2)
        self.assertEqual(comp[(2, "shot")].positioned, 1)
        self.assertEqual(comp[(2, "shot")].short, 1)                # 3 - 2
        self.assertEqual(comp[(2, "hit")].anchor, 3)
        self.assertEqual(comp[(2, "hit")].anchor_source, "census")
        self.assertEqual(comp[(2, "hit")].found, 3)
        self.assertEqual(comp[(2, "hit")].short, 0)
        self.assertEqual(comp[(2, "goal")].anchor, 1)
        self.assertEqual(comp[(2, "faceoff")].anchor, 1)
        # position shortfall (found - positioned), type-agnostic except faceoff
        self.assertEqual(comp[(2, "shot")].pos_short, 1)   # 2 found, 1 positioned
        self.assertEqual(comp[(2, "hit")].pos_short, 2)    # 3 found, 1 positioned
        self.assertEqual(comp[(2, "faceoff")].pos_short, 0)  # faceoffs never positioned

    def test_hit_anchor_none_without_census_frame(self):
        comp = {(c.period, c.event_type): c for c in
                rat.build_completeness({2: [{"event_type": "hit"}]}, {2: []}, {}, [])}
        self.assertIsNone(comp[(2, "hit")].anchor)
        self.assertEqual(comp[(2, "hit")].anchor_source, "none")
        self.assertEqual(comp[(2, "hit")].short, 0)


# ─── binding engine ────────────────────────────────────────────────────────


class BindingTests(unittest.TestCase):
    def _cluster(self, color, shape, hx, hy, px, py, panel=None):
        obs = rat.MarkerObservation(
            capture_id=1, pixel_x=px, pixel_y=py, hockey_x=hx, hockey_y=hy,
            color=color, shape_type=shape, fill_style="solid", confidence=1.0,
            period=2, panel_by_type=panel or {},
        )
        return rat.Cluster(markers=[obs])

    def test_elimination_binds_unique_orphan_hit(self):
        # THE 19:43 REGRESSION: one orphan white(against) hit marker at the
        # recovered position, one gap (unpositioned) against-hit event for
        # TOEWS@19:43, and NO panel co-occurrence evidence (card never
        # co-visible with the marker) → bind by elimination.
        orphan = self._cluster("white", "hit", 10.08, -6.81, 1356, 639, panel={})
        gap = _me(288, 2, "hit", "19:43", "TOEWS", "against", x=None)
        result = rat.reconcile_period(2, [orphan], [gap])
        self.assertEqual(len(result.updates), 1)
        u = result.updates[0]
        self.assertEqual(u.event_id, 288)
        self.assertAlmostEqual(u.x, 10.08, places=2)
        self.assertAlmostEqual(u.y, -6.81, places=2)
        self.assertEqual(u.rink_zone, "neutral")
        self.assertEqual(u.confidence_label, "extrapolated")
        self.assertEqual(u.method, "elimination")

    def test_inferred_binding_never_sets_reviewed(self):
        orphan = self._cluster("white", "hit", 10.08, -6.81, 1356, 639)
        gap = _me(288, 2, "hit", "19:43", "TOEWS", "against", x=None)
        result = rat.reconcile_period(2, [orphan], [gap])
        sql = rat.emit_update_sql(result.updates[0])
        self.assertNotIn("review_status", sql)
        self.assertIn("position_confidence='extrapolated'", sql)

    def test_multiway_ambiguity_flagged_not_bound(self):
        # Two orphan against-hit markers + two gap against-hit events → no
        # guess; report the bucket as ambiguous, emit no updates.
        o1 = self._cluster("white", "hit", 10.0, -6.0, 1356, 639)
        o2 = self._cluster("white", "hit", -30.0, 12.0, 800, 400)
        g1 = _me(101, 2, "hit", "19:43", "TOEWS", "against", x=None)
        g2 = _me(102, 2, "hit", "05:20", "WHOOSAH", "against", x=None)
        result = rat.reconcile_period(2, [o1, o2], [g1, g2])
        self.assertEqual(result.updates, [])
        self.assertEqual(len(result.ambiguous), 1)

    def test_manual_and_positioned_rows_not_clobbered(self):
        # A positioned (manual) event is never selected for an UPDATE, and
        # the emitted SQL guards against overwriting positioned/manual rows.
        orphan = self._cluster("white", "hit", 10.0, -6.0, 1356, 639)
        positioned = _me(256, 2, "hit", "11:23", "SILKY", "against",
                         x=30.0, y=-38.0, position_confidence="manual")
        result = rat.reconcile_period(2, [orphan], [positioned])
        self.assertEqual(result.updates, [])  # nothing to position
        # And the guard is present on any emitted UPDATE.
        u = rat.Update(event_id=999, x=1.0, y=2.0, rink_zone="neutral",
                       confidence_label="extrapolated", method="elimination")
        sql = rat.emit_update_sql(u)
        self.assertIn("x IS NULL", sql)
        self.assertIn("position_confidence IS DISTINCT FROM 'manual'", sql)

    def test_pairweight_match_positions_event(self):
        # A cluster whose source frame's panel carries the (actor, clock) of a
        # gap event binds via co-occurrence (pair_weight), method='pairweight'.
        panel = {"hit": [("TOEWS", "13:43"), ("TOEWS", "13:43")]}
        cluster = self._cluster("white", "hit", 82.9, 15.9, 1200, 500, panel=panel)
        gap = _me(266, 2, "hit", "13:43", "TOEWS", "against", x=None)
        result = rat.reconcile_period(2, [cluster], [gap])
        self.assertEqual(len(result.updates), 1)
        self.assertEqual(result.updates[0].event_id, 266)
        self.assertEqual(result.updates[0].method, "pairweight")


# ─── orphan spatial-prune ──────────────────────────────────────────────────


class PruneTests(unittest.TestCase):
    def _cluster(self, color, shape, hx, hy, px, py, n=1, panel=None):
        obs = [rat.MarkerObservation(
            capture_id=i, pixel_x=px, pixel_y=py, hockey_x=hx, hockey_y=hy,
            color=color, shape_type=shape, fill_style="solid", confidence=1.0,
            period=2, panel_by_type=panel or {}) for i in range(n)]
        return rat.Cluster(markers=obs)

    def test_orphan_redetection_of_positioned_event_is_pruned(self):
        # An orphan marker sitting on top of an already-positioned event is a
        # re-detection, not a new location → pruned, not flagged orphan/ambiguous.
        redetection = self._cluster("white", "hit", 71.2, -38.5, 1450, 760)  # ~0.5u from id287
        positioned = _me(287, 2, "hit", "18:06", "P. MAGROYNE", "against",
                         x=71.0, y=-38.7, position_confidence="interpolated")
        result = rat.reconcile_period(2, [redetection], [positioned])
        self.assertEqual(result.updates, [])
        self.assertEqual(result.orphans, [])
        self.assertEqual(result.ambiguous, [])

    def test_prune_resolves_false_ambiguity_then_elimination_binds(self):
        # One re-detection orphan (near a positioned event) + one TRUE orphan +
        # one gap. After pruning the re-detection, it's a clean 1:1 → bind.
        redetection = self._cluster("white", "hit", 71.2, -38.5, 1450, 760)
        true_orphan = self._cluster("white", "hit", 10.08, -6.81, 1356, 639)
        positioned = _me(287, 2, "hit", "18:06", "P. MAGROYNE", "against",
                         x=71.0, y=-38.7, position_confidence="interpolated")
        gap = _me(288, 2, "hit", "19:43", "TOEWS", "against", x=None)
        result = rat.reconcile_period(2, [redetection, true_orphan], [positioned, gap])
        self.assertEqual(len(result.updates), 1)
        self.assertEqual(result.updates[0].event_id, 288)
        self.assertAlmostEqual(result.updates[0].x, 10.08, places=2)
        self.assertEqual(result.updates[0].method, "elimination")


# ─── yellow-position salvage ───────────────────────────────────────────────


class YellowSalvageTests(unittest.TestCase):
    def test_build_yellow_salvage_only_from_scroll_past_frames(self):
        # Scroll-past: yellow marker present AND selected card off-screen
        # (selected_event_index None / out of range).
        scroll_past = _frame(1, 2, [_event("hit", "13:43", "TOEWS", 2)],
                             None,  # card off-screen
                             [_marker("yellow", "unknown", 10.08, -6.81, 1356, 639)])
        normal = _frame(2, 2, [_event("hit", "13:43", "TOEWS", 2)],
                        0,  # card on-screen → NOT scroll-past
                        [_marker("yellow", "unknown", 80.0, 15.0, 1200, 500)])
        ys = rat.build_yellow_salvage_clusters([scroll_past, normal])
        self.assertEqual(len(ys.get(2, [])), 1)
        hx, hy, _ = ys[2][0].median_hockey()
        self.assertAlmostEqual(hx, 10.08, places=2)

    def test_yellow_salvage_binds_unique_remaining_gap(self):
        # 288's marker only ever appeared yellow (card off-screen). After
        # type/team bucketing leaves one period gap and one yellow-salvage
        # cluster, bind by elimination.
        yc = rat.Cluster(markers=[rat.MarkerObservation(
            capture_id=1, pixel_x=1356, pixel_y=639, hockey_x=10.08, hockey_y=-6.81,
            color="yellow", shape_type="unknown", fill_style="unknown",
            confidence=1.0, period=2, panel_by_type={})])
        gap = _me(288, 2, "hit", "19:43", "TOEWS", "against", x=None)
        result = rat.reconcile_period(2, [], [gap], yellow_clusters=[yc])
        self.assertEqual(len(result.updates), 1)
        u = result.updates[0]
        self.assertEqual(u.event_id, 288)
        self.assertAlmostEqual(u.x, 10.08, places=2)
        self.assertEqual(u.method, "yellow_salvage")
        self.assertEqual(u.confidence_label, "extrapolated")

    def test_yellow_salvage_ambiguous_when_multiple_gaps(self):
        yc = rat.Cluster(markers=[rat.MarkerObservation(
            capture_id=1, pixel_x=1356, pixel_y=639, hockey_x=10.0, hockey_y=-6.0,
            color="yellow", shape_type="unknown", fill_style="unknown",
            confidence=1.0, period=2, panel_by_type={})])
        g1 = _me(288, 2, "hit", "19:43", "TOEWS", "against", x=None)
        g2 = _me(290, 2, "shot", "05:00", "SILKY", "against", x=None)
        result = rat.reconcile_period(2, [], [g1, g2], yellow_clusters=[yc])
        self.assertEqual(result.updates, [])
        self.assertTrue(any(a[0] == "yellow_salvage" for a in result.ambiguous))


# ─── dry-run / SQL emission ────────────────────────────────────────────────


class EmissionTests(unittest.TestCase):
    def test_update_sql_targets_event_id_and_fields(self):
        u = rat.Update(event_id=288, x=10.08, y=-6.81, rink_zone="neutral",
                       confidence_label="extrapolated", method="elimination")
        sql = rat.emit_update_sql(u)
        self.assertIn("UPDATE match_events SET", sql)
        self.assertIn("x='10.08'", sql)
        self.assertIn("y='-6.81'", sql)
        self.assertIn("rink_zone='neutral'", sql)
        self.assertIn("WHERE id=288", sql)


if __name__ == "__main__":
    unittest.main()
