"""Tests for the new subject-bundle assembler: assemble_loadout_subject_bundles.

Phase 2A architectural fix: one LoadoutSubjectBundle per distinct subject
(player the operator navigated to), deduped by fuzzy gamertag match.

Run with:
    PYTHONPATH=tools/game_ocr python3 -m pytest tools/video_ingest/tests/test_loadout_subject_bundle.py -v
"""

from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np

from game_ocr.loadout_extractors.slot_identity import SubjectIdentity


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_subject_identity(
    gamertag: str = "TestPlayer",
    position: str | None = "C",
    jersey_number: int | None = None,
    observability: str = "observable",
    anchor_y: int | None = 300,
) -> SubjectIdentity:
    return SubjectIdentity(
        gamertag=gamertag,
        gamertag_confidence=0.9,
        position=position,
        position_confidence=0.9 if position else None,
        jersey_number=jersey_number,
        jersey_confidence=0.9 if jersey_number is not None else None,
        anchor_y=anchor_y,
        observability=observability,
    )


def _fake_paths(n: int) -> list[Path]:
    return [Path(f"/fake/{i:05d}.png") for i in range(1, n + 1)]


def _dummy_bgr_image():
    return np.zeros((10, 10, 3), dtype=np.uint8)


class _StubRecord:
    """FrameRecord-like stub for bundler tests (image + frame_index only)."""

    __slots__ = ("image", "frame_index")

    def __init__(self, image, frame_index: int):
        self.image = image
        self.frame_index = frame_index


def _fake_records(n: int, *, image=None) -> list[_StubRecord]:
    """``n`` records carrying the same dummy BGR image and dense indices 0..n-1."""
    img = image if image is not None else _dummy_bgr_image()
    return [_StubRecord(image=img, frame_index=i) for i in range(n)]


# ---------------------------------------------------------------------------
# Test: basic bundle creation
# ---------------------------------------------------------------------------


class TestAssembleSubjectBundlesBasic(unittest.TestCase):
    """assemble_loadout_subject_bundles creates one bundle per distinct subject."""

    def test_single_subject_across_multiple_frames_creates_one_bundle(self):
        from game_ocr.loadout_bundle import assemble_loadout_subject_bundles

        records = _fake_records(3)
        subject = _make_subject_identity("StickMenace")
        dummy_img = _dummy_bgr_image()

        with patch("game_ocr.loadout_bundle.extract_subject_identity", return_value=subject), \
             patch("game_ocr.loadout_bundle.blur_score", return_value=50.0):

            bundles = assemble_loadout_subject_bundles(
                records, segment_index=2, ocr_lines_per_frame=[[], [], []]
            )

        self.assertEqual(len(bundles), 1)
        self.assertEqual(len(bundles[0].support_frame_indices), 3)

    def test_three_distinct_subjects_creates_three_bundles(self):
        from game_ocr.loadout_bundle import assemble_loadout_subject_bundles

        records = _fake_records(3)
        # Use clearly distinct gamertags (not sharing 6-char prefix)
        subjects = [
            _make_subject_identity("StickMenace"),
            _make_subject_identity("HenryTheBobJr"),
            _make_subject_identity("JoeyFlopfish"),
        ]
        dummy_img = _dummy_bgr_image()
        subject_iter = iter(subjects)

        with patch("game_ocr.loadout_bundle.extract_subject_identity",
                   side_effect=lambda *a, **kw: next(subject_iter)), \
             patch("game_ocr.loadout_bundle.blur_score", return_value=50.0):

            bundles = assemble_loadout_subject_bundles(
                records, segment_index=2, ocr_lines_per_frame=[[], [], []]
            )

        self.assertEqual(len(bundles), 3)

    def test_returns_empty_when_no_subjects_identified(self):
        from game_ocr.loadout_bundle import assemble_loadout_subject_bundles

        records = _fake_records(3)
        dummy_img = _dummy_bgr_image()

        with patch("game_ocr.loadout_bundle.extract_subject_identity", return_value=None), \
             patch("game_ocr.loadout_bundle.blur_score", return_value=50.0):

            bundles = assemble_loadout_subject_bundles(
                records, segment_index=0, ocr_lines_per_frame=[[], [], []]
            )

        self.assertEqual(bundles, [])

    def test_skips_records_where_image_is_none(self):
        """Phase 3b: assembler skips records whose image is None (the
        equivalent of cv2.imread → None on the legacy path). The skipped
        record's frame_index does not appear in any bundle."""
        from game_ocr.loadout_bundle import assemble_loadout_subject_bundles

        subject = _make_subject_identity("PlayerA")
        # Frame 1 is unreadable (image=None).
        records = [
            _StubRecord(image=_dummy_bgr_image(), frame_index=0),
            _StubRecord(image=None, frame_index=1),
            _StubRecord(image=_dummy_bgr_image(), frame_index=2),
        ]

        with patch("game_ocr.loadout_bundle.extract_subject_identity", return_value=subject), \
             patch("game_ocr.loadout_bundle.blur_score", return_value=50.0):

            bundles = assemble_loadout_subject_bundles(
                records, segment_index=0, ocr_lines_per_frame=[[], [], []]
            )

        self.assertEqual(len(bundles), 1)
        # Only 2 frames contributed (frame_index 1 was unreadable)
        self.assertEqual(bundles[0].support_frame_indices, (0, 2))


# ---------------------------------------------------------------------------
# Test: slot_key format
# ---------------------------------------------------------------------------


class TestSubjectBundleSlotKeyFormat(unittest.TestCase):
    """slot_key must be 'loadout_slot_seg{NNNN}_subject{NN}'."""

    def test_slot_key_format(self):
        import re
        from game_ocr.loadout_bundle import assemble_loadout_subject_bundles

        records = _fake_records(2)
        subjects = [
            _make_subject_identity("PlayerA"),
            _make_subject_identity("PlayerB"),
        ]
        dummy_img = _dummy_bgr_image()
        subject_iter = iter(subjects)

        with patch("game_ocr.loadout_bundle.extract_subject_identity",
                   side_effect=lambda *a, **kw: next(subject_iter)), \
             patch("game_ocr.loadout_bundle.blur_score", return_value=50.0):

            bundles = assemble_loadout_subject_bundles(
                records, segment_index=5, ocr_lines_per_frame=[[], []]
            )

        pattern = re.compile(r"^loadout_slot_seg\d{4}_subject\d{2}$")
        for b in bundles:
            self.assertRegex(b.slot_key, pattern)

    def test_slot_key_segment_index_padded(self):
        from game_ocr.loadout_bundle import assemble_loadout_subject_bundles

        records = _fake_records(1)
        dummy_img = _dummy_bgr_image()

        with patch("game_ocr.loadout_bundle.extract_subject_identity",
                   return_value=_make_subject_identity("PlayerA")), \
             patch("game_ocr.loadout_bundle.blur_score", return_value=50.0):

            bundles = assemble_loadout_subject_bundles(
                records, segment_index=7, ocr_lines_per_frame=[[]]
            )

        self.assertEqual(len(bundles), 1)
        self.assertTrue(bundles[0].slot_key.startswith("loadout_slot_seg0007_"))


# ---------------------------------------------------------------------------
# Test: fuzzy gamertag deduplication
# ---------------------------------------------------------------------------


class TestBundleDedupesByFuzzyGamertag(unittest.TestCase):
    """Two subjects with fuzzy-matching gamertags should be merged into one bundle."""

    def test_exact_same_gamertag_same_bundle(self):
        from game_ocr.loadout_bundle import assemble_loadout_subject_bundles

        records = _fake_records(2)
        # Same gamertag across 2 frames → 1 bundle
        subjects = [
            _make_subject_identity("StickMenace"),
            _make_subject_identity("StickMenace"),
        ]
        dummy_img = _dummy_bgr_image()
        subject_iter = iter(subjects)

        with patch("game_ocr.loadout_bundle.extract_subject_identity",
                   side_effect=lambda *a, **kw: next(subject_iter)), \
             patch("game_ocr.loadout_bundle.blur_score", return_value=50.0):

            bundles = assemble_loadout_subject_bundles(
                records, segment_index=0, ocr_lines_per_frame=[[], []]
            )

        self.assertEqual(len(bundles), 1)
        self.assertEqual(len(bundles[0].support_frame_indices), 2)

    def test_ocr_typo_in_gamertag_same_bundle(self):
        """'StickMenace' and 'StickMenacc' (1-char OCR typo) → same bundle."""
        from game_ocr.loadout_bundle import assemble_loadout_subject_bundles

        records = _fake_records(2)
        subjects = [
            _make_subject_identity("StickMenace"),  # clean frame
            _make_subject_identity("StickMenacc"),  # OCR typo on 'e' → 'c'
        ]
        dummy_img = _dummy_bgr_image()
        subject_iter = iter(subjects)

        with patch("game_ocr.loadout_bundle.extract_subject_identity",
                   side_effect=lambda *a, **kw: next(subject_iter)), \
             patch("game_ocr.loadout_bundle.blur_score", return_value=50.0):

            bundles = assemble_loadout_subject_bundles(
                records, segment_index=0, ocr_lines_per_frame=[[], []]
            )

        # Should be 1 bundle (fuzzy match)
        self.assertEqual(len(bundles), 1)

    def test_clearly_different_gamertags_separate_bundles(self):
        """'StickMenace' and 'JoeyFlopfish' → separate bundles."""
        from game_ocr.loadout_bundle import assemble_loadout_subject_bundles

        records = _fake_records(2)
        subjects = [
            _make_subject_identity("StickMenace"),
            _make_subject_identity("JoeyFlopfish"),
        ]
        dummy_img = _dummy_bgr_image()
        subject_iter = iter(subjects)

        with patch("game_ocr.loadout_bundle.extract_subject_identity",
                   side_effect=lambda *a, **kw: next(subject_iter)), \
             patch("game_ocr.loadout_bundle.blur_score", return_value=50.0):

            bundles = assemble_loadout_subject_bundles(
                records, segment_index=0, ocr_lines_per_frame=[[], []]
            )

        self.assertEqual(len(bundles), 2)


# ---------------------------------------------------------------------------
# Test: best frame selection
# ---------------------------------------------------------------------------


class TestBestFrameSelection(unittest.TestCase):
    """best_frame_path is the frame with the highest sharpness score."""

    def test_picks_sharpest_frame(self):
        from game_ocr.loadout_bundle import assemble_loadout_subject_bundles

        records = _fake_records(3)
        subject = _make_subject_identity("PlayerA")
        sharpness_values = [10.0, 50.0, 25.0]  # frame 1 (index 1) is sharpest
        call_count = [0]

        def mock_blur(img):
            idx = call_count[0]
            call_count[0] += 1
            return sharpness_values[idx]

        dummy_img = _dummy_bgr_image()

        with patch("game_ocr.loadout_bundle.extract_subject_identity", return_value=subject), \
             patch("game_ocr.loadout_bundle.blur_score", side_effect=mock_blur):

            bundles = assemble_loadout_subject_bundles(
                records, segment_index=0, ocr_lines_per_frame=[[], [], []]
            )

        self.assertEqual(len(bundles), 1)
        bundle = bundles[0]
        # frame_index 1 (the middle record) had the highest blur_score.
        self.assertEqual(bundle.best_frame_index, 1)
        self.assertAlmostEqual(bundle.best_frame_sharpness_score, 50.0)


# ---------------------------------------------------------------------------
# Test: canonical subject merging
# ---------------------------------------------------------------------------


class TestCanonicalSubjectMerging(unittest.TestCase):
    """The canonical_subject is merged from all contributing frames."""

    def test_canonical_subject_gamertag_from_highest_confidence(self):
        from game_ocr.loadout_bundle import assemble_loadout_subject_bundles

        records = _fake_records(2)
        # Frame 0: low confidence gamertag
        s0 = SubjectIdentity(gamertag="StickMenace", gamertag_confidence=0.6, position="RW",
                             position_confidence=0.9, observability="observable")
        # Frame 1: high confidence gamertag
        s1 = SubjectIdentity(gamertag="StickMenace", gamertag_confidence=0.95, position="RW",
                             position_confidence=0.9, observability="observable")
        dummy_img = _dummy_bgr_image()
        subject_iter = iter([s0, s1])

        with patch("game_ocr.loadout_bundle.extract_subject_identity",
                   side_effect=lambda *a, **kw: next(subject_iter)), \
             patch("game_ocr.loadout_bundle.blur_score", return_value=50.0):

            bundles = assemble_loadout_subject_bundles(
                records, segment_index=0, ocr_lines_per_frame=[[], []]
            )

        self.assertEqual(len(bundles), 1)
        # Canonical gamertag confidence should be 0.95 (from frame 1)
        self.assertAlmostEqual(bundles[0].canonical_subject.gamertag_confidence, 0.95)

    def test_position_from_contributing_frame_with_highest_position_confidence(self):
        from game_ocr.loadout_bundle import assemble_loadout_subject_bundles

        records = _fake_records(2)
        s0 = SubjectIdentity(gamertag="PlayerA", gamertag_confidence=0.9,
                             position="RW", position_confidence=0.6, observability="observable")
        s1 = SubjectIdentity(gamertag="PlayerA", gamertag_confidence=0.9,
                             position="RW", position_confidence=0.95, observability="observable")
        dummy_img = _dummy_bgr_image()
        subject_iter = iter([s0, s1])

        with patch("game_ocr.loadout_bundle.extract_subject_identity",
                   side_effect=lambda *a, **kw: next(subject_iter)), \
             patch("game_ocr.loadout_bundle.blur_score", return_value=50.0):

            bundles = assemble_loadout_subject_bundles(
                records, segment_index=0, ocr_lines_per_frame=[[], []]
            )

        self.assertEqual(len(bundles), 1)
        self.assertAlmostEqual(bundles[0].canonical_subject.position_confidence, 0.95)


# ---------------------------------------------------------------------------
# Test: support_frame_indices
# ---------------------------------------------------------------------------


class TestSupportFrameIndices(unittest.TestCase):
    """support_frame_indices carry the global frame index of each contributing frame."""

    def test_support_frame_indices_match_frame_positions(self):
        from game_ocr.loadout_bundle import assemble_loadout_subject_bundles

        records = _fake_records(4)
        # Use clearly distinct gamertags (not sharing 6-char prefix)
        subject_A = _make_subject_identity("StickMenace")
        subject_B = _make_subject_identity("HenryTheBobJr")
        # Frame 0 = A, Frame 1 = B, Frame 2 = A, Frame 3 = B
        subjects = [subject_A, subject_B, subject_A, subject_B]
        dummy_img = _dummy_bgr_image()
        subject_iter = iter(subjects)

        with patch("game_ocr.loadout_bundle.extract_subject_identity",
                   side_effect=lambda *a, **kw: next(subject_iter)), \
             patch("game_ocr.loadout_bundle.blur_score", return_value=50.0):

            bundles = assemble_loadout_subject_bundles(
                records, segment_index=0, ocr_lines_per_frame=[[], [], [], []]
            )

        self.assertEqual(len(bundles), 2)
        bundle_A = next(b for b in bundles if b.canonical_subject.gamertag == "StickMenace")
        bundle_B = next(b for b in bundles if b.canonical_subject.gamertag == "HenryTheBobJr")

        self.assertEqual(set(bundle_A.support_frame_indices), {0, 2})
        self.assertEqual(set(bundle_B.support_frame_indices), {1, 3})


# ---------------------------------------------------------------------------
# Test: input validation
# ---------------------------------------------------------------------------


class TestSubjectBundleInputValidation(unittest.TestCase):
    """assemble_loadout_subject_bundles raises ValueError on bad inputs."""

    def test_raises_when_ocr_lines_not_provided(self):
        from game_ocr.loadout_bundle import assemble_loadout_subject_bundles

        with self.assertRaises(ValueError):
            assemble_loadout_subject_bundles(_fake_paths(2), segment_index=0)

    def test_raises_when_ocr_lines_length_mismatch(self):
        from game_ocr.loadout_bundle import assemble_loadout_subject_bundles

        with self.assertRaises(ValueError):
            assemble_loadout_subject_bundles(
                _fake_paths(3),
                segment_index=0,
                ocr_lines_per_frame=[[], []],  # only 2 for 3 frames
            )


# ---------------------------------------------------------------------------
# Test: subject_ordinal ordering
# ---------------------------------------------------------------------------


class TestSubjectOrdinalOrdering(unittest.TestCase):
    """subject_ordinal reflects the order of first appearance across frames."""

    def test_first_seen_subject_has_ordinal_0(self):
        from game_ocr.loadout_bundle import assemble_loadout_subject_bundles

        records = _fake_records(3)
        # Use clearly distinct gamertags (not sharing 6-char prefix)
        subjects = [
            _make_subject_identity("StickMenace"),   # frame 0 — first seen
            _make_subject_identity("HenryTheBobJr"), # frame 1 — second seen
            _make_subject_identity("JoeyFlopfish"),  # frame 2 — third seen
        ]
        dummy_img = _dummy_bgr_image()
        subject_iter = iter(subjects)

        with patch("game_ocr.loadout_bundle.extract_subject_identity",
                   side_effect=lambda *a, **kw: next(subject_iter)), \
             patch("game_ocr.loadout_bundle.blur_score", return_value=50.0):

            bundles = assemble_loadout_subject_bundles(
                records, segment_index=0, ocr_lines_per_frame=[[], [], []]
            )

        ordinals = [b.subject_ordinal for b in bundles]
        self.assertEqual(ordinals, [0, 1, 2])

        gamertags_by_ordinal = {b.subject_ordinal: b.canonical_subject.gamertag for b in bundles}
        self.assertEqual(gamertags_by_ordinal[0], "StickMenace")
        self.assertEqual(gamertags_by_ordinal[1], "HenryTheBobJr")
        self.assertEqual(gamertags_by_ordinal[2], "JoeyFlopfish")


# ---------------------------------------------------------------------------
# Test: LoadoutSubjectBundle dataclass contract
# ---------------------------------------------------------------------------


class TestLoadoutSubjectBundleDataclass(unittest.TestCase):
    """LoadoutSubjectBundle is a frozen dataclass with expected fields."""

    def test_bundle_is_frozen(self):
        from game_ocr.loadout_bundle import LoadoutSubjectBundle

        si = _make_subject_identity()
        bundle = LoadoutSubjectBundle(
            slot_key="loadout_slot_seg0000_subject00",
            subject_ordinal=0,
            segment_index=0,
            canonical_subject=si,
            frame_paths=(Path("/fake/00001.png"),),
            best_frame_path=Path("/fake/00001.png"),
            best_frame_sharpness_score=50.0,
            all_subject_identities=(si,),
            support_frame_indices=(0,),
        )
        with self.assertRaises((TypeError, AttributeError)):
            bundle.subject_ordinal = 99  # type: ignore[misc]

    def test_bundle_default_observability_is_observable(self):
        from game_ocr.loadout_bundle import LoadoutSubjectBundle

        si = _make_subject_identity()
        bundle = LoadoutSubjectBundle(
            slot_key="loadout_slot_seg0000_subject00",
            subject_ordinal=0,
            segment_index=0,
            canonical_subject=si,
            frame_paths=(Path("/fake/00001.png"),),
            best_frame_path=Path("/fake/00001.png"),
            best_frame_sharpness_score=50.0,
            all_subject_identities=(si,),
            support_frame_indices=(0,),
        )
        self.assertEqual(bundle.observability, "observable")


# ---------------------------------------------------------------------------
# Test: is_subject_view flag on bundles
# ---------------------------------------------------------------------------


class TestIsSubjectViewFlag(unittest.TestCase):
    """LoadoutSubjectBundle.is_subject_view distinguishes subject-view from roster-only."""

    def test_bundle_is_subject_view_when_extract_subject_identity_produces_subject(self):
        """Bundles produced by extract_subject_identity have is_subject_view=True."""
        from game_ocr.loadout_bundle import assemble_loadout_subject_bundles

        records = _fake_records(2)
        subject = _make_subject_identity("StickMenace")
        dummy_img = _dummy_bgr_image()

        with patch("game_ocr.loadout_bundle.extract_subject_identity", return_value=subject), \
             patch("game_ocr.loadout_bundle.extract_roster_only_identities", return_value=[]), \
             patch("game_ocr.loadout_bundle.blur_score", return_value=50.0), \
             patch("game_ocr.loadout_bundle._extract_anchor_lines", return_value=[]), \
             patch("game_ocr.loadout_bundle._bucket_anchors", return_value=[]):

            bundles = assemble_loadout_subject_bundles(
                records, segment_index=0, ocr_lines_per_frame=[[], []]
            )

        self.assertEqual(len(bundles), 1)
        self.assertTrue(bundles[0].is_subject_view)

    def test_bundle_is_roster_only_when_player_never_selected(self):
        """Roster-only bundles (extract_roster_only_identities result, no subject) have is_subject_view=False."""
        from game_ocr.loadout_bundle import assemble_loadout_subject_bundles

        records = _fake_records(2)
        roster_player = _make_subject_identity("JoeyFlopfish")
        dummy_img = _dummy_bgr_image()

        with patch("game_ocr.loadout_bundle.extract_subject_identity", return_value=None), \
             patch("game_ocr.loadout_bundle.extract_roster_only_identities", return_value=[roster_player]), \
             patch("game_ocr.loadout_bundle.blur_score", return_value=50.0), \
             patch("game_ocr.loadout_bundle._extract_anchor_lines", return_value=[]), \
             patch("game_ocr.loadout_bundle._bucket_anchors", return_value=[]):

            bundles = assemble_loadout_subject_bundles(
                records, segment_index=0, ocr_lines_per_frame=[[], []]
            )

        roster_only_bundles = [b for b in bundles if not b.is_subject_view]
        self.assertTrue(len(roster_only_bundles) >= 1)
        self.assertEqual(roster_only_bundles[0].canonical_subject.gamertag, "JoeyFlopfish")

    def test_default_bundle_is_subject_view_true(self):
        """Default value of is_subject_view on LoadoutSubjectBundle is True."""
        from game_ocr.loadout_bundle import LoadoutSubjectBundle

        si = _make_subject_identity()
        bundle = LoadoutSubjectBundle(
            slot_key="loadout_slot_seg0000_subject00",
            subject_ordinal=0,
            segment_index=0,
            canonical_subject=si,
            frame_paths=(Path("/fake/00001.png"),),
            best_frame_path=Path("/fake/00001.png"),
            best_frame_sharpness_score=50.0,
            all_subject_identities=(si,),
            support_frame_indices=(0,),
        )
        self.assertTrue(bundle.is_subject_view)


# ---------------------------------------------------------------------------
# Test: Phase 3b additive contract — best_frame_image / best_frame_index
# ---------------------------------------------------------------------------


class TestBundleCarriesBestFrameImage(unittest.TestCase):
    """Phase 3b C1: assembled bundles carry the best frame's BGR pixels
    and its global index, alongside the legacy path fields.

    The image is the same ndarray the assembler used to score sharpness
    (no second imread). best_frame_index matches the support_frame_indices
    entry whose blur_score was highest.
    """

    def test_best_frame_image_is_populated_and_index_matches(self):
        from game_ocr.loadout_bundle import assemble_loadout_subject_bundles

        subject = _make_subject_identity("StickMenace")
        dummy_img = _dummy_bgr_image()
        records = _fake_records(3, image=dummy_img)

        # Frame 1 is the sharpest (frame_index 1 in the input).
        blur_scores_iter = iter([10.0, 99.0, 20.0])

        with patch("game_ocr.loadout_bundle.extract_subject_identity",
                   return_value=subject), \
             patch("game_ocr.loadout_bundle.blur_score",
                   side_effect=lambda img: next(blur_scores_iter)):

            bundles = assemble_loadout_subject_bundles(
                records, segment_index=2, ocr_lines_per_frame=[[], [], []]
            )

        self.assertEqual(len(bundles), 1)
        b = bundles[0]
        self.assertIsNotNone(b.best_frame_image)
        # Same ndarray the assembler scored — not a re-read.
        self.assertIs(b.best_frame_image, dummy_img)
        # Index matches the support_frame_indices entry with the max sharpness.
        self.assertEqual(b.best_frame_index, b.support_frame_indices[1])
        # Without a frame_paths kwarg, the legacy path fields are empty / None.
        self.assertEqual(b.frame_paths, ())
        self.assertIsNone(b.best_frame_path)

    def test_legacy_frame_paths_kwarg_populates_path_fields(self):
        """Phase 3b back-compat: when ``frame_paths`` is supplied, bundles
        emit the legacy path fields keyed by ``record.frame_index``.

        Removed in C5; until then this keeps the disk-based extractor path
        producing the same bundles."""
        from game_ocr.loadout_bundle import assemble_loadout_subject_bundles

        subject = _make_subject_identity("StickMenace")
        records = _fake_records(3)
        paths = _fake_paths(3)

        blur_scores_iter = iter([10.0, 99.0, 20.0])

        with patch("game_ocr.loadout_bundle.extract_subject_identity",
                   return_value=subject), \
             patch("game_ocr.loadout_bundle.blur_score",
                   side_effect=lambda img: next(blur_scores_iter)):

            bundles = assemble_loadout_subject_bundles(
                records,
                segment_index=2,
                ocr_lines_per_frame=[[], [], []],
                frame_paths=paths,
            )

        self.assertEqual(len(bundles), 1)
        b = bundles[0]
        self.assertEqual(b.frame_paths, tuple(paths))
        self.assertEqual(b.best_frame_path, paths[1])


if __name__ == "__main__":
    unittest.main()
