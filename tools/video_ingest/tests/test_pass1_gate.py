"""WS2 Pass-1 pre-OCR gate policy: gate() decision, config parsing, and the
cache-key fingerprint. Pure logic — no OCR, no video."""

from __future__ import annotations

import unittest

import numpy as np

from video_ingest.visual_prefilter.pass1_policy import (
    GateConfig,
    gate,
    gate_cache_fingerprint,
    parse_gate_config,
    pass1_emissions_bias,
    resolve_effective_gate,
)
from video_ingest.visual_prefilter.signals import VisualSignals


def _signals(*, brightness: float, log_blur: float, edge_density: float) -> VisualSignals:
    return VisualSignals(
        hsv_histogram=np.zeros(48, dtype=np.float64),
        brightness=brightness,
        log_blur=log_blur,
        edge_density=edge_density,
        dhash_thumbnail=np.zeros((8, 9), dtype=np.uint8),
    )


# Black-frame launch signature (matches nhl26.yaml).
_BLACK_FRAME = GateConfig(
    enabled=True,
    require_all=True,
    max_brightness=0.06,
    max_edge_density=0.005,
    max_log_blur=2.0,
)


class TestGate(unittest.TestCase):
    def test_disabled_always_ocr(self) -> None:
        cfg = GateConfig(enabled=False, max_edge_density=0.005)
        s = _signals(brightness=0.0, log_blur=0.0, edge_density=0.0)
        self.assertEqual(gate(s, cfg), "ocr")

    def test_no_thresholds_always_ocr(self) -> None:
        cfg = GateConfig(enabled=True)  # enabled but no criteria configured
        s = _signals(brightness=0.0, log_blur=0.0, edge_density=0.0)
        self.assertEqual(gate(s, cfg), "ocr")

    def test_black_frame_skips(self) -> None:
        s = _signals(brightness=0.02, log_blur=0.5, edge_density=0.001)
        self.assertEqual(gate(s, _BLACK_FRAME), "skip")

    def test_bright_text_screen_ocrs_even_if_dark_quiet(self) -> None:
        # High edge_density (text/UI chrome) must force OCR under AND-logic,
        # even though brightness and blur would individually qualify.
        s = _signals(brightness=0.02, log_blur=0.5, edge_density=0.15)
        self.assertEqual(gate(s, _BLACK_FRAME), "ocr")

    def test_boundary_equality_skips(self) -> None:
        # Thresholds are upper bounds; signal == threshold qualifies (<=).
        s = _signals(brightness=0.06, log_blur=2.0, edge_density=0.005)
        self.assertEqual(gate(s, _BLACK_FRAME), "skip")

    def test_require_all_false_is_or(self) -> None:
        cfg = GateConfig(
            enabled=True,
            require_all=False,
            max_brightness=0.06,
            max_edge_density=0.005,
        )
        # Only one criterion satisfied → OR-mode skips.
        s = _signals(brightness=0.02, log_blur=99.0, edge_density=0.9)
        self.assertEqual(gate(s, cfg), "skip")


class TestParseGateConfig(unittest.TestCase):
    def test_absent_block_returns_none(self) -> None:
        self.assertIsNone(parse_gate_config({"sample_fps": 1}))

    def test_parses_full_block(self) -> None:
        cfg = parse_gate_config(
            {
                "pre_ocr_gate": {
                    "enabled": True,
                    "require_all": True,
                    "max_brightness": 0.06,
                    "max_edge_density": 0.005,
                    "max_log_blur": 2.0,
                }
            }
        )
        assert cfg is not None
        self.assertTrue(cfg.enabled)
        self.assertTrue(cfg.require_all)
        self.assertEqual(cfg.max_brightness, 0.06)
        self.assertEqual(cfg.max_edge_density, 0.005)
        self.assertEqual(cfg.max_log_blur, 2.0)

    def test_defaults_when_keys_missing(self) -> None:
        cfg = parse_gate_config({"pre_ocr_gate": {"max_edge_density": 0.01}})
        assert cfg is not None
        self.assertFalse(cfg.enabled)  # default-off if not stated
        self.assertTrue(cfg.require_all)  # conservative default
        self.assertIsNone(cfg.max_brightness)
        self.assertEqual(cfg.max_edge_density, 0.01)


class TestGateCacheFingerprint(unittest.TestCase):
    def test_none_and_disabled_yield_none(self) -> None:
        self.assertIsNone(gate_cache_fingerprint(None))
        self.assertIsNone(
            gate_cache_fingerprint(GateConfig(enabled=False, max_edge_density=0.005))
        )

    def test_enabled_yields_string(self) -> None:
        fp = gate_cache_fingerprint(_BLACK_FRAME)
        self.assertIsInstance(fp, str)
        assert fp is not None
        self.assertIn("gate:", fp)

    def test_different_thresholds_differ(self) -> None:
        a = gate_cache_fingerprint(_BLACK_FRAME)
        b = gate_cache_fingerprint(
            GateConfig(
                enabled=True,
                require_all=True,
                max_brightness=0.06,
                max_edge_density=0.02,  # widened
                max_log_blur=2.0,
            )
        )
        self.assertNotEqual(a, b)


class TestResolveEffectiveGate(unittest.TestCase):
    def test_yaml_only_passthrough(self) -> None:
        eff = resolve_effective_gate(_BLACK_FRAME, cli_enabled=None, env_disabled=False)
        self.assertIs(eff, _BLACK_FRAME)

    def test_none_yaml_stays_none(self) -> None:
        self.assertIsNone(
            resolve_effective_gate(None, cli_enabled=None, env_disabled=False)
        )

    def test_cli_can_force_off(self) -> None:
        eff = resolve_effective_gate(_BLACK_FRAME, cli_enabled=False, env_disabled=False)
        assert eff is not None
        self.assertFalse(eff.enabled)
        # thresholds preserved
        self.assertEqual(eff.max_edge_density, 0.005)

    def test_cli_can_force_on_over_disabled_yaml(self) -> None:
        disabled = GateConfig(enabled=False, max_edge_density=0.005)
        eff = resolve_effective_gate(disabled, cli_enabled=True, env_disabled=False)
        assert eff is not None
        self.assertTrue(eff.enabled)

    def test_env_disable_wins_over_cli_on(self) -> None:
        # env-disable > CLI: CLI forces on, env forces it back off.
        eff = resolve_effective_gate(
            _BLACK_FRAME, cli_enabled=True, env_disabled=True
        )
        assert eff is not None
        self.assertFalse(eff.enabled)

    def test_env_disable_on_none_stays_none(self) -> None:
        self.assertIsNone(
            resolve_effective_gate(None, cli_enabled=None, env_disabled=True)
        )


class TestPass1EmissionsBias(unittest.TestCase):
    def test_bias_row_shape_and_values(self) -> None:
        row = pass1_emissions_bias(reject_floor=-20.0, unk_idx=2, n_states=5)
        self.assertEqual(row.shape, (5,))
        for i in range(5):
            if i == 2:
                self.assertEqual(row[i], -19.0)
            else:
                self.assertEqual(row[i], -20.0)


if __name__ == "__main__":
    unittest.main()
