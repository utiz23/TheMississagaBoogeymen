"""video_ingest — two-pass video → OCR frames orchestrator.

Bootstraps the sibling tools/game_ocr package onto sys.path. The video_ingest
submodules import game_ocr at module load time, so this must run before any
video_ingest.* submodule is imported. Centralizing it here covers the CLI,
tests, and ad-hoc importers without each having to set PYTHONPATH manually.
"""

from __future__ import annotations

import sys
from pathlib import Path

_GAME_OCR_PATH = str(Path(__file__).resolve().parents[2] / "game_ocr")
if _GAME_OCR_PATH not in sys.path:
    sys.path.insert(0, _GAME_OCR_PATH)

__version__ = "0.1.0"
