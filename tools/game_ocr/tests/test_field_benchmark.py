"""Per-field benchmark regression gate (the accuracy contract).

Scores the committed match-250 loadout golden (the parity-locked current-main
extractor output) against the hand-labeled V2 ground truth and asserts each
field clears its floor. Floors START at the current measured baseline and are
ratcheted UP as the extractor improves (Phases C/D/E/F). They must never be
lowered to make a regression pass.

This is fast + deterministic (no OCR, no DB) — it reads the golden JSON — so it
runs in the normal suite. The heavy `--from-extractor` / `--from-db` paths are
exercised separately.
"""

import json
from pathlib import Path

import pytest

from game_ocr.benchmark.report import score_match

REPO = Path(__file__).resolve().parents[3]
LABELS = REPO / "tools/game_ocr/calibration/extras/loadout/benchmark/labels/250.json"
GOLDEN = (
    REPO
    / "tools/game_ocr/calibration/extras/loadout/fixtures"
    / "fixture_match250_full_lobby/expected_loadout_evidence.json"
)

# Per-field minimum accuracy. Baseline measured 2026-06-14 against the v3 golden.
# Gaps left at 0.0 are KNOWN and tracked by later phases:
#   - player_level / handedness: not carried in loadout evidence (lobby-evidence
#     merge / extractor extension — Phases B/E).
#   - captain: undetected by the glyph heuristic (Phase D ★ specialist).
FIELD_ACCURACY_FLOORS = {
    "gamertag": 0.90,
    "persona": 0.80,
    "player_number": 1.00,
    "position": 1.00,
    "build_class_canonical": 0.80,
    "x_factor_name": 0.80,
    "x_factor_tier": 0.80,
    "attribute_value": 0.72,
    "player_level": 0.0,
    "handedness": 0.0,
}
CAPTAIN_FALSE_POSITIVES_MAX = 0  # the FP-LW regression must never reappear


@pytest.fixture(scope="module")
def report():
    labels = json.loads(LABELS.read_text(encoding="utf-8"))
    records = json.loads(GOLDEN.read_text(encoding="utf-8"))
    return score_match(labels, records)


def test_all_truth_subjects_align(report):
    # Every labeled subject must align to a predicted slot; a drop here means
    # gamertag extraction or alignment regressed and the field numbers are moot.
    assert report["subjects"]["matched"] == report["subjects"]["truth"]


@pytest.mark.parametrize("field,floor", sorted(FIELD_ACCURACY_FLOORS.items()))
def test_field_accuracy_meets_floor(report, field, floor):
    acc = report["fields"][field]["accuracy"]
    assert acc >= floor, f"{field} accuracy {acc:.3f} fell below floor {floor:.3f}"


def test_captain_no_false_positives(report):
    assert report["captain"]["fp"] <= CAPTAIN_FALSE_POSITIVES_MAX
