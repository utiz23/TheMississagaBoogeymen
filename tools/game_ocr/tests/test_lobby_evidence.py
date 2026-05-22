"""Tests for `lobby_evidence.extract_lobby_evidence`.

These tests pass `ocr_lines_per_frame` explicitly so we never need real PNG
content — empty placeholder files just satisfy the bundle_dir glob.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from game_ocr.lobby_evidence import (
    EXTRACTOR_VERSION,
    SCREEN_STATE,
    extract_lobby_evidence,
)
from game_ocr.lobby_extractors.row_grouping import LOBBY_CANONICAL_ROW_ORDER
from game_ocr.ocr import OCRLine


def _line(text: str, x_center: float, y_center: float, conf: float = 0.95) -> OCRLine:
    return OCRLine(
        text=text,
        confidence=conf,
        x1=x_center - 30,
        x2=x_center + 30,
        y1=y_center - 12,
        y2=y_center + 12,
    )


def _state2_frame() -> list[OCRLine]:
    """6 BGM + 6 opp anchors with #NN-Persona + gamertag per row."""
    lines: list[OCRLine] = []
    for i, position in enumerate(LOBBY_CANONICAL_ROW_ORDER):
        y = 300 + i * 88
        lines.append(_line(position, 77, y))
        lines.append(_line(position, 1844, y))
        lines.append(_line(f"BgmGT{i}", 250, y - 12))
        lines.append(_line(f"#{10 + i}-Persona{i}", 250, y + 10))
        lines.append(_line(f"OppGT{i}", 1700, y - 12))
        lines.append(_line(f"#{20 + i}-OppPersona{i}", 1700, y + 10))
    return lines


def _empty_bundle(num_frames: int) -> Path:
    """Create a tempdir with N empty PNG placeholders. Caller is responsible
    for cleanup via TemporaryDirectory context."""
    tmp = tempfile.mkdtemp(prefix="lobby_evidence_test_")
    p = Path(tmp)
    for i in range(num_frames):
        (p / f"{i + 1:05d}.png").write_bytes(b"")
    return p


class LobbyEvidenceTests(unittest.TestCase):
    def test_emits_records_for_all_12_slots(self) -> None:
        bundle = _empty_bundle(1)
        try:
            records = extract_lobby_evidence(
                bundle,
                segment_index=42,
                ocr_lines_per_frame=[_state2_frame()],
            )
        finally:
            for p in bundle.iterdir():
                p.unlink()
            bundle.rmdir()

        # Position is emitted for every slot (12 slots × at least 1 record).
        position_records = [r for r in records if r.field_key == "position"]
        self.assertEqual(len(position_records), 12)
        slot_keys = {r.subject_slot_key for r in position_records}
        self.assertEqual(len(slot_keys), 12)
        for r in position_records:
            self.assertEqual(r.screen_state, SCREEN_STATE)
            self.assertEqual(r.field_family, "closed_vocab")
            self.assertEqual(r.extractor_version, EXTRACTOR_VERSION)

    def test_field_families_assigned_correctly(self) -> None:
        bundle = _empty_bundle(1)
        try:
            records = extract_lobby_evidence(
                bundle,
                segment_index=1,
                ocr_lines_per_frame=[_state2_frame()],
            )
        finally:
            for p in bundle.iterdir():
                p.unlink()
            bundle.rmdir()

        # Build expected mapping per field
        expected_families = {
            "position": "closed_vocab",
            "gamertag": "open_text",
            "player_number": "tabular_numeric",
            "player_name_persona": "open_text",
        }
        for r in records:
            if r.field_key in expected_families:
                self.assertEqual(
                    r.field_family, expected_families[r.field_key],
                    msg=f"field {r.field_key} got family {r.field_family}",
                )

    def test_state2_emits_player_number_and_persona(self) -> None:
        bundle = _empty_bundle(1)
        try:
            records = extract_lobby_evidence(
                bundle,
                segment_index=7,
                ocr_lines_per_frame=[_state2_frame()],
            )
        finally:
            for p in bundle.iterdir():
                p.unlink()
            bundle.rmdir()
        # BGM C is the first row: #10 / Persona0.
        bgm_c_records = [r for r in records if r.subject_slot_key == "lobby_for_C"]
        pnum = next(r for r in bgm_c_records if r.field_key == "player_number")
        self.assertEqual(pnum.candidate_value, 10)
        persona = next(r for r in bgm_c_records if r.field_key == "player_name_persona")
        self.assertEqual(persona.candidate_value, "Persona0")

    def test_cpu_slot_emits_low_quality_marker(self) -> None:
        # Modify the BGM G row to be CPU.
        lines = _state2_frame()
        lines.append(_line("CPU", 250, 740, 0.97))
        bundle = _empty_bundle(1)
        try:
            records = extract_lobby_evidence(
                bundle,
                segment_index=0,
                ocr_lines_per_frame=[lines],
            )
        finally:
            for p in bundle.iterdir():
                p.unlink()
            bundle.rmdir()
        bgm_g = [r for r in records if r.subject_slot_key == "lobby_for_G"]
        gamertag_r = next(r for r in bgm_g if r.field_key == "gamertag")
        self.assertEqual(gamertag_r.observability_status, "low_quality")
        # Position is still emitted as observable.
        position_r = next(r for r in bgm_g if r.field_key == "position")
        self.assertEqual(position_r.observability_status, "observable")

    def test_best_frame_selection_picks_higher_confidence(self) -> None:
        # Two frames: frame 0 has all confidences = 0.5, frame 1 has 0.9.
        # Pick frame 1 for every slot.
        lines_low = [
            line for line in _state2_frame()
        ]
        # Mutate confidences without breaking original (rebuild instead).
        lines_low = []
        for i, position in enumerate(LOBBY_CANONICAL_ROW_ORDER):
            y = 300 + i * 88
            lines_low.append(_line(position, 77, y, conf=0.5))
            lines_low.append(_line(position, 1844, y, conf=0.5))
            lines_low.append(_line(f"BgmGT{i}", 250, y - 12, conf=0.5))
            lines_low.append(_line(f"#{10 + i}-Persona{i}", 250, y + 10, conf=0.5))
            lines_low.append(_line(f"OppGT{i}", 1700, y - 12, conf=0.5))
            lines_low.append(_line(f"#{20 + i}-OppPersona{i}", 1700, y + 10, conf=0.5))
        bundle = _empty_bundle(2)
        try:
            records = extract_lobby_evidence(
                bundle,
                segment_index=99,
                ocr_lines_per_frame=[lines_low, _state2_frame()],
            )
        finally:
            for p in bundle.iterdir():
                p.unlink()
            bundle.rmdir()
        # Picked frame 1 (conf 0.95) — raw_confidence on gamertag must be ≥ 0.7.
        bgm_c_gt = next(
            r for r in records
            if r.subject_slot_key == "lobby_for_C" and r.field_key == "gamertag"
        )
        self.assertGreaterEqual(bgm_c_gt.raw_confidence, 0.7)

    def test_record_dict_serializable(self) -> None:
        bundle = _empty_bundle(1)
        try:
            records = extract_lobby_evidence(
                bundle,
                segment_index=0,
                ocr_lines_per_frame=[_state2_frame()],
            )
        finally:
            for p in bundle.iterdir():
                p.unlink()
            bundle.rmdir()
        # Every record should round-trip through to_dict() with all required keys.
        for r in records:
            d = r.to_dict()
            for key in (
                "screen_state", "field_key", "field_family", "candidate_value",
                "candidate_rank", "raw_confidence", "calibrated_confidence",
                "extractor_family", "extractor_version",
                "observability_status", "normalization_status",
                "subject_slot_key", "support_frame_ids", "roi_bbox",
            ):
                self.assertIn(key, d, msg=f"missing key {key!r} in record dict")

    def test_empty_bundle_dir_raises(self) -> None:
        bundle = _empty_bundle(0)
        try:
            with self.assertRaises(ValueError):
                extract_lobby_evidence(
                    bundle,
                    segment_index=0,
                    ocr_lines_per_frame=[],
                )
        finally:
            bundle.rmdir()


if __name__ == "__main__":
    unittest.main()
