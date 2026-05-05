#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from common import ManifestRow, dump_json, ensure_video_path, load_manifest

FRAME_FPS = 1

ROI = {
    "filters": (90, 165, 1260, 255),
    "headers": (640, 255, 1910, 320),
    "highlight_rank": (90, 708, 220, 772),
    "highlight_row": (220, 708, 1910, 772),
    "footer_gamertag": (75, 830, 520, 960),
    "footer_summary": (790, 820, 1865, 965),
    "scrollbar": (630, 758, 1830, 792),
}

SUMMARY_LABEL_MAP = {
    "goals": "goals",
    "assists": "assists",
    "points": "points",
    "games played": "games_played",
    "plus/minus": "plus_minus",
}

@dataclass(slots=True)
class OcrToken:
    text: str
    x: float
    y: float
    confidence: float


def load_runtime():
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
    except ImportError as exc:  # pragma: no cover - env dependent
        raise SystemExit(
            "Missing OpenCV/Numpy. Install tools/historical_import/requirements.txt before running."
        ) from exc

    try:
        from rapidocr_onnxruntime import RapidOCR  # type: ignore
    except ImportError as exc:  # pragma: no cover - env dependent
        raise SystemExit(
            "Missing RapidOCR. Install tools/historical_import/requirements.txt before running."
        ) from exc

    try:
        import onnxruntime as ort  # type: ignore
    except ImportError:  # pragma: no cover - env dependent
        ort = None

    return cv2, np, RapidOCR, ort


def env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def build_ocr_kwargs(ort) -> dict[str, Any]:
    kwargs: dict[str, Any] = {}
    use_cuda = env_flag("OCR_USE_CUDA", default=False)
    if use_cuda:
        kwargs.update(
            {
                "det_use_cuda": True,
                "cls_use_cuda": True,
                "rec_use_cuda": True,
            }
        )

    intra_threads = os.getenv("OCR_INTRA_THREADS")
    if intra_threads:
        kwargs["intra_op_num_threads"] = int(intra_threads)

    inter_threads = os.getenv("OCR_INTER_THREADS")
    if inter_threads:
        kwargs["inter_op_num_threads"] = int(inter_threads)

    if ort is not None:
        providers = ort.get_available_providers()
        print(f"[ocr] onnxruntime providers: {providers}", file=sys.stderr)
        if use_cuda and "CUDAExecutionProvider" not in providers:
            print(
                "[ocr] OCR_USE_CUDA=1 requested but CUDAExecutionProvider is unavailable; falling back to CPU.",
                file=sys.stderr,
            )
    else:
        print("[ocr] onnxruntime import unavailable; RapidOCR will use its default runtime path.", file=sys.stderr)

    print(f"[ocr] rapidocr kwargs: {kwargs}", file=sys.stderr)
    return kwargs


def extract_frames(cv2, asset_path: Path) -> list[Any]:
    capture = cv2.VideoCapture(str(asset_path))
    if not capture.isOpened():
        raise SystemExit(f"Unable to open video asset: {asset_path}")

    fps = capture.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        fps = 30.0
    step = max(int(round(fps / FRAME_FPS)), 1)

    frames: list[Any] = []
    frame_index = 0
    # cv2.VideoCapture.grab() advances the demuxer without decoding the
    # frame; retrieve() decodes the most recently grabbed frame. Decoding
    # all 59/60 unwanted frames just to discard them is the largest
    # avoidable cost in extract_frames, so we only retrieve the kept ones.
    while True:
        if frame_index % step == 0:
            ok, image = capture.read()
            if not ok:
                break
            frames.append(image)
        else:
            ok = capture.grab()
            if not ok:
                break
        frame_index += 1

    capture.release()
    return frames


def crop(image, key: str, override: tuple[int, int, int, int] | None = None):
    x1, y1, x2, y2 = override if override is not None else ROI[key]
    return image[y1:y2, x1:x2]


# HSV ranges for the selected-row band across NHL versions.
# NHL 22/24 use a lime/chartreuse highlight (H≈30-45). NHL 23 uses a
# coral red highlight that wraps the H=0 boundary so it needs two ranges.
# NHL 25 uses a near-white highlight (low saturation, high value) which
# the saturated-colour ranges miss entirely; it gets its own range.
HIGHLIGHT_HSV_RANGES: list[tuple[tuple[int,int,int], tuple[int,int,int]]] = [
    ((28, 100, 180), (45, 255, 255)),  # lime / chartreuse — NHL 22, NHL 24
    ((0, 80, 130),   (15, 255, 255)),  # red lower band   — NHL 23
    ((165, 80, 130), (180, 255, 255)), # red upper band   — NHL 23 (hue wrap)
    ((0, 0, 200),    (180, 60, 255)),  # near-white       — NHL 25
]
HIGHLIGHT_MIN_WIDTH_FRAC = 0.50
HIGHLIGHT_MIN_HEIGHT_PX = 30
HIGHLIGHT_PAD_PX = 2
HIGHLIGHT_Y_BOUNDS = (150, 850)  # exclude navbar at top, footer at bottom


def detect_highlight_band(image) -> tuple[int, int] | None:
    """Locate the saturated selected-row band by HSV mask.

    Tries each colour range in HIGHLIGHT_HSV_RANGES and ORs the masks
    together so a single detector handles both lime (NHL 24+) and red
    (NHL 23) highlights. Returns (y1, y2) padded to match the legacy
    static ROI height, or None if no plausible band is found.
    """
    import cv2  # type: ignore
    import numpy as np  # type: ignore

    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mask: "np.ndarray | None" = None
    for lower_t, upper_t in HIGHLIGHT_HSV_RANGES:
        lower = np.array(lower_t, dtype=np.uint8)
        upper = np.array(upper_t, dtype=np.uint8)
        m = cv2.inRange(hsv, lower, upper)
        mask = m if mask is None else cv2.bitwise_or(mask, m)
    assert mask is not None
    h, w = mask.shape
    width_threshold = int(HIGHLIGHT_MIN_WIDTH_FRAC * w)
    row_active = (mask > 0).sum(axis=1) >= width_threshold

    y_lo, y_hi = HIGHLIGHT_Y_BOUNDS
    y_lo = max(0, y_lo)
    y_hi = min(h, y_hi)

    best_start, best_len = -1, 0
    cur_start = -1
    for y in range(y_lo, y_hi):
        if row_active[y]:
            if cur_start < 0:
                cur_start = y
        else:
            if cur_start >= 0:
                length = y - cur_start
                if length > best_len:
                    best_start, best_len = cur_start, length
                cur_start = -1
    if cur_start >= 0:
        length = y_hi - cur_start
        if length > best_len:
            best_start, best_len = cur_start, length

    if best_len < HIGHLIGHT_MIN_HEIGHT_PX:
        return None

    y1 = max(0, best_start - HIGHLIGHT_PAD_PX)
    y2 = min(h, best_start + best_len + HIGHLIGHT_PAD_PX)
    return y1, y2


def dynamic_highlight_roi(image) -> dict[str, tuple[int, int, int, int]]:
    """Return ROI dict with highlight_row/highlight_rank y-bounds set to the
    detected band when available, else the static fallback."""
    band = detect_highlight_band(image)
    if band is None:
        return ROI
    y1, y2 = band
    rx1, _, rx2, _ = ROI["highlight_row"]
    rkx1, _, rkx2, _ = ROI["highlight_rank"]
    return {
        **ROI,
        "highlight_row": (rx1, y1, rx2, y2),
        "highlight_rank": (rkx1, y1, rkx2, y2),
    }


def ocr_tokens(ocr, image, *, x_offset: int = 0, y_offset: int = 0) -> list[OcrToken]:
    result, _ = ocr(image, use_cls=False)
    tokens: list[OcrToken] = []
    if not result:
        return tokens
    for item in result:
        if not item or len(item) < 3:
            continue
        box, text, confidence = item
        if not str(text).strip():
            continue
        xs = [point[0] for point in box]
        ys = [point[1] for point in box]
        tokens.append(
            OcrToken(
                text=str(text).strip(),
                x=float(sum(xs) / len(xs) + x_offset),
                y=float(sum(ys) / len(ys) + y_offset),
                confidence=float(confidence),
            )
        )
    return sorted(tokens, key=lambda token: token.x)


def normalize_text(text: str) -> str:
    return (
        text.lower()
        .replace("—", "-")
        .replace(" ", "")
        .replace("%", "%")
        .replace("pts/g", "pts/g")
    )


def canonical_header(text: str) -> str | None:
    normalized = normalize_text(text)
    normalized = normalized.replace("!", "s").replace("|", "l")
    normalized = normalized.replace("pts/g", "ptsg").replace("hits/g", "hitsg")
    mapping = {
        "ct": "ct",
        "gp": "games_played",
        "dnf%": "dnf_pct",
        "g": "goals",
        "a": "assists",
        "pts": "points",
        "pt!": "points",
        "pts/g": "pts_g",
        "ptsg": "pts_g",
        "+/-": "plus_minus",
        "pm": "plus_minus",
        "pim": "pim",
        "ppg": "ppg",
        "shg": "shg",
        "gwg": "gwg",
        "hits": "hits",
        "hits/g": "hits_g",
        "hitsg": "hits_g",
        "s": "shots",
        "s%": "s_pct",
        "s/g": "s_g",
        "sg": "s_g",
        "sog": "shots",
        "satt": "shot_attempts",
        "sog%": "sog_pct",
        "tk": "takeaways",
        "gv": "giveaways",
        "fow": "faceoff_wins",
        "fol": "faceoff_losses",
        "fo%": "faceoff_pct",
        "pass": "pass_completions",
        "patt": "pass_attempts",
        "pass%": "pass_pct",
        "bs": "blocked_shots",
        "int": "interceptions",
        "off": "offsides",
        "off/g": "offsides_g",
        "offg": "offsides_g",
        "fht": "fights",
        "fhtw": "fights_won",
        "htw": "fights_won",
        "dka": "dekes_attempted",
        "dk": "dekes",
        "hat": "hat_tricks",
        "pd": "penalties_drawn",
        "spass": "spass",
        "pkzc": "pkzc",
        "defl": "deflections",
        "brkg": "breakaway_goals",
        "brk": "breakaways",
        "brk%": "breakaway_pct",
        "psg": "psg",
        "ps": "ps",
        "ps%": "ps_pct",
        "gc": "gc",
        "gc6": "gc6",
        "w": "wins",
        "l": "losses",
        "otl": "otl",
        "oti": "otl",  # frequent OCR misread of OTL
        "sv%": "save_pct",
        "svpct": "save_pct",
        "gaa": "gaa",
        "so": "shutouts",
        "sv": "total_saves",
        "saves": "total_saves",
        "sa": "total_shots_against",
        "shotsagainst": "total_shots_against",
        "ga": "total_goals_against",
        "goalsagainst": "total_goals_against",
        "min": "minutes_played",
        "sop": "shootout_points",
        "brks": "breakaway_shots",
        "brksv": "breakaway_saves",
        "brksv%": "breakaway_save_pct",
        "psv": "penalty_shot_saves",
        "psv%": "penalty_shot_save_pct",
        "dsv": "diving_saves",
    }
    return mapping.get(normalized)


def canonical_summary_label(text: str) -> str | None:
    normalized = normalize_text(text).replace("!", "i")
    mapping = {
        "goals": "goals",
        "assists": "assists",
        "points": "points",
        "gamesplayed": "games_played",
        "plus/minus": "plus_minus",
        "plusminus": "plus_minus",
    }
    return mapping.get(normalized)


def normalize_stat_value(text: str) -> str:
    normalized = text.strip().replace("!", "5")
    if normalized.startswith(".") and normalized.endswith("%"):
        return f"0{normalized}"
    return normalized


def is_numeric_like(text: str) -> bool:
    compact = normalize_stat_value(text).replace(",", "").replace("%", "").replace(".", "").replace("-", "")
    return compact.isdigit()


def parse_stat_columns(
    ocr,
    image,
    *,
    roi: dict[str, tuple[int, int, int, int]] | None = None,
    row_tokens: list[OcrToken] | None = None,
) -> tuple[dict[str, str], list[str], float]:
    roi = roi or ROI
    header_roi = crop(image, "headers", roi["headers"])
    row_roi_box = roi["highlight_row"]
    header_tokens = ocr_tokens(ocr, header_roi, x_offset=roi["headers"][0], y_offset=roi["headers"][1])
    if row_tokens is None:
        row_roi = crop(image, "highlight_row", row_roi_box)
        row_tokens = ocr_tokens(ocr, row_roi, x_offset=row_roi_box[0], y_offset=row_roi_box[1])
    header_points = [(token.x, token.text, canonical_header(token.text)) for token in header_tokens]
    header_x_by_key = {key: x for x, _, key in header_points if key}

    row_tokens = [token for token in row_tokens if len(token.text.strip()) > 0]
    numeric_tokens = [token for token in row_tokens if is_numeric_like(token.text)]
    header_points = [(x, text, key) for x, text, key in header_points if key]

    if not header_points or not numeric_tokens:
        return {}, ["missing_headers_or_values"], 0.0

    # Estimate the visible column width from header spacing — half this width
    # is the maximum acceptable header-value x distance. Without this guard
    # the greedy nearest-token pairing happily assigns a value from the next
    # column over when its own value was missed by OCR (cascading shifts).
    if len(header_points) >= 2:
        sorted_xs = sorted(x for x, _, _ in header_points)
        gaps = [b - a for a, b in zip(sorted_xs, sorted_xs[1:]) if b - a > 0]
        gaps.sort()
        median_gap = gaps[len(gaps) // 2] if gaps else 100.0
    else:
        median_gap = 100.0
    max_offset_px = max(40.0, median_gap * 0.55)

    values_by_header: dict[str, str] = {}
    warnings: list[str] = []
    score_total = 0.0
    paired = 0
    used_indices: set[int] = set()

    for header_x, header_text, key in header_points:
        candidates = [
            (abs(token.x - header_x), index, token)
            for index, token in enumerate(numeric_tokens)
            if index not in used_indices
        ]
        if not candidates:
            warnings.append(f"missing_value:{key}")
            continue
        distance, index, value_token = min(candidates, key=lambda item: item[0])
        if distance > max_offset_px:
            # Closest unused token is in someone else's column — likely OCR
            # missed this header's value. Don't take a neighbour's value.
            warnings.append(f"missing_value:{key}")
            continue
        used_indices.add(index)
        if key in values_by_header and values_by_header[key] != value_token.text:
            warnings.append(f"conflict:{key}")
            continue
        values_by_header[key] = normalize_stat_value(value_token.text)
        score_total += value_token.confidence
        paired += 1

    if "shots" not in values_by_header and "s_pct" in header_x_by_key:
        left_bound = header_x_by_key.get("hits_g", row_roi_box[0])
        candidates = [
            (header_x_by_key["s_pct"] - token.x, index, token)
            for index, token in enumerate(numeric_tokens)
            if index not in used_indices and left_bound < token.x < header_x_by_key["s_pct"]
        ]
        if candidates:
            _, index, token = min(candidates, key=lambda item: item[0])
            used_indices.add(index)
            values_by_header["shots"] = normalize_stat_value(token.text)
            score_total += token.confidence
            paired += 1

    confidence = score_total / paired if paired else 0.0
    return values_by_header, warnings, confidence


def _parse_summary_from_tokens(tokens: list[OcrToken]) -> dict[str, str]:
    """Group footer-summary tokens into label/value pairs and emit a stats dict.

    Split out from `parse_summary` so the OCR step can be cached at the
    per-video layer (footer summary is identical across all frames in a
    single capture).
    """
    summary: dict[str, str] = {}
    groups: list[list[OcrToken]] = []
    for token in sorted(tokens, key=lambda item: item.x):
        if not groups or abs(groups[-1][0].x - token.x) > 140:
            groups.append([token])
        else:
            groups[-1].append(token)

    import re
    record_re = re.compile(r"^(\d+)\s*[-–—]\s*(\d+)\s*[-–—]\s*(\d+)$")

    for group in groups:
        ordered = sorted(group, key=lambda item: item.y)
        if len(ordered) < 2:
            continue
        label_raw = normalize_text(ordered[0].text)
        value_raw = ordered[-1].text.strip().replace(",", "")
        # Goalie footer: RECORD field is "W-L-OTL" (e.g., "61-68-9")
        if label_raw == "record":
            m = record_re.match(value_raw)
            if m:
                summary["wins"] = m.group(1)
                summary["losses"] = m.group(2)
                summary["otl"] = m.group(3)
            continue
        label = canonical_summary_label(ordered[0].text)
        value = normalize_stat_value(ordered[-1].text)
        if label and is_numeric_like(value):
            summary[label] = value
    return summary


def parse_summary(ocr, image) -> dict[str, str]:
    tokens = ocr_tokens(
        ocr,
        crop(image, "footer_summary"),
        x_offset=ROI["footer_summary"][0],
        y_offset=ROI["footer_summary"][1],
    )
    return _parse_summary_from_tokens(tokens)


# Frames to OCR for the footer_summary strip. The early frames of a capture
# can contain transient bad totals (mid-animation / previous-screen state),
# so we deliberately skip frame 0 and start at frame 3. Spacing the samples
# evenly across the typical 20-24 frame capture preserves the modal-merge
# recovery behaviour with far fewer OCR calls than per-frame.
DEFAULT_SUMMARY_SAMPLE_INDICES: tuple[int, ...] = (3, 7, 11, 15, 19)


def pick_summary_sample_indices(total_frames: int) -> list[int]:
    """Return the frame indices that should be OCR'd for footer_summary.

    For a typical ~20-frame video, returns the canonical fixed sample set
    `(3, 7, 11, 15, 19)`. Degrades gracefully for shorter clips: skips
    frame 0 when possible (it's the most likely to carry transient bad
    totals), and falls back to sampling every frame for very short clips.
    """
    if total_frames <= 0:
        return []
    indices = [i for i in DEFAULT_SUMMARY_SAMPLE_INDICES if i < total_frames]
    if indices:
        return indices
    # Clip too short for any canonical index. Skip frame 0 if we can.
    if total_frames == 1:
        return [0]
    return list(range(1, total_frames))


def _resolve_rank(rank_tokens: list[OcrToken]) -> str | None:
    for token in rank_tokens:
        value = normalize_stat_value(token.text)
        if is_numeric_like(value):
            return value
    return None


def parse_identity(
    ocr,
    image,
    *,
    roi: dict[str, tuple[int, int, int, int]] | None = None,
    row_tokens: list[OcrToken] | None = None,
    cached_rank: str | None = None,
) -> dict[str, str]:
    roi = roi or ROI
    rank_box = roi["highlight_rank"]
    row_box = roi["highlight_row"]
    if cached_rank is None:
        rank_tokens = ocr_tokens(
            ocr,
            crop(image, "highlight_rank", rank_box),
            x_offset=rank_box[0],
            y_offset=rank_box[1],
        )
        cached_rank = _resolve_rank(rank_tokens)
    if row_tokens is None:
        row_tokens = ocr_tokens(
            ocr,
            crop(image, "highlight_row", row_box),
            x_offset=row_box[0],
            y_offset=row_box[1],
        )

    identity: dict[str, str] = {}
    if cached_rank is not None:
        identity["rank"] = cached_rank

    text_tokens = [token.text.strip() for token in row_tokens if token.text.strip()]
    non_numeric = [token for token in text_tokens if not is_numeric_like(token)]
    if non_numeric:
        identity["player"] = non_numeric[0]
    if len(non_numeric) > 1:
        identity["playerName"] = non_numeric[1]
    if len(non_numeric) > 2:
        identity["playerLevel"] = non_numeric[2]

    return identity


def text_contains(tokens: list[OcrToken], target: str) -> bool:
    normalized_target = normalize_text(target)
    return any(normalized_target in normalize_text(token.text) for token in tokens)


def compute_video_static_context(
    ocr,
    sample_image,
    row: ManifestRow,
) -> dict[str, Any]:
    """OCR the ROIs that don't change between frames in a single video, exactly once.

    Cached:
      - `filters` chip strip — chip selections are static for the duration
        of a capture.
      - `footer_gamertag` strip — same player viewing throughout.
      - `highlight_rank` — the player's leaderboard rank doesn't shift while
        the video plays.

    Deliberately NOT cached: `footer_summary`. The first 1-2 frames of a
    capture often show transient/bad totals (e.g. previous-screen value,
    mid-animation state) that the per-frame OCR + modal merge recovers
    from. Locking in a single-frame sample of the summary regresses data
    correctness, so it stays per-frame in `analyze_frame`.
    """
    filter_tokens = ocr_tokens(ocr, crop(sample_image, "filters"))
    footer_tokens = ocr_tokens(ocr, crop(sample_image, "footer_gamertag"))

    chip_results: dict[str, bool | None] = {
        "footer_gamertag": text_contains(footer_tokens, row.gamertag),
        "game_mode_chip": (
            text_contains(filter_tokens, row.source_game_mode_label)
            if row.source_game_mode_label else None
        ),
        "position_chip": (
            text_contains(filter_tokens, row.source_position_label)
            if row.source_position_label else None
        ),
    }

    sample_dyn_roi = dynamic_highlight_roi(sample_image)
    rank_box = sample_dyn_roi["highlight_rank"]
    rank_tokens = ocr_tokens(
        ocr,
        crop(sample_image, "highlight_rank", rank_box),
        x_offset=rank_box[0],
        y_offset=rank_box[1],
    )
    rank = _resolve_rank(rank_tokens)

    return {
        "chip_results": chip_results,
        "rank": rank,
    }


def analyze_frame(
    ocr,
    image,
    row: ManifestRow,
    *,
    video_ctx: dict[str, Any] | None = None,
    summary: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Analyze one video frame.

    When `video_ctx` is supplied (returned by `compute_video_static_context`),
    the static-ROI OCR work (filters / footer_gamertag / highlight_rank) is
    reused from the per-video cache and skipped here. The variable per-frame
    OCR — `headers` and `highlight_row` — still runs. Within a single frame,
    `highlight_row` is OCR'd once and the tokens are shared between
    `parse_stat_columns` and `parse_identity`.

    `footer_summary` is not OCR'd per-frame. The caller pre-samples a small
    set of frames (see `pick_summary_sample_indices`) and passes the parsed
    summary dict here. Non-sample frames pass `{}` so they contribute nothing
    to the merged summary buckets — modal merge across the sampled frames
    still recovers from a transient bad reading on any single sample. If
    `summary` is `None`, the legacy per-frame behavior is used as a fallback
    (mainly for unit tests / cold-path callers).
    """
    if video_ctx is None:
        video_ctx = compute_video_static_context(ocr, image, row)

    chip_results = video_ctx["chip_results"]
    cached_rank = video_ctx.get("rank")

    dyn_roi = dynamic_highlight_roi(image)
    highlight_detected = dyn_roi["highlight_row"] != ROI["highlight_row"]

    row_box = dyn_roi["highlight_row"]
    row_tokens = ocr_tokens(
        ocr,
        crop(image, "highlight_row", row_box),
        x_offset=row_box[0],
        y_offset=row_box[1],
    )

    values, frame_warnings, confidence = parse_stat_columns(
        ocr, image, roi=dyn_roi, row_tokens=row_tokens
    )
    if summary is None:
        summary = parse_summary(ocr, image)
    identity = parse_identity(
        ocr, image, roi=dyn_roi, row_tokens=row_tokens, cached_rank=cached_rank
    )

    for key in ("goals", "assists", "points", "games_played", "plus_minus", "wins", "losses", "otl"):
        if key not in values and key in summary:
            values[key] = summary[key]

    return {
        "identity": identity,
        "values": values,
        "summary": summary,
        "chip_results": chip_results,
        "roi": dyn_roi,
        "highlight_detected": highlight_detected,
        "frame_warnings": frame_warnings,
        "confidence": round(confidence * 100, 2),
    }


# Warning thresholds. Chip warnings fire when fewer than this share of frames
# matched. Conflict warnings fire when the modal pick covers less than this
# share of votes (i.e. the consensus is weak).
CHIP_POSITIVE_THRESHOLD = 0.30
IDENTITY_DOMINANCE_THRESHOLD = 0.60
VALUE_DOMINANCE_THRESHOLD = 0.70
HIGHLIGHT_DETECTED_THRESHOLD = 0.50
SUMMARY_KEYS = ("goals", "assists", "points", "games_played", "plus_minus", "wins", "losses", "otl")


def _modal(values: list[str]) -> tuple[str, float]:
    counts = Counter(values)
    modal_value, modal_count = counts.most_common(1)[0]
    dominance = modal_count / sum(counts.values())
    return modal_value, dominance


def modal_merge(frame_results: list[dict[str, Any]]) -> tuple[dict[str, str], dict[str, str], list[str], float]:
    buckets: dict[str, list[str]] = defaultdict(list)
    identity_buckets: dict[str, list[str]] = defaultdict(list)
    summary_buckets: dict[str, list[str]] = defaultdict(list)
    raw_frame_warnings: list[str] = []
    confidences: list[float] = []
    chip_counts: dict[str, list[int]] = {
        "footer_gamertag": [0, 0],
        "game_mode_chip": [0, 0],
        "position_chip": [0, 0],
    }  # [positive, negative]; None observations are skipped.
    highlight_detected_count = 0
    total_frames = 0

    for frame in frame_results:
        total_frames += 1
        confidences.append(float(frame["confidence"]))
        raw_frame_warnings.extend(frame.get("frame_warnings", []))
        for key, value in frame.get("identity", {}).items():
            identity_buckets[key].append(value)
        for key, value in frame["values"].items():
            buckets[key].append(value)
        for key, value in frame.get("summary", {}).items():
            summary_buckets[key].append(value)
        for label, observed in frame.get("chip_results", {}).items():
            if observed is True:
                chip_counts[label][0] += 1
            elif observed is False:
                chip_counts[label][1] += 1
        if frame.get("highlight_detected"):
            highlight_detected_count += 1

    final_warnings: set[str] = set()
    merged: dict[str, str] = {}

    for key, values in identity_buckets.items():
        modal_value, dominance = _modal(values)
        merged[key] = modal_value
        if dominance < IDENTITY_DOMINANCE_THRESHOLD:
            final_warnings.add(f"conflicting_identity:{key}")

    for key, values in buckets.items():
        modal_value, dominance = _modal(values)
        merged[key] = modal_value
        if dominance < VALUE_DOMINANCE_THRESHOLD:
            final_warnings.add(f"conflicting_values:{key}")

    merged_summary: dict[str, str] = {}
    for key, values in summary_buckets.items():
        modal_value, _ = _modal(values)
        merged_summary[key] = modal_value

    # Chip warnings — fire only when the chip was rarely recognised.
    chip_label_to_warning = {
        "footer_gamertag": "footer_gamertag_mismatch",
        "game_mode_chip": "game_mode_chip_mismatch",
        "position_chip": "position_chip_mismatch",
    }
    for label, (pos, neg) in chip_counts.items():
        total = pos + neg
        if total == 0:
            continue
        if pos / total < CHIP_POSITIVE_THRESHOLD:
            final_warnings.add(chip_label_to_warning[label])

    # Missing-value warnings only persist when the key really is absent post-merge.
    for warning in raw_frame_warnings:
        if warning.startswith("missing_value:"):
            key = warning.split(":", 1)[1]
            if key not in merged:
                final_warnings.add(warning)
        elif warning == "missing_headers_or_values":
            if not merged:
                final_warnings.add(warning)
        elif warning.startswith("conflict:"):
            # Per-frame stat-column conflicts; surfaced only if the merged
            # value's modal dominance is also weak (already handled above).
            continue
        else:
            final_warnings.add(warning)

    # Summary mismatch — compute once against the merged summary vs merged stats.
    for key in SUMMARY_KEYS:
        sval = merged_summary.get(key)
        rval = merged.get(key)
        if sval and rval and sval.replace(",", "") != rval.replace(",", ""):
            final_warnings.add(f"summary_mismatch:{key}")

    if total_frames:
        if highlight_detected_count / total_frames < HIGHLIGHT_DETECTED_THRESHOLD:
            final_warnings.add("highlight_band_not_detected")

    avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0
    return merged, merged_summary, sorted(final_warnings), round(avg_confidence, 2)


def csv_record(base: dict[str, Any], stats: dict[str, Any]) -> dict[str, Any]:
    record = dict(base)
    record.update(stats)
    return record


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract review artifacts from historical stat videos.")
    parser.add_argument("manifest_csv", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--import-batch", default="historical-video-import")
    parser.add_argument("--save-crops", action="store_true")
    args = parser.parse_args()

    cv2, np, RapidOCR, ort = load_runtime()
    rows = load_manifest(args.manifest_csv)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    ocr = RapidOCR(**build_ocr_kwargs(ort))
    review_records: list[dict[str, Any]] = []
    flat_rows: list[dict[str, Any]] = []

    for row in rows:
        asset_path = Path(row.asset_path)
        ensure_video_path(asset_path)
        if not asset_path.exists():
            raise SystemExit(f"Missing asset: {asset_path}")

        frames = extract_frames(cv2, asset_path)
        selected_frames: list[tuple[int, Any]] = list(enumerate(frames))

        frame_results: list[dict[str, Any]] = []
        debug_dir = args.output_dir / "debug" / asset_path.stem
        if args.save_crops:
            debug_dir.mkdir(parents=True, exist_ok=True)

        # Compute the per-video static-ROI cache from the first frame whose
        # dynamic highlight band is detectable. Falls back to the first frame
        # if none qualify, in which case the rank may use the static fallback.
        video_ctx: dict[str, Any] | None = None
        if selected_frames:
            sample_image = selected_frames[0][1]
            for _, candidate in selected_frames:
                if detect_highlight_band(candidate) is not None:
                    sample_image = candidate
                    break
            video_ctx = compute_video_static_context(ocr, sample_image, row)

        # Pre-OCR footer_summary on a small sampled subset of frames. Modal
        # merge across these samples still recovers the correct totals if
        # any single sample reads badly, while skipping the early frames
        # that are most likely to carry transient bad totals.
        summary_sample_indices = pick_summary_sample_indices(len(selected_frames))
        summary_by_index: dict[int, dict[str, str]] = {
            idx: parse_summary(ocr, selected_frames[idx][1])
            for idx in summary_sample_indices
        }

        for frame_index, image in selected_frames:
            frame_summary = summary_by_index.get(frame_index, {})
            result = analyze_frame(
                ocr, image, row, video_ctx=video_ctx, summary=frame_summary
            )
            frame_results.append(result)

            if args.save_crops:
                cv2.imwrite(str(debug_dir / f"frame_{frame_index:05d}_full.png"), image)
                roi_for_frame = result.get("roi", ROI)
                for key in ROI:
                    box = roi_for_frame.get(key, ROI[key])
                    cv2.imwrite(
                        str(debug_dir / f"frame_{frame_index:05d}_{key}.png"),
                        crop(image, key, box),
                    )

        merged_stats, _merged_summary, warnings, confidence = modal_merge(frame_results)
        warnings = sorted(set(warnings))
        review_status = "reviewed" if confidence >= 85 and not warnings else "pending_review"

        review_record = {
            "titleSlug": row.title_slug,
            "gamertag": row.gamertag,
            "gameMode": row.game_mode,
            "positionScope": row.position_scope,
            "roleGroup": row.role_group,
            "sourceGameModeLabel": row.source_game_mode_label,
            "sourcePositionLabel": row.source_position_label,
            "sourceAssetPath": row.asset_path,
            "importBatch": args.import_batch,
            "reviewStatus": review_status,
            "confidenceScore": confidence,
            "warnings": warnings,
            "stats": merged_stats,
        }
        review_records.append(review_record)
        flat_rows.append(csv_record(review_record, merged_stats))

    dump_json(args.output_dir / "review.json", {"records": review_records})
    with (args.output_dir / "review.csv").open("w", encoding="utf-8", newline="") as handle:
        fieldnames = sorted({key for row in flat_rows for key in row.keys()})
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in flat_rows:
            writer.writerow(row)

    print(json.dumps({"records": len(review_records), "outputDir": str(args.output_dir)}, indent=2))


if __name__ == "__main__":
    main()
