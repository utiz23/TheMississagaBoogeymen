"""Tests for the Phase 3a diagnostic script `scripts/diagnose_segments.py`.

We don't reach into the script's internals — instead we run it as a subprocess
against the labeled match-250 clip fixture and verify the TSV is well-formed.
"""

from __future__ import annotations

import csv
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "tools" / "game_ocr" / "scripts" / "diagnose_segments.py"
CLIP = REPO_ROOT / "tools" / "video_ingest" / "tests" / "fixtures" / "match-250-clip.mkv"
LABELS = REPO_ROOT / "tools" / "video_ingest" / "tests" / "fixtures" / "match-250-clip-segments.json"
WEIGHTS = REPO_ROOT / "tools" / "game_ocr" / "game_ocr" / "weights" / "nhl26-screen-classifier-v1.json"


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg not on PATH")
@unittest.skipUnless(CLIP.exists(), "test clip not present")
@unittest.skipUnless(WEIGHTS.exists(), "Phase 1 classifier weights not present")
class TestDiagnoseSegments(unittest.TestCase):
    def test_emits_well_formed_tsv(self):
        out = REPO_ROOT / "tools" / "game_ocr" / "diagnostics" / "phase-3a" / "test-clip.tsv"
        if out.exists():
            out.unlink()
        env = {
            "PYTHONPATH": f"{REPO_ROOT / 'tools' / 'video_ingest'}:{REPO_ROOT / 'tools' / 'game_ocr'}",
            "PATH": "/usr/bin:/bin:/usr/local/bin",
        }
        cmd = [
            sys.executable, str(SCRIPT),
            "--video", str(CLIP),
            "--segments-json", str(LABELS),
            "--version", "nhl26",
            "--out", str(out),
        ]
        result = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=300)
        self.assertEqual(
            result.returncode, 0,
            msg=f"diagnose_segments.py failed: {result.stderr}",
        )
        self.assertTrue(out.exists(), msg=f"TSV not written: {out}")

        with out.open() as fh:
            reader = csv.DictReader(fh, delimiter="\t")
            header = reader.fieldnames or []
            rows = list(reader)

        # Expected columns
        for col in (
            "t_sec", "viterbi_screen", "gt_screen",
            "top1", "top1_lp", "top2", "top2_lp",
            "lp_pre_game_lobby_state_1", "lp_pre_game_lobby_state_2",
            "lp_player_loadout_view",
            "anchor_flags", "anchor_text", "reject",
        ):
            self.assertIn(col, header, msg=f"missing column {col!r}")

        # match-250-clip.mkv is 60.066s; the canonical-PTS sampler
        # (iter_sampled_frames, the production Pass-1 sampler since c872670)
        # emits one sample per 1s boundary t=0..60 = 61 rows. The old
        # ffmpeg `fps=1` sampler emitted 60; this assertion was updated when
        # diagnose_segments.py was rewired to the canonical-PTS sampler.
        self.assertEqual(len(rows), 61, msg=f"expected 61 rows, got {len(rows)}")

        # Spot-check the first row's log-probs are finite.
        first = rows[0]
        for col in (
            "top1_lp", "top2_lp",
            "lp_pre_game_lobby_state_1", "lp_pre_game_lobby_state_2",
            "lp_player_loadout_view",
        ):
            val = float(first[col])
            self.assertFalse(
                val != val,  # NaN check
                msg=f"NaN in column {col!r} on first row",
            )

        # The hand-labeled fixture stamps lobby + loadout in different frame
        # windows — when we pass it as --segments-json we should see at least
        # one row with `viterbi_screen == pre_game_lobby_state_2` (frames 7-15
        # and 29-50 per the fixture).
        lobby_rows = [r for r in rows if r["viterbi_screen"] == "pre_game_lobby_state_2"]
        self.assertGreater(len(lobby_rows), 0, msg="no lobby rows stamped from fixture")


if __name__ == "__main__":
    unittest.main()
