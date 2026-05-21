"""Phase 2A T1A — Extractor-vs-fixture-PNGs parity test.

Runs the real Python extractor ``extract_loadout_evidence()`` against committed
fixture PNGs and diffs the output against ``expected_loadout_evidence.json``.

The fixture JSON is authored truth (per Task 2A-19 PROVENANCE.md); this test
locks the extractor → JSON contract for the diffed fixtures.

Pre-condition: operator must populate ``frames/*.png`` in each fixture's segment
directory.  When ``frames/`` is empty (only ``.gitkeep`` present), the relevant
test SKIPs silently.

CI behaviour: this test runs in the existing pytest CI step.  When PNGs are
present it asserts the diff matches within tolerances.  When absent it records
SKIPPED — gate status is "pending operator setup."

Tolerances
----------
- Categorical / icon / open-text ``candidate_value``: exact string match.
- Tabular-numeric ``candidate_value``:  ±1 integer tolerance (OCR rounding).
- ``raw_confidence`` / ``calibrated_confidence``: ±0.10 absolute.
- ``field_family``, ``extractor_family``, ``observability_status``: exact.

Fixtures covered
----------------
fixture_match250_full_lobby/seg_bgm   — 305 records (BGM roster)
fixture_match250_full_lobby/seg_opp   — 305 records (opponent roster)
fixture_match463_single_slot          — 61 records  (HenryTheBobJr single-slot)
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

# ---------------------------------------------------------------------------
# Ensure tools/game_ocr is importable when pytest is invoked from repo root
# with PYTHONPATH=tools/game_ocr.  We add it explicitly here as a fallback
# so the test is self-contained even without the env var.
# ---------------------------------------------------------------------------
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_GAME_OCR_SRC = _REPO_ROOT / "tools" / "game_ocr"
if str(_GAME_OCR_SRC) not in sys.path:
    sys.path.insert(0, str(_GAME_OCR_SRC))

from game_ocr.loadout_evidence import extract_loadout_evidence  # noqa: E402

# ---------------------------------------------------------------------------
# Fixture root
# ---------------------------------------------------------------------------

_FIXTURE_ROOT = (
    _REPO_ROOT
    / "tools"
    / "game_ocr"
    / "calibration"
    / "extras"
    / "loadout"
    / "fixtures"
)

# ---------------------------------------------------------------------------
# Diff tolerances
# ---------------------------------------------------------------------------

_NUMERIC_FAMILY = "tabular_numeric"
_CONFIDENCE_TOLERANCE = 0.10
_NUMERIC_VALUE_TOLERANCE = 1

# Fields that must match exactly (other than candidate_value, handled per-family).
_EXACT_FIELDS = ("field_family", "extractor_family", "observability_status")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _frames_present(seg_dir: Path) -> bool:
    """Return True if ``seg_dir/frames/`` contains at least one ``*.png`` file."""
    frames_dir = seg_dir / "frames"
    if not frames_dir.is_dir():
        return False
    return any(frames_dir.glob("*.png"))


def _load_expected(json_path: Path) -> list[dict]:
    """Load and return the expected evidence list from *json_path*."""
    with json_path.open() as fh:
        return json.load(fh)


def _index_records(records: list[dict]) -> dict[tuple, dict]:
    """Index records by ``(subject_slot_key, field_key, candidate_rank)``."""
    index: dict[tuple, dict] = {}
    for rec in records:
        key = (rec.get("subject_slot_key"), rec.get("field_key"), rec.get("candidate_rank"))
        # If duplicates exist, last one wins (shouldn't happen in well-formed output).
        index[key] = rec
    return index


def _diff_records(expected: list[dict], actual: list[dict]) -> list[str]:
    """Diff two evidence lists.

    Returns a list of human-readable mismatch messages.  An empty list means
    the actual output matches within the declared tolerances.

    Matching key: ``(subject_slot_key, field_key, candidate_rank)``.
    """
    exp_idx = _index_records(expected)
    act_idx = _index_records(actual)
    diffs: list[str] = []

    for key in exp_idx:
        if key not in act_idx:
            diffs.append(f"MISSING in extractor output: {key}")

    for key in act_idx:
        if key not in exp_idx:
            diffs.append(f"EXTRA in extractor output: {key}")

    for key in exp_idx:
        if key not in act_idx:
            continue
        e = exp_idx[key]
        a = act_idx[key]

        # --- candidate_value -------------------------------------------------
        if e.get("field_family") == _NUMERIC_FAMILY:
            ev = e.get("candidate_value")
            av = a.get("candidate_value")
            if ev is None and av is None:
                pass  # both null — ok
            elif ev is None or av is None:
                diffs.append(
                    f"{key}: numeric candidate_value None mismatch: "
                    f"expected={ev!r} actual={av!r}"
                )
            elif abs(int(ev) - int(av)) > _NUMERIC_VALUE_TOLERANCE:
                diffs.append(
                    f"{key}: numeric candidate_value diff > {_NUMERIC_VALUE_TOLERANCE}: "
                    f"expected={ev} actual={av}"
                )
        else:
            if e.get("candidate_value") != a.get("candidate_value"):
                diffs.append(
                    f"{key}: candidate_value mismatch: "
                    f"expected={e.get('candidate_value')!r} "
                    f"actual={a.get('candidate_value')!r}"
                )

        # --- confidence fields -----------------------------------------------
        for conf_key in ("raw_confidence", "calibrated_confidence"):
            e_val = e.get(conf_key, 0.0)
            a_val = a.get(conf_key, 0.0)
            if abs(float(e_val) - float(a_val)) > _CONFIDENCE_TOLERANCE:
                diffs.append(
                    f"{key}: {conf_key} diff > {_CONFIDENCE_TOLERANCE}: "
                    f"expected={e_val} actual={a_val}"
                )

        # --- exact-match fields ----------------------------------------------
        for exact_key in _EXACT_FIELDS:
            if e.get(exact_key) != a.get(exact_key):
                diffs.append(
                    f"{key}: {exact_key} mismatch: "
                    f"expected={e.get(exact_key)!r} actual={a.get(exact_key)!r}"
                )

    return diffs


def _run_parity_assert(test_case: unittest.TestCase, seg_dir: Path, segment_index: int) -> None:
    """Core helper: run extractor + diff against expected JSON, assert no diffs.

    Skips when ``frames/`` has no PNGs (operator-TODO placeholder).
    Fails with the first 10 mismatch messages when diffs are found.
    """
    if not _frames_present(seg_dir):
        test_case.skipTest(
            f"Operator-TODO: populate {seg_dir / 'frames'} with fixture PNGs to enable T1A"
        )

    expected_path = seg_dir / "expected_loadout_evidence.json"
    expected = _load_expected(expected_path)

    actual_records = extract_loadout_evidence(
        bundle_dir=seg_dir / "frames",
        segment_index=segment_index,
        extractor_version="loadout-evidence-v1",
    )
    actual = [r.to_dict() for r in actual_records]

    diffs = _diff_records(expected, actual)
    if diffs:
        shown = diffs[:10]
        tail = f"\n... and {len(diffs) - 10} more" if len(diffs) > 10 else ""
        test_case.fail(
            f"Extractor output differs from fixture ({len(diffs)} mismatches):\n"
            + "\n".join(shown)
            + tail
        )


# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------


class TestLoadoutEvidenceFixtureParity(unittest.TestCase):
    """T1A — extractor-vs-fixture-PNGs parity.

    Each test SKIPs silently when its fixture ``frames/`` directory is empty
    (operator-TODO per Task 2A-19).  Once the operator populates PNGs the test
    becomes an acceptance gate: the extractor output must match
    ``expected_loadout_evidence.json`` within the declared tolerances.
    """

    def test_match250_seg_bgm_parity(self):
        """Match-250 BGM-roster segment — 305 expected records.

        Skip reason: populate
        tools/game_ocr/calibration/extras/loadout/fixtures/
            fixture_match250_full_lobby/seg_bgm/frames/
        with the match-250 BGM-roster frame PNGs to run this gate.
        """
        seg_dir = _FIXTURE_ROOT / "fixture_match250_full_lobby" / "seg_bgm"
        _run_parity_assert(self, seg_dir, segment_index=1)

    def test_match250_seg_opp_parity(self):
        """Match-250 opponent-roster segment — 305 expected records.

        Skip reason: populate
        tools/game_ocr/calibration/extras/loadout/fixtures/
            fixture_match250_full_lobby/seg_opp/frames/
        with the match-250 opponent-roster frame PNGs to run this gate.
        """
        seg_dir = _FIXTURE_ROOT / "fixture_match250_full_lobby" / "seg_opp"
        _run_parity_assert(self, seg_dir, segment_index=2)

    def test_match463_single_slot_parity(self):
        """Match-463 single-slot segment (HenryTheBobJr) — 61 expected records.

        Skip reason: populate
        tools/game_ocr/calibration/extras/loadout/fixtures/
            fixture_match463_single_slot/frames/
        with the match-463 HenryTheBobJr frame PNGs to run this gate.
        """
        seg_dir = _FIXTURE_ROOT / "fixture_match463_single_slot"
        _run_parity_assert(self, seg_dir, segment_index=1)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    unittest.main()
