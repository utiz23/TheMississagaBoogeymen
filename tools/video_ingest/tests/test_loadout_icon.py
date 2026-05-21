"""Tests for Phase 2A-6: LoadoutIconExtractor + IconEvidence.

TDD tests — written before full implementation, verified green after.

Run with:
    PYTHONPATH=tools/game_ocr python3 -m pytest tools/video_ingest/tests/test_loadout_icon.py -v
"""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

import numpy as np

# ---------------------------------------------------------------------------
# Module under test
# ---------------------------------------------------------------------------
from game_ocr.loadout_extractors.icon import (
    IconEvidence,
    LoadoutIconExtractor,
)

# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------

_IMAGE_W = 1920
_IMAGE_H = 1080
_THREE_CENTERS = [(500, 340), (1000, 340), (1500, 340)]


def _blank_image(h: int = _IMAGE_H, w: int = _IMAGE_W) -> np.ndarray:
    return np.zeros((h, w, 3), dtype=np.uint8)


def _make_icon_match(name: str = "Wheels", tier: str = "Elite", confidence: float = 0.72):
    """Return an object shaped like xfactor_icon_matcher.IconMatch."""
    m = MagicMock()
    m.canonical_name = name
    m.tier = tier
    m.confidence = confidence
    return m


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestLoadoutIconExtractorNameCandidates(unittest.TestCase):
    """X-Factor name candidates — template-match path."""

    def test_extract_xfactor_icons_returns_3_candidates_per_slot(self):
        """Given 3 icon centers, emits exactly 3 name-family records (one per slot)."""
        extractor = LoadoutIconExtractor()
        image = _blank_image()

        with (
            patch(
                "game_ocr.loadout_extractors.icon.match_icon",
                return_value=_make_icon_match("Wheels"),
            ),
            patch(
                "game_ocr.loadout_extractors.icon._classify_xfactor_tier",
                return_value=None,  # suppress tier records so we can count cleanly
            ),
        ):
            results = extractor.extract_xfactor_icons(
                image,
                slot_anchor_y=0,
                icon_centers=_THREE_CENTERS,
            )

        name_records = [r for r in results if r.field_key.startswith("x_factor_name_")]
        self.assertEqual(len(name_records), 3)

        # field_key covers all three slot indices.
        keys = {r.field_key for r in name_records}
        self.assertEqual(keys, {"x_factor_name_0", "x_factor_name_1", "x_factor_name_2"})

    def test_each_candidate_carries_shape_or_icon_class_field(self):
        """Every emitted record has a non-None shape_or_icon_class (possibly empty string)."""
        extractor = LoadoutIconExtractor()
        image = _blank_image()

        # Mix: slot 0 matches, slot 1 matches, slot 2 returns None (low_quality).
        side_effects = [
            _make_icon_match("Wheels"),
            _make_icon_match("One_T"),
            None,
        ]

        with (
            patch(
                "game_ocr.loadout_extractors.icon.match_icon",
                side_effect=side_effects,
            ),
            patch(
                "game_ocr.loadout_extractors.icon._classify_xfactor_tier",
                return_value=None,
            ),
        ):
            results = extractor.extract_xfactor_icons(
                image,
                slot_anchor_y=0,
                icon_centers=_THREE_CENTERS,
            )

        for record in results:
            self.assertIsNotNone(record.shape_or_icon_class)
            # Observability must be set to a known value.
            self.assertIn(
                record.observability,
                ("observable", "low_quality", "not_observable_from_source"),
            )

        # The None match must yield an empty string (not crash) and low_quality.
        name_2 = next(r for r in results if r.field_key == "x_factor_name_2")
        self.assertEqual(name_2.shape_or_icon_class, "")
        self.assertEqual(name_2.observability, "low_quality")

    def test_match_below_threshold_returns_empty_with_observability_low_quality(self):
        """When match_icon returns None, record has observability='low_quality' and raw_confidence=0."""
        extractor = LoadoutIconExtractor()
        image = _blank_image()

        with (
            patch(
                "game_ocr.loadout_extractors.icon.match_icon",
                return_value=None,
            ),
            patch(
                "game_ocr.loadout_extractors.icon._classify_xfactor_tier",
                return_value=None,
            ),
        ):
            results = extractor.extract_xfactor_icons(
                image,
                slot_anchor_y=0,
                icon_centers=_THREE_CENTERS,
            )

        name_records = [r for r in results if r.field_key.startswith("x_factor_name_")]
        self.assertEqual(len(name_records), 3)

        for record in name_records:
            self.assertEqual(record.observability, "low_quality")
            self.assertEqual(record.raw_confidence, 0.0)
            self.assertEqual(record.shape_or_icon_class, "")
            self.assertEqual(record.field_family, "icon")


class TestLoadoutIconExtractorTierCandidates(unittest.TestCase):
    """Tier-color candidates — HSV sampler path."""

    def test_tier_color_is_separate_candidate_with_x_norm_y_norm(self):
        """Tier records have field_key 'x_factor_tier_<idx>', are separate from name records,
        and carry normalised coordinates."""
        extractor = LoadoutIconExtractor()
        image = _blank_image()

        with (
            patch(
                "game_ocr.loadout_extractors.icon.match_icon",
                return_value=_make_icon_match("Wheels"),
            ),
            patch(
                "game_ocr.loadout_extractors.icon._classify_xfactor_tier",
                return_value="Elite",
            ),
        ):
            results = extractor.extract_xfactor_icons(
                image,
                slot_anchor_y=0,
                icon_centers=_THREE_CENTERS,
            )

        tier_records = [r for r in results if r.field_key.startswith("x_factor_tier_")]
        self.assertEqual(len(tier_records), 3)

        tier_keys = {r.field_key for r in tier_records}
        self.assertEqual(tier_keys, {"x_factor_tier_0", "x_factor_tier_1", "x_factor_tier_2"})

        for record in tier_records:
            # Normalised coordinates must be in [0, 1].
            self.assertGreaterEqual(record.x_norm, 0.0)
            self.assertLessEqual(record.x_norm, 1.0)
            self.assertGreaterEqual(record.y_norm, 0.0)
            self.assertLessEqual(record.y_norm, 1.0)

            # Tier records are separate from name records.
            self.assertNotIn(record.field_key, {"x_factor_name_0", "x_factor_name_1", "x_factor_name_2"})

            # Tier records carry the tier label and max confidence.
            self.assertEqual(record.field_family, "icon")
            self.assertIn(record.shape_or_icon_class, ("Elite", "All Star", "Specialist"))
            self.assertEqual(record.raw_confidence, 1.0)
            self.assertEqual(record.calibrated_confidence, 1.0)

    def test_tier_records_not_emitted_when_hsv_returns_none(self):
        """When _classify_xfactor_tier returns None, no tier record is emitted for that slot."""
        extractor = LoadoutIconExtractor()
        image = _blank_image()

        with (
            patch(
                "game_ocr.loadout_extractors.icon.match_icon",
                return_value=_make_icon_match("Wheels"),
            ),
            patch(
                "game_ocr.loadout_extractors.icon._classify_xfactor_tier",
                return_value=None,
            ),
        ):
            results = extractor.extract_xfactor_icons(
                image,
                slot_anchor_y=0,
                icon_centers=_THREE_CENTERS,
            )

        tier_records = [r for r in results if r.field_key.startswith("x_factor_tier_")]
        self.assertEqual(len(tier_records), 0)

    def test_total_records_when_all_match(self):
        """When all 3 slots match icon + tier, total = 6 records."""
        extractor = LoadoutIconExtractor()
        image = _blank_image()

        with (
            patch(
                "game_ocr.loadout_extractors.icon.match_icon",
                return_value=_make_icon_match("Wheels"),
            ),
            patch(
                "game_ocr.loadout_extractors.icon._classify_xfactor_tier",
                return_value="All Star",
            ),
        ):
            results = extractor.extract_xfactor_icons(
                image,
                slot_anchor_y=0,
                icon_centers=_THREE_CENTERS,
            )

        self.assertEqual(len(results), 6)


class TestLoadoutIconExtractorFieldShape(unittest.TestCase):
    """Structural / contract tests for IconEvidence fields."""

    def test_field_family_is_always_icon(self):
        """Every emitted record has field_family == 'icon'."""
        extractor = LoadoutIconExtractor()
        image = _blank_image()

        with (
            patch(
                "game_ocr.loadout_extractors.icon.match_icon",
                return_value=_make_icon_match("Wheels"),
            ),
            patch(
                "game_ocr.loadout_extractors.icon._classify_xfactor_tier",
                return_value="Specialist",
            ),
        ):
            results = extractor.extract_xfactor_icons(
                image,
                slot_anchor_y=0,
                icon_centers=_THREE_CENTERS,
            )

        for record in results:
            self.assertEqual(record.field_family, "icon")

    def test_normalised_coords_respect_image_dimensions(self):
        """x_norm and y_norm are derived from the actual image dimensions."""
        extractor = LoadoutIconExtractor()
        # Use a non-standard image size to verify the normalisation math.
        w, h = 800, 600
        image = np.zeros((h, w, 3), dtype=np.uint8)
        centers = [(100, 150)]

        with (
            patch(
                "game_ocr.loadout_extractors.icon.match_icon",
                return_value=_make_icon_match("Wheels"),
            ),
            patch(
                "game_ocr.loadout_extractors.icon._classify_xfactor_tier",
                return_value="Elite",
            ),
        ):
            results = extractor.extract_xfactor_icons(
                image,
                slot_anchor_y=0,
                icon_centers=centers,
            )

        name_rec = next(r for r in results if r.field_key == "x_factor_name_0")
        self.assertAlmostEqual(name_rec.x_norm, 100 / w, places=5)
        self.assertAlmostEqual(name_rec.y_norm, 150 / h, places=5)

    def test_slot_anchor_y_shifts_y_norm(self):
        """slot_anchor_y shifts the cy used for normalisation."""
        extractor = LoadoutIconExtractor()
        image = _blank_image()
        centers = [(500, 340)]
        anchor = 50

        with (
            patch(
                "game_ocr.loadout_extractors.icon.match_icon",
                return_value=_make_icon_match("Wheels"),
            ),
            patch(
                "game_ocr.loadout_extractors.icon._classify_xfactor_tier",
                return_value=None,
            ),
        ):
            results = extractor.extract_xfactor_icons(
                image,
                slot_anchor_y=anchor,
                icon_centers=centers,
            )

        name_rec = next(r for r in results if r.field_key == "x_factor_name_0")
        expected_y_norm = (340 + anchor) / _IMAGE_H
        self.assertAlmostEqual(name_rec.y_norm, expected_y_norm, places=5)

    def test_empty_image_returns_empty_list(self):
        """Passing an empty image returns an empty list without raising."""
        extractor = LoadoutIconExtractor()
        empty = np.array([])

        results = extractor.extract_xfactor_icons(
            empty,
            slot_anchor_y=0,
            icon_centers=_THREE_CENTERS,
        )

        self.assertEqual(results, [])

    def test_roi_bbox_is_dict_with_xywh_keys(self):
        """roi_bbox is a dict with 'x', 'y', 'w', 'h' keys."""
        extractor = LoadoutIconExtractor()
        image = _blank_image()

        with (
            patch(
                "game_ocr.loadout_extractors.icon.match_icon",
                return_value=_make_icon_match("Wheels"),
            ),
            patch(
                "game_ocr.loadout_extractors.icon._classify_xfactor_tier",
                return_value=None,
            ),
        ):
            results = extractor.extract_xfactor_icons(
                image,
                slot_anchor_y=0,
                icon_centers=_THREE_CENTERS,
            )

        for record in results:
            self.assertIsNotNone(record.roi_bbox)
            self.assertIn("x", record.roi_bbox)
            self.assertIn("y", record.roi_bbox)
            self.assertIn("w", record.roi_bbox)
            self.assertIn("h", record.roi_bbox)


class TestIconEvidenceDataclass(unittest.TestCase):
    """Unit tests for the IconEvidence dataclass itself."""

    def test_frozen(self):
        """IconEvidence is immutable (frozen dataclass)."""
        ev = IconEvidence(
            field_family="icon",
            field_key="x_factor_name_0",
            shape_or_icon_class="Wheels",
            raw_confidence=0.72,
            calibrated_confidence=0.72,
            x_norm=0.26,
            y_norm=0.31,
        )
        with self.assertRaises(Exception):
            ev.raw_confidence = 0.9  # type: ignore[misc]

    def test_default_observability(self):
        """Default observability is 'observable'."""
        ev = IconEvidence(
            field_family="icon",
            field_key="x_factor_tier_1",
            shape_or_icon_class="Elite",
            raw_confidence=1.0,
            calibrated_confidence=1.0,
            x_norm=0.5,
            y_norm=0.31,
        )
        self.assertEqual(ev.observability, "observable")


if __name__ == "__main__":
    unittest.main()
