from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image


@dataclass(frozen=True)
class Region:
    name: str
    x: float
    y: float
    width: float
    height: float
    preprocess: str = "default"


def load_image(path: str) -> np.ndarray:
    with Image.open(path) as image:
        return cv2.cvtColor(np.array(image.convert("RGB")), cv2.COLOR_RGB2BGR)


def crop_region(image: np.ndarray, region: Region) -> np.ndarray:
    height, width = image.shape[:2]
    x1 = max(0, int(region.x * width))
    y1 = max(0, int(region.y * height))
    x2 = min(width, int((region.x + region.width) * width))
    y2 = min(height, int((region.y + region.height) * height))
    return image[y1:y2, x1:x2].copy()


def preprocess_image(image: np.ndarray, mode: str) -> np.ndarray:
    # Skip gray + 2x upscale when the parser needs OCR bboxes in native
    # image coordinates (e.g. anchor-based full-frame parsing).
    if mode == "raw" or mode == "none":
        return image
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    scaled = cv2.resize(gray, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
    if mode == "threshold":
        _, thresh = cv2.threshold(scaled, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return thresh
    if mode == "invert-threshold":
        _, thresh = cv2.threshold(scaled, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return 255 - thresh
    return scaled

