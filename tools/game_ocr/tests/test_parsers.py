from __future__ import annotations

import unittest
from pathlib import Path

from game_ocr.extractor import Extractor, ScreenRegistry
from game_ocr.models import ExtractionMeta, FailedExtractionResult, FieldStatus
from game_ocr.ocr import OCRLine
from game_ocr.parsers import field_from_lines, parse_pre_game_result
from game_ocr.utils import parse_int, parse_percentage, split_height_weight


class UtilsTests(unittest.TestCase):
    def test_parse_int(self) -> None:
        self.assertEqual(parse_int("23,757"), 23757)

    def test_parse_percentage(self) -> None:
        self.assertEqual(parse_percentage("91.4%"), 91.4)

    def test_split_height_weight(self) -> None:
        self.assertEqual(split_height_weight("5'8\" 160LBS"), ("5'8\"", "160 lbs"))


class ParserTests(unittest.TestCase):
    def test_field_from_lines_uncertain_when_parser_fails(self) -> None:
        field = field_from_lines([OCRLine(text="abc", confidence=0.9)], parser=parse_int)
        self.assertEqual(field.status, FieldStatus.UNCERTAIN)
        self.assertIsNone(field.value)

    def test_cpu_detection_in_lobby_parser(self) -> None:
        meta = ExtractionMeta(screen_type="pre_game_lobby_state_1", source_path="fake.png", ocr_backend="fake")
        # The new parser uses full-frame OCR + position-label anchors at fixed
        # x ranges (BGM: x_center < 130, Opp: x_center > 1820). Construct synthetic
        # OCRLines with appropriate bbox coordinates.
        def line(text: str, x_center: float, y_center: float, conf: float = 0.99) -> OCRLine:
            return OCRLine(
                text=text, confidence=conf,
                x1=x_center - 30, x2=x_center + 30,
                y1=y_center - 12, y2=y_center + 12,
            )
        result = parse_pre_game_result(
            meta,
            {
                "full_frame": [
                    line("EASHL 6v6", 200, 130, 0.98),
                    line("THE BOOGEYMEN", 200, 211, 0.98),
                    line("TRIPORT CHUGS", 1600, 211, 0.98),
                    # BGM panel: LW row with a CPU placeholder + a gamertag.
                    line("LW", 77, 300),
                    line("silkyjoker851", 250, 300, 0.95),
                    line("CPU", 250, 305, 0.97),
                    # Opp panel: C row with a gamertag.
                    line("C", 1844, 300),
                    line("cbrslays", 1700, 300, 0.95),
                ],
            },
            include_player_name=False,
        )
        # First BGM slot should be marked CPU; first Opp slot should not.
        self.assertEqual(result.our_team.roster[0].fields["empty_or_cpu"].value, "CPU")
        self.assertEqual(result.opponent_team.roster[0].fields["empty_or_cpu"].status, FieldStatus.MISSING)

    def test_away_label_not_picked_as_gamertag(self) -> None:
        """Regression: the right-panel "AWAY" label was being picked up as
        the topmost text candidate for an opp roster row's gamertag when
        the actual gamertag OCR landed lower in the row. The parser must
        treat AWAY/HOME the same way it treats position tokens — skip
        them when ranking gamertag candidates.
        """
        meta = ExtractionMeta(
            screen_type="pre_game_lobby_state_2", source_path="fake.png", ocr_backend="fake",
        )
        def line(text: str, x_center: float, y_center: float, conf: float = 0.99) -> OCRLine:
            return OCRLine(
                text=text, confidence=conf,
                x1=x_center - 30, x2=x_center + 30,
                y1=y_center - 12, y2=y_center + 12,
            )
        result = parse_pre_game_result(
            meta,
            {
                "full_frame": [
                    line("EASHL 6v6", 200, 130, 0.98),
                    line("THE BOOGEYMEN", 200, 211, 0.98),
                    line("4TH LINE", 1600, 211, 0.98),
                    # Opp panel: G row with the team-side label "AWAY" landing
                    # above the actual gamertag — the failure mode the fix
                    # addresses.
                    line("G", 1844, 800),
                    line("AWAY", 1700, 795, 0.98),  # topmost candidate, must be rejected
                    line("xZ4RKY", 1700, 810, 0.95),
                ],
            },
            include_player_name=False,
        )
        # Find the G slot (parser emits fixed C/LW/RW/LD/RD/G order).
        opp_g = next(
            (slot for slot in result.opponent_team.roster
             if slot.fields["position"].value == "G"),
            None,
        )
        self.assertIsNotNone(opp_g, "Expected an opp G slot in the roster")
        self.assertEqual(opp_g.fields["gamertag"].value, "xZ4RKY")
        self.assertNotIn("AWAY", opp_g.fields["gamertag"].value or "")


class FakeExtractorTests(unittest.TestCase):
    def test_wrong_image_path_returns_failure(self) -> None:
        extractor = Extractor(registry=ScreenRegistry())
        result = extractor.extract_path("pre_game_lobby_state_1", Path("missing.png"))
        self.assertIsInstance(result, FailedExtractionResult)


if __name__ == "__main__":
    unittest.main()
