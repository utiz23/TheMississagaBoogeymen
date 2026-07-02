"""Phase E — away-side persona (player_name_full) extraction.

The AWAY left strip lists the persona name BEFORE the jersey number with no
leading dash (``"Drew P Hog-#69"``), a layout that neither the number-first
``_NAME_RE`` nor the leading-dash ``_NAME_RE_OPP`` matched — so away-side
personas read as None (home 5/5, away 0/5 on the match-2577 benchmark). These
tests pin the parse fix: away personas now extract, and the HOME/OPP formats are
unchanged.

Synthetic OCR lines mirror the real content-band reads captured off the 2577
frames (see the diagnostic in the Phase E session): each away row has a gamertag
line (no ``#``) followed by a ``Name-#NN`` persona line, both inside the row
content band (x in [130, 400]).
"""

from __future__ import annotations

import unittest

from game_ocr.ocr import OCRLine
from game_ocr.loadout_extractors.slot_identity import (
    _persona_name_from_summary,
    extract_subject_identity,
)


class PersonaFromSummaryTests(unittest.TestCase):
    """Unit-level coverage of the away-format normalizer."""

    def test_away_name_before_number_no_leading_dash(self) -> None:
        # The exact reads observed on the 2577 away rows.
        self.assertEqual(_persona_name_from_summary("Drew P Hog-#69"), "Drew P Hog")
        self.assertEqual(_persona_name_from_summary("Drew PHog-#69"), "Drew PHog")
        self.assertEqual(
            _persona_name_from_summary("Houselicks Hungmen-#21"), "Houselicks Hungmen"
        )
        self.assertEqual(
            _persona_name_from_summary("Laced Her Drink-#26"), "Laced Her Drink"
        )
        self.assertEqual(_persona_name_from_summary("Wayne Kinit-#8"), "Wayne Kinit")
        self.assertEqual(_persona_name_from_summary("Hog Fitzwell-#5"), "Hog Fitzwell")

    def test_home_and_opp_formats_still_normalize(self) -> None:
        # Not the primary path (structured regexes handle these first) but the
        # normalizer must stay consistent if it ever runs on them.
        self.assertEqual(_persona_name_from_summary("#10--Silky"), "Silky")
        self.assertEqual(_persona_name_from_summary("-Toews-#19"), "Toews")

    def test_non_persona_lines_return_none(self) -> None:
        # Gamertag line (no "#") — must never be read as a persona.
        self.assertIsNone(_persona_name_from_summary("EndlessMitchh"))
        self.assertIsNone(_persona_name_from_summary("MAJORBLAKA958"))
        # Level fragments.
        self.assertIsNone(_persona_name_from_summary("P3LVL2"))
        self.assertIsNone(_persona_name_from_summary("LVL48"))
        # HUD label / height-weight / team header.
        self.assertIsNone(_persona_name_from_summary("AWAY"))
        self.assertIsNone(_persona_name_from_summary("6'2\"|180LBS|#1"))
        self.assertIsNone(_persona_name_from_summary("THE BOOGEYMEN-#1"))
        # Line with a name but no jersey number is not a summary line.
        self.assertIsNone(_persona_name_from_summary("Drew P Hog"))


def _row_frame(gamertag: str, position: str, persona_line: str, *, anchor_y: float = 300.0):
    """Minimal single-row loadout frame: top-right gamertag + one left-strip row.

    The row carries a position anchor (x<130), a content gamertag line and a
    content persona line, both in the row content band around ``anchor_y``.
    """
    return [
        # Subject gamertag — top-right corner (y<200, x>1400).
        OCRLine(text=gamertag, confidence=0.99, x1=1600, y1=182, x2=1760, y2=200),
        # Left-strip position anchor (x<130).
        OCRLine(text=position, confidence=1.0, x1=100, y1=anchor_y - 10, x2=125, y2=anchor_y + 10),
        # Row content: gamertag line (no "#") then the persona summary line.
        OCRLine(text=gamertag, confidence=0.98, x1=250, y1=anchor_y - 10, x2=340, y2=anchor_y + 10),
        OCRLine(text=persona_line, confidence=0.97, x1=270, y1=anchor_y + 5, x2=345, y2=anchor_y + 25),
    ]


class ExtractSubjectIdentityPersonaTests(unittest.TestCase):
    """End-to-end: the extractor recovers the persona from a matched row."""

    def test_away_format_persona_extracted(self) -> None:
        lines = _row_frame("EndlessMitchh", "C", "Drew P Hog-#69")
        ident = extract_subject_identity(None, ocr_lines=lines)
        self.assertIsNotNone(ident)
        self.assertEqual(ident.gamertag, "EndlessMitchh")
        self.assertEqual(ident.jersey_number, 69)
        self.assertEqual(ident.player_name_full, "Drew P Hog")

    def test_home_format_persona_unchanged(self) -> None:
        lines = _row_frame("silkyjoker85", "C", "#10--Silky")
        ident = extract_subject_identity(None, ocr_lines=lines)
        self.assertIsNotNone(ident)
        self.assertEqual(ident.gamertag, "silkyjoker85")
        self.assertEqual(ident.jersey_number, 10)
        self.assertEqual(ident.player_name_full, "Silky")


if __name__ == "__main__":
    unittest.main()
