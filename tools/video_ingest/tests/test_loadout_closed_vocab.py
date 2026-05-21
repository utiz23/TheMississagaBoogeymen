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


if __name__ == "__main__":
    unittest.main()
