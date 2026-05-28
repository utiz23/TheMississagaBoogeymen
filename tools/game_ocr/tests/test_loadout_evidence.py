"""Tests for `loadout_evidence` — focused on the is_cpu contract symmetry.

Loadout-view never observes CPU slots (the operator only navigates to human
subjects), so we emit a deterministic `is_cpu=False` record per bundle to give
the downstream promoter a uniform fieldDecisions surface. These tests verify
that contract on both the subject-view and roster-only emit paths.

We exercise the private per-bundle dispatchers directly with synthetic
`LoadoutSubjectBundle` instances (no real PNGs / image extraction needed):
`cv2.imread` on a non-existent path returns None, and every downstream
extractor handles `image_bgr is None` by short-circuiting — so the identity-
field emission path (which is what we care about) still runs cleanly.
"""

from __future__ import annotations

import unittest
from pathlib import Path

from game_ocr.loadout_bundle import LoadoutSubjectBundle
from game_ocr.loadout_evidence import (
    EXTRACTOR_VERSION,
    SCREEN_STATE,
    FieldEvidenceRecord,
    _evidence_for_roster_only_bundle,
    _evidence_for_subject_bundle,
)
from game_ocr.loadout_extractors.closed_vocab import LoadoutClosedVocabExtractor
from game_ocr.loadout_extractors.icon import LoadoutIconExtractor
from game_ocr.loadout_extractors.open_text import LoadoutOpenTextExtractor
from game_ocr.loadout_extractors.slot_identity import SubjectIdentity
from game_ocr.loadout_extractors.tabular_numeric import LoadoutTabularExtractor


def _identity(**overrides) -> SubjectIdentity:
    """Build a SubjectIdentity with sensible test defaults."""
    defaults = dict(
        gamertag="testtag",
        gamertag_confidence=0.95,
        position="C",
        position_confidence=0.9,
        jersey_number=11,
        jersey_confidence=0.9,
        player_name_full="Test Player",
        player_name_confidence=0.9,
        is_captain=False,
        is_captain_confidence=0.9,
        build_class_raw="PWF",
        build_class_confidence=0.85,
        player_level_raw="P1LVL17",
        player_level_confidence=0.85,
        anchor_y=300,
        observability="observable",
    )
    defaults.update(overrides)
    return SubjectIdentity(**defaults)


def _bundle(
    identity: SubjectIdentity,
    *,
    is_subject_view: bool = True,
    slot_key: str = "loadout_slot_seg0001_subject00",
) -> LoadoutSubjectBundle:
    # best_frame_path intentionally points at a non-existent file so cv2.imread
    # returns None and the right-pane extractors short-circuit cleanly.
    fake_path = Path("/nonexistent/loadout_evidence_test/00001.png")
    return LoadoutSubjectBundle(
        slot_key=slot_key,
        subject_ordinal=0,
        segment_index=1,
        canonical_subject=identity,
        frame_paths=(fake_path,),
        best_frame_path=fake_path,
        best_frame_sharpness_score=100.0,
        all_subject_identities=(identity,),
        support_frame_indices=(0,),
        observability="observable",
        is_subject_view=is_subject_view,
    )


class LoadoutSubjectBundleIsCpuTests(unittest.TestCase):
    def setUp(self) -> None:
        self.closed_vocab = LoadoutClosedVocabExtractor()
        self.tabular = LoadoutTabularExtractor()
        self.icon = LoadoutIconExtractor()
        self.open_text = LoadoutOpenTextExtractor()

    def _subject_records(self) -> list[FieldEvidenceRecord]:
        return _evidence_for_subject_bundle(
            _bundle(_identity()),
            self.closed_vocab,
            self.tabular,
            self.icon,
            self.open_text,
            EXTRACTOR_VERSION,
            best_frame_ocr_lines=[],
        )

    def test_subject_bundle_emits_is_cpu_false(self) -> None:
        records = self._subject_records()
        is_cpu_records = [r for r in records if r.field_key == "is_cpu"]
        self.assertEqual(len(is_cpu_records), 1)
        r = is_cpu_records[0]
        self.assertEqual(r.candidate_value, False)
        self.assertEqual(r.field_family, "icon")
        self.assertEqual(r.observability_status, "observable")
        self.assertEqual(r.normalization_status, "normalized")
        self.assertEqual(r.raw_confidence, 1.0)
        self.assertEqual(r.calibrated_confidence, 1.0)
        self.assertEqual(r.extractor_family, "icon")
        self.assertEqual(r.extractor_version, EXTRACTOR_VERSION)
        self.assertEqual(r.screen_state, SCREEN_STATE)
        self.assertEqual(r.subject_slot_key, "loadout_slot_seg0001_subject00")
        self.assertIsNone(r.shape_or_icon_class)

    def test_subject_bundle_is_cpu_coexists_with_identity_records(self) -> None:
        records = self._subject_records()
        field_keys = {r.field_key for r in records}
        # Identity fields must still be emitted alongside the new is_cpu record.
        for k in ("gamertag", "position", "jersey_number", "is_captain",
                  "persona_raw", "player_level_raw", "build_class_raw", "is_cpu"):
            self.assertIn(k, field_keys, msg=f"missing field {k!r}")


class LoadoutRosterOnlyBundleIsCpuTests(unittest.TestCase):
    def test_roster_only_bundle_emits_is_cpu_false(self) -> None:
        records = _evidence_for_roster_only_bundle(
            _bundle(_identity(), is_subject_view=False, slot_key="loadout_roster_only_x"),
            EXTRACTOR_VERSION,
        )
        is_cpu_records = [r for r in records if r.field_key == "is_cpu"]
        self.assertEqual(len(is_cpu_records), 1)
        r = is_cpu_records[0]
        self.assertEqual(r.candidate_value, False)
        self.assertEqual(r.field_family, "icon")
        self.assertEqual(r.observability_status, "observable")
        self.assertEqual(r.normalization_status, "normalized")
        self.assertEqual(r.raw_confidence, 1.0)
        self.assertEqual(r.subject_slot_key, "loadout_roster_only_x")
        self.assertIsNone(r.shape_or_icon_class)

    def test_roster_only_bundle_is_cpu_coexists_with_identity_records(self) -> None:
        records = _evidence_for_roster_only_bundle(
            _bundle(_identity(), is_subject_view=False),
            EXTRACTOR_VERSION,
        )
        field_keys = {r.field_key for r in records}
        for k in ("gamertag", "position", "jersey_number", "is_captain",
                  "persona_raw", "player_level_raw", "is_cpu"):
            self.assertIn(k, field_keys, msg=f"missing field {k!r}")
        # Roster-only bundles deliberately skip build_class_raw.
        self.assertNotIn("build_class_raw", field_keys)


if __name__ == "__main__":
    unittest.main()
