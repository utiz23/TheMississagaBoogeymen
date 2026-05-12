"""Spatial extraction: detect event markers on rink illustrations and map their
pixel positions to hockey-standard coordinates.

Phase 5 of the OCR build. Currently only Action Tracker is supported. The plan
extends to Faceoff Map and Net Chart later.

The pipeline:
  1. Load rink calibration (per-screen JSON in `configs/rink/`).
  2. Crop the rink region from the full screenshot.
  3. HSV color masks isolate marker colors (yellow=selected, red=event,
     white=event).
  4. Morphological cleanup + contour detection produce candidate markers.
  5. Filter contours by area + circularity.
  6. Convert centroids from pixel space to hockey-standard via the calibration's
     bounding box.

Hockey coords used here:
  x ∈ [-100, +100]: length of rink. BGM attacks +x (per `bgm_attacks` field).
  y ∈ [-42.5, +42.5]: width of rink.
  rink_zone: 'offensive' if x > 25, 'defensive' if x < -25, else 'neutral'.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import cv2
import numpy as np


@dataclass(frozen=True)
class RinkPixelBox:
    x1: int
    y1: int
    x2: int
    y2: int

    @property
    def width(self) -> int:
        return self.x2 - self.x1

    @property
    def height(self) -> int:
        return self.y2 - self.y1

    @property
    def center_x(self) -> float:
        return (self.x1 + self.x2) / 2.0

    @property
    def center_y(self) -> float:
        return (self.y1 + self.y2) / 2.0


@dataclass(frozen=True)
class ColorThreshold:
    """HSV mask params. Red has a wraparound so two H ranges are supported."""

    h_min: int = 0
    h_max: int = 0
    s_min: int = 0
    s_max: int = 255
    v_min: int = 0
    v_max: int = 255
    # For red wraparound. None for non-red colors.
    h_min_b: int | None = None
    h_max_b: int | None = None


@dataclass(frozen=True)
class MarkerFilter:
    area_min: float = 100.0
    area_max: float = 1500.0
    circularity_min: float = 0.55


@dataclass(frozen=True)
class RinkCalibration:
    screen_type: str
    expected_width: int
    expected_height: int
    rink_pixel_box: RinkPixelBox
    bgm_attacks: Literal["right", "left"]
    reference_points: dict[str, tuple[int, int]]
    color_thresholds: dict[str, ColorThreshold]
    marker_filter: MarkerFilter


@dataclass
class DetectedMarker:
    """A marker found on the rink. pixel_x/y are in FULL-IMAGE coordinates."""

    pixel_x: float
    pixel_y: float
    color: Literal["yellow", "red", "white"]
    area_px: float
    bbox: tuple[int, int, int, int]  # x, y, w, h (full-image)


@dataclass
class RinkCoordinate:
    x: float  # hockey-standard, BGM-perspective: positive x = offensive zone
    y: float  # hockey-standard
    rink_zone: Literal["offensive", "defensive", "neutral"]
    confidence: float


# ─── Calibration loading ──────────────────────────────────────────────────────


_CALIBRATION_DIR = Path(__file__).parent / "configs" / "rink"


def load_rink_calibration(screen_type: str) -> RinkCalibration:
    """Load and parse the rink calibration JSON for a given screen type."""
    path = _CALIBRATION_DIR / f"{screen_type}.json"
    if not path.exists():
        raise FileNotFoundError(
            f"No rink calibration found for {screen_type!r} at {path}"
        )
    raw = json.loads(path.read_text())

    box_raw = raw["rink_pixel_box"]
    box = RinkPixelBox(
        x1=int(box_raw["x1"]),
        y1=int(box_raw["y1"]),
        x2=int(box_raw["x2"]),
        y2=int(box_raw["y2"]),
    )

    refs: dict[str, tuple[int, int]] = {}
    for name, pt in raw.get("reference_points", {}).items():
        refs[name] = (int(pt["x"]), int(pt["y"]))

    thresholds: dict[str, ColorThreshold] = {}
    for color, t in raw.get("color_thresholds", {}).items():
        thresholds[color] = ColorThreshold(
            h_min=int(t.get("h_min", 0) if "h_min" in t else t.get("h_min_a", 0)),
            h_max=int(t.get("h_max", 180) if "h_max" in t else t.get("h_max_a", 180)),
            s_min=int(t.get("s_min", 0)),
            s_max=int(t.get("s_max", 255)),
            v_min=int(t.get("v_min", 0)),
            v_max=int(t.get("v_max", 255)),
            h_min_b=int(t["h_min_b"]) if "h_min_b" in t else None,
            h_max_b=int(t["h_max_b"]) if "h_max_b" in t else None,
        )

    mf_raw = raw.get("marker_filter", {})
    marker_filter = MarkerFilter(
        area_min=float(mf_raw.get("area_min", 100.0)),
        area_max=float(mf_raw.get("area_max", 1500.0)),
        circularity_min=float(mf_raw.get("circularity_min", 0.55)),
    )

    bgm_attacks = raw.get("bgm_attacks", "right")
    if bgm_attacks not in {"right", "left"}:
        raise ValueError(f"bgm_attacks must be 'right' or 'left', got {bgm_attacks!r}")

    return RinkCalibration(
        screen_type=raw["screen_type"],
        expected_width=int(raw["expected_width"]),
        expected_height=int(raw["expected_height"]),
        rink_pixel_box=box,
        bgm_attacks=bgm_attacks,  # type: ignore[arg-type]
        reference_points=refs,
        color_thresholds=thresholds,
        marker_filter=marker_filter,
    )


# ─── Marker detection ─────────────────────────────────────────────────────────


def _color_mask(hsv: np.ndarray, t: ColorThreshold) -> np.ndarray:
    """Build an HSV color mask, supporting red's H wraparound."""
    mask_a = cv2.inRange(
        hsv,
        np.array([t.h_min, t.s_min, t.v_min], dtype=np.uint8),
        np.array([t.h_max, t.s_max, t.v_max], dtype=np.uint8),
    )
    if t.h_min_b is not None and t.h_max_b is not None:
        mask_b = cv2.inRange(
            hsv,
            np.array([t.h_min_b, t.s_min, t.v_min], dtype=np.uint8),
            np.array([t.h_max_b, t.s_max, t.v_max], dtype=np.uint8),
        )
        return cv2.bitwise_or(mask_a, mask_b)
    return mask_a


def _morphological_clean(mask: np.ndarray) -> np.ndarray:
    """Remove pixel-noise specks while preserving marker shapes."""
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    eroded = cv2.erode(mask, kernel, iterations=1)
    dilated = cv2.dilate(eroded, kernel, iterations=1)
    return dilated


def _circularity(area: float, perimeter: float) -> float:
    if perimeter <= 0:
        return 0.0
    return 4.0 * np.pi * area / (perimeter * perimeter)


def detect_rink_markers(
    image: np.ndarray, calibration: RinkCalibration
) -> list[DetectedMarker]:
    """Find marker candidates on the rink illustration.

    image: full-frame BGR image (np.ndarray of shape (H, W, 3)).
    Returns markers in FULL-IMAGE pixel coordinates.
    """
    box = calibration.rink_pixel_box
    # Clamp to image bounds defensively.
    h, w = image.shape[:2]
    x1 = max(0, min(w, box.x1))
    x2 = max(0, min(w, box.x2))
    y1 = max(0, min(h, box.y1))
    y2 = max(0, min(h, box.y2))
    if x2 <= x1 or y2 <= y1:
        return []
    crop = image[y1:y2, x1:x2]
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)

    markers: list[DetectedMarker] = []
    mf = calibration.marker_filter

    for color_name, threshold in calibration.color_thresholds.items():
        mask = _color_mask(hsv, threshold)
        mask = _morphological_clean(mask)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            area = float(cv2.contourArea(c))
            if area < mf.area_min or area > mf.area_max:
                continue
            perim = float(cv2.arcLength(c, closed=True))
            if _circularity(area, perim) < mf.circularity_min:
                continue
            m = cv2.moments(c)
            if m["m00"] == 0:
                continue
            cx_crop = m["m10"] / m["m00"]
            cy_crop = m["m01"] / m["m00"]
            bx, by, bw, bh = cv2.boundingRect(c)
            markers.append(
                DetectedMarker(
                    pixel_x=x1 + cx_crop,
                    pixel_y=y1 + cy_crop,
                    color=color_name,  # type: ignore[arg-type]
                    area_px=area,
                    bbox=(x1 + bx, y1 + by, bw, bh),
                )
            )

    return markers


def find_selected_marker(markers: list[DetectedMarker]) -> DetectedMarker | None:
    """Among detected markers, return the unique yellow one (the selected event).

    If 0 yellow markers → None. If multiple → pick the largest (false positives
    from rink texture tend to be small specks).
    """
    yellow = [m for m in markers if m.color == "yellow"]
    if not yellow:
        return None
    if len(yellow) == 1:
        return yellow[0]
    return max(yellow, key=lambda m: m.area_px)


def pixel_to_hockey(
    marker: DetectedMarker, calibration: RinkCalibration
) -> RinkCoordinate:
    """Convert a marker's full-image pixel position to hockey-standard coords."""
    box = calibration.rink_pixel_box
    half_w = box.width / 2.0
    half_h = box.height / 2.0
    if half_w <= 0 or half_h <= 0:
        raise ValueError("Rink calibration has zero/negative width or height")

    cx = box.center_x
    cy = box.center_y

    # Normalized to [-1, +1] within rink box.
    x_norm = (marker.pixel_x - cx) / half_w
    y_norm = (marker.pixel_y - cy) / half_h
    # Clamp to [-1.05, +1.05] — markers very close to the boards may go slightly
    # outside the bbox due to anti-aliasing.
    x_norm = max(-1.05, min(1.05, x_norm))
    y_norm = max(-1.05, min(1.05, y_norm))

    # Hockey-standard. y inverted because pixel y increases downward.
    x_hockey = x_norm * 100.0
    y_hockey = -y_norm * 42.5

    if calibration.bgm_attacks == "left":
        x_hockey = -x_hockey

    if x_hockey > 25.0:
        zone: Literal["offensive", "defensive", "neutral"] = "offensive"
    elif x_hockey < -25.0:
        zone = "defensive"
    else:
        zone = "neutral"

    return RinkCoordinate(
        x=round(x_hockey, 2),
        y=round(y_hockey, 2),
        rink_zone=zone,
        confidence=1.0,
    )


# ─── Public convenience wrapper ──────────────────────────────────────────────


@dataclass
class SpatialResult:
    """High-level result for a single capture's spatial analysis."""

    selected_coordinate: RinkCoordinate | None
    detected_marker_count: int
    yellow_marker_count: int
    warnings: list[str] = field(default_factory=list)


def detect_bgm_attack_direction(
    image: np.ndarray,
    *,
    left_bar_px: tuple[int, int] = (840, 606),
    right_bar_px: tuple[int, int] = (1774, 606),
    sample_radius: int = 2,
) -> Literal["left", "right"] | None:
    """Detect which side BGM attacks in this capture's in-game rink art.

    Each end-zone trapezoid (behind each net) holds a thin colored bar that
    matches the attacking team's colors. BGM bar is red and wider; opp bar is
    black. We sample a small block at each side's bar pixel and pick BGM as
    whichever side reads as red.

    Returns 'left' or 'right' (which side BGM attacks), or None if both bars
    look the same (image is bad or the capture isn't an Action Tracker view).
    """
    h, w = image.shape[:2]
    if w < right_bar_px[0] + sample_radius or h < right_bar_px[1] + sample_radius:
        return None

    def is_red(px: tuple[int, int]) -> bool:
        x, y = px
        y1 = max(0, y - sample_radius)
        y2 = min(h, y + sample_radius + 1)
        x1 = max(0, x - sample_radius)
        x2 = min(w, x + sample_radius + 1)
        block = image[y1:y2, x1:x2]
        if block.size == 0:
            return False
        bgr_mean = block.mean(axis=(0, 1))
        hsv = cv2.cvtColor(
            np.uint8([[bgr_mean]]), cv2.COLOR_BGR2HSV
        )[0, 0]
        # Red hue wraps; saturation > 100 and value > 100 rules out black/dark.
        h_val, s_val, v_val = int(hsv[0]), int(hsv[1]), int(hsv[2])
        red_hue = h_val < 15 or h_val > 168
        return red_hue and s_val > 100 and v_val > 100

    left_red = is_red(left_bar_px)
    right_red = is_red(right_bar_px)
    if left_red and not right_red:
        return "left"
    if right_red and not left_red:
        return "right"
    return None  # ambiguous (both red, both black, or one off-screen)


def detect_selected_row_index(
    image: np.ndarray,
    panel_x1: int,
    panel_y1: int,
    panel_x2: int,
    panel_y2: int,
    cropped_y_centers: list[float],
    *,
    sample_left_fraction: float = 0.22,
    sample_right_fraction: float = 0.78,
    border_below_actor_min: int = 50,
    border_below_actor_max: int = 90,
    min_border_density: int = 250,
    max_border_thickness: int = 8,
) -> int | None:
    """Identify which event row is currently highlighted in the Action Tracker.

    Selection cue: a thin (3-5 px tall) white BORDER outlines the selected
    card. Non-selected rows have no border. We detect the bottom border —
    a sharp, narrow horizontal line of pure-white pixels distinct from the
    20+ px tall text bands. It sits ~67 px BELOW the row's actor.y_center
    (the actor name is at the top of each card; the border is at the bottom).

    Algorithm:
      1. Crop a vertical strip of the panel (skip portrait + pill icons).
      2. Per-pixel-row, count near-white pixels.
      3. Find the strongest narrow peak (<= max_border_thickness px tall,
         density >= min_border_density). Text peaks are 20+ px tall and reach
         density ~200 at most; a real border peak hits 400+.
      4. Pick the row whose actor.y_center is the right distance ABOVE that
         peak (i.e. peak_y - actor_y is in the border-below-actor range).

    The portrait bg / event-type pill carry team colors but are irrelevant
    here; the white border is the only reliable selection cue.
    """
    if not cropped_y_centers:
        return None
    h, w = image.shape[:2]
    panel_x1 = max(0, panel_x1)
    panel_y1 = max(0, panel_y1)
    panel_x2 = min(w, panel_x2)
    panel_y2 = min(h, panel_y2)
    if panel_x2 <= panel_x1 or panel_y2 <= panel_y1:
        return None

    sample_x1 = panel_x1 + int(sample_left_fraction * (panel_x2 - panel_x1))
    sample_x2 = panel_x1 + int(sample_right_fraction * (panel_x2 - panel_x1))
    if sample_x2 <= sample_x1:
        return None
    band = image[panel_y1:panel_y2, sample_x1:sample_x2]
    if band.size == 0:
        return None

    hsv = cv2.cvtColor(band, cv2.COLOR_BGR2HSV)
    # Tight near-white: high V, very low S. Excludes off-white text artifacts.
    white_mask = cv2.inRange(
        hsv, np.array([0, 0, 220]), np.array([180, 40, 255])
    )
    density = np.count_nonzero(white_mask, axis=1)  # (band_h,) int

    band_h = panel_y2 - panel_y1
    # Find the strongest narrow peak. A "narrow" peak is a contiguous run of
    # high-density rows that is no taller than max_border_thickness; text lines
    # are 20+ px tall and will not qualify.
    best_peak_y: int | None = None
    best_peak_density: int = 0
    i = 0
    while i < band_h:
        if density[i] >= min_border_density:
            j = i
            while j < band_h and density[j] >= min_border_density:
                j += 1
            run_h = j - i
            run_peak = int(density[i:j].max())
            if run_h <= max_border_thickness and run_peak > best_peak_density:
                best_peak_density = run_peak
                best_peak_y = i + run_h // 2
            i = j
        else:
            i += 1

    if best_peak_y is None:
        return None

    # The peak is the BOTTOM border of the selected card. The matching row's
    # actor.y_center should sit ABOVE the peak by ~67 px (empirical, stable
    # across captures because card height is constant).
    target_offset = (border_below_actor_min + border_below_actor_max) // 2
    best_idx: int | None = None
    best_dev = border_below_actor_max - border_below_actor_min
    for idx, cy in enumerate(cropped_y_centers):
        cy_int = int(round(cy))
        gap = best_peak_y - cy_int
        if border_below_actor_min <= gap <= border_below_actor_max:
            dev = abs(gap - target_offset)
            if dev < best_dev:
                best_dev = dev
                best_idx = idx
    return best_idx


def extract_selected_event_position(
    image: np.ndarray, calibration: RinkCalibration
) -> SpatialResult:
    """Find the selected (yellow) marker and return its hockey coordinates.

    This is the function callers should use from parsers — it bundles
    detect → find_selected → pixel_to_hockey with sensible defaults.
    """
    markers = detect_rink_markers(image, calibration)
    yellow = [m for m in markers if m.color == "yellow"]
    selected = find_selected_marker(markers)
    warnings: list[str] = []
    coord: RinkCoordinate | None = None
    if selected is None:
        warnings.append("No yellow (selected) marker detected on rink")
    elif len(yellow) > 1:
        warnings.append(
            f"Multiple yellow markers detected ({len(yellow)}); picked largest"
        )
        coord = pixel_to_hockey(selected, calibration)
    else:
        coord = pixel_to_hockey(selected, calibration)

    return SpatialResult(
        selected_coordinate=coord,
        detected_marker_count=len(markers),
        yellow_marker_count=len(yellow),
        warnings=warnings,
    )
