from __future__ import annotations

import unittest
from pathlib import Path

import yaml

from game_ocr.extractor import Extractor, ScreenRegistry
from game_ocr.models import ExtractionMeta, FailedExtractionResult, FieldStatus
from game_ocr.ocr import OCRLine
from game_ocr.parsers import (
    _action_tracker_event_type,
    _clean_period_label_text,
    _net_chart_period_number,
    _net_chart_row_key,
    _normalize_period_label,
    _parse_faceoff_dot,
    field_from_lines,
    parse_post_game_action_tracker,
    parse_post_game_box_score,
    parse_post_game_events,
    parse_post_game_faceoff_map,
    parse_post_game_net_chart,
    parse_pre_game_result,
)
from game_ocr.utils import parse_int, parse_percentage, split_height_weight


class UtilsTests(unittest.TestCase):
    def test_parse_int(self) -> None:
        self.assertEqual(parse_int("23,757"), 23757)

    def test_parse_int_rejects_dotted_noise(self) -> None:
        self.assertIsNone(parse_int("2.3.4"))

    def test_parse_int_rejects_whitespace_split(self) -> None:
        self.assertIsNone(parse_int("1 2 3"))

    def test_parse_int_tolerates_padding(self) -> None:
        self.assertEqual(parse_int(" 42 "), 42)

    def test_parse_int_negative(self) -> None:
        self.assertEqual(parse_int("-7"), -7)

    def test_parse_int_rejects_trailing_text(self) -> None:
        self.assertIsNone(parse_int("9FINAL"))

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


class FaceoffMapParserTests(unittest.TestCase):
    """Tests for parse_post_game_faceoff_map and its dot helper.

    Ground truth from research/OCR-SS/Action-Tracker/Faceoff-Map/
    vlcsnap-2026-05-10-02h06m43s475.png (1st period):
      BM(A) 75.0% — OZ 4/4, DZ 0/0
      4TH(H) 25.0% — OZ 0/0, DZ 0/4
    Sum of away_wins across the 9 dots should equal BM total wins == 4.
    Sum of home_wins should equal 4TH total wins == 0.
    """

    @staticmethod
    def _line(text: str, x_center: float, y_center: float, conf: float = 0.95) -> OCRLine:
        return OCRLine(
            text=text, confidence=conf,
            x1=x_center - 15, x2=x_center + 15,
            y1=y_center - 12, y2=y_center + 12,
        )

    def test_parse_faceoff_dot_x_pivot_split(self) -> None:
        # Single ROI cropped to ~172x86. Red flag at x≈30 (away), dark at x≈130 (home).
        red = self._line("4", 30, 40)
        black = self._line("0", 130, 40)
        away, home = _parse_faceoff_dot([red, black])
        self.assertEqual(away.value, 4)
        self.assertEqual(home.value, 0)

    def test_parse_faceoff_dot_empty(self) -> None:
        away, home = _parse_faceoff_dot([])
        self.assertEqual(away.status, FieldStatus.MISSING)
        self.assertEqual(home.status, FieldStatus.MISSING)

    def test_parse_faceoff_dot_single_glyph_left_is_away(self) -> None:
        # ROI in OCR-input coords is ~420 wide (real-world: ~211px crop × 2x
        # upscale). A single glyph at x_center=80 is well left of the 210
        # midpoint → assigned to away_wins.
        glyph = self._line("3", 80, 50)
        away, home = _parse_faceoff_dot([glyph], crop_width=420)
        self.assertEqual(away.value, 3)
        self.assertEqual(home.status, FieldStatus.MISSING)

    def test_parse_faceoff_dot_single_glyph_right_is_home(self) -> None:
        glyph = self._line("2", 320, 50)
        away, home = _parse_faceoff_dot([glyph], crop_width=420)
        self.assertEqual(away.status, FieldStatus.MISSING)
        self.assertEqual(home.value, 2)

    def test_parse_faceoff_dot_two_glyphs_with_crop_width(self) -> None:
        # When both glyphs are present, ROI-center pivot still classifies
        # them correctly (left=away, right=home), matching the legacy
        # median-based split for the canonical layout.
        red = self._line("4", 80, 50)
        black = self._line("0", 320, 50)
        away, home = _parse_faceoff_dot([red, black], crop_width=420)
        self.assertEqual(away.value, 4)
        self.assertEqual(home.value, 0)

    def test_parse_faceoff_dot_recovers_look_alike_L_as_1(self) -> None:
        # RapidOCR commonly misreads "1" on small red flags as "L". The
        # parser must recover the value rather than discard the read.
        glyph = self._line("L", 80, 50, conf=0.99)
        away, home = _parse_faceoff_dot([glyph], crop_width=420)
        self.assertEqual(away.value, 1)
        self.assertEqual(home.status, FieldStatus.MISSING)

    def test_parse_faceoff_dot_recovers_cjk_lookalikes(self) -> None:
        # On the color-isolated flag chips RapidOCR sometimes falls back to
        # its Chinese characters: "己" instead of "2", "口" instead of "0".
        glyph_2 = self._line("己", 80, 50, conf=0.55)
        away, home = _parse_faceoff_dot([glyph_2], crop_width=420)
        self.assertEqual(away.value, 2)

        glyph_0 = self._line("口", 320, 50, conf=0.56)
        away, home = _parse_faceoff_dot([glyph_0], crop_width=420)
        self.assertEqual(home.value, 0)

    def test_parse_faceoff_dot_rejects_multi_digit_garbage(self) -> None:
        # OCR sometimes splits a single glyph as two-digit garbage ("11").
        # Reject implausible values rather than persisting wrong data.
        glyph = self._line("11", 320, 50, conf=0.50)
        away, home = _parse_faceoff_dot([glyph], crop_width=420)
        self.assertEqual(away.status, FieldStatus.MISSING)
        self.assertEqual(home.value, None)
        self.assertEqual(home.status, FieldStatus.UNCERTAIN)

    def test_full_parser_first_period_ground_truth(self) -> None:
        meta = ExtractionMeta(
            screen_type="post_game_faceoff_map", source_path="fake.png", ocr_backend="fake",
        )
        # Text panel: away (BM) on left, home (4TH) on right, label in middle.
        # x_center: away ≈ 100, label ≈ 250, home ≈ 400 (within stats_panel coords).
        # Three rows separated vertically by > 24 px.
        regions = {
            "period_label": [self._line("1ST PERIOD", 300, 80)],
            "away_label": [self._line("BM(A)", 130, 230)],
            "home_label": [self._line("4TH(H)", 670, 230)],
            "stats_panel": [
                # Row 1: OVERALL WIN %
                self._line("75.0%", 100, 60),
                self._line("OVERALL WIN %", 250, 60),
                self._line("25.0%", 400, 60),
                # Row 2: OFFENSIVE ZONE
                self._line("4/4", 100, 120),
                self._line("OFFENSIVE ZONE", 250, 120),
                self._line("0/0", 400, 120),
                # Row 3: DEFENSIVE ZONE
                self._line("0/0", 100, 180),
                self._line("DEFENSIVE ZONE", 250, 180),
                self._line("0/4", 400, 180),
            ],
            # Nine dots. Wins distributed so sums match: away total = 4, home total = 0.
            # Use lz_top and lz_bot for the four BM offensive-zone wins (BM(A) is on
            # the left side of the rink this match → OZ wins land in left-end zones).
            "dot_lz_top": [self._line("2", 30, 40), self._line("0", 130, 40)],
            "dot_lz_bot": [self._line("2", 30, 40), self._line("0", 130, 40)],
            "dot_lnz_top": [self._line("0", 30, 40), self._line("0", 130, 40)],
            "dot_lnz_bot": [self._line("0", 30, 40), self._line("0", 130, 40)],
            "dot_center": [self._line("0", 30, 40), self._line("0", 130, 40)],
            "dot_rnz_top": [self._line("0", 30, 40), self._line("0", 130, 40)],
            "dot_rnz_bot": [self._line("0", 30, 40), self._line("0", 130, 40)],
            "dot_rz_top": [self._line("0", 30, 40), self._line("0", 130, 40)],
            "dot_rz_bot": [self._line("0", 30, 40), self._line("0", 130, 40)],
        }
        result = parse_post_game_faceoff_map(meta, regions)

        self.assertEqual(result.period_number, 1)
        self.assertEqual(result.away_team_abbr.value, "BM")
        self.assertEqual(result.home_team_abbr.value, "4TH")

        # Overall % (text panel).
        self.assertEqual(result.away.overall_win_pct.value, 75.0)
        self.assertEqual(result.home.overall_win_pct.value, 25.0)

        # Parsed zone splits.
        self.assertEqual(result.away.offensive_zone_wins.value, 4)
        self.assertEqual(result.away.offensive_zone_total.value, 4)
        self.assertEqual(result.away.defensive_zone_wins.value, 0)
        self.assertEqual(result.away.defensive_zone_total.value, 0)
        self.assertEqual(result.home.offensive_zone_wins.value, 0)
        self.assertEqual(result.home.offensive_zone_total.value, 0)
        self.assertEqual(result.home.defensive_zone_wins.value, 0)
        self.assertEqual(result.home.defensive_zone_total.value, 4)

        # Verbatim strings preserved.
        self.assertEqual(result.away.offensive_zone.value, "4/4")
        self.assertEqual(result.home.defensive_zone.value, "0/4")

        # All 9 dots present.
        expected_ids = {
            "lz_top", "lz_bot", "lnz_top", "lnz_bot", "center",
            "rnz_top", "rnz_bot", "rz_top", "rz_bot",
        }
        self.assertEqual(set(result.dots.keys()), expected_ids)

        # Sanity sums against ground truth.
        away_total = sum(
            d.away_wins.value for d in result.dots.values()
            if isinstance(d.away_wins.value, int)
        )
        home_total = sum(
            d.home_wins.value for d in result.dots.values()
            if isinstance(d.home_wins.value, int)
        )
        self.assertEqual(away_total, 4)
        self.assertEqual(home_total, 0)


class NetChartParserTests(unittest.TestCase):
    """Tests for parse_post_game_net_chart and its row/period helpers.

    Ground truth from research/OCR-SS/Action-Tracker/Net-Chart/
    vlcsnap-2026-05-10-02h07m08s705.png (1st period):
      TOTAL: 5/2, WRIST: 1/0, SLAP: 0/0, BACKHAND: 0/0,
      SNAP: 3/1, DEFLECTIONS: 1/0, SHOTS ON PP: 0/0.
    Header totals across all four canonical frames sum to BM 29 / 4TH 16.
    """

    @staticmethod
    def _line(text: str, x_center: float, y_center: float, conf: float = 0.95) -> OCRLine:
        return OCRLine(
            text=text, confidence=conf,
            x1=x_center - 15, x2=x_center + 15,
            y1=y_center - 12, y2=y_center + 12,
        )

    # ─── Period-label helpers ─────────────────────────────────────────────

    def test_period_number_all_periods_explicit(self) -> None:
        self.assertEqual(_net_chart_period_number("ALL PERIODS"), -1)
        self.assertEqual(_net_chart_period_number("RT ALL PERIODS"), -1)

    def test_period_number_unrecognized_returns_zero_not_minus_one(self) -> None:
        # Regression: failed OCR used to default to -1 and silently overwrite
        # the legitimate ALL PERIODS slot.
        self.assertEqual(_net_chart_period_number(""), 0)
        self.assertEqual(_net_chart_period_number("garbled junk"), 0)
        self.assertEqual(_net_chart_period_number("RT"), 0)

    def test_period_number_explicit_periods(self) -> None:
        self.assertEqual(_net_chart_period_number("1ST PERIOD"), 1)
        self.assertEqual(_net_chart_period_number("RT 2ND PERIOD"), 2)
        self.assertEqual(_net_chart_period_number("3RD PERIOD RT"), 3)
        self.assertEqual(_net_chart_period_number("RT OT"), 4)

    def test_clean_period_label_strips_controller_glyphs(self) -> None:
        self.assertEqual(_clean_period_label_text("RT 2ND PERIOD"), "2ND PERIOD")
        self.assertEqual(_clean_period_label_text("1ST PERIOD RT"), "1ST PERIOD")
        self.assertEqual(_clean_period_label_text("  RT  OT  "), "OT")
        self.assertEqual(_clean_period_label_text(""), "")

    # ─── Row-key matcher ──────────────────────────────────────────────────

    def test_row_key_full_word_matchers(self) -> None:
        self.assertEqual(_net_chart_row_key("TOTAL SHOTS"), "total_shots")
        self.assertEqual(_net_chart_row_key("WRIST SHOTS"), "wrist_shots")
        self.assertEqual(_net_chart_row_key("SLAPSHOTS"), "slap_shots")
        self.assertEqual(_net_chart_row_key("SHOTS ON PP"), "power_play_shots")

    def test_row_key_half_word_fallback(self) -> None:
        # Half-word fallbacks rescue rows where RapidOCR drops "SHOTS".
        self.assertEqual(_net_chart_row_key("WRIST"), "wrist_shots")
        self.assertEqual(_net_chart_row_key("SLAP"), "slap_shots")
        self.assertEqual(_net_chart_row_key("BACKHAND"), "backhand_shots")
        self.assertEqual(_net_chart_row_key("SNAP"), "snap_shots")
        self.assertEqual(_net_chart_row_key("DEFLECT"), "deflections")

    def test_row_key_unknown_returns_none(self) -> None:
        self.assertIsNone(_net_chart_row_key("RANDOM JUNK"))
        self.assertIsNone(_net_chart_row_key(""))

    # ─── Full-parser scenarios ────────────────────────────────────────────

    def _meta(self) -> ExtractionMeta:
        return ExtractionMeta(
            screen_type="post_game_net_chart", source_path="fake.png", ocr_backend="fake",
        )

    def _make_regions(
        self,
        period_label: str,
        rows: list[tuple[str, int, int]],
    ) -> dict[str, list[OCRLine]]:
        """Build a regions dict from (label_text, away_value, home_value) rows.

        Each row is rendered at a unique y-center spaced > 20 px apart so
        _group_lines_by_y assigns them to distinct rows.
        """
        regions: dict[str, list[OCRLine]] = {
            "period_label": [self._line(period_label, 300, 80)] if period_label else [],
            "away_label": [self._line("BM(A)", 130, 230)],
            "home_label": [self._line("4TH(H)", 670, 230)],
            "stats_panel": [],
        }
        for i, (label, away, home) in enumerate(rows):
            y = 60 + i * 50
            regions["stats_panel"].extend([
                self._line(str(away), 100, y),
                self._line(label, 250, y),
                self._line(str(home), 400, y),
            ])
        return regions

    def test_full_parser_first_period_ground_truth(self) -> None:
        regions = self._make_regions(
            "1ST PERIOD",
            [
                ("TOTAL SHOTS", 5, 2),
                ("WRIST SHOTS", 1, 0),
                ("SLAPSHOTS", 0, 0),
                ("BACKHAND SHOTS", 0, 0),
                ("SNAP SHOTS", 3, 1),
                ("DEFLECTIONS", 1, 0),
                ("SHOTS ON PP", 0, 0),
            ],
        )
        result = parse_post_game_net_chart(self._meta(), regions)

        self.assertEqual(result.period_number, 1)
        self.assertEqual(result.period_label.value, "1ST PERIOD")
        self.assertEqual(result.away_team_abbr.value, "BM")
        self.assertEqual(result.home_team_abbr.value, "4TH")

        self.assertEqual(result.away.total_shots.value, 5)
        self.assertEqual(result.home.total_shots.value, 2)
        self.assertEqual(result.away.wrist_shots.value, 1)
        self.assertEqual(result.away.snap_shots.value, 3)
        self.assertEqual(result.away.deflections.value, 1)
        self.assertEqual(result.away.power_play_shots.value, 0)
        self.assertEqual(result.home.power_play_shots.value, 0)

    def test_all_periods_label_resolves_to_minus_one(self) -> None:
        regions = self._make_regions(
            "ALL PERIODS",
            [("TOTAL SHOTS", 29, 16)],
        )
        result = parse_post_game_net_chart(self._meta(), regions)
        self.assertEqual(result.period_number, -1)
        self.assertEqual(result.period_label.value, "ALL PERIODS")
        self.assertEqual(result.away.total_shots.value, 29)
        self.assertEqual(result.home.total_shots.value, 16)

    def test_garbled_period_label_resolves_to_zero_not_minus_one(self) -> None:
        regions = self._make_regions(
            "garbled junk",
            [("TOTAL SHOTS", 5, 2)],
        )
        result = parse_post_game_net_chart(self._meta(), regions)
        # Critical: must be 0 (= "do not promote"), not -1 (= ALL PERIODS).
        self.assertEqual(result.period_number, 0)

    def test_period_label_cleaned_strips_controller_prefix(self) -> None:
        regions = self._make_regions(
            "RT 2ND PERIOD",
            [("TOTAL SHOTS", 9, 3)],
        )
        result = parse_post_game_net_chart(self._meta(), regions)
        self.assertEqual(result.period_number, 2)
        self.assertEqual(result.period_label.value, "2ND PERIOD")
        # Raw text preserved for audit.
        self.assertEqual(result.period_label.raw_text, "RT 2ND PERIOD")

    def test_header_total_shots_parsed_from_score_strip(self) -> None:
        # The score-strip header is identical across per-period frames; the
        # promoter uses it to populate the ALL PERIODS row's total_shots.
        regions = self._make_regions(
            "1ST PERIOD",
            [("TOTAL SHOTS", 5, 2)],
        )
        regions["header_total_shots_away"] = [self._line("29 SHOTS", 1060, 260)]
        regions["header_total_shots_home"] = [self._line("16 SHOTS", 1545, 260)]
        result = parse_post_game_net_chart(self._meta(), regions)
        self.assertEqual(result.away_header_total_shots.value, 29)
        self.assertEqual(result.home_header_total_shots.value, 16)

    def test_header_total_shots_missing_when_roi_empty(self) -> None:
        # Older frames (or ROI mis-calibration) may leave the header regions
        # empty. Parser must surface MISSING, not raise.
        regions = self._make_regions(
            "1ST PERIOD",
            [("TOTAL SHOTS", 5, 2)],
        )
        result = parse_post_game_net_chart(self._meta(), regions)
        self.assertEqual(result.away_header_total_shots.status, FieldStatus.MISSING)
        self.assertEqual(result.home_header_total_shots.status, FieldStatus.MISSING)

    def test_multi_line_row_label_split_still_recognized(self) -> None:
        # RapidOCR sometimes returns "WRIST" and "SHOTS" as separate OCRLines
        # on the same row. The row must still be identified as wrist_shots.
        regions: dict[str, list[OCRLine]] = {
            "period_label": [self._line("1ST PERIOD", 300, 80)],
            "away_label": [self._line("BM(A)", 130, 230)],
            "home_label": [self._line("4TH(H)", 670, 230)],
            "stats_panel": [
                self._line("1", 100, 60),
                # Split label spanning two adjacent OCRLines at the same y.
                self._line("WRIST", 230, 60),
                self._line("SHOTS", 280, 60),
                self._line("0", 400, 60),
            ],
        }
        result = parse_post_game_net_chart(self._meta(), regions)
        self.assertEqual(result.away.wrist_shots.value, 1)
        self.assertEqual(result.home.wrist_shots.value, 0)


class BoxScoreParserTests(unittest.TestCase):
    """Tests for parse_post_game_box_score and its period-label normalizer.

    The Box Score grid has a fixed shape: 7 header columns (1ST/2ND/3RD/OT/OT2/OT3/TOT)
    and two stats rows (away/home), each a sequence of integers anchored to the
    header x-centers.
    """

    @staticmethod
    def _line(text: str, x1: float, x2: float, y_center: float, conf: float = 0.95) -> OCRLine:
        return OCRLine(
            text=text, confidence=conf,
            x1=x1, x2=x2,
            y1=y_center - 12, y2=y_center + 12,
        )

    def _meta(self) -> ExtractionMeta:
        return ExtractionMeta(
            screen_type="post_game_box_score_goals", source_path="fake.png", ocr_backend="fake",
        )

    def _header_lines(self, labels: list[str]) -> list[OCRLine]:
        # Place each header at x_center = 100 + 100*i, width 30 (well over the
        # 12px gap threshold). Vertical position is irrelevant — _split_into_columns
        # groups purely by x.
        return [
            self._line(label, 100 + 100 * i - 15, 100 + 100 * i + 15, 200)
            for i, label in enumerate(labels)
        ]

    def _stats_lines(self, values: list[int | str], y: float = 250) -> list[OCRLine]:
        return [
            self._line(str(v), 100 + 100 * i - 15, 100 + 100 * i + 15, y)
            for i, v in enumerate(values)
        ]

    def test_clean_seven_column_row(self) -> None:
        regions: dict[str, list[OCRLine]] = {
            "tab_label": [self._line("GOALS", 50, 110, 80)],
            "period_header_row": self._header_lines(["1ST", "2ND", "3RD", "OT", "OT2", "OT3", "TOT"]),
            "away_team_name": [self._line("BM", 50, 110, 250)],
            "home_team_name": [self._line("4TH", 50, 110, 350)],
            "away_stats_row": self._stats_lines([1, 0, 2, 0, 0, 0, 3], y=250),
            "home_stats_row": self._stats_lines([0, 2, 1, 0, 0, 0, 3], y=350),
        }
        result = parse_post_game_box_score(self._meta(), regions, stat_kind="goals")

        self.assertEqual(len(result.periods), 7)
        self.assertEqual(
            [c.period_number for c in result.periods],
            [1, 2, 3, 4, 5, 6, -1],
        )
        self.assertEqual([c.away_value.value for c in result.periods], [1, 0, 2, 0, 0, 0, 3])
        self.assertEqual([c.home_value.value for c in result.periods], [0, 2, 1, 0, 0, 0, 3])
        self.assertEqual(result.warnings, [])

    def test_glued_digit_token_explosion(self) -> None:
        # Away row arrives as a single OCRLine "23314" spanning the full header
        # width — RapidOCR's typical failure mode for tightly-spaced digits.
        # x span: 85..515 covers the 5 header centers at 100..500.
        regions: dict[str, list[OCRLine]] = {
            "tab_label": [self._line("SHOTS", 50, 110, 80)],
            "period_header_row": self._header_lines(["1ST", "2ND", "3RD", "OT", "TOT"]),
            "away_team_name": [self._line("BM", 50, 110, 250)],
            "home_team_name": [self._line("4TH", 50, 110, 350)],
            "away_stats_row": [self._line("23314", 85, 515, 250)],
            "home_stats_row": self._stats_lines([1, 2, 3, 0, 6], y=350),
        }
        result = parse_post_game_box_score(self._meta(), regions, stat_kind="shots")

        # Five header columns → five period cells, with the glued away digits
        # distributed left-to-right.
        self.assertEqual([c.away_value.value for c in result.periods], [2, 3, 3, 1, 4])
        self.assertEqual([c.home_value.value for c in result.periods], [1, 2, 3, 0, 6])

    def test_unrecognized_header_yields_period_number_zero(self) -> None:
        # An OCR'd header that doesn't normalize ("XYZ") must result in
        # period_number=0 so the promoter skips it (period_number < 1).
        regions: dict[str, list[OCRLine]] = {
            "tab_label": [self._line("GOALS", 50, 110, 80)],
            "period_header_row": [
                *self._header_lines(["1ST", "2ND", "3RD", "OT", "OT2", "OT3", "TOT"]),
                self._line("XYZ", 800 - 15, 800 + 15, 200),
            ],
            "away_team_name": [self._line("BM", 50, 110, 250)],
            "home_team_name": [self._line("4TH", 50, 110, 350)],
            "away_stats_row": self._stats_lines([1, 0, 2, 0, 0, 0, 3, 9], y=250),
            "home_stats_row": self._stats_lines([0, 2, 1, 0, 0, 0, 3, 9], y=350),
        }
        result = parse_post_game_box_score(self._meta(), regions, stat_kind="goals")

        unrecognized = [c for c in result.periods if c.period_label == "XYZ"]
        self.assertEqual(len(unrecognized), 1)
        self.assertEqual(unrecognized[0].period_number, 0)

    def test_col_n_fallback_for_empty_header_text(self) -> None:
        # If a header column exists positionally but its OCR text is empty,
        # the parser falls back to "col_<i>" so we don't silently merge it
        # with an adjacent column.
        regions: dict[str, list[OCRLine]] = {
            "tab_label": [self._line("GOALS", 50, 110, 80)],
            "period_header_row": [
                self._line("1ST", 100 - 15, 100 + 15, 200),
                self._line("", 200 - 15, 200 + 15, 200),
                self._line("TOT", 300 - 15, 300 + 15, 200),
            ],
            "away_team_name": [self._line("BM", 50, 110, 250)],
            "home_team_name": [self._line("4TH", 50, 110, 350)],
            "away_stats_row": self._stats_lines([1, 2, 3], y=250),
            "home_stats_row": self._stats_lines([0, 1, 1], y=350),
        }
        result = parse_post_game_box_score(self._meta(), regions, stat_kind="goals")

        labels = [c.period_label for c in result.periods]
        self.assertTrue(any(label.startswith("col_") for label in labels), labels)
        col_cell = next(c for c in result.periods if c.period_label.startswith("col_"))
        self.assertEqual(col_cell.period_number, 0)

    def test_tot_mismatch_emits_warning(self) -> None:
        # Away periods sum to 4 but TOT reads 5 → warning expected.
        regions: dict[str, list[OCRLine]] = {
            "tab_label": [self._line("GOALS", 50, 110, 80)],
            "period_header_row": self._header_lines(["1ST", "2ND", "3RD", "TOT"]),
            "away_team_name": [self._line("BM", 50, 110, 250)],
            "home_team_name": [self._line("4TH", 50, 110, 350)],
            "away_stats_row": self._stats_lines([1, 1, 2, 5], y=250),  # sum=4, TOT=5
            "home_stats_row": self._stats_lines([0, 0, 0, 0], y=350),
        }
        result = parse_post_game_box_score(self._meta(), regions, stat_kind="goals")

        self.assertTrue(
            any("TOT mismatch" in w and "away" in w for w in result.warnings),
            result.warnings,
        )

    def test_period_label_alias_normalization(self) -> None:
        # Direct _normalize_period_label calls covering the alias table and
        # canonical labels.
        self.assertEqual(_normalize_period_label("0T"), "OT")
        self.assertEqual(_normalize_period_label("T0T"), "TOT")
        self.assertEqual(_normalize_period_label("1SI"), "1ST")
        self.assertEqual(_normalize_period_label("1ST"), "1ST")
        self.assertEqual(_normalize_period_label("OT2"), "OT2")
        self.assertEqual(_normalize_period_label("OT3"), "OT3")
        self.assertEqual(_normalize_period_label("garbage"), "")
        self.assertEqual(_normalize_period_label(""), "")


class BoxScoreRoiTests(unittest.TestCase):
    """Invariant checks on the three Box Score ROI YAMLs.

    The shots/goals/faceoffs configs share an identical layout — they only
    differ in which tab is selected before the screenshot. This test catches
    accidental coordinate drift in one config without the others.
    """

    ROI_DIR = Path(__file__).resolve().parents[1] / "game_ocr" / "configs" / "roi"
    YAML_NAMES = (
        "post_game_box_score_goals.yaml",
        "post_game_box_score_shots.yaml",
        "post_game_box_score_faceoffs.yaml",
    )

    def _load(self, name: str) -> dict:
        with (self.ROI_DIR / name).open() as f:
            return yaml.safe_load(f)

    def test_expected_dimensions_are_1080p(self) -> None:
        for name in self.YAML_NAMES:
            cfg = self._load(name)
            self.assertEqual(cfg["expected_width"], 1920, name)
            self.assertEqual(cfg["expected_height"], 1080, name)

    def test_all_regions_within_frame_bounds(self) -> None:
        for name in self.YAML_NAMES:
            cfg = self._load(name)
            for region_name, r in cfg["regions"].items():
                self.assertGreaterEqual(r["x"], 0.0, f"{name}:{region_name}")
                self.assertGreaterEqual(r["y"], 0.0, f"{name}:{region_name}")
                self.assertLessEqual(r["x"] + r["width"], 1.0, f"{name}:{region_name}")
                self.assertLessEqual(r["y"] + r["height"], 1.0, f"{name}:{region_name}")

    def test_stat_column_row_bands_do_not_overlap(self) -> None:
        # period_header_row, away_stats_row, home_stats_row all sit in the
        # same x-band; their vertical bands must not overlap or rows will
        # bleed into each other during OCR.
        for name in self.YAML_NAMES:
            cfg = self._load(name)
            r = cfg["regions"]
            bands = sorted(
                [
                    ("period_header_row", r["period_header_row"]["y"], r["period_header_row"]["y"] + r["period_header_row"]["height"]),
                    ("away_stats_row", r["away_stats_row"]["y"], r["away_stats_row"]["y"] + r["away_stats_row"]["height"]),
                    ("home_stats_row", r["home_stats_row"]["y"], r["home_stats_row"]["y"] + r["home_stats_row"]["height"]),
                ],
                key=lambda t: t[1],
            )
            for (a_name, _, a_bottom), (b_name, b_top, _) in zip(bands, bands[1:]):
                self.assertLessEqual(
                    a_bottom, b_top,
                    f"{name}: {a_name} (ends {a_bottom}) overlaps {b_name} (starts {b_top})",
                )

    def test_all_three_yamls_share_identical_regions(self) -> None:
        # If a future UI patch shifts coords, fixing one YAML and forgetting
        # the others would silently break the other two tabs. Lock the shape.
        loaded = [self._load(name) for name in self.YAML_NAMES]
        reference_regions = loaded[0]["regions"]
        for name, cfg in zip(self.YAML_NAMES[1:], loaded[1:]):
            self.assertEqual(cfg["regions"], reference_regions, name)


class EventsParserTests(unittest.TestCase):
    """Tests for parse_post_game_events (post-game Events screen list)."""

    @staticmethod
    def _line(text: str, x_center: float, y_center: float, conf: float = 0.95) -> OCRLine:
        return OCRLine(
            text=text, confidence=conf,
            x1=x_center - 20, x2=x_center + 20,
            y1=y_center - 12, y2=y_center + 12,
        )

    def _meta(self) -> ExtractionMeta:
        return ExtractionMeta(
            screen_type="post_game_events", source_path="fake.png", ocr_backend="fake",
        )

    def test_happy_path_single_goal(self) -> None:
        # Period header on its own y-row, followed by a goal line:
        #   <CLOCK> <SCORER> [GOAL_NUM] [ASSIST]
        regions = {
            "filter_label": [self._line("ALL EVENTS", 200, 40)],
            "events_panel": [
                self._line("1ST PERIOD:", 200, 80),
                # The team chip and the detail share a y-row.
                self._line("BM", 60, 140),
                self._line("06:19 silkyjoker851 [1] [WANHG]", 400, 140),
            ],
        }
        result = parse_post_game_events(self._meta(), regions)
        self.assertEqual(len(result.events), 1)
        ev = result.events[0]
        self.assertEqual(ev.event_type, "goal")
        self.assertEqual(ev.period_number, 1)
        self.assertEqual(ev.team_abbreviation.value, "BM")
        self.assertEqual(ev.clock.value, "06:19")
        self.assertEqual(ev.actor_snapshot.value, "silkyjoker851")
        self.assertEqual(ev.goal_number_in_game.value, 1)

    def test_team_token_skips_loss_indicator_ornament(self) -> None:
        # The UI sometimes renders a loss-indicator badge ("L"/"TL"/"IL") to
        # the left of the team logo. The parser must skip those and pick the
        # real team abbrev (here, BM) instead of treating the ornament as the
        # team token.
        regions = {
            "filter_label": [self._line("ALL EVENTS", 200, 40)],
            "events_panel": [
                self._line("1ST PERIOD:", 200, 80),
                self._line("TL", 30, 140),
                self._line("BM", 90, 140),
                self._line("06:19 silkyjoker851 [1] [WANHG]", 400, 140),
            ],
        }
        result = parse_post_game_events(self._meta(), regions)
        self.assertEqual(len(result.events), 1)
        self.assertEqual(result.events[0].team_abbreviation.value, "BM")

    def test_penalty_row_parsed(self) -> None:
        regions = {
            "filter_label": [self._line("ALL EVENTS", 200, 40)],
            "events_panel": [
                self._line("2ND PERIOD:", 200, 80),
                self._line("4TH", 60, 140),
                self._line("12:34 someplayer Tripping Minor", 400, 140),
            ],
        }
        result = parse_post_game_events(self._meta(), regions)
        self.assertEqual(len(result.events), 1)
        ev = result.events[0]
        self.assertEqual(ev.event_type, "penalty")
        self.assertEqual(ev.period_number, 2)
        self.assertEqual(ev.clock.value, "12:34")
        self.assertEqual(ev.infraction.value, "Tripping")
        self.assertEqual(ev.penalty_type.value, "Minor")

    def test_unknown_row_without_clock_surfaces_missing_clock(self) -> None:
        # A row that doesn't match goal/penalty regexes and has no clock
        # token at all falls through to event_type='unknown' with the clock
        # field marked MISSING. Promoter-side filtering drops these.
        regions = {
            "filter_label": [self._line("ALL EVENTS", 200, 40)],
            "events_panel": [
                self._line("1ST PERIOD:", 200, 80),
                self._line("BM", 60, 140),
                self._line("garbage text with no clock or pattern", 400, 140),
            ],
        }
        result = parse_post_game_events(self._meta(), regions)
        self.assertEqual(len(result.events), 1)
        ev = result.events[0]
        self.assertEqual(ev.event_type, "unknown")
        self.assertEqual(ev.clock.status, FieldStatus.MISSING)


class ActionTrackerParserTests(unittest.TestCase):
    """Tests for parse_post_game_action_tracker (in-game Action Tracker list)."""

    @staticmethod
    def _line(text: str, x_center: float, y_center: float, conf: float = 0.95) -> OCRLine:
        return OCRLine(
            text=text, confidence=conf,
            x1=x_center - 30, x2=x_center + 30,
            y1=y_center - 12, y2=y_center + 12,
        )

    def _meta(self) -> ExtractionMeta:
        return ExtractionMeta(
            screen_type="post_game_action_tracker",
            source_path="fake.png",
            ocr_backend="fake",
        )

    def test_event_type_levenshtein_recovers_ocr_typos(self) -> None:
        # The RapidOCR backend swaps O↔D in this panel font:
        #   "SHOT" → "SHDT", "GOAL" → "GDAL"
        # Exact-match would drop these; the parser's Levenshtein-1 fallback
        # must recover both to their canonical types.
        self.assertEqual(_action_tracker_event_type("SHDT"), "shot")
        self.assertEqual(_action_tracker_event_type("GDAL"), "goal")
        # Far-distance garbage stays unknown.
        self.assertEqual(_action_tracker_event_type("XYZ123"), "unknown")
        # Exact matches still work.
        self.assertEqual(_action_tracker_event_type("HIT"), "hit")
        self.assertEqual(_action_tracker_event_type("PENALTY"), "penalty")

    def test_two_events_grouped_separately_when_well_spaced(self) -> None:
        # Two events ~200 px apart on the y-axis. Each event has its actor
        # row (with ON|VS) and a detail row carrying clock + type.
        regions = {
            "filter_label": [self._line("ALL", 100, 50)],
            "period_label": [self._line("1ST PERIOD", 300, 80)],
            "list_panel": [
                # Event 1 — shot at 08:03.
                self._line("E. WANHG ON M. LEHMANN", 300, 200),
                self._line("SHOT 08:03", 300, 250),
                # Event 2 — hit at 12:34, well-separated (>140px).
                self._line("J. TOEWS ON K. SILKY", 300, 500),
                self._line("HIT 12:34", 300, 550),
            ],
        }
        result = parse_post_game_action_tracker(self._meta(), regions)
        self.assertEqual(len(result.events), 2)
        types = sorted(ev.event_type for ev in result.events)
        self.assertEqual(types, ["hit", "shot"])
        clocks = sorted(ev.clock.value for ev in result.events if ev.clock.value)
        self.assertEqual(clocks, ["08:03", "12:34"])

    def test_relation_regex_tolerates_run_in_with_target_initial(self) -> None:
        # Regression for commit b6874ec: RapidOCR sometimes drops the space
        # between "ON" and the target's leading initial, producing e.g.
        # "WANHG ONM. LEHMANN". The old regex required whitespace on both
        # sides of ON|VS and silently dropped the event group.
        regions = {
            "filter_label": [self._line("ALL", 100, 50)],
            "period_label": [self._line("3RD PERIOD", 300, 80)],
            "list_panel": [
                self._line("E. WANHG ONM. LEHMANN", 300, 200),
                self._line("SHOT 08:03", 300, 250),
            ],
        }
        result = parse_post_game_action_tracker(self._meta(), regions)
        self.assertEqual(len(result.events), 1)
        ev = result.events[0]
        self.assertEqual(ev.event_type, "shot")
        self.assertEqual(ev.clock.value, "08:03")
        self.assertEqual(ev.relation.value, "ON")
        # Actor stops at the relation token; target picks up after it.
        self.assertIn("WANHG", ev.actor_snapshot.value or "")
        self.assertIn("LEHMANN", ev.target_snapshot.value or "")

    def test_clock_bounds_reject_out_of_range_seconds(self) -> None:
        # The bounded regex `[01]?\d:[0-5]\d` rejects implausible clocks so
        # OCR noise doesn't land in the DB. SS > 59 (e.g. "12:99") has no
        # valid substring match, so the row surfaces with clock = MISSING.
        # (Note: out-of-range minutes like "71:10" can still substring-match
        # as "1:10" because the tens-of-minutes digit is optional — that
        # case is harder to guard at the regex level.)
        regions = {
            "filter_label": [self._line("ALL", 100, 50)],
            "period_label": [self._line("2ND PERIOD", 300, 80)],
            "list_panel": [
                self._line("J. TOEWS ON K. SILKY", 300, 200),
                self._line("HIT 12:99", 300, 250),
            ],
        }
        result = parse_post_game_action_tracker(self._meta(), regions)
        self.assertEqual(len(result.events), 1)
        ev = result.events[0]
        # Type still recovered from the row even when the clock is rejected.
        self.assertEqual(ev.event_type, "hit")
        self.assertEqual(ev.clock.status, FieldStatus.MISSING)
        self.assertIsNone(ev.clock.value)


class FakeExtractorTests(unittest.TestCase):
    def test_wrong_image_path_returns_failure(self) -> None:
        extractor = Extractor(registry=ScreenRegistry())
        result = extractor.extract_path("pre_game_lobby_state_1", Path("missing.png"))
        self.assertIsInstance(result, FailedExtractionResult)


if __name__ == "__main__":
    unittest.main()
