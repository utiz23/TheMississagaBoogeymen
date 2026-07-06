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
    _vote_slot_identity,
    extract_lobby_evidence,
)
from game_ocr.lobby_extractors.row_grouping import LOBBY_CANONICAL_ROW_ORDER
from game_ocr.lobby_extractors.slot_identity import LobbySubjectIdentity
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


def _state2_frame_bgm_c(bgm_c_gt: str, conf: float = 0.95) -> list[OCRLine]:
    """A state_2 frame identical to ``_state2_frame`` except the BGM C row's
    gamertag is overridden (and every line uses ``conf``).

    Used to synthesize a mid-scroll transition frame: setting ``bgm_c_gt`` to
    another BGM slot's gamertag (e.g. ``BgmGT1`` == LW) reproduces the
    within-panel duplicate that EA's roster-slide animation produces.
    """
    lines: list[OCRLine] = []
    for i, position in enumerate(LOBBY_CANONICAL_ROW_ORDER):
        y = 300 + i * 88
        lines.append(_line(position, 77, y, conf))
        lines.append(_line(position, 1844, y, conf))
        gt = bgm_c_gt if i == 0 else f"BgmGT{i}"
        lines.append(_line(gt, 250, y - 12, conf))
        lines.append(_line(f"#{10 + i}-Persona{i}", 250, y + 10, conf))
        lines.append(_line(f"OppGT{i}", 1700, y - 12, conf))
        lines.append(_line(f"#{20 + i}-OppPersona{i}", 1700, y + 10, conf))
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
            records, _ = extract_lobby_evidence(
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
            records, _ = extract_lobby_evidence(
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
            records, _ = extract_lobby_evidence(
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
            records, _ = extract_lobby_evidence(
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
        # is_cpu must also be present alongside the low_quality gamertag marker.
        is_cpu_r = next(r for r in bgm_g if r.field_key == "is_cpu")
        self.assertEqual(is_cpu_r.candidate_value, True)
        self.assertEqual(is_cpu_r.field_family, "icon")
        self.assertEqual(is_cpu_r.observability_status, "observable")
        self.assertEqual(is_cpu_r.normalization_status, "normalized")
        self.assertEqual(is_cpu_r.raw_confidence, 1.0)
        self.assertEqual(is_cpu_r.shape_or_icon_class, "cpu")

    def test_cpu_slot_is_cpu_record_coexists_with_low_quality_gamertag(self) -> None:
        # Regression: CPU-row early-return must NOT drop the is_cpu record.
        lines = _state2_frame()
        lines.append(_line("CPU", 250, 740, 0.97))
        bundle = _empty_bundle(1)
        try:
            records, _ = extract_lobby_evidence(
                bundle,
                segment_index=0,
                ocr_lines_per_frame=[lines],
            )
        finally:
            for p in bundle.iterdir():
                p.unlink()
            bundle.rmdir()
        bgm_g_field_keys = {
            r.field_key for r in records if r.subject_slot_key == "lobby_for_G"
        }
        # Position, is_cpu, gamertag-low_quality marker — all three present.
        self.assertIn("position", bgm_g_field_keys)
        self.assertIn("is_cpu", bgm_g_field_keys)
        self.assertIn("gamertag", bgm_g_field_keys)

    def test_human_slot_emits_is_cpu_false(self) -> None:
        bundle = _empty_bundle(1)
        try:
            records, _ = extract_lobby_evidence(
                bundle,
                segment_index=0,
                ocr_lines_per_frame=[_state2_frame()],
            )
        finally:
            for p in bundle.iterdir():
                p.unlink()
            bundle.rmdir()
        # Every one of the 12 human slots must emit is_cpu=False.
        is_cpu_records = [r for r in records if r.field_key == "is_cpu"]
        self.assertEqual(len(is_cpu_records), 12)
        for r in is_cpu_records:
            self.assertEqual(r.candidate_value, False)
            self.assertEqual(r.field_family, "icon")
            self.assertEqual(r.observability_status, "observable")
            self.assertEqual(r.normalization_status, "normalized")
            self.assertEqual(r.raw_confidence, 1.0)
            self.assertIsNone(r.shape_or_icon_class)

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
            records, _ = extract_lobby_evidence(
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
            records, _ = extract_lobby_evidence(
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

    def test_cross_team_duplicate_emits_is_cpu_true_for_both_slots(self) -> None:
        # Real human gamertags cannot appear on both rosters of an EASHL
        # lobby simultaneously, so a same-frame cross-team duplicate (e.g.
        # 'XZ4RKY' on match 250) is structurally a CPU placeholder OCR
        # misread as text. The detector-side dedup must demote both slots
        # so the evidence layer emits is_cpu=True for them.
        lines: list[OCRLine] = []
        for i, position in enumerate(LOBBY_CANONICAL_ROW_ORDER):
            y = 300 + i * 88
            lines.append(_line(position, 77, y))
            lines.append(_line(position, 1844, y))
            # BGM panel: G (i==5) reads XZ4RKY; others unique.
            bgm_gt = "XZ4RKY" if position == "G" else f"BgmGT{i}"
            lines.append(_line(bgm_gt, 250, y - 12))
            lines.append(_line(f"#{10 + i}-Persona{i}", 250, y + 10))
            # Opp panel: C (i==0) reads XZ4RKY; others unique.
            opp_gt = "XZ4RKY" if position == "C" else f"OppGT{i}"
            lines.append(_line(opp_gt, 1700, y - 12))
            lines.append(_line(f"#{20 + i}-OppPersona{i}", 1700, y + 10))

        bundle = _empty_bundle(1)
        try:
            records, _ = extract_lobby_evidence(
                bundle,
                segment_index=42,
                ocr_lines_per_frame=[lines],
            )
        finally:
            for p in bundle.iterdir():
                p.unlink()
            bundle.rmdir()

        bgm_g_is_cpu = next(
            r for r in records
            if r.subject_slot_key == "lobby_for_G" and r.field_key == "is_cpu"
        )
        opp_c_is_cpu = next(
            r for r in records
            if r.subject_slot_key == "lobby_against_C" and r.field_key == "is_cpu"
        )
        self.assertEqual(bgm_g_is_cpu.candidate_value, True)
        self.assertEqual(bgm_g_is_cpu.shape_or_icon_class, "cpu")
        self.assertEqual(opp_c_is_cpu.candidate_value, True)
        self.assertEqual(opp_c_is_cpu.shape_or_icon_class, "cpu")

    def test_transition_frame_dropped_in_favor_of_settled_majority(self) -> None:
        # During EA's roster-slide, a transition frame duplicates a player's
        # gamertag across adjacent slots (segment-4 of match 250 read
        # "Stick Menace" into BOTH C and LW). Such a frame OCRs crisply
        # (~0.99), so the old highest-mean-confidence best-frame pick promoted
        # its scrambled read over the settled frames. The aggregation must
        # drop the transition frame and majority-vote the settled reads.
        settled = _state2_frame_bgm_c("BgmGT0", conf=0.90)  # C reads its own GT
        transition = _state2_frame_bgm_c("BgmGT1", conf=0.99)  # C == LW (dup)
        bundle = _empty_bundle(4)
        try:
            records, _ = extract_lobby_evidence(
                bundle,
                segment_index=5,
                # 3 settled + 1 higher-confidence transition frame.
                ocr_lines_per_frame=[settled, settled, settled, transition],
            )
        finally:
            for p in bundle.iterdir():
                p.unlink()
            bundle.rmdir()

        bgm_c_gt = next(
            r for r in records
            if r.subject_slot_key == "lobby_for_C" and r.field_key == "gamertag"
        )
        # Settled majority wins over the higher-confidence transition read.
        self.assertEqual(bgm_c_gt.candidate_value, "BgmGT0")
        # The real LW slot is unaffected.
        bgm_lw_gt = next(
            r for r in records
            if r.subject_slot_key == "lobby_for_LW" and r.field_key == "gamertag"
        )
        self.assertEqual(bgm_lw_gt.candidate_value, "BgmGT1")

    def test_all_transition_frames_still_emit_slot(self) -> None:
        # Fallback: if EVERY frame in the segment is a transition frame (a
        # too-short frame budget), the slot must still be emitted rather than
        # dropped — grade-degraded data beats no data.
        transition = _state2_frame_bgm_c("BgmGT1", conf=0.97)  # C == LW (dup)
        bundle = _empty_bundle(2)
        try:
            records, _ = extract_lobby_evidence(
                bundle,
                segment_index=5,
                ocr_lines_per_frame=[transition, transition],
            )
        finally:
            for p in bundle.iterdir():
                p.unlink()
            bundle.rmdir()

        bgm_c_gt = [
            r for r in records
            if r.subject_slot_key == "lobby_for_C" and r.field_key == "gamertag"
        ]
        self.assertEqual(len(bgm_c_gt), 1)

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


def _subject(gamertag: str, **overrides: object) -> LobbySubjectIdentity:
    """Build a BGM-C human subject observation for _vote_slot_identity tests."""
    fields: dict[str, object] = dict(
        slot_key="lobby_for_C",
        team_side="our_team",
        position="C",
        position_confidence=0.9,
        is_empty_or_cpu=False,
        gamertag=gamertag,
        gamertag_confidence=0.95,
    )
    fields.update(overrides)
    return LobbySubjectIdentity(**fields)  # type: ignore[arg-type]


class VoteSlotIdentityMergeTests(unittest.TestCase):
    """Per-field merge of a slot's toggle-phase observations.

    state_2 toggles the two team panels on opposite phases: one settled frame
    carries a slot's build-class, another carries its #NN + persona — never
    both on a single frame. The per-slot vote must MERGE the winning
    gamertag's observations so the slot emits every field, not collapse to a
    single representative frame that keeps only one phase.
    """

    def test_merges_toggle_phases_of_same_gamertag(self) -> None:
        build_phase = _subject(
            "StickMenace",
            build_class_raw="Playmaker",
            build_class_confidence=0.93,
        )
        number_phase = _subject(
            "StickMenace",
            player_number=11,
            player_number_confidence=0.97,
            player_name_persona="E.Wanhg",
            player_name_persona_confidence=0.91,
        )
        merged = _vote_slot_identity([build_phase, number_phase])
        self.assertEqual(merged.gamertag, "StickMenace")
        # Both toggle phases survive the merge.
        self.assertEqual(merged.build_class_raw, "Playmaker")
        self.assertEqual(merged.player_number, 11)
        self.assertEqual(merged.player_name_persona, "E.Wanhg")
        # Each merged value carries its own observation's confidence.
        self.assertEqual(merged.build_class_confidence, 0.93)
        self.assertEqual(merged.player_number_confidence, 0.97)
        self.assertEqual(merged.player_name_persona_confidence, 0.91)

    def test_merge_scoped_to_winning_gamertag_group(self) -> None:
        # A bled read for a DIFFERENT gamertag (a losing vote grouped
        # separately) must not contribute any field to the winning subject.
        winner_a = _subject("StickMenace", player_number=11, player_number_confidence=0.97)
        winner_b = _subject("StickMenace", player_number=11, player_number_confidence=0.95)
        bleed = _subject("DuhPope", build_class_raw="Sniper", build_class_confidence=0.99)
        merged = _vote_slot_identity([winner_a, winner_b, bleed])
        self.assertEqual(merged.gamertag, "StickMenace")
        self.assertEqual(merged.player_number, 11)
        # DuhPope's build_class must NOT leak into StickMenace's slot.
        self.assertIsNone(merged.build_class_raw)

    def test_merges_coupled_level_fields_as_a_unit(self) -> None:
        number_phase = _subject(
            "StickMenace", player_number=11, player_number_confidence=0.97
        )
        level_phase = _subject(
            "StickMenace",
            player_level_raw="LV 35",
            player_level_number=35,
            player_level_confidence=0.88,
        )
        merged = _vote_slot_identity([number_phase, level_phase])
        # raw + number + confidence travel together from the same observation.
        self.assertEqual(merged.player_level_raw, "LV 35")
        self.assertEqual(merged.player_level_number, 35)
        self.assertEqual(merged.player_level_confidence, 0.88)

    def test_highest_confidence_wins_per_field(self) -> None:
        # Within the winning group, each field takes its highest-confidence
        # non-None observation.
        low = _subject(
            "StickMenace", player_number=99, player_number_confidence=0.60
        )
        high = _subject(
            "StickMenace", player_number=11, player_number_confidence=0.97
        )
        merged = _vote_slot_identity([low, high])
        self.assertEqual(merged.player_number, 11)

    def test_merges_glyph_drift_variants_into_winner(self) -> None:
        # Regression: match-250 for_RW. state_2 toggles build-class and
        # #NN/persona onto different frames; the winning gamertag group's
        # frames happened to carry ONLY the build phase, while the #NN/persona
        # reads landed on frames whose gamertag glyph-drifted
        # (silkyjoker85 -> sillkyjoker85, a 6-char-prefix Levenshtein of 2).
        # Exact-key grouping dropped those reads, losing #NN entirely. The
        # merge must reunite the drift variant. A genuine cross-panel bleed
        # (HenryTheBobJr, edit-distant) must STILL be excluded even though its
        # #NN read is higher-confidence.
        build_a = _subject(
            "silkyjoker85",
            build_class_raw="Cole Caufield-SNP",
            build_class_confidence=0.98,
        )
        build_b = _subject(
            "silkyjoker85",
            build_class_raw="Cole Caufield-SNP",
            build_class_confidence=0.96,
        )
        drift_number = _subject(
            "sillkyjoker85",  # glyph drift of the SAME player
            player_number=10,
            player_number_confidence=0.90,
            player_name_persona="Silky",
            player_name_persona_confidence=0.90,
        )
        bleed = _subject(
            "HenryTheBobJr",  # a DIFFERENT player bled in on a transition frame
            player_number=7,
            player_number_confidence=0.99,
            player_name_persona="Hubert Jenkins",
            player_name_persona_confidence=0.99,
        )
        merged = _vote_slot_identity([build_a, build_b, drift_number, bleed])
        # Representative identity stays the clean winning gamertag + its build.
        self.assertEqual(merged.gamertag, "silkyjoker85")
        self.assertEqual(merged.build_class_raw, "Cole Caufield-SNP")
        # #NN + persona recovered from the glyph-drift variant of the SAME player.
        self.assertEqual(merged.player_number, 10)
        self.assertEqual(merged.player_name_persona, "Silky")
        # The edit-distant bleed (higher confidence!) must NOT win the field.
        self.assertNotEqual(merged.player_number, 7)


if __name__ == "__main__":
    unittest.main()
