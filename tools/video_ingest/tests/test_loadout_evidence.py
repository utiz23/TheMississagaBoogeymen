"""Tests for Phase 2A-9: typed extractor entry point + FieldEvidenceRecord.

TDD tests written before implementation.  Run with:
    PYTHONPATH=tools/game_ocr python3 -m pytest tools/video_ingest/tests/test_loadout_evidence.py -v
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch, mock_open

import numpy as np

# ---------------------------------------------------------------------------
# Required fields — mirrors ocr_field_evidence non-nullable Drizzle columns
# ---------------------------------------------------------------------------

REQUIRED_FIELDS = [
    "screen_state",
    "field_key",
    "field_family",
    "candidate_value",
    "candidate_rank",
    "raw_confidence",
    "calibrated_confidence",
    "extractor_family",
    "extractor_version",
    "observability_status",
    "normalization_status",
]

# ---------------------------------------------------------------------------
# Helpers — synthetic data factories
# ---------------------------------------------------------------------------


def _make_slot_identity(slot_key: str, row_ordinal: int = 0) -> Any:
    from game_ocr.loadout_extractors.slot_identity import SlotIdentity
    return SlotIdentity(
        slot_key=slot_key,
        row_ordinal=row_ordinal,
        anchor_y=300,
        position="C",
        observability="observable",
    )


def _make_bundle(slot_key: str = "loadout_slot_seg0000_row0", row_ordinal: int = 0) -> Any:
    """Create a minimal synthetic LoadoutFrameBundle."""
    from game_ocr.loadout_bundle import LoadoutFrameBundle

    si = _make_slot_identity(slot_key, row_ordinal)
    return LoadoutFrameBundle(
        slot_key=slot_key,
        row_ordinal=row_ordinal,
        segment_index=0,
        frame_paths=(Path(f"/fake/seg0/frame_0000.png"),),
        best_frame_path=Path(f"/fake/seg0/frame_0000.png"),
        best_frame_blur_score=100.0,
        slot_identities=(si,),
        support_frame_indices=(0,),
        observability="observable",
        position_stability=1.0,
    )


def _make_bundle_with_observability(obs: str) -> Any:
    """Make a bundle with a specific observability status."""
    from game_ocr.loadout_bundle import LoadoutFrameBundle

    si = _make_slot_identity("loadout_slot_seg0000_row0")
    return LoadoutFrameBundle(
        slot_key="loadout_slot_seg0000_row0",
        row_ordinal=0,
        segment_index=0,
        frame_paths=(Path("/fake/seg0/frame_0000.png"),),
        best_frame_path=Path("/fake/seg0/frame_0000.png"),
        best_frame_blur_score=5.0,
        slot_identities=(si,),
        support_frame_indices=(0,),
        observability=obs,
        position_stability=0.4 if obs in ("obstructed", "low_quality") else 1.0,
    )


def _make_5_bundles() -> list:
    return [_make_bundle(f"loadout_slot_seg0000_row{i}", i) for i in range(5)]


def _make_dummy_image():
    return np.zeros((1080, 1920, 3), dtype=np.uint8)


def _make_open_text_evidence(field_key: str = "gamertag", rank: int = 0) -> Any:
    from game_ocr.loadout_extractors.open_text import OpenTextEvidence
    return OpenTextEvidence(
        field_key=field_key,
        value="TestPlayer",
        raw_confidence=0.95,
        calibrated_confidence=0.95,
        candidate_rank=rank,
        roi_bbox={"x": 1500.0, "y": 130.0, "w": 420.0, "h": 40.0},
        observability="observable",
    )


def _make_closed_vocab_candidate(value: str = "Sniper") -> Any:
    from game_ocr.loadout_extractors.closed_vocab import ClosedVocabCandidate
    return ClosedVocabCandidate(
        value=value,
        raw_confidence=1.0,
        calibrated_confidence=1.0,
        roi_bbox=None,
    )


def _make_tabular_evidence(row_key: str = "speed", column_key: str = "value", value: int = 85) -> Any:
    from game_ocr.loadout_extractors.tabular_numeric import NumericCellEvidence
    return NumericCellEvidence(
        row_key=row_key,
        column_key=column_key,
        value=value,
        raw_confidence=0.92,
        calibrated_confidence=0.92,
        candidate_rank=0,
        roi_bbox={"x": 400.0, "y": 580.0, "w": 100.0, "h": 50.0},
        observability="observable",
    )


def _make_icon_evidence(field_key: str = "x_factor_name_0", shape: str = "Wheels") -> Any:
    from game_ocr.loadout_extractors.icon import IconEvidence
    return IconEvidence(
        field_family="icon",
        field_key=field_key,
        shape_or_icon_class=shape,
        raw_confidence=0.88,
        calibrated_confidence=0.88,
        x_norm=0.26,
        y_norm=0.31,
        roi_bbox={"x": 0.24, "y": 0.29, "w": 0.04, "h": 0.07},
        observability="observable",
    )


# ---------------------------------------------------------------------------
# Helper: run _evidence_for_bundle with mocked extractors
# ---------------------------------------------------------------------------


def _run_evidence_for_bundle(
    bundle,
    open_ev=None,
    cv_ev=None,
    tab_ev=None,
    icon_ev=None,
    extractor_version: str = "test-v1",
) -> list:
    """Call _evidence_for_bundle with all 4 extractors mocked."""
    from game_ocr.loadout_evidence import _evidence_for_bundle
    from game_ocr.loadout_extractors.closed_vocab import LoadoutClosedVocabExtractor
    from game_ocr.loadout_extractors.tabular_numeric import LoadoutTabularExtractor
    from game_ocr.loadout_extractors.icon import LoadoutIconExtractor
    from game_ocr.loadout_extractors.open_text import LoadoutOpenTextExtractor

    dummy_img = _make_dummy_image()

    cv_extractor = LoadoutClosedVocabExtractor()
    tab_extractor = LoadoutTabularExtractor()
    icon_extractor = LoadoutIconExtractor()
    ot_extractor = LoadoutOpenTextExtractor()

    with patch("game_ocr.loadout_evidence.cv2.imread", return_value=dummy_img), \
         patch("game_ocr.loadout_evidence._load_frame_ocr_lines", return_value=[]), \
         patch.object(ot_extractor, "extract_open_text_for_roi", return_value=open_ev or []), \
         patch.object(tab_extractor, "extract_attribute_grid", return_value=tab_ev or []), \
         patch.object(icon_extractor, "extract_xfactor_icons", return_value=icon_ev or []), \
         patch.object(cv_extractor, "classify_build_class", return_value=cv_ev or []), \
         patch.object(cv_extractor, "classify_position", return_value=cv_ev or []), \
         patch.object(cv_extractor, "classify_x_factor_name", return_value=cv_ev or []), \
         patch.object(cv_extractor, "classify_x_factor_tier_from_image", return_value=cv_ev or []):

        return _evidence_for_bundle(
            bundle, cv_extractor, tab_extractor, icon_extractor, ot_extractor, extractor_version
        )


# ---------------------------------------------------------------------------
# Helper: run extract_loadout_evidence with the assemble step mocked
# ---------------------------------------------------------------------------


def _run_extract_evidence(
    bundles: list,
    open_ev=None,
    cv_ev=None,
    tab_ev=None,
    icon_ev=None,
    extractor_version: str = "test-v1",
) -> list:
    """Run extract_loadout_evidence with bundle assembly AND all 4 extractors mocked.

    Passes ocr_lines_per_frame=[] explicitly so RapidOCR is never instantiated.
    """
    from game_ocr.loadout_evidence import extract_loadout_evidence
    from game_ocr.loadout_extractors.closed_vocab import LoadoutClosedVocabExtractor
    from game_ocr.loadout_extractors.tabular_numeric import LoadoutTabularExtractor
    from game_ocr.loadout_extractors.icon import LoadoutIconExtractor
    from game_ocr.loadout_extractors.open_text import LoadoutOpenTextExtractor

    dummy_img = _make_dummy_image()

    # Fake frame paths returned by glob — use 5-digit zero-padded names (Pass-2 convention)
    fake_frames = [Path("/fake/00001.png"), Path("/fake/00002.png")]

    with patch("game_ocr.loadout_evidence.assemble_loadout_bundles", return_value=bundles), \
         patch("game_ocr.loadout_evidence.cv2.imread", return_value=dummy_img), \
         patch("pathlib.Path.glob", return_value=iter(fake_frames)), \
         patch("game_ocr.loadout_evidence._load_frame_ocr_lines", return_value=[]), \
         patch.object(LoadoutOpenTextExtractor, "extract_open_text_for_roi", return_value=open_ev or []), \
         patch.object(LoadoutTabularExtractor, "extract_attribute_grid", return_value=tab_ev or []), \
         patch.object(LoadoutIconExtractor, "extract_xfactor_icons", return_value=icon_ev or []), \
         patch.object(LoadoutClosedVocabExtractor, "classify_build_class", return_value=cv_ev or []), \
         patch.object(LoadoutClosedVocabExtractor, "classify_position", return_value=cv_ev or []), \
         patch.object(LoadoutClosedVocabExtractor, "classify_x_factor_name", return_value=cv_ev or []), \
         patch.object(LoadoutClosedVocabExtractor, "classify_x_factor_tier_from_image", return_value=cv_ev or []):

        # Pass ocr_lines_per_frame=[] to bypass internal RapidOCR instantiation;
        # assemble_loadout_bundles is mocked so the empty list is never indexed.
        return extract_loadout_evidence(
            Path("/fake/bundle_dir"),
            segment_index=0,
            extractor_version=extractor_version,
            ocr_lines_per_frame=[],
        )


# ---------------------------------------------------------------------------
# Test 1: returns records for all visible slots
# ---------------------------------------------------------------------------


class TestExtractLoadoutEvidenceReturnsRecordsForAllVisibleSlots(unittest.TestCase):
    """extract_loadout_evidence returns FieldEvidenceRecord rows for all visible slots."""

    def test_returns_records_for_5_slots(self):
        """Given 5 bundles (one per slot), the returned records cover all 5 slot_keys."""
        bundles = _make_5_bundles()
        open_ev = [_make_open_text_evidence()]
        cv_ev = [_make_closed_vocab_candidate()]
        tab_ev = [_make_tabular_evidence()]
        icon_ev = [_make_icon_evidence()]

        records = _run_extract_evidence(
            bundles, open_ev=open_ev, cv_ev=cv_ev, tab_ev=tab_ev, icon_ev=icon_ev
        )

        # Every bundle's slot_key must appear among the records' subject_slot_key
        slot_keys_in_records = {r.subject_slot_key for r in records}
        expected_slot_keys = {b.slot_key for b in bundles}
        self.assertEqual(expected_slot_keys, slot_keys_in_records)

    def test_no_bundles_returns_empty_list(self):
        """Zero bundles → empty records list (no error)."""
        records = _run_extract_evidence([])
        self.assertEqual(records, [])


# ---------------------------------------------------------------------------
# Test 2: every record has all required fields non-None
# ---------------------------------------------------------------------------


class TestEachRecordHasRequiredFieldsForFieldEvidenceTable(unittest.TestCase):
    """Every FieldEvidenceRecord has non-None required fields."""

    def _get_records(self) -> list:
        bundle = _make_bundle()
        return _run_evidence_for_bundle(
            bundle,
            open_ev=[_make_open_text_evidence("gamertag")],
            cv_ev=[_make_closed_vocab_candidate("Sniper")],
            tab_ev=[_make_tabular_evidence()],
            icon_ev=[_make_icon_evidence()],
        )

    def test_all_required_fields_non_none(self):
        records = self._get_records()
        self.assertGreater(len(records), 0, "expected at least 1 record")
        for rec in records:
            d = rec.to_dict()
            for field_name in REQUIRED_FIELDS:
                self.assertIn(field_name, d, f"missing key {field_name!r} in to_dict()")
                self.assertIsNotNone(
                    d[field_name],
                    f"record field {field_name!r} is None for record "
                    f"field_key={rec.field_key!r} family={rec.field_family!r}",
                )

    def test_screen_state_is_player_loadout_view(self):
        records = self._get_records()
        for rec in records:
            self.assertEqual(
                rec.screen_state,
                "player_loadout_view",
                f"expected screen_state='player_loadout_view', got {rec.screen_state!r}",
            )

    def test_to_dict_produces_json_serializable_output(self):
        """to_dict() must round-trip through json.dumps without error."""
        records = self._get_records()
        for rec in records:
            d = rec.to_dict()
            json_str = json.dumps(d)  # must not raise
            self.assertIsInstance(json_str, str)

    def test_support_frame_ids_is_a_list_in_to_dict(self):
        """support_frame_ids must be a list (not tuple) in to_dict() output."""
        records = self._get_records()
        for rec in records:
            d = rec.to_dict()
            self.assertIsInstance(
                d["support_frame_ids"],
                list,
                f"support_frame_ids should be list, got {type(d['support_frame_ids'])}",
            )


# ---------------------------------------------------------------------------
# Test 3: absent slot yields observability record per slot_key
# ---------------------------------------------------------------------------


class TestAbsentSlotYieldsObservabilityRecordPerSlotKey(unittest.TestCase):
    """When a bundle has degraded observability, all its records inherit that status."""

    def _records_for_bundle_obs(self, obs: str) -> list:
        bundle = _make_bundle_with_observability(obs)
        return _run_evidence_for_bundle(
            bundle,
            open_ev=[_make_open_text_evidence()],
            cv_ev=[_make_closed_vocab_candidate()],
            tab_ev=[_make_tabular_evidence()],
            icon_ev=[_make_icon_evidence()],
        )

    def test_obstructed_bundle_propagates_to_all_records(self):
        """Bundle observability='obstructed' → every record's observability_status='obstructed'."""
        records = self._records_for_bundle_obs("obstructed")
        self.assertGreater(len(records), 0)
        for rec in records:
            self.assertEqual(
                rec.observability_status,
                "obstructed",
                f"expected 'obstructed' for field_key={rec.field_key!r}, "
                f"got {rec.observability_status!r}",
            )

    def test_low_quality_bundle_propagates_to_all_records(self):
        """Bundle observability='low_quality' → every record's observability_status='low_quality'."""
        records = self._records_for_bundle_obs("low_quality")
        self.assertGreater(len(records), 0)
        for rec in records:
            self.assertIn(
                rec.observability_status,
                ("low_quality",),
                f"expected 'low_quality' for field_key={rec.field_key!r}, "
                f"got {rec.observability_status!r}",
            )

    def test_observable_bundle_yields_observable_records(self):
        """Bundle observability='observable' → extractor-level observability is preserved."""
        records = self._records_for_bundle_obs("observable")
        self.assertGreater(len(records), 0)
        for rec in records:
            self.assertEqual(rec.observability_status, "observable")

    def test_missing_slots_when_no_bundles_returns_empty(self):
        """When assemble_loadout_bundles returns no bundles (0 visible rows),
        extract_loadout_evidence returns an empty list rather than raising."""
        records = _run_extract_evidence([])
        self.assertEqual(records, [])


# ---------------------------------------------------------------------------
# Test 4: extractor_version is stamped on every record
# ---------------------------------------------------------------------------


class TestExtractorVersionIsStamped(unittest.TestCase):
    """Every record's extractor_version matches the passed-in value."""

    def test_default_version_is_stamped(self):
        from game_ocr.loadout_evidence import EXTRACTOR_VERSION

        bundle = _make_bundle()
        records = _run_evidence_for_bundle(
            bundle,
            open_ev=[_make_open_text_evidence()],
            cv_ev=[_make_closed_vocab_candidate()],
            tab_ev=[_make_tabular_evidence()],
            icon_ev=[_make_icon_evidence()],
            extractor_version=EXTRACTOR_VERSION,
        )
        self.assertGreater(len(records), 0)
        for rec in records:
            self.assertEqual(
                rec.extractor_version,
                EXTRACTOR_VERSION,
                f"expected {EXTRACTOR_VERSION!r}, got {rec.extractor_version!r}",
            )

    def test_custom_version_is_stamped(self):
        custom_version = "loadout-evidence-test-v99"
        bundle = _make_bundle()
        records = _run_evidence_for_bundle(
            bundle,
            open_ev=[_make_open_text_evidence()],
            cv_ev=[_make_closed_vocab_candidate()],
            tab_ev=[_make_tabular_evidence()],
            icon_ev=[_make_icon_evidence()],
            extractor_version=custom_version,
        )
        self.assertGreater(len(records), 0)
        for rec in records:
            self.assertEqual(
                rec.extractor_version,
                custom_version,
                f"expected {custom_version!r}, got {rec.extractor_version!r}",
            )

    def test_version_propagates_from_extract_loadout_evidence(self):
        """extract_loadout_evidence passes extractor_version through to every record."""
        from game_ocr.loadout_evidence import EXTRACTOR_VERSION

        bundles = [_make_bundle()]
        records = _run_extract_evidence(
            bundles,
            open_ev=[_make_open_text_evidence()],
            extractor_version=EXTRACTOR_VERSION,
        )
        self.assertGreater(len(records), 0)
        for rec in records:
            self.assertEqual(rec.extractor_version, EXTRACTOR_VERSION)


# ---------------------------------------------------------------------------
# Test 5: FieldEvidenceRecord dataclass contract
# ---------------------------------------------------------------------------


class TestFieldEvidenceRecordDataclass(unittest.TestCase):
    """FieldEvidenceRecord is a frozen dataclass with to_dict() serialization."""

    def _make_record(self, **kwargs) -> Any:
        from game_ocr.loadout_evidence import FieldEvidenceRecord
        defaults = dict(
            screen_state="player_loadout_view",
            field_key="gamertag",
            field_family="open_text",
            candidate_value="TestPlayer",
            candidate_rank=0,
            raw_confidence=0.95,
            calibrated_confidence=0.95,
            extractor_family="open_text",
            extractor_version="loadout-evidence-v1",
            observability_status="observable",
            normalization_status="normalized",
        )
        defaults.update(kwargs)
        return FieldEvidenceRecord(**defaults)

    def test_is_frozen(self):
        rec = self._make_record()
        with self.assertRaises((TypeError, AttributeError)):
            rec.field_key = "changed"  # type: ignore[misc]

    def test_to_dict_contains_all_required_keys(self):
        rec = self._make_record()
        d = rec.to_dict()
        for key in REQUIRED_FIELDS:
            self.assertIn(key, d)

    def test_to_dict_support_frame_ids_is_list(self):
        rec = self._make_record(support_frame_ids=(1, 2, 3))
        d = rec.to_dict()
        self.assertEqual(d["support_frame_ids"], [1, 2, 3])
        self.assertIsInstance(d["support_frame_ids"], list)

    def test_optional_fields_default_to_none(self):
        rec = self._make_record()
        self.assertIsNone(rec.screen_instance_key)
        self.assertIsNone(rec.subject_slot_key)
        self.assertIsNone(rec.roi_bbox)
        self.assertIsNone(rec.template_version)
        self.assertIsNone(rec.row_key)
        self.assertIsNone(rec.column_key)
        self.assertIsNone(rec.x_norm)
        self.assertIsNone(rec.y_norm)
        self.assertIsNone(rec.shape_or_icon_class)

    def test_screen_state_constant_is_player_loadout_view(self):
        from game_ocr.loadout_evidence import SCREEN_STATE
        self.assertEqual(SCREEN_STATE, "player_loadout_view")


# ---------------------------------------------------------------------------
# Test 6: per-family adapter field mapping
# ---------------------------------------------------------------------------


class TestFamilyAdapterFieldMapping(unittest.TestCase):
    """Family-specific evidence records are correctly adapted to FieldEvidenceRecord."""

    def test_open_text_adapter_field_family(self):
        bundle = _make_bundle()
        ot_ev = [_make_open_text_evidence("gamertag")]
        records = _run_evidence_for_bundle(bundle, open_ev=ot_ev)
        ot_records = [r for r in records if r.field_family == "open_text"]
        self.assertGreater(len(ot_records), 0)
        for r in ot_records:
            self.assertEqual(r.extractor_family, "open_text")
            self.assertEqual(r.field_family, "open_text")
            self.assertEqual(r.screen_state, "player_loadout_view")

    def test_closed_vocab_adapter_field_family(self):
        bundle = _make_bundle()
        cv_cand = [_make_closed_vocab_candidate("Sniper")]
        records = _run_evidence_for_bundle(bundle, cv_ev=cv_cand)
        cv_records = [r for r in records if r.field_family == "closed_vocab"]
        self.assertGreater(len(cv_records), 0)
        for r in cv_records:
            self.assertEqual(r.extractor_family, "closed_vocab")
            self.assertEqual(r.normalization_status, "normalized")

    def test_tabular_numeric_adapter_sets_row_key_and_column_key(self):
        bundle = _make_bundle()
        tab_ev = [_make_tabular_evidence("speed", "value", 85)]
        records = _run_evidence_for_bundle(bundle, tab_ev=tab_ev)
        tab_records = [r for r in records if r.field_family == "tabular_numeric"]
        self.assertGreater(len(tab_records), 0)
        speed_value = [r for r in tab_records if r.row_key == "speed" and r.column_key == "value"]
        self.assertGreater(len(speed_value), 0)
        rec = speed_value[0]
        self.assertEqual(rec.field_key, "attribute_speed_value")
        self.assertEqual(rec.candidate_value, 85)

    def test_tabular_none_value_has_normalization_failed(self):
        from game_ocr.loadout_extractors.tabular_numeric import NumericCellEvidence
        bundle = _make_bundle()
        tab_ev_missing = [NumericCellEvidence(
            row_key="speed", column_key="value", value=None,
            raw_confidence=0.0, calibrated_confidence=0.0,
            candidate_rank=0, observability="low_quality",
        )]
        records = _run_evidence_for_bundle(bundle, tab_ev=tab_ev_missing)
        missing_recs = [r for r in records if r.row_key == "speed" and r.column_key == "value"]
        self.assertGreater(len(missing_recs), 0)
        self.assertEqual(missing_recs[0].normalization_status, "failed")

    def test_icon_adapter_sets_x_norm_y_norm_and_shape(self):
        bundle = _make_bundle()
        icon_ev = [_make_icon_evidence("x_factor_name_0", "Wheels")]
        records = _run_evidence_for_bundle(bundle, icon_ev=icon_ev)
        icon_records = [r for r in records if r.field_family == "icon"]
        self.assertGreater(len(icon_records), 0)
        wheels_rec = next((r for r in icon_records if r.shape_or_icon_class == "Wheels"), None)
        self.assertIsNotNone(wheels_rec, "Expected a record with shape_or_icon_class='Wheels'")
        self.assertIsNotNone(wheels_rec.x_norm)
        self.assertIsNotNone(wheels_rec.y_norm)
        self.assertEqual(wheels_rec.field_key, "x_factor_name_0")

    def test_open_text_empty_value_has_unnormalized_status(self):
        from game_ocr.loadout_extractors.open_text import OpenTextEvidence
        bundle = _make_bundle()
        ot_ev_empty = [OpenTextEvidence(
            field_key="gamertag",
            value="",
            raw_confidence=0.0,
            calibrated_confidence=0.0,
            candidate_rank=0,
            observability="low_quality",
        )]
        records = _run_evidence_for_bundle(bundle, open_ev=ot_ev_empty)
        gamertag_recs = [r for r in records if r.field_key == "gamertag"]
        self.assertGreater(len(gamertag_recs), 0)
        self.assertEqual(gamertag_recs[0].normalization_status, "unnormalized")

    def test_subject_slot_key_matches_bundle_slot_key(self):
        """Every record's subject_slot_key matches the bundle's slot_key."""
        bundle = _make_bundle("loadout_slot_seg0007_row3", row_ordinal=3)
        records = _run_evidence_for_bundle(
            bundle,
            open_ev=[_make_open_text_evidence()],
            cv_ev=[_make_closed_vocab_candidate()],
            tab_ev=[_make_tabular_evidence()],
            icon_ev=[_make_icon_evidence()],
        )
        self.assertGreater(len(records), 0)
        for rec in records:
            self.assertEqual(
                rec.subject_slot_key,
                "loadout_slot_seg0007_row3",
                f"slot_key mismatch for field_key={rec.field_key!r}",
            )


# ---------------------------------------------------------------------------
# Test 7: FileNotFoundError / ValueError from extract_loadout_evidence
# ---------------------------------------------------------------------------


class TestFrameGlobAndOcrLinesHandling(unittest.TestCase):
    """extract_loadout_evidence uses 5-digit zero-padded PNG names and runs OCR internally."""

    def test_raises_when_no_frames(self):
        """Empty bundle_dir raises ValueError (no PNGs match [0-9]*.png)."""
        import tempfile

        from game_ocr.loadout_evidence import extract_loadout_evidence

        with tempfile.TemporaryDirectory() as tmp:
            bundle_dir = Path(tmp) / "bundle"
            bundle_dir.mkdir()
            # Empty directory — no frames
            with self.assertRaises(ValueError):
                extract_loadout_evidence(bundle_dir, segment_index=0)

    def test_frame_prefix_png_not_matched_by_glob(self):
        """frame_NNNN.png files (old convention) are NOT matched — only [0-9]*.png."""
        import tempfile
        import cv2

        from game_ocr.loadout_evidence import extract_loadout_evidence

        with tempfile.TemporaryDirectory() as tmp:
            bundle_dir = Path(tmp) / "bundle"
            bundle_dir.mkdir()
            # Write a PNG using the OLD "frame_" prefix convention
            img = np.zeros((10, 10, 3), dtype=np.uint8)
            cv2.imwrite(str(bundle_dir / "frame_0000.png"), img)
            # The glob [0-9]*.png should NOT match "frame_0000.png"
            # → no frames found → ValueError
            with self.assertRaises(ValueError):
                extract_loadout_evidence(bundle_dir, segment_index=0)

    def test_runs_rapidocr_when_lines_not_provided(self):
        """When ocr_lines_per_frame is None, RapidOCR is invoked on each PNG.

        Uses a tiny synthetic PNG + mocks RapidOCRBackend to return known
        OCR lines; verifies that assemble_loadout_bundles receives the
        mocked output (not an empty list from a missing JSON file).
        """
        import tempfile
        import cv2

        from game_ocr.loadout_evidence import extract_loadout_evidence
        from game_ocr.ocr import OCRLine

        known_line = OCRLine(text="AutoOCR", confidence=0.99, x1=10.0, y1=10.0, x2=200.0, y2=30.0)

        with tempfile.TemporaryDirectory() as tmp:
            bundle_dir = Path(tmp) / "bundle"
            bundle_dir.mkdir()
            # Write a 5-digit zero-padded PNG (correct Pass-2 convention)
            img = np.zeros((1080, 1920, 3), dtype=np.uint8)
            cv2.imwrite(str(bundle_dir / "00001.png"), img)

            captured_ocr_args: list = []

            def _fake_assemble(frame_paths, *, segment_index, ocr_lines_per_frame):
                captured_ocr_args.append(list(ocr_lines_per_frame))
                return []  # return empty bundles → empty records list

            with patch("game_ocr.loadout_evidence.assemble_loadout_bundles", side_effect=_fake_assemble), \
                 patch("game_ocr.loadout_evidence.RapidOCRBackend") as MockBackend:
                mock_backend_instance = MagicMock()
                mock_backend_instance.read.return_value = [known_line]
                MockBackend.return_value = mock_backend_instance

                records = extract_loadout_evidence(bundle_dir, segment_index=0)

            # Verify RapidOCRBackend was instantiated and .read() called
            MockBackend.assert_called_once_with(use_gpu=False)
            mock_backend_instance.read.assert_called_once()

            # Verify assemble_loadout_bundles received the mocked OCR lines
            self.assertEqual(len(captured_ocr_args), 1)
            lines_passed = captured_ocr_args[0]
            self.assertEqual(len(lines_passed), 1, "expected one frame's lines")
            self.assertEqual(lines_passed[0][0].text, "AutoOCR")

            # No records because assemble returned empty
            self.assertEqual(records, [])


# ---------------------------------------------------------------------------
# Test 8: _ocr_line_from_dict handles both bbox formats
# ---------------------------------------------------------------------------


class TestOcrLineFromDict(unittest.TestCase):
    """_ocr_line_from_dict handles x1/y1/x2/y2 and bbox list formats."""

    def test_x1_format(self):
        from game_ocr.loadout_evidence import _ocr_line_from_dict
        line = _ocr_line_from_dict({
            "text": "hello", "confidence": 0.9,
            "x1": 10.0, "y1": 20.0, "x2": 100.0, "y2": 40.0,
        })
        self.assertEqual(line.text, "hello")
        self.assertAlmostEqual(line.x1, 10.0)
        self.assertAlmostEqual(line.y1, 20.0)
        self.assertAlmostEqual(line.x2, 100.0)
        self.assertAlmostEqual(line.y2, 40.0)

    def test_bbox_list_format(self):
        from game_ocr.loadout_evidence import _ocr_line_from_dict
        line = _ocr_line_from_dict({
            "text": "world", "confidence": 0.85,
            "bbox": [5.0, 15.0, 95.0, 35.0],
        })
        self.assertEqual(line.text, "world")
        self.assertAlmostEqual(line.x1, 5.0)
        self.assertAlmostEqual(line.y2, 35.0)

    def test_empty_dict_returns_default_ocr_line(self):
        from game_ocr.loadout_evidence import _ocr_line_from_dict
        line = _ocr_line_from_dict({})
        self.assertEqual(line.text, "")
        self.assertAlmostEqual(line.confidence, 0.0)


# ---------------------------------------------------------------------------
# Test 9: merge observability logic
# ---------------------------------------------------------------------------


class TestMergeObservability(unittest.TestCase):
    """_merge_observability returns the worse of the two status values."""

    def _merge(self, a, b):
        from game_ocr.loadout_evidence import _merge_observability
        return _merge_observability(a, b)

    def test_observable_plus_observable_is_observable(self):
        self.assertEqual(self._merge("observable", "observable"), "observable")

    def test_obstructed_beats_observable(self):
        self.assertEqual(self._merge("obstructed", "observable"), "obstructed")

    def test_observable_bundle_inherits_field_low_quality(self):
        # field-level low_quality is worse than observable bundle
        self.assertEqual(self._merge("observable", "low_quality"), "low_quality")

    def test_not_observable_from_source_is_worst(self):
        self.assertEqual(
            self._merge("not_observable_from_source", "obstructed"),
            "not_observable_from_source",
        )
        self.assertEqual(
            self._merge("observable", "not_observable_from_source"),
            "not_observable_from_source",
        )


if __name__ == "__main__":
    unittest.main()
