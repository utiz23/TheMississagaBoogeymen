from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


class CLISmokeTests(unittest.TestCase):
    def test_extract_single_image(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            output = Path(tmpdir) / "result.json"
            command = [
                "python3",
                "-m",
                "game_ocr.cli",
                "extract",
                "--screen",
                "pre_game_lobby_state_1",
                "--input",
                str(ROOT / "ScreenShots" / "Pre-Game Lobby State 1.png"),
                "--output",
                str(output),
            ]
            proc = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, check=False)
            self.assertTrue(output.exists(), proc.stderr)
            data = json.loads(output.read_text())
            self.assertEqual(len(data), 1)
            self.assertEqual(data[0]["meta"]["screen_type"], "pre_game_lobby_state_1")


if __name__ == "__main__":
    unittest.main()
