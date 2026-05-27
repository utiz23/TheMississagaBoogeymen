"""Unit tests for the v2 regex priors loader."""

from __future__ import annotations

import unittest
from pathlib import Path
from textwrap import dedent

from game_ocr.regex_priors import (
    DEFAULT_ROI_NAME,
    RegexPriorsConfig,
    RegexPriorsConfigError,
    load_regex_priors,
)
from game_ocr import regex_priors as rp_mod


REPO_ROOT = Path(__file__).resolve().parents[3]


def _write_yaml(tmp_dir: Path, version: str, body: str) -> Path:
    """Write a temp YAML and point CONFIGS_DIR at the tmp dir for the test."""
    cfg = tmp_dir / f"{version}_regex_priors.yaml"
    cfg.write_text(body)
    rp_mod.CONFIGS_DIR = tmp_dir
    return cfg


class LoadRegexPriorsNhl26IntegrationTest(unittest.TestCase):
    """Validates the real nhl26 priors file ships in a parseable state."""

    def setUp(self) -> None:
        # Reset CONFIGS_DIR in case a prior test mutated it.
        rp_mod.CONFIGS_DIR = (
            REPO_ROOT / "tools" / "game_ocr" / "game_ocr" / "configs" / "state_machine"
        )

    def test_loads_without_error(self) -> None:
        cfg = load_regex_priors("nhl26")
        self.assertIsInstance(cfg, RegexPriorsConfig)
        # YAML carries 7 classes per Phase-A spec.
        self.assertGreaterEqual(len(cfg.priors_by_state), 5)
        # Flat ordering is non-empty and consistent.
        self.assertGreater(cfg.n_priors(), 0)
        self.assertEqual(
            cfg.n_priors(),
            sum(len(v) for v in cfg.priors_by_state.values()),
        )

    def test_required_phase_a_classes_present(self) -> None:
        cfg = load_regex_priors("nhl26")
        for state in (
            "menu_club_management",
            "player_loadout_landing",
            "menu_world_of_chel",
        ):
            self.assertIn(state, cfg.priors_by_state)
            self.assertGreater(len(cfg.priors_by_state[state]), 0)

    def test_required_rois_present(self) -> None:
        cfg = load_regex_priors("nhl26")
        self.assertIn("top_bar", cfg.rois)
        self.assertIn("side_strip", cfg.rois)

    def test_regexes_compile_and_can_match_expected_text(self) -> None:
        cfg = load_regex_priors("nhl26")
        # The world_of_chel title regex should fire on the expected anchor text.
        wo_priors = cfg.priors_by_state["menu_world_of_chel"]
        wo_titles = [p for p in wo_priors if p.name == "title"]
        self.assertEqual(len(wo_titles), 1)
        self.assertTrue(wo_titles[0].matches("WORLD OF CHEL"))
        self.assertTrue(wo_titles[0].matches("world of chel"))  # case insensitive
        self.assertFalse(wo_titles[0].matches("nothing relevant"))


class LoadRegexPriorsValidationTest(unittest.TestCase):
    """Negative-path tests against synthetic YAML."""

    def setUp(self) -> None:
        # We point CONFIGS_DIR at a per-test temp dir.
        import tempfile
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_dir = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()
        # Reset to the real configs dir so other tests see canonical state.
        rp_mod.CONFIGS_DIR = (
            REPO_ROOT / "tools" / "game_ocr" / "game_ocr" / "configs" / "state_machine"
        )

    def test_missing_file_raises_file_not_found(self) -> None:
        rp_mod.CONFIGS_DIR = self.tmp_dir  # empty dir
        with self.assertRaises(FileNotFoundError):
            load_regex_priors("nonexistent_version")

    def test_missing_version_key_raises(self) -> None:
        _write_yaml(self.tmp_dir, "t", dedent("""
            roi_definitions:
              top_bar: { bbox: [0, 0, 1920, 200] }
            menu_world_of_chel:
              - { name: title, pattern: '\\bworld\\b' }
        """))
        with self.assertRaisesRegex(RegexPriorsConfigError, "version"):
            load_regex_priors("t")

    def test_missing_default_roi_raises(self) -> None:
        # roi_definitions without top_bar (the default) must fail loudly.
        _write_yaml(self.tmp_dir, "t", dedent("""
            version: "v0"
            roi_definitions:
              side_strip: { bbox: [0, 200, 220, 880] }
            menu_world_of_chel:
              - { name: title, pattern: '\\bworld\\b', roi: side_strip }
        """))
        with self.assertRaisesRegex(RegexPriorsConfigError, DEFAULT_ROI_NAME):
            load_regex_priors("t")

    def test_unknown_roi_reference_raises(self) -> None:
        _write_yaml(self.tmp_dir, "t", dedent("""
            version: "v0"
            roi_definitions:
              top_bar: { bbox: [0, 0, 1920, 200] }
            menu_world_of_chel:
              - { name: title, pattern: '\\bworld\\b', roi: nonexistent_roi }
        """))
        with self.assertRaisesRegex(RegexPriorsConfigError, "nonexistent_roi"):
            load_regex_priors("t")

    def test_invalid_regex_raises(self) -> None:
        _write_yaml(self.tmp_dir, "t", dedent("""
            version: "v0"
            roi_definitions:
              top_bar: { bbox: [0, 0, 1920, 200] }
            menu_world_of_chel:
              - { name: bad, pattern: '[unclosed' }
        """))
        with self.assertRaisesRegex(RegexPriorsConfigError, "not a valid regex"):
            load_regex_priors("t")

    def test_duplicate_prior_name_within_state_raises(self) -> None:
        _write_yaml(self.tmp_dir, "t", dedent("""
            version: "v0"
            roi_definitions:
              top_bar: { bbox: [0, 0, 1920, 200] }
            menu_world_of_chel:
              - { name: title, pattern: '\\bworld\\b' }
              - { name: title, pattern: '\\bchel\\b' }
        """))
        with self.assertRaisesRegex(RegexPriorsConfigError, "duplicate prior name"):
            load_regex_priors("t")

    def test_empty_priors_raises(self) -> None:
        _write_yaml(self.tmp_dir, "t", dedent("""
            version: "v0"
            roi_definitions:
              top_bar: { bbox: [0, 0, 1920, 200] }
        """))
        with self.assertRaisesRegex(RegexPriorsConfigError, "no per-state priors"):
            load_regex_priors("t")

    def test_bbox_validation(self) -> None:
        _write_yaml(self.tmp_dir, "t", dedent("""
            version: "v0"
            roi_definitions:
              top_bar: { bbox: [0, 0, 0, 200] }
            menu_world_of_chel:
              - { name: title, pattern: '\\bworld\\b' }
        """))
        with self.assertRaisesRegex(RegexPriorsConfigError, "positive"):
            load_regex_priors("t")

    def test_roi_omitted_defaults_to_top_bar(self) -> None:
        _write_yaml(self.tmp_dir, "t", dedent("""
            version: "v0"
            roi_definitions:
              top_bar: { bbox: [0, 0, 1920, 200] }
              side_strip: { bbox: [0, 200, 220, 880] }
            menu_world_of_chel:
              - { name: title, pattern: '\\bworld\\b' }
        """))
        cfg = load_regex_priors("t")
        prior = cfg.priors_by_state["menu_world_of_chel"][0]
        self.assertEqual(prior.roi, DEFAULT_ROI_NAME)


class FlatOrderingStabilityTest(unittest.TestCase):
    def test_flat_ordering_matches_yaml_insertion_order(self) -> None:
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            _write_yaml(tmp_dir, "t", dedent("""
                version: "v0"
                roi_definitions:
                  top_bar: { bbox: [0, 0, 1920, 200] }
                state_a:
                  - { name: a1, pattern: 'aaa' }
                  - { name: a2, pattern: 'AAA' }
                state_b:
                  - { name: b1, pattern: 'bbb' }
            """))
            cfg = load_regex_priors("t")
            names_in_order = [p.name for p in cfg.priors_flat]
            self.assertEqual(names_in_order, ["a1", "a2", "b1"])
        rp_mod.CONFIGS_DIR = (
            REPO_ROOT / "tools" / "game_ocr" / "game_ocr" / "configs" / "state_machine"
        )


if __name__ == "__main__":
    unittest.main()
