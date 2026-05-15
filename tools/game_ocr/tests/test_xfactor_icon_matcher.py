"""Unit tests for the X-Factor icon-glyph matcher.

Ground truth comes from visual inspection of the V2-benchmark
match-250 loadout captures at `research/OCR-SS/Pre-Game-Loadouts/`.
Each capture has 3 X-Factor slots; the canonical-name truth was read
directly off the text labels visible in the source PNGs.
"""

from __future__ import annotations

import os
import unittest
from pathlib import Path

import cv2

from game_ocr.parsers import _LOADOUT_XFACTOR_ICON_CENTROIDS
from game_ocr.xfactor_icon_matcher import canonical_names, match_icon


REPO_ROOT = Path(__file__).resolve().parents[3]
LOADOUT_FIXTURES = REPO_ROOT / "research" / "OCR-SS" / "Pre-Game-Loadouts"

# (filename, [(canonical_name, slot_index), ...]) — slot order is left→right.
# Only fixtures with verified-from-source X-Factor text labels are listed.
GROUND_TRUTH: list[tuple[str, list[str]]] = [
    # silkyjoker85 — SNIPER. Labels visible: QUICK RELEASE / ONE T / PRESSURE+
    ("vlcsnap-2026-05-10-01h49m12s913.png", ["Quick_Release", "One_T", "PressurePlus"]),
    # HenryTheBobJr — PUCK MOVING DEFENSEMAN. Labels: WARRIOR / WHEELS / QUICK RELEASE
    ("vlcsnap-2026-05-10-01h49m17s363.png", ["Warrior", "Wheels", "Quick_Release"]),
    # JoeyFlopfish — PUCK MOVING DEFENSEMAN. Labels: ELITE EDGES / TAPE TO TAPE / STICK 'EM UP
    ("vlcsnap-2026-05-10-01h49m20s173.png", ["Elite_Edges", "Tape_to_Tape", "Stick_Em_Up"]),
]

# Gate the e2e tests behind an env var so CI (no fixtures) doesn't fail.
RUN_E2E = os.environ.get("RUN_ICON_MATCHER_E2E", "1") == "1"


class TestCanonicalNames(unittest.TestCase):
    def test_loads_28_distinct_names(self) -> None:
        names = canonical_names()
        self.assertEqual(len(names), 28)
        # Expected canonical set — spot-check a few
        for must_have in ["Tape_to_Tape", "PressurePlus", "Quick_Release", "Wheels", "One_T"]:
            self.assertIn(must_have, names)


@unittest.skipUnless(RUN_E2E, "set RUN_ICON_MATCHER_E2E=1 to enable")
class TestMatchIcon(unittest.TestCase):
    def test_v2_benchmark_canonical_names(self) -> None:
        misses: list[str] = []
        for fname, expected_names in GROUND_TRUTH:
            path = LOADOUT_FIXTURES / fname
            self.assertTrue(path.exists(), f"missing fixture: {path}")
            img = cv2.imread(str(path))
            self.assertIsNotNone(img, f"cv2.imread failed: {path}")
            for slot_idx, (cx, cy) in enumerate(_LOADOUT_XFACTOR_ICON_CENTROIDS):
                result = match_icon(img, cx, cy)
                if result is None:
                    misses.append(f"{fname} slot{slot_idx}: returned None, expected {expected_names[slot_idx]}")
                    continue
                if result.canonical_name != expected_names[slot_idx]:
                    misses.append(
                        f"{fname} slot{slot_idx}: got {result.canonical_name} "
                        f"({result.confidence:.2f}), expected {expected_names[slot_idx]}"
                    )
        self.assertEqual(
            misses, [],
            "icon-matcher regression on V2-benchmark fixtures:\n" + "\n".join(misses),
        )

    def test_returns_none_on_blank_region(self) -> None:
        """A 0-saturation gray region should not produce a confident match."""
        import numpy as np
        blank = np.zeros((1080, 1920, 3), dtype=np.uint8)
        blank[:] = 128
        result = match_icon(blank, 500, 340)
        # No template should clear the 0.35 threshold for a flat gray ROI.
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
