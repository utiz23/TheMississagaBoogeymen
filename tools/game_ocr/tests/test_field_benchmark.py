"""Per-field benchmark regression gate (the accuracy contract).

Scores each committed loadout golden (the parity-locked current-main extractor
output) against its hand-labeled V2 ground truth and asserts every field clears
its floor. Floors START at the current measured baseline and are ratcheted UP as
the extractor improves (Phases C/D/E/F). They must never be lowered to make a
regression pass.

This is fast + deterministic (no OCR, no DB) — it reads the golden JSON — so it
runs in the normal suite. The heavy `--from-extractor` / `--from-db` paths are
exercised separately.

Gated matches (both in `benchmark/manifest.json splits.validation`):
  - 250  — full lobby golden (Phase A baseline, measured 2026-06-14).
  - 2577 — real-game loadout window golden (Phase B Gate 2, measured 2026-07-01
           at t76-116 @3fps). Most fields match or beat 250 (build 0.90, position
           1.00, x_factor_name 0.86); persona (0.50) is lower — right-pane OCR
           difficulty on this clip, plus one subject-split phantom (against_RW
           captain fn), not a regression. See fixture_match2577_loadout/PROVENANCE.md.

Per-field floors, per match. Gaps left at 0.0 are KNOWN and tracked by later
phases:
  - player_level / handedness: not carried in loadout evidence (lobby-evidence
    merge / extractor extension — Phases B/E).
  - captain: undetected / split by the glyph heuristic (Phase D ★ specialist).
"""

import json
from pathlib import Path

import pytest

from game_ocr.benchmark.report import score_match

REPO = Path(__file__).resolve().parents[3]
BENCH = REPO / "tools/game_ocr/calibration/extras/loadout/benchmark"
FIXTURES = REPO / "tools/game_ocr/calibration/extras/loadout/fixtures"

# Each gated match: labels + committed golden + per-field floors. Floors are the
# measured baseline rounded DOWN to a clean lower bound; ratchet up, never down.
MATCHES = {
    250: {
        "labels": BENCH / "labels/250.json",
        "golden": FIXTURES / "fixture_match250_full_lobby/expected_loadout_evidence.json",
        # Baseline measured 2026-06-14 against the v3 golden.
        "floors": {
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
        },
        "captain_fp_max": 0,
    },
    2577: {
        "labels": BENCH / "labels/2577.json",
        "golden": FIXTURES / "fixture_match2577_loadout/expected_loadout_evidence.json",
        # Baseline measured 2026-07-01 (real-game loadout window t76-116 @3fps).
        "floors": {
            "gamertag": 0.90,
            "persona": 0.50,
            "player_number": 1.00,
            "position": 1.00,
            "build_class_canonical": 0.90,
            "x_factor_name": 0.86,
            "x_factor_tier": 0.90,
            "attribute_value": 0.74,
            "player_level": 0.0,
            "handedness": 0.0,
        },
        "captain_fp_max": 0,  # the FP-LW regression must never reappear
    },
}


@pytest.fixture(scope="module")
def reports():
    out = {}
    for match_id, cfg in MATCHES.items():
        labels = json.loads(cfg["labels"].read_text(encoding="utf-8"))
        records = json.loads(cfg["golden"].read_text(encoding="utf-8"))
        out[match_id] = score_match(labels, records)
    return out


@pytest.mark.parametrize("match_id", sorted(MATCHES))
def test_all_truth_subjects_align(reports, match_id):
    # Every labeled subject must align to a predicted slot; a drop here means
    # gamertag extraction or alignment regressed and the field numbers are moot.
    report = reports[match_id]
    assert report["subjects"]["matched"] == report["subjects"]["truth"]


@pytest.mark.parametrize(
    "match_id,field,floor",
    [
        (mid, field, floor)
        for mid, cfg in sorted(MATCHES.items())
        for field, floor in sorted(cfg["floors"].items())
    ],
)
def test_field_accuracy_meets_floor(reports, match_id, field, floor):
    acc = reports[match_id]["fields"][field]["accuracy"]
    assert acc >= floor, (
        f"match {match_id}: {field} accuracy {acc:.3f} fell below floor {floor:.3f}"
    )


@pytest.mark.parametrize("match_id", sorted(MATCHES))
def test_captain_no_false_positives(reports, match_id):
    assert reports[match_id]["captain"]["fp"] <= MATCHES[match_id]["captain_fp_max"]
