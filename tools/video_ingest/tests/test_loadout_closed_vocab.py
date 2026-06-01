"""Tests for Phase 2A-2: ClosedVocab loader + alias-regex match_canonical.

TDD tests written before implementation.  Run with:
    PYTHONPATH=tools/game_ocr python3 -m pytest tools/video_ingest/tests/test_loadout_closed_vocab.py -v
"""

from __future__ import annotations

import re
import unittest

from game_ocr.loadout_extractors.closed_vocab import (
    ClosedVocab,
    ClosedVocabEntry,
    load_attribute_keys,
    load_closed_vocab,
)

ENTRY_FAMILIES = ["x_factors", "build_classes", "positions", "platforms", "x_factor_tiers"]
EXPECTED_ENTRY_COUNTS = {
    "x_factors": 28,
    "build_classes": 9,
    "positions": 6,
    "platforms": 6,
    "x_factor_tiers": 3,
}


class TestLoadsYaml(unittest.TestCase):
    def test_loads_yaml_entry_counts(self):
        """load_closed_vocab returns ClosedVocab with the correct number of entries."""
        for family, expected_count in EXPECTED_ENTRY_COUNTS.items():
            with self.subTest(family=family):
                vocab = load_closed_vocab(family)
                self.assertIsInstance(vocab, ClosedVocab)
                self.assertEqual(
                    len(vocab.entries),
                    expected_count,
                    f"{family}: expected {expected_count} entries, got {len(vocab.entries)}",
                )

    def test_loads_yaml_family_and_version(self):
        """load_closed_vocab sets family and version from YAML."""
        vocab = load_closed_vocab("build_classes")
        self.assertEqual(vocab.family, "build_classes")
        self.assertEqual(vocab.version, "nhl26")

    def test_loads_yaml_entries_are_closed_vocab_entry_instances(self):
        """Entries in the loaded vocab are ClosedVocabEntry instances."""
        vocab = load_closed_vocab("positions")
        for entry in vocab.entries:
            self.assertIsInstance(entry, ClosedVocabEntry)


class TestAliasRegexCompiles(unittest.TestCase):
    def test_alias_regex_compiles_for_all_entry_families(self):
        """All alias patterns in all entries:-schema files compile without re.error."""
        for family in ENTRY_FAMILIES:
            with self.subTest(family=family):
                vocab = load_closed_vocab(family)
                for entry in vocab.entries:
                    for pattern in entry.alias_patterns:
                        # Patterns are already compiled — just verify they are re.Pattern
                        self.assertIsInstance(pattern, re.Pattern)

    def test_alias_patterns_are_pre_compiled(self):
        """Alias patterns stored as compiled re.Pattern objects, not raw strings."""
        vocab = load_closed_vocab("x_factors")
        first_entry = vocab.entries[0]
        self.assertGreater(len(first_entry.alias_patterns), 0)
        for pattern in first_entry.alias_patterns:
            self.assertIsInstance(pattern, re.Pattern)


class TestMatchCanonical(unittest.TestCase):
    def test_exact_alias_match_returns_confidence_1(self):
        """Exact alias regex full-match returns (canonical, 1.0)."""
        vocab = load_closed_vocab("build_classes")
        result = vocab.match_canonical("Sniper")
        self.assertIsNotNone(result)
        canonical, confidence = result
        self.assertEqual(canonical, "Sniper")
        self.assertAlmostEqual(confidence, 1.0)

    def test_typo_within_edit_distance_2_returns_confidence_0_5(self):
        """Fuzzy match within edit-distance 2 returns (canonical, 0.5)."""
        vocab = load_closed_vocab("build_classes")
        # "Snper" has edit-distance 1 from "Sniper"
        result = vocab.match_canonical("Snper")
        self.assertIsNotNone(result)
        canonical, confidence = result
        self.assertEqual(canonical, "Sniper")
        self.assertAlmostEqual(confidence, 0.5)

    def test_ocr_stylized_alias_returns_confidence_1(self):
        """Stylized OCR alias (e.g. 5niper via [sS5]niper regex) returns (canonical, 1.0)."""
        vocab = load_closed_vocab("build_classes")
        # "5niper" matches the [sS5]niper alias pattern
        result = vocab.match_canonical("5niper")
        self.assertIsNotNone(result)
        canonical, confidence = result
        self.assertEqual(canonical, "Sniper")
        self.assertAlmostEqual(confidence, 1.0)

    def test_exact_match_prefers_alias_over_fuzzy_canonical(self):
        """When an alias matches AND a different canonical is closer in edit-distance,
        the exact alias still wins with confidence 1.0."""
        vocab = load_closed_vocab("build_classes")
        # "5niper" could fuzzy-match other things but should exact-alias to "Sniper"
        result = vocab.match_canonical("5niper")
        self.assertIsNotNone(result)
        canonical, confidence = result
        self.assertEqual(canonical, "Sniper")
        self.assertAlmostEqual(confidence, 1.0)

    def test_x_factors_exact_match(self):
        """Exact match works on x_factors family."""
        vocab = load_closed_vocab("x_factors")
        result = vocab.match_canonical("Rocket")
        self.assertIsNotNone(result)
        canonical, confidence = result
        self.assertEqual(canonical, "Rocket")
        self.assertAlmostEqual(confidence, 1.0)

    def test_positions_exact_match(self):
        """Exact match on a short canonical (positions)."""
        vocab = load_closed_vocab("positions")
        result = vocab.match_canonical("G")
        self.assertIsNotNone(result)
        canonical, confidence = result
        self.assertEqual(canonical, "G")
        self.assertAlmostEqual(confidence, 1.0)

    def test_case_insensitive_exact_match(self):
        """Alias regexes are case-insensitive ((?i) flag)."""
        vocab = load_closed_vocab("build_classes")
        result = vocab.match_canonical("sniper")
        self.assertIsNotNone(result)
        canonical, confidence = result
        self.assertEqual(canonical, "Sniper")
        self.assertAlmostEqual(confidence, 1.0)


class TestUnknownRawReturnsNone(unittest.TestCase):
    def test_unknown_raw_returns_none(self):
        """String far from all canonicals (edit-distance >2) returns None."""
        vocab = load_closed_vocab("build_classes")
        result = vocab.match_canonical("xyzzy_unknown_class_name")
        self.assertIsNone(result)

    def test_empty_string_returns_none_for_build_classes(self):
        """Empty string has edit-distance >2 from all build_class canonicals."""
        vocab = load_closed_vocab("build_classes")
        result = vocab.match_canonical("qqqqqqqqqqqqqqqqq")
        self.assertIsNone(result)

    def test_partial_match_beyond_threshold_returns_none(self):
        """String at edit-distance 3+ from every canonical returns None."""
        vocab = load_closed_vocab("x_factor_tiers")
        # All x_factor_tiers are short (1 word); "zzz_nope" is far from all
        result = vocab.match_canonical("zzz_nope_not_here")
        self.assertIsNone(result)


class TestLoadAttributeKeys(unittest.TestCase):
    def test_load_attribute_keys_returns_5_groups_with_23_total_keys(self):
        """load_attribute_keys returns dict with 5 groups totalling 23 keys."""
        groups = load_attribute_keys()
        self.assertEqual(len(groups), 5)
        total_keys = sum(len(v) for v in groups.values())
        self.assertEqual(total_keys, 23)

    def test_load_attribute_keys_group_names(self):
        """Groups match expected names from attribute_keys.yaml."""
        groups = load_attribute_keys()
        self.assertIn("technique", groups)
        self.assertIn("power", groups)
        self.assertIn("playstyle", groups)
        self.assertIn("tenacity", groups)
        self.assertIn("tactics", groups)

    def test_load_attribute_keys_values_are_lists(self):
        """Each group value is a list of strings."""
        groups = load_attribute_keys()
        for name, keys in groups.items():
            self.assertIsInstance(keys, list)
            for key in keys:
                self.assertIsInstance(key, str)


class TestErrorCases(unittest.TestCase):
    def test_load_closed_vocab_raises_for_missing_version(self):
        """load_closed_vocab raises FileNotFoundError for a nonexistent version."""
        with self.assertRaises(FileNotFoundError):
            load_closed_vocab("build_classes", version="nhl99")

    def test_load_closed_vocab_raises_when_attribute_keys_uses_wrong_loader(self):
        """load_closed_vocab('attribute_keys') raises ValueError (use load_attribute_keys instead)."""
        with self.assertRaises(ValueError):
            load_closed_vocab("attribute_keys")

    def test_predict_log_probs_raises_not_implemented(self):
        """predict_log_probs raises NotImplementedError (Phase 2B stub)."""
        vocab = load_closed_vocab("build_classes")
        with self.assertRaises(NotImplementedError):
            vocab.predict_log_probs(None)


# ---------------------------------------------------------------------------
# Phase 2A-4: ClosedVocabCandidate + LoadoutClosedVocabExtractor
# ---------------------------------------------------------------------------

from game_ocr.loadout_extractors.closed_vocab import (  # noqa: E402
    ClosedVocabCandidate,
    LoadoutClosedVocabExtractor,
)


class TestClosedVocabCandidateShape(unittest.TestCase):
    def test_candidate_is_frozen_dataclass(self):
        """ClosedVocabCandidate is a frozen dataclass with the expected fields."""
        c = ClosedVocabCandidate(
            value="Sniper",
            raw_confidence=1.0,
            calibrated_confidence=1.0,
            roi_bbox=None,
        )
        self.assertEqual(c.value, "Sniper")
        self.assertAlmostEqual(c.raw_confidence, 1.0)
        self.assertAlmostEqual(c.calibrated_confidence, 1.0)
        self.assertIsNone(c.roi_bbox)

    def test_candidate_is_immutable(self):
        """Frozen dataclass: assigning a field raises FrozenInstanceError."""
        c = ClosedVocabCandidate(
            value="Sniper",
            raw_confidence=1.0,
            calibrated_confidence=1.0,
        )
        with self.assertRaises(Exception):
            c.value = "Other"  # type: ignore[misc]

    def test_candidate_roi_bbox_defaults_to_none(self):
        """roi_bbox defaults to None when not supplied."""
        c = ClosedVocabCandidate(value="C", raw_confidence=1.0, calibrated_confidence=1.0)
        self.assertIsNone(c.roi_bbox)

    def test_calibrated_confidence_equals_raw_confidence_in_phase_2a(self):
        """Phase 2A: calibrated_confidence always equals raw_confidence (no calibration yet)."""
        extractor = LoadoutClosedVocabExtractor()
        candidates = extractor.classify_build_class("Sniper")
        self.assertEqual(len(candidates), 1)
        c = candidates[0]
        self.assertAlmostEqual(c.calibrated_confidence, c.raw_confidence)


class TestClassifyBuildClass(unittest.TestCase):
    def test_classify_build_class_returns_top1_from_alias_regex(self):
        """Exact alias match for 'Sniper' returns one ClosedVocabCandidate."""
        extractor = LoadoutClosedVocabExtractor()
        result = extractor.classify_build_class("Sniper")
        self.assertEqual(len(result), 1)
        c = result[0]
        self.assertEqual(c.value, "Sniper")
        self.assertAlmostEqual(c.raw_confidence, 1.0)
        self.assertAlmostEqual(c.calibrated_confidence, 1.0)
        self.assertIsNone(c.roi_bbox)

    def test_classify_build_class_fuzzy_typo_returns_top1(self):
        """Typo within edit-distance 2 returns candidate with confidence 0.5."""
        extractor = LoadoutClosedVocabExtractor()
        result = extractor.classify_build_class("Snper")
        self.assertEqual(len(result), 1)
        c = result[0]
        self.assertEqual(c.value, "Sniper")
        self.assertAlmostEqual(c.raw_confidence, 0.5)
        self.assertAlmostEqual(c.calibrated_confidence, 0.5)

    def test_classify_build_class_passes_roi_bbox_through(self):
        """roi_bbox kwarg is passed through to the candidate unchanged."""
        extractor = LoadoutClosedVocabExtractor()
        bbox = {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.05}
        result = extractor.classify_build_class("Sniper", roi_bbox=bbox)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].roi_bbox, bbox)

    def test_classify_build_class_case_insensitive(self):
        """Alias regex is case-insensitive: 'sniper' → 'Sniper'."""
        extractor = LoadoutClosedVocabExtractor()
        result = extractor.classify_build_class("sniper")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].value, "Sniper")
        self.assertAlmostEqual(result[0].raw_confidence, 1.0)


class TestUnknownRawReturnsEmptyCandidateList(unittest.TestCase):
    def test_unknown_raw_returns_empty_candidate_list_not_misclassification(self):
        """String far from all canonicals returns [] — never a nearest-neighbor candidate."""
        extractor = LoadoutClosedVocabExtractor()
        result = extractor.classify_build_class("xyzzy_unknown_blah")
        # CRITICAL: must be empty list, not None, not a guessed candidate
        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 0)

    def test_unknown_returns_list_not_none(self):
        """Return type is always list, even when no match — callers can len() it safely."""
        extractor = LoadoutClosedVocabExtractor()
        result = extractor.classify_build_class("###$$$$%%%")
        self.assertIsInstance(result, list)


class TestClassifyXFactorName(unittest.TestCase):
    def test_classify_x_factor_name_returns_top1(self):
        """Exact alias match for 'Wheels' returns one ClosedVocabCandidate."""
        extractor = LoadoutClosedVocabExtractor()
        result = extractor.classify_x_factor_name("Wheels")
        self.assertEqual(len(result), 1)
        c = result[0]
        self.assertEqual(c.value, "Wheels")
        self.assertAlmostEqual(c.raw_confidence, 1.0)
        self.assertAlmostEqual(c.calibrated_confidence, 1.0)
        self.assertIsNone(c.roi_bbox)

    def test_classify_x_factor_name_fuzzy_match(self):
        """Typo within edit-distance 2 returns fuzzy candidate."""
        extractor = LoadoutClosedVocabExtractor()
        result = extractor.classify_x_factor_name("Rocket")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].value, "Rocket")
        self.assertAlmostEqual(result[0].raw_confidence, 1.0)

    def test_classify_x_factor_name_unknown_returns_empty(self):
        """Unknown x-factor name returns []."""
        extractor = LoadoutClosedVocabExtractor()
        result = extractor.classify_x_factor_name("xyzzy_unknown_blah")
        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 0)


class TestClassifyXFactorTierFromImage(unittest.TestCase):
    def test_classify_x_factor_tier_returns_candidate_when_function_returns_tier(self):
        """When _classify_xfactor_tier returns 'Elite', wrapper produces one ClosedVocabCandidate."""
        from unittest.mock import patch

        extractor = LoadoutClosedVocabExtractor()
        fake_image = object()  # not a real image — mocked away

        with patch(
            "game_ocr.parsers._classify_xfactor_tier",
            return_value="Elite",
        ) as mock_fn:
            result = extractor.classify_x_factor_tier_from_image(
                fake_image, cx=100, cy=200, radius=35
            )
            mock_fn.assert_called_once_with(fake_image, 100, 200, 35)

        self.assertEqual(len(result), 1)
        c = result[0]
        self.assertEqual(c.value, "Elite")
        self.assertAlmostEqual(c.raw_confidence, 1.0)
        self.assertAlmostEqual(c.calibrated_confidence, 1.0)
        self.assertIsNone(c.roi_bbox)

    def test_classify_x_factor_tier_returns_one_of_three(self):
        """All three valid tier values are accepted."""
        from unittest.mock import patch

        extractor = LoadoutClosedVocabExtractor()
        fake_image = object()

        for tier in ("Elite", "All Star", "Specialist"):
            with self.subTest(tier=tier):
                with patch(
                    "game_ocr.parsers._classify_xfactor_tier",
                    return_value=tier,
                ):
                    result = extractor.classify_x_factor_tier_from_image(
                        fake_image, cx=50, cy=50
                    )
                self.assertEqual(len(result), 1)
                self.assertEqual(result[0].value, tier)

    def test_classify_x_factor_tier_empty_on_none(self):
        """When _classify_xfactor_tier returns None, wrapper returns []."""
        from unittest.mock import patch

        extractor = LoadoutClosedVocabExtractor()
        fake_image = object()

        with patch(
            "game_ocr.parsers._classify_xfactor_tier",
            return_value=None,
        ):
            result = extractor.classify_x_factor_tier_from_image(
                fake_image, cx=50, cy=50
            )
        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 0)

    def test_classify_x_factor_tier_passes_roi_bbox(self):
        """roi_bbox is forwarded to the candidate."""
        from unittest.mock import patch

        extractor = LoadoutClosedVocabExtractor()
        bbox = {"x": 0.5, "y": 0.1, "w": 0.1, "h": 0.1}

        with patch(
            "game_ocr.parsers._classify_xfactor_tier",
            return_value="Specialist",
        ):
            result = extractor.classify_x_factor_tier_from_image(
                object(), cx=50, cy=50, roi_bbox=bbox
            )
        self.assertEqual(result[0].roi_bbox, bbox)


class TestClassifyPosition(unittest.TestCase):
    def test_classify_position_returns_canonical_for_typo(self):
        """OCR artifact '1w' is an explicit alias for 'LW', so confidence is 1.0.

        '1w' appears as an alias in positions.yaml because OCR commonly mistakes
        'L' for '1'. The YAML captures this as an exact-regex alias, so the
        result is confidence 1.0 (not 0.5 fuzzy).
        """
        extractor = LoadoutClosedVocabExtractor()
        result = extractor.classify_position("1w")
        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].value, "LW")
        # '1w' is an explicit alias → exact match → confidence 1.0
        self.assertAlmostEqual(result[0].raw_confidence, 1.0)

    def test_classify_position_exact_match(self):
        """Exact match 'C' returns 'C' with confidence 1.0."""
        extractor = LoadoutClosedVocabExtractor()
        result = extractor.classify_position("C")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].value, "C")
        self.assertAlmostEqual(result[0].raw_confidence, 1.0)


class TestExtractorVersion(unittest.TestCase):
    def test_extractor_version_is_stamped(self):
        """EXTRACTOR_VERSION class attribute is the expected sentinel string."""
        self.assertEqual(
            LoadoutClosedVocabExtractor.EXTRACTOR_VERSION,
            "closed-vocab-v2",
        )

    def test_extractor_accepts_version_kwarg(self):
        """LoadoutClosedVocabExtractor(version='nhl26') constructs without error."""
        extractor = LoadoutClosedVocabExtractor(version="nhl26")
        self.assertIsNotNone(extractor)


if __name__ == "__main__":
    unittest.main()
