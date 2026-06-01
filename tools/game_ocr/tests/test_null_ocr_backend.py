"""_NullOCRBackend reads nothing — the no-OCR backend the WS2 Pass-1 gate
slots in for frames classified as unambiguously non-text."""

from __future__ import annotations

import unittest

import numpy as np

from game_ocr.ocr import _NullOCRBackend


class TestNullOCRBackend(unittest.TestCase):
    def test_read_returns_empty(self) -> None:
        backend = _NullOCRBackend()
        img = np.zeros((1080, 1920, 3), dtype=np.uint8)
        self.assertEqual(backend.read(img), [])

    def test_read_returns_empty_for_nonblack_image(self) -> None:
        backend = _NullOCRBackend()
        img = np.full((100, 100, 3), 200, dtype=np.uint8)
        self.assertEqual(backend.read(img), [])

    def test_has_name(self) -> None:
        self.assertEqual(_NullOCRBackend().name, "null")


if __name__ == "__main__":
    unittest.main()
