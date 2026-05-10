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
        result = parse_pre_game_result(
            meta,
            {
                "game_mode": [OCRLine(text="EASHL 6v6", confidence=0.98)],
                "our_team_name": [OCRLine(text="THE BOOGEYMEN", confidence=0.98)],
                "opponent_team_name": [OCRLine(text="TRIPORT CHUGS", confidence=0.98)],
                "our_team_panel": [
                    OCRLine(text="LW", confidence=0.99),
                    OCRLine(text="silkyjoker851", confidence=0.95),
                    OCRLine(text="CPU", confidence=0.97),
                ],
                "opponent_team_panel": [
                    OCRLine(text="C", confidence=0.99),
                    OCRLine(text="cbrslays", confidence=0.95),
                ],
            },
            include_player_name=False,
        )
        self.assertEqual(result.our_team.roster[0].fields["empty_or_cpu"].value, "CPU")


class FakeExtractorTests(unittest.TestCase):
    def test_wrong_image_path_returns_failure(self) -> None:
        extractor = Extractor(registry=ScreenRegistry())
        result = extractor.extract_path("pre_game_lobby_state_1", Path("missing.png"))
        self.assertIsInstance(result, FailedExtractionResult)


if __name__ == "__main__":
    unittest.main()
