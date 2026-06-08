"""Tests for scripts/reconcile_action_tracker.py — the period-level Action
Tracker reconciliation post-pass.

The matching core is a PURE function over in-memory dicts (no DB), so these
tests build synthetic `raw_result_json` frames + match_events rows directly.
"""

from __future__ import annotations

import io
import json
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

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


def _orphan_event(event_type, actor, period, target=None, actor_conf=0.95, detail=None):
    """An AT event card whose clock failed OCR (status='missing'). The live
    promoter drops these; WS4 Stage 2a recovers their identity. `detail` overrides
    the Row-B line (raw_text) — used to carry a garbled clock/period for Stage 3."""
    e = _event(event_type, None, actor, period, target)
    e["clock"] = {"value": None, "raw_text": "", "confidence": 0.0, "status": "missing"}
    e["actor_snapshot"] = {
        "value": actor, "raw_text": actor, "confidence": actor_conf,
        "status": "ok" if actor else "missing",
    }
    e["raw_text"] = _ef(detail if detail is not None else f"{event_type} {actor or ''}")
    return e


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


# ─── permissive clock recovery (WS4 Stage 3 Tier 1) ────────────────────────


class PermissiveClockRecoveryTests(unittest.TestCase):
    """recover_clock re-parses the garbled clock digits stored verbatim in an
    orphan's event_detail. Returns (clock | None, confidence). Clocks are emitted
    UN-zero-padded to match the live promoter's stored form; confidence counts
    distinct transform KINDS (1.0 clean, 0.8 one kind, 0.6 two kinds / glued)."""

    def test_recovers_real_garbled_strings_with_confidence(self):
        cases = {
            # event_detail -> (recovered_clock, confidence)
            "P. MAGROYNE ON J. WAGNER S SHOT D:33 | 3rd Period": ("0:33", 0.8),
            "S. ZUBOV S SHOT D:14": ("0:14", 0.8),
            "E. WANHG S SHOT DT 18.12": ("18:12", 0.8),
            "-. TOEWS ON E. WANHG 19·43 1 2nd Perind HIT": ("19:43", 0.8),
            ". MARTEL ON J. WAGNER S SHOT 8.12 1 2nd Perind": ("8:12", 0.8),
            "C. YOSEFF ON P. BEAV H 2.59 HIT | 3rd Perind": ("2:59", 0.8),
            "C. YOSEFF ON V. GREYJOY HT 7.24 I Tet Periar": ("7:24", 0.8),
            # B->8 (one digit kind), trailing "10T" is an OT suffix, NOT glued noise.
            ". SILKY ON M. LEHMANN S SHOT B:4910T": ("8:49", 0.8),
        }
        for detail, expected in cases.items():
            with self.subTest(detail=detail):
                self.assertEqual(rat.recover_clock(detail), expected)

    def test_glued_trailing_digit_degrades_below_floor(self):
        # "9:0D1": D->0 gives 9:00, but the trailing bare digit "1" (no OT marker)
        # signals a mis-segmented SS -> forced to 0.6 (below the 0.66 exact-key floor).
        self.assertEqual(
            rat.recover_clock("M. RANTANEN ON -. WILDE HIT 9:0D1 2nd Period"),
            ("9:00", 0.6),
        )

    def test_unrecoverable_returns_none(self):
        for detail in [
            "L. STINKKPIT ON -. SILKY H 69:0 3rd Period HIT",   # MM=69 > 20 (and SS<2)
            ". MARTEL ON V. GREYJOY H HIT LU·UL 3rd Perind",  # no clock-ish token
            "U. MAILMAN ON H. JENKINS H 2nd Period HIT",        # no clock token at all
            "",
            None,
        ]:
            with self.subTest(detail=detail):
                self.assertEqual(rat.recover_clock(detail), (None, 0.0))

    def test_validation_bounds(self):
        self.assertEqual(rat.recover_clock("GOAL 20:00")[0], "20:00")   # puck drop is valid
        self.assertIsNone(rat.recover_clock("GOAL 20:01")[0])           # 20:xx>00 impossible
        self.assertEqual(rat.recover_clock("GOAL 19:59")[0], "19:59")
        self.assertIsNone(rat.recover_clock("GOAL 21:00")[0])
        self.assertIsNone(rat.recover_clock("GOAL 17:71")[0])           # SS>59

    def test_clean_read_is_full_confidence(self):
        # A legible MM:SS the AT regex only missed due to surrounding noise.
        self.assertEqual(rat.recover_clock("HIT 5:00 garble"), ("5:00", 1.0))

    def test_actor_initials_not_mistaken_for_clock(self):
        # A "D." initial is not a clock token; only the real 5:00 is recovered,
        # and actor text is never mutated (the fn returns only the clock string).
        self.assertEqual(rat.recover_clock("D. WANGER SHOT 5:00"), ("5:00", 1.0))


class PermissivePeriodRecoveryTests(unittest.TestCase):
    """recover_period is the FALLBACK for orphans whose period parse failed
    (period < 1) but whose "Nth Period" survives (often garbled) in event_detail.
    Conservative: needs an ordinal digit + a PERIOD-like token."""

    def test_recovers_regulation_periods(self):
        cases = {
            "P. MAGROYNE ON J. WAGNER S SHOT D:33 | 3rd Period": 3,
            "M. RANTANEN ON -. WILDE HIT 9:0D1 2nd Period": 2,
            "-. TOEWS ON E. WANHG 19·43 1 2nd Perind HIT": 2,     # garbled PERIND
            "V. GREYJOY ON -. FELLA 7.52 1ct Perind HIT": 1,      # garbled 1ST + PERIND
            "S. ZUBOV S SHOT 1st Period": 1,
            # Period is recoverable even when the clock is not:
            "U. MAILMAN ON H. JENKINS H 2nd Period HIT": 2,
        }
        for detail, expected in cases.items():
            with self.subTest(detail=detail):
                self.assertEqual(rat.recover_period(detail), expected)

    def test_recovers_overtime(self):
        self.assertEqual(rat.recover_period("SILKY S SHOT Overtime"), 4)
        self.assertEqual(rat.recover_period("SILKY S SHOT Overtime2"), 5)  # OT2
        self.assertEqual(rat.recover_period("SILKY S SHOT Overtime3"), 6)  # OT3 (no SO)

    def test_unrecoverable_returns_none(self):
        for detail in [
            "C. YOSEFF ON V. GREYJOY HT 7.24 I Tet Periar",  # no ordinal digit cue
            "S. ZUBOV S SHOT 5:00 garble",                   # no period token
            "",
            None,
        ]:
            with self.subTest(detail=detail):
                self.assertIsNone(rat.recover_period(detail))


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

    def test_canonical_collapses_ocr_letter_variant_actors(self):
        # WILDE vs WILOE at the same (period, type, clock) is ONE shot — an
        # OCR D->O misread, not two events. Mirrors the promoter's Levenshtein-1.
        f1 = _frame(1, 2, [_event("shot", "1:46", "WILDE", 2)], 0, [])
        f2 = _frame(2, 2, [_event("shot", "1:46", "WILOE", 2)], 0, [])
        canon = rat.build_canonical_events([f1, f2])
        shots = [e for e in canon[2] if e["event_type"] == "shot"]
        self.assertEqual(len(shots), 1)

    def test_canonical_keeps_distinct_actors_at_same_clock(self):
        # Genuinely different shooters at the same clock are NOT merged
        # (Levenshtein > 1).
        f = _frame(1, 2, [_event("shot", "5:00", "SILKY", 2),
                          _event("shot", "5:00", "TOEWS", 2)], 0, [])
        canon = rat.build_canonical_events([f])
        self.assertEqual(len([e for e in canon[2] if e["event_type"] == "shot"]), 2)


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


# ─── --json output mode (worker tail-hook contract) ────────────────────────


class JsonModeTests(unittest.TestCase):
    """The worker calls this script with --json and applies the proposals via
    Drizzle. These exercise main()'s thin shell end-to-end (stdin → stdout)."""

    def _scroll_past_payload(self):
        # The 19:43 case as main() sees it: a yellow-only scroll-past frame
        # (selected card off-screen) carrying the marker at (10.08, -6.81),
        # plus the unpositioned gap row it should bind to via yellow-salvage.
        ext = _frame(
            1, 2, [_event("hit", "19:43", "TOEWS", 2)],
            None,  # selected card off-screen → scroll-past
            [_marker("yellow", "unknown", 10.08, -6.81, 1356, 639)],
        )
        me = _me(288, 2, "hit", "19:43", "TOEWS", "against", x=None)
        return {"extractions": [ext], "match_events": [me], "period_summaries": []}

    def _run_main(self, stdin_text, argv):
        out = io.StringIO()
        with mock.patch.object(sys, "stdin", io.StringIO(stdin_text)), \
                mock.patch.object(sys, "argv", argv), \
                redirect_stdout(out), redirect_stderr(io.StringIO()):
            rc = rat.main()
        return rc, out.getvalue()

    def test_json_mode_emits_proposals(self):
        rc, stdout = self._run_main(
            json.dumps(self._scroll_past_payload()), ["reconcile", "250", "--json"])
        self.assertEqual(rc, 0)
        doc = json.loads(stdout)
        self.assertEqual(doc["match_id"], 250)
        self.assertEqual(len(doc["updates"]), 1)
        u = doc["updates"][0]
        self.assertEqual(u["event_id"], 288)
        self.assertAlmostEqual(u["x"], 10.08, places=2)
        self.assertAlmostEqual(u["y"], -6.81, places=2)
        self.assertEqual(u["rink_zone"], "neutral")
        self.assertEqual(u["confidence_label"], "extrapolated")
        self.assertEqual(u["method"], "yellow_salvage")

    def test_dry_run_json_mode_emits_empty_updates(self):
        rc, stdout = self._run_main(
            json.dumps(self._scroll_past_payload()),
            ["reconcile", "250", "--json", "--dry-run"])
        self.assertEqual(rc, 0)
        doc = json.loads(stdout)
        self.assertEqual(doc["match_id"], 250)
        self.assertEqual(doc["updates"], [])

    def test_json_mode_no_input_emits_empty_updates(self):
        rc, stdout = self._run_main("", ["reconcile", "250", "--json"])
        self.assertEqual(rc, 0)
        self.assertEqual(
            json.loads(stdout),
            {"match_id": 250, "updates": [], "orphan_cards": []},
        )

    def test_json_mode_emits_orphan_cards(self):
        ext = _frame(7, 2, [_orphan_event("shot", "RANTANEN", 2)], None, [])
        payload = {"extractions": [ext], "match_events": [], "period_summaries": []}
        rc, stdout = self._run_main(json.dumps(payload), ["reconcile", "250", "--json"])
        self.assertEqual(rc, 0)
        doc = json.loads(stdout)
        self.assertIn("updates", doc)  # updates still emitted (empty here)
        self.assertEqual(len(doc["orphan_cards"]), 1)
        self.assertEqual(doc["orphan_cards"][0]["event_type"], "shot")
        self.assertEqual(doc["orphan_cards"][0]["actor_snapshot"], "RANTANEN")

    def test_json_mode_emits_positioned_orphan_card(self):
        # WS4 Stage 2b: a garbled-clock orphan whose marker is detected across
        # frames comes out of --json already positioned + bound.
        frames = [
            _frame(i, 2, [_orphan_event("shot", "RANTANEN", 2)], None,
                   [_marker("red", "shot", 36.5, 36.2, 1200, 500)])
            for i in range(1, 30)
        ]
        payload = {"extractions": frames, "match_events": [], "period_summaries": []}
        rc, stdout = self._run_main(json.dumps(payload), ["reconcile", "250", "--json"])
        self.assertEqual(rc, 0)
        card = json.loads(stdout)["orphan_cards"][0]
        self.assertAlmostEqual(card["x"], 36.5, places=2)
        self.assertAlmostEqual(card["y"], 36.2, places=2)
        self.assertEqual(card["rink_zone"], "offensive")
        self.assertEqual(card["bind_method"], "co_occurrence")
        self.assertEqual(card["cluster_color_side"], "for")

    def test_dry_run_json_mode_emits_empty_orphan_cards(self):
        ext = _frame(7, 2, [_orphan_event("shot", "RANTANEN", 2)], None, [])
        payload = {"extractions": [ext], "match_events": [], "period_summaries": []}
        rc, stdout = self._run_main(
            json.dumps(payload), ["reconcile", "250", "--json", "--dry-run"])
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(stdout)["orphan_cards"], [])

    def test_sql_mode_unchanged_with_orphans(self):
        # An orphan-bearing payload must NOT leak orphan JSON into SQL mode.
        ext = _frame(7, 2, [_orphan_event("shot", "RANTANEN", 2)], None, [])
        payload = {"extractions": [ext], "match_events": [], "period_summaries": []}
        rc, stdout = self._run_main(json.dumps(payload), ["reconcile", "250"])
        self.assertEqual(rc, 0)
        self.assertTrue(stdout.startswith("BEGIN;"))
        self.assertIn("COMMIT;", stdout)
        self.assertNotIn("orphan_cards", stdout)


class OrphanCardTests(unittest.TestCase):
    """Pure-function tests for build_orphan_cards (WS4 Stage 2a)."""

    def _cards(self, extractions):
        with redirect_stderr(io.StringIO()):
            return rat.build_orphan_cards(extractions)

    def test_missing_clock_card_emitted(self):
        ext = _frame(7, 2, [_orphan_event("shot", "RANTANEN", 2)], None, [])
        cards = self._cards([ext])
        self.assertEqual(len(cards), 1)
        c = cards[0]
        self.assertEqual(c["period_number"], 2)
        self.assertEqual(c["period_label"], "2")
        self.assertEqual(c["event_type"], "shot")
        self.assertEqual(c["actor_snapshot"], "RANTANEN")
        self.assertIsNone(c["target_snapshot"])
        self.assertEqual(c["ocr_extraction_id"], 7)
        self.assertIn("event_detail", c)

    def test_cross_frame_dedup_to_one_keeps_highest_confidence_ext(self):
        frames = [
            _frame(i, 2, [_orphan_event("shot", "RANTANEN", 2, actor_conf=0.5)], None, [])
            for i in range(1, 115)
        ]
        # The 115th frame has the highest-confidence actor reading.
        frames.append(
            _frame(999, 2, [_orphan_event("shot", "RANTANEN", 2, actor_conf=0.99)], None, []))
        cards = self._cards(frames)
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["ocr_extraction_id"], 999)

    def test_distinct_actors_not_collapsed(self):
        ext = _frame(7, 2, [
            _orphan_event("shot", "RANTANEN", 2),
            _orphan_event("shot", "MAKAR", 2),
        ], None, [])
        self.assertEqual(len(self._cards([ext])), 2)

    def test_distinct_targets_not_collapsed(self):
        ext = _frame(7, 2, [
            _orphan_event("hit", "RANTANEN", 2, target="SMITH"),
            _orphan_event("hit", "RANTANEN", 2, target="JONES"),
        ], None, [])
        self.assertEqual(len(self._cards([ext])), 2)

    def test_missing_actor_skipped(self):
        ext = _frame(7, 2, [_orphan_event("shot", None, 2)], None, [])
        self.assertEqual(self._cards([ext]), [])

    def test_unknown_event_type_skipped(self):
        ext = _frame(7, 2, [_orphan_event("unknown", "RANTANEN", 2)], None, [])
        self.assertEqual(self._cards([ext]), [])

    def test_faceoff_skipped(self):
        ext = _frame(7, 2, [_orphan_event("faceoff", "RANTANEN", 2)], None, [])
        self.assertEqual(self._cards([ext]), [])

    def test_clock_present_card_not_emitted(self):
        # A normal (clock readable) card is the live promoter's job, not ours.
        ext = _frame(7, 2, [_event("shot", "5:00", "RANTANEN", 2)], None, [])
        self.assertEqual(self._cards([ext]), [])

    def test_within_frame_multiplicity_warns_and_emits_one(self):
        # Two distinct same-identity garbled shots in ONE frame: 2a can only
        # recover one, but must surface the drop on stderr (not silent).
        ext = _frame(7, 2, [
            _orphan_event("shot", "RANTANEN", 2),
            _orphan_event("shot", "RANTANEN", 2),
        ], None, [])
        err = io.StringIO()
        with redirect_stderr(err):
            cards = rat.build_orphan_cards([ext])
        self.assertEqual(len(cards), 1)
        self.assertIn("multiplicity", err.getvalue().lower())

    def test_garbled_period_orphan_now_admitted(self):
        # WS4 Stage 3: an orphan whose OCR period parse failed (period=-1) but
        # whose "3rd Period" survives in event_detail is now ADMITTED at period 3
        # (was silently dropped by the period<1 filter).
        ext = _frame(7, 3, [_orphan_event(
            "shot", "MAGROYNE", -1, target="WAGNER",
            detail="P. MAGROYNE ON J. WAGNER S SHOT D:33 | 3rd Period")], None, [])
        cards = self._cards([ext])
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["period_number"], 3)
        self.assertEqual(cards[0]["period_label"], "3")

    def test_garbled_period_unrecoverable_still_skipped(self):
        # period<1 AND no recoverable period token → still dropped (no anchor).
        ext = _frame(7, 3, [_orphan_event(
            "shot", "MAGROYNE", -1, detail="MAGROYNE S SHOT D:33")], None, [])
        self.assertEqual(self._cards([ext]), [])


class OrphanPanelIndexTests(unittest.TestCase):
    """build_orphan_panel_index (WS4 Stage 2b) — actor↔frame co-occurrence."""

    def test_panel_index_maps_identity_to_capture_ids(self):
        frames = [
            _frame(7, 2, [_orphan_event("shot", "RANTANEN", 2)], None,
                   [_marker("red", "shot", 36.5, 36.2, 1200, 500)]),
            _frame(9, 2, [_orphan_event("shot", "RANTANEN", 2)], None, []),
        ]
        idx = rat.build_orphan_panel_index(frames)
        self.assertEqual(idx[(2, "shot", "rantanen", "")], {7, 9})

    def test_panel_index_keys_event_level_period_not_frame_period(self):
        # Frame-level period (3) disagrees with event-level period (2). The
        # index must key on the EVENT period — the same authority the card and
        # the live promoter use — so card↔index always align (Finding 3).
        frame = _frame(7, 3, [_orphan_event("shot", "RANTANEN", 2)], None, [])
        idx = rat.build_orphan_panel_index([frame])
        self.assertIn((2, "shot", "rantanen", ""), idx)
        self.assertNotIn((3, "shot", "rantanen", ""), idx)

    def test_panel_index_uses_recovered_period(self):
        # WS4 Stage 3: a period<1 orphan whose period recovers from event_detail
        # must key the index under the RECOVERED period, or it diverges from the
        # card key and binding silently loses it (review Finding 1 alignment).
        frame = _frame(7, 3, [_orphan_event(
            "shot", "MAGROYNE", -1, target="WAGNER",
            detail="MAGROYNE ON WAGNER S SHOT D:33 | 3rd Period")], None, [])
        idx = rat.build_orphan_panel_index([frame])
        self.assertIn((3, "shot", "magroyne", "wagner"), idx)


class OrphanClockObsTests(unittest.TestCase):
    """build_orphan_clock_obs (WS4 Stage 3) — per-frame recovered-clock evidence."""

    def test_collects_recovered_clock_per_frame(self):
        frames = [
            _frame(7, 2, [_orphan_event("shot", "MAGROYNE", 3, target="WAGNER",
                          detail="MAGROYNE ON WAGNER S SHOT D:33 | 3rd Period")], None, []),
            _frame(9, 2, [_orphan_event("shot", "MAGROYNE", 3, target="WAGNER",
                          detail="MAGROYNE ON WAGNER S SHOT D:33 | 3rd Period")], None, []),
        ]
        obs = rat.build_orphan_clock_obs(frames)
        key = (3, "shot", "magroyne", "wagner")
        self.assertEqual(
            sorted(obs[key]), [(7, "0:33", 0.8), (9, "0:33", 0.8)])

    def test_unrecoverable_clock_absent_from_obs(self):
        frame = _frame(7, 2, [_orphan_event("hit", "MARTEL", 3,
                       detail="MARTEL H HIT LU·UL 3rd Perind")], None, [])
        self.assertEqual(rat.build_orphan_clock_obs([frame]), {})


class OrphanBindingTests(unittest.TestCase):
    """bind_orphan_cards (WS4 Stage 2b) — attach positions + split multiplicity."""

    def _bind(self, frames, periods=None):
        with redirect_stderr(io.StringIO()):
            cards = rat.build_orphan_cards(frames)
            idx = rat.build_orphan_panel_index(frames)
            obs = rat.build_orphan_clock_obs(frames)
            clusters = rat.build_period_clusters(frames)
            results = [rat.reconcile_period(p, clusters.get(p, []), [])
                       for p in (periods if periods is not None else clusters)]
            return rat.bind_orphan_cards(cards, idx, results, obs)

    def test_single_orphan_binds_to_cluster_position(self):
        # The real match-250 case: a 115-frame orphan shot marker at ~(36.5,36.2)
        # whose card clock was garbled → one positioned card, offensive zone.
        frames = [
            _frame(i, 2, [_orphan_event("shot", "RANTANEN", 2)], None,
                   [_marker("red", "shot", 36.5, 36.2, 1200, 500)])
            for i in range(1, 116)
        ]
        bound = self._bind(frames)
        self.assertEqual(len(bound), 1)
        c = bound[0]
        self.assertAlmostEqual(c["x"], 36.5, places=2)
        self.assertAlmostEqual(c["y"], 36.2, places=2)
        self.assertEqual(c["rink_zone"], "offensive")
        self.assertEqual(c["bind_method"], "co_occurrence")
        self.assertEqual(c["cluster_color_side"], "for")  # red marker → 'for'
        self.assertEqual(c["actor_snapshot"], "RANTANEN")

    def test_two_distinct_clusters_split_same_identity(self):
        # One identity, two markers per frame at distinct positions → 2a
        # collapses to one card; 2b fans it out to TWO positioned cards.
        frames = [
            _frame(i, 2, [_orphan_event("shot", "RANTANEN", 2)], None,
                   [_marker("red", "shot", 36.5, 36.2, 1200, 500),
                    _marker("red", "shot", -40.0, -10.0, 400, 300)])
            for i in range(1, 30)
        ]
        bound = self._bind(frames)
        self.assertEqual(len(bound), 2)
        xs = sorted(c["x"] for c in bound)
        self.assertEqual(xs, [-40.0, 36.5])
        self.assertTrue(all(c["bind_method"] == "co_occurrence" for c in bound))

    def test_contending_identities_higher_score_wins_cluster(self):
        # RANTANEN co-occurs with the marker in 5 frames, MAKAR in 2; the lone
        # cluster goes to RANTANEN, MAKAR falls back unpositioned.
        frames = []
        for i in range(1, 6):
            events = [_orphan_event("shot", "RANTANEN", 2)]
            if i <= 2:
                events.append(_orphan_event("shot", "MAKAR", 2))
            frames.append(_frame(i, 2, events, None,
                                 [_marker("red", "shot", 36.5, 36.2, 1200, 500)]))
        bound = self._bind(frames)
        by_actor = {c["actor_snapshot"]: c for c in bound}
        self.assertEqual(by_actor["RANTANEN"]["bind_method"], "co_occurrence")
        self.assertEqual(by_actor["MAKAR"]["bind_method"], "none")
        self.assertIsNone(by_actor["MAKAR"]["x"])

    def test_orphan_with_no_marker_stays_unpositioned(self):
        frames = [_frame(7, 2, [_orphan_event("hit", "TOEWS", 2)], None, [])]
        bound = self._bind(frames)
        self.assertEqual(len(bound), 1)
        self.assertIsNone(bound[0]["x"])
        self.assertIsNone(bound[0]["y"])
        self.assertIsNone(bound[0]["rink_zone"])
        self.assertEqual(bound[0]["bind_method"], "none")
        self.assertIsNone(bound[0]["cluster_color_side"])

    def test_redetection_of_positioned_event_not_eligible(self):
        # The orphan's only marker sits on an already-positioned event, so
        # reconcile_period prunes that cluster (absent from res.orphans) and the
        # card finds nothing to bind → unpositioned, never steals the position.
        frames = [
            _frame(i, 2, [_orphan_event("shot", "RANTANEN", 2)], None,
                   [_marker("red", "shot", 71.0, -38.7, 1450, 760)])
            for i in range(1, 30)
        ]
        with redirect_stderr(io.StringIO()):
            cards = rat.build_orphan_cards(frames)
            idx = rat.build_orphan_panel_index(frames)
            clusters = rat.build_period_clusters(frames)
            positioned = _me(287, 2, "shot", "18:06", "OTHER", "for",
                             x=71.0, y=-38.7, position_confidence="interpolated")
            results = [rat.reconcile_period(2, clusters.get(2, []), [positioned])]
            bound = rat.bind_orphan_cards(cards, idx, results)
        self.assertEqual(len(bound), 1)
        self.assertEqual(bound[0]["bind_method"], "none")

    def test_binds_when_frame_capture_period_differs_from_event_period(self):
        # Frame's capture period (select_capture_period → 5 via the selected
        # faceoff) disagrees with the orphan event's period (2). Binding is
        # frame-based (capture_id), so it still binds; the card keeps period 2
        # (WS4 Finding 3 regression guard).
        frames = []
        for i in range(1, 30):
            faceoff = _event("faceoff", "13:40", "WANHG", 5)
            shot = _orphan_event("shot", "RANTANEN", 2)
            frames.append(_frame(i, 5, [faceoff, shot], 0,
                                 [_marker("red", "shot", 36.5, 36.2, 1200, 500)]))
        bound = self._bind(frames)
        self.assertEqual(len(bound), 1)
        self.assertEqual(bound[0]["period_number"], 2)
        self.assertAlmostEqual(bound[0]["x"], 36.5, places=2)
        self.assertEqual(bound[0]["bind_method"], "co_occurrence")

    def test_binding_is_idempotent(self):
        frames = [
            _frame(i, 2, [_orphan_event("shot", "RANTANEN", 2)], None,
                   [_marker("red", "shot", 36.5, 36.2, 1200, 500)])
            for i in range(1, 30)
        ]
        self.assertEqual(self._bind(frames), self._bind(frames))

    def test_unpositioned_card_carries_recovered_clock(self):
        # WS4 Stage 3: a single-occurrence orphan with one recovered clock across
        # its frames carries that clock on the emitted (unpositioned) card.
        frames = [
            _frame(i, 2, [_orphan_event("shot", "MAGROYNE", 3, target="WAGNER",
                          detail="MAGROYNE ON WAGNER S SHOT D:33 | 3rd Period")], None, [])
            for i in range(1, 5)
        ]
        bound = self._bind(frames)
        self.assertEqual(len(bound), 1)
        self.assertEqual(bound[0]["recovered_clock"], "0:33")
        self.assertEqual(bound[0]["recovered_clock_confidence"], 0.8)

    def test_unrecoverable_clock_card_is_null(self):
        frames = [_frame(7, 2, [_orphan_event("hit", "MARTEL", 3,
                  detail="MARTEL H HIT LU·UL 3rd Perind")], None, [])]
        bound = self._bind(frames)
        self.assertEqual(len(bound), 1)
        self.assertIsNone(bound[0]["recovered_clock"])
        self.assertEqual(bound[0]["recovered_clock_confidence"], 0.0)

    def test_fanout_splits_clock_per_cluster(self):
        # One identity, two physical events at distinct positions in distinct
        # frames, each frame carrying its OWN recovered clock. The split children
        # must each get the clock from THEIR cluster's frames — not a shared one
        # (review Finding 1).
        frames = []
        for i in range(1, 6):   # cluster A @ (36.5,36.2), clock 5:00
            frames.append(_frame(i, 2, [_orphan_event(
                "shot", "RANTANEN", 2, detail="RANTANEN S SHOT 5:00 2nd Period")], None,
                [_marker("red", "shot", 36.5, 36.2, 1200, 500)]))
        for i in range(6, 11):  # cluster B @ (-40,-10), clock 7:30
            frames.append(_frame(i, 2, [_orphan_event(
                "shot", "RANTANEN", 2, detail="RANTANEN S SHOT 7:30 2nd Period")], None,
                [_marker("red", "shot", -40.0, -10.0, 400, 300)]))
        bound = self._bind(frames)
        self.assertEqual(len(bound), 2)
        by_clock = {c["recovered_clock"]: c for c in bound}
        self.assertAlmostEqual(by_clock["5:00"]["x"], 36.5, places=1)
        self.assertAlmostEqual(by_clock["7:30"]["x"], -40.0, places=1)

    def test_fanout_conflicting_clock_is_null(self):
        # Two distinct recovered clocks bound to the SAME cluster (same position)
        # → cannot decide which belongs → clock-null (never guess).
        frames = [
            _frame(1, 2, [_orphan_event("shot", "RANTANEN", 2,
                   detail="RANTANEN S SHOT 5:00 2nd Period")], None,
                   [_marker("red", "shot", 36.5, 36.2, 1200, 500)]),
            _frame(2, 2, [_orphan_event("shot", "RANTANEN", 2,
                   detail="RANTANEN S SHOT 7:30 2nd Period")], None,
                   [_marker("red", "shot", 36.5, 36.2, 1200, 500)]),
        ]
        bound = self._bind(frames)
        self.assertEqual(len(bound), 1)
        self.assertEqual(bound[0]["bind_method"], "co_occurrence")
        self.assertIsNone(bound[0]["recovered_clock"])


if __name__ == "__main__":
    unittest.main()
