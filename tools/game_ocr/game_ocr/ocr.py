from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np
from rapidocr_onnxruntime import RapidOCR

from game_ocr.utils import normalize_text


@dataclass
class OCRLine:
    text: str
    confidence: float
    x1: float = 0.0
    y1: float = 0.0
    x2: float = 0.0
    y2: float = 0.0

    @property
    def y_center(self) -> float:
        return (self.y1 + self.y2) / 2.0

    @property
    def x_center(self) -> float:
        return (self.x1 + self.x2) / 2.0


class OCRBackend(Protocol):
    name: str

    def read(self, image: np.ndarray) -> list[OCRLine]:
        ...


class RapidOCRBackend:
    name = "rapidocr_onnxruntime"

    def __init__(self) -> None:
        self._engine = RapidOCR()

    def read(self, image: np.ndarray) -> list[OCRLine]:
        result, _ = self._engine(image)
        if not result:
            return []
        lines: list[OCRLine] = []
        for box, text, confidence in result:
            normalized = normalize_text(text)
            if normalized:
                xs = [point[0] for point in box]
                ys = [point[1] for point in box]
                lines.append(
                    OCRLine(
                        text=normalized,
                        confidence=float(confidence),
                        x1=float(min(xs)),
                        y1=float(min(ys)),
                        x2=float(max(xs)),
                        y2=float(max(ys)),
                    )
                )
        return lines
