from __future__ import annotations

import importlib.util
from pathlib import Path
import sys


MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "scripts"
    / "extract_xfactor_effects_spike.py"
)
SPEC = importlib.util.spec_from_file_location("extract_xfactor_effects_spike", MODULE_PATH)
assert SPEC is not None
assert SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def test_parse_value_with_duration() -> None:
    parsed = MODULE.parse_value("+3%(0.50sec)")
    assert parsed.numeric_value == 3.0
    assert parsed.unit == "percent"
    assert parsed.duration_text == "0.50sec"


def test_parse_value_normalizes_fullwidth_parenthesis() -> None:
    parsed = MODULE.parse_value("+3%（0.50sec)")
    assert parsed.numeric_value == 3.0
    assert parsed.unit == "percent"
    assert parsed.duration_text == "0.50sec"


def test_parse_value_negative_percent() -> None:
    parsed = MODULE.parse_value("-75%")
    assert parsed.numeric_value == -75.0
    assert parsed.unit == "percent"
    assert parsed.duration_text is None


def test_canonicalize_name_handles_collapsed_spacing() -> None:
    assert MODULE.canonicalize_name("BACKHANDBEAUTY") == "Backhand_Beauty"
    assert MODULE.canonicalize_name("SECONDWIND") == "Second_Wind"


def test_detect_row_headings_filters_body_text() -> None:
    class StubLine:
        def __init__(self, text: str, y1: float, y2: float) -> None:
            self.text = text
            self.y1 = y1
            self.y2 = y2
            self.x1 = 0.0

    class StubOcr:
        def read(self, _image):  # type: ignore[no-untyped-def]
            return [
                StubLine("X-FACTORS", 10, 20),
                StubLine("WHEELS", 76, 108),
                StubLine("Turn on the jets", 122, 146),
                StubLine("SECOND WIND", 512, 541),
            ]

    rows = MODULE.detect_row_headings(StubOcr(), MODULE.np.zeros((1080, 1920, 3), dtype=MODULE.np.uint8))
    assert [row["rawName"] for row in rows] == ["WHEELS", "SECOND WIND"]


def test_merge_visible_rows_unions_sources_and_prefers_more_complete_description() -> None:
    merged = MODULE.merge_visible_rows(
        [
            {
                "rows": [
                    {
                        "category": "Skating/Strength",
                        "canonicalName": "Wheels",
                        "screenshot": "a.png",
                        "rawName": "WHEELS",
                        "descriptionLines": ["one"],
                        "tiers": {"Specialist": {"metrics": []}, "All Star": {"metrics": []}, "Elite": {"metrics": []}},
                    }
                ]
            },
            {
                "rows": [
                    {
                        "category": "Skating/Strength",
                        "canonicalName": "Wheels",
                        "screenshot": "b.png",
                        "rawName": "WHEELS",
                        "descriptionLines": ["one", "two"],
                        "tiers": {"Specialist": {"metrics": []}, "All Star": {"metrics": []}, "Elite": {"metrics": []}},
                    }
                ]
            },
        ]
    )
    assert len(merged) == 1
    assert merged[0]["sourceScreenshots"] == ["a.png", "b.png"]
    assert merged[0]["descriptionLines"] == ["one", "two"]


def test_repair_metric_signs_applies_consensus_to_missing_sign() -> None:
    row = {
        "tiers": {
            "Specialist": {"metrics": [{"raw": "-10%(1sec)", "numericValue": -10.0}]},
            "All Star": {"metrics": [{"raw": "20%(3sec)", "numericValue": 20.0}]},
            "Elite": {"metrics": [{"raw": "-30%(5sec)", "numericValue": -30.0}]},
        }
    }
    MODULE.repair_metric_signs(row)
    repaired = row["tiers"]["All Star"]["metrics"][0]
    assert repaired["raw"] == "-20%(3sec)"
    assert repaired["numericValue"] == -20.0


def test_repair_semantic_negative_signs_marks_drain_and_opponent_speed() -> None:
    row = {
        "tiers": {
            "Specialist": {
                "metrics": [
                    {"metric": "OPPONENTACCELERATION", "raw": "10%(1sec)", "numericValue": 10.0},
                    {"metric": "ENERGYDRAIN(PRESSUREMETER)", "raw": "15%", "numericValue": 15.0},
                ]
            },
            "All Star": {"metrics": []},
            "Elite": {"metrics": []},
        }
    }
    MODULE.repair_semantic_negative_signs(row)
    first = row["tiers"]["Specialist"]["metrics"][0]
    second = row["tiers"]["Specialist"]["metrics"][1]
    assert first["raw"] == "-10%(1sec)"
    assert first["numericValue"] == -10.0
    assert second["raw"] == "-15%"
    assert second["numericValue"] == -15.0
