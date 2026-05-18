"""Regression tests for the video_ingest CLI / package bootstrap.

Issue 1 (2026-05-16 review): a clean interpreter with only tools/video_ingest
on PYTHONPATH used to fail with ModuleNotFoundError: No module named 'game_ocr'
because cli.py imported the orchestrator before injecting the sibling game_ocr
path. These tests pin the contract that the package bootstraps the sibling
path on its own.
"""

from __future__ import annotations

import os
import subprocess
import sys
import unittest
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parent.parent
TOOLS_DIR = PACKAGE_ROOT.parent
GAME_OCR_DIR = TOOLS_DIR / "game_ocr"


def _clean_env_with_video_ingest_only() -> dict[str, str]:
    """Build an env where PYTHONPATH points only at tools/video_ingest.

    The bug manifests precisely when game_ocr is reachable on disk but not
    on sys.path; the package must bootstrap it.
    """
    env = os.environ.copy()
    env["PYTHONPATH"] = str(PACKAGE_ROOT)
    return env


@unittest.skipUnless(GAME_OCR_DIR.is_dir(), f"sibling game_ocr not found at {GAME_OCR_DIR}")
class CLISmokeTests(unittest.TestCase):
    def test_cli_help_in_clean_interpreter(self) -> None:
        """`python -m video_ingest.cli --help` must work without game_ocr on PYTHONPATH."""
        proc = subprocess.run(
            [sys.executable, "-m", "video_ingest.cli", "--help"],
            cwd=TOOLS_DIR,
            env=_clean_env_with_video_ingest_only(),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, f"stderr:\n{proc.stderr}\nstdout:\n{proc.stdout}")
        out = proc.stdout + proc.stderr
        for cmd in ("ingest", "classify-only", "extract-only"):
            self.assertIn(cmd, out, f"missing subcommand '{cmd}' in --help output")

    def test_orchestrator_import_in_clean_interpreter(self) -> None:
        """`from video_ingest.orchestrator import ingest` must work the same way.

        Tests and notebooks that bypass cli.py hit the same import chain and
        need the bootstrap to happen at package-load time.
        """
        proc = subprocess.run(
            [sys.executable, "-c", "from video_ingest.orchestrator import ingest; print('ok')"],
            cwd=TOOLS_DIR,
            env=_clean_env_with_video_ingest_only(),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, f"stderr:\n{proc.stderr}\nstdout:\n{proc.stdout}")
        self.assertIn("ok", proc.stdout)


if __name__ == "__main__":
    unittest.main()
