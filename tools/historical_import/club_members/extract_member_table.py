"""
Pilot extractor for one club-member screenshot (CLUBS → members table).

Single-frame static PNG. No temporal merge, no highlighted-row detection,
no scrolling. Designed for the screenshots under
research/Previous_NHL_Stats/NHL_<title>/team_leaderboard__NN.png.

Approach:
  1. Run RapidOCR on the full image; collect (bbox, text, conf) tuples.
  2. Cluster boxes into rows by y-centre.
  3. Identify the "sorted by" label (top-right corner header pill).
  4. Identify the column-header row by looking for short uppercase metric
     tokens (SGP, GGP, G, A, PTS, +/-, ...).
  5. Each remaining row is a data row. Within a data row:
       - leftmost token = gamertag
       - the token containing "LVL" = player_level (if any)
       - longest non-numeric, non-LVL middle-band token = player_name
       - integer-parseable tokens, ordered left-to-right and aligned to
         column-header x-centres, become the metric values.

Output is a single JSON file describing one screenshot's contribution. It
maps cleanly to the hand-keyed pilot format used by
import-club-member-reviewed.ts (one record per row, with a single
sources[] entry pointing at this screenshot).

Not intended for the player-card video pipeline. No shared state with
extract_review_artifacts.py.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2
from rapidocr_onnxruntime import RapidOCR

# ---------------------------------------------------------------------------
# Domain
# ---------------------------------------------------------------------------

# Metric tokens we expect as column headers in this screenshot family.
# Anchors detection of the header row.
KNOWN_METRIC_HEADERS: set[str] = {
    "SGP",
    "GGP",
    "G",
    "A",
    "PTS",
    "+/-",
    "DNF%",
    "PIM",
    "PPG",
    "SHG",
    "HITS",
    "PASS%",
    "BS",
    "GV",
    "TK",
    "INT",
    "S",
    "S%",
    "GAA",
    "GA",
    "SV",
    "SV%",
    "SO",
    "SOP",
}

# Plain-English label per snake_case canonical metric. Used to map a
# detected sorted-by label back to the canonical key.
SORTED_BY_LABELS: dict[str, str] = {
    "skater_games_played": "Skater Games Played",
    "goalie_games_played": "Goalie Games Played",
    "pass_percentage": "Pass Percentage",
    "total_goals_against": "Total Goals Against",
    "shutout_periods": "Shutout Periods",
}


# Per-view canonical column mapping. When a screenshot's sorted-by label
# matches one of these keys, the visible column slots map to the listed
# canonical snake_case metric names. None means "metric exists in the
# game but is not modelled in our schema yet" — we drop those columns
# silently from the output so the artifact only contains real metrics.
#
# Order of this list MUST match the on-screen left-to-right column order
# of the visible columns for that view (gamertag and player name columns
# excluded — only the metric columns).
VIEW_COLUMN_MAP: dict[str, dict[str, Any]] = {
    "skater games played": {
        "role_group": "skater",
        "columns": ["skater_gp", "goalie_gp", "goals", "assists"],
    },
    "pass percentage": {
        "role_group": "skater",
        "columns": [
            "assists",
            "points",
            "plus_minus",
            "dnf_pct",
            "pim",
            "pp_goals",
            "sh_goals",
            "hits",
            "pass_pct",
        ],
    },
    "total goals against": {
        # Right-of-PASS% scrolled view. Visible columns are mostly skater
        # metrics not in our schema (BS/GV/TK/INT) plus the leftmost goalie
        # cells (GAA, GA). We only model gaa + total_goals_against here.
        # The mode-mixed nature means this view is most useful for goalie
        # rows; skater rows mostly contribute zeros for goalie metrics.
        "role_group": "goalie",
        "columns": [None, None, None, None, None, None, "gaa", "total_goals_against"],
    },
    "shutout periods": {
        "role_group": "goalie",
        "columns": [
            None,  # INT
            None,  # S
            None,  # S%
            "gaa",
            "total_goals_against",
            "total_saves",
            "save_pct",
            "shutouts",
            None,  # SOP — not in schema
        ],
    },
}


# ---------------------------------------------------------------------------
# OCR primitives
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class Box:
    text: str
    conf: float
    x_left: float
    x_right: float
    x_centre: float
    y_top: float
    y_bottom: float
    y_centre: float
    height: float

    @classmethod
    def from_rapid(cls, raw_box: list[list[float]], text: str, conf: float) -> "Box":
        xs = [pt[0] for pt in raw_box]
        ys = [pt[1] for pt in raw_box]
        x_left, x_right = min(xs), max(xs)
        y_top, y_bottom = min(ys), max(ys)
        return cls(
            text=text.strip(),
            conf=float(conf),
            x_left=float(x_left),
            x_right=float(x_right),
            x_centre=float((x_left + x_right) / 2.0),
            y_top=float(y_top),
            y_bottom=float(y_bottom),
            y_centre=float((y_top + y_bottom) / 2.0),
            height=float(y_bottom - y_top),
        )


def run_ocr(image_path: Path) -> tuple[list[Box], "Any", "Any"]:
    """Returns (boxes, image, ocr_instance) so callers can reuse them for
    targeted per-cell OCR passes without re-instantiating the model."""
    img = cv2.imread(str(image_path))
    if img is None:
        raise FileNotFoundError(f"Could not read image: {image_path}")
    ocr = RapidOCR()
    result, _ = ocr(img)
    boxes = [Box.from_rapid(b, t, c) for (b, t, c) in (result or [])]
    return boxes, img, ocr


# ---------------------------------------------------------------------------
# Per-cell numeric OCR (gap-fill pass)
# ---------------------------------------------------------------------------

def _preprocess_variants(crop: "Any") -> list["Any"]:
    """
    Several preprocessing variants tried per cell. RapidOCR can read any
    of them, so we run all and pick the most-confident numeric result.
    Variants chosen to handle: bright text / dim text / anti-aliased small
    digits / dark-on-bright legend bands.
    """
    variants: list["Any"] = []
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

    # 1. Plain 3x upscale of grayscale (no threshold).
    variants.append(cv2.resize(gray, None, fx=3.0, fy=3.0, interpolation=cv2.INTER_CUBIC))

    # 2. Grayscale 3x upscale + invert (dark text on light bg, OCR friendly).
    variants.append(
        cv2.bitwise_not(
            cv2.resize(gray, None, fx=3.0, fy=3.0, interpolation=cv2.INTER_CUBIC)
        )
    )

    # 3. Fixed binary threshold + invert + 3x upscale.
    _, thr110 = cv2.threshold(gray, 110, 255, cv2.THRESH_BINARY)
    variants.append(
        cv2.resize(
            cv2.bitwise_not(thr110), None, fx=3.0, fy=3.0, interpolation=cv2.INTER_CUBIC
        )
    )

    # 4. Lower fixed threshold (catches dim digits) + invert + 3x upscale.
    _, thr80 = cv2.threshold(gray, 80, 255, cv2.THRESH_BINARY)
    variants.append(
        cv2.resize(
            cv2.bitwise_not(thr80), None, fx=3.0, fy=3.0, interpolation=cv2.INTER_CUBIC
        )
    )

    # 5. Adaptive threshold + invert + 3x upscale.
    adaptive = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 25, 5
    )
    variants.append(
        cv2.resize(
            cv2.bitwise_not(adaptive), None, fx=3.0, fy=3.0, interpolation=cv2.INTER_CUBIC
        )
    )

    return variants


def _cell_bounds(
    img_h: int,
    img_w: int,
    anchor_x: float,
    y_centre: float,
    half_w: float,
    half_h: float,
) -> tuple[int, int, int, int]:
    x0 = max(0, int(anchor_x - half_w))
    x1 = min(img_w, int(anchor_x + half_w))
    y0 = max(0, int(y_centre - half_h))
    y1 = min(img_h, int(y_centre + half_h))
    return x0, y0, x1, y1


def _ocr_cell_variants(ocr: "Any", crop: "Any") -> int | float | None:
    """
    Try several preprocessing variants on the cell. Pick the most-voted
    numeric value across variants; ties broken by highest confidence.
    """
    variants = _preprocess_variants(crop)
    # value -> (vote count, max confidence seen)
    tally: dict[int | float, list[float]] = {}
    for v_img in variants:
        result, _ = ocr(v_img)
        if not result:
            continue
        for (_, text, conf) in result:
            v = parse_metric_value(str(text))
            if v is None:
                continue
            tally.setdefault(v, []).append(float(conf))
    if not tally:
        return None
    # Sort by (-vote_count, -max_conf). Most-voted wins; tie -> most confident.
    ranked = sorted(
        tally.items(),
        key=lambda kv: (-len(kv[1]), -max(kv[1])),
    )
    return ranked[0][0]


def fill_numeric_gaps(
    img: "Any",
    ocr: "Any",
    data_rows: list[DataRow],
    data_row_boxes: list[list[Box]],
    full_anchors: list[tuple[str, float]],
) -> int:
    """
    For each parsed data row, run per-cell OCR on every column anchor that
    received no value in the broad-row pass. Mutates data_rows in place.
    Returns the number of cells filled.
    """
    if img is None or not data_rows or not full_anchors:
        return 0

    img_h, img_w = img.shape[:2]

    # Half-width = 45% of median column pitch; half-height = median row half-height.
    if len(full_anchors) >= 2:
        pitches = [
            abs(full_anchors[i + 1][1] - full_anchors[i][1])
            for i in range(len(full_anchors) - 1)
        ]
        half_w = (sorted(pitches)[len(pitches) // 2]) * 0.45
    else:
        half_w = 50.0

    filled = 0
    for parsed, row_boxes in zip(data_rows, data_row_boxes):
        if not row_boxes:
            continue
        y_centre = sum(b.y_centre for b in row_boxes) / len(row_boxes)
        max_h = max(b.height for b in row_boxes)
        half_h = max(14.0, max_h * 0.85)

        for metric_name, anchor_x in full_anchors:
            if metric_name in parsed.stats and parsed.stats[metric_name] is not None:
                continue
            x0, y0, x1, y1 = _cell_bounds(img_h, img_w, anchor_x, y_centre, half_w, half_h)
            if x1 - x0 < 6 or y1 - y0 < 6:
                continue
            crop = img[y0:y1, x0:x1]
            value = _ocr_cell_variants(ocr, crop)
            if value is None:
                parsed.warnings.append(f"per-cell OCR found no value at {metric_name}")
                continue
            parsed.stats[metric_name] = value
            parsed.warnings.append(f"per-cell OCR filled {metric_name}={value}")
            filled += 1

    return filled


# ---------------------------------------------------------------------------
# Row clustering
# ---------------------------------------------------------------------------

def cluster_rows(boxes: list[Box], y_tol_factor: float = 0.6) -> list[list[Box]]:
    """Group boxes into rows by y-centre. Tolerance scales with box height."""
    if not boxes:
        return []
    sorted_by_y = sorted(boxes, key=lambda b: b.y_centre)
    rows: list[list[Box]] = [[sorted_by_y[0]]]
    for b in sorted_by_y[1:]:
        ref = rows[-1][-1]
        tol = max(8.0, ref.height * y_tol_factor)
        if abs(b.y_centre - ref.y_centre) <= tol:
            rows[-1].append(b)
        else:
            rows.append([b])
    for row in rows:
        row.sort(key=lambda b: b.x_left)
    return rows


# ---------------------------------------------------------------------------
# Header detection
# ---------------------------------------------------------------------------

def normalise_metric_token(text: str) -> str:
    """Trim & uppercase; tolerant of OCR variants like 'A.' or 'PTs'."""
    cleaned = text.strip().rstrip(".").upper()
    return cleaned


def is_known_metric_header(text: str) -> bool:
    return normalise_metric_token(text) in KNOWN_METRIC_HEADERS


def detect_header_row(rows: list[list[Box]]) -> tuple[int, list[Box]] | None:
    """Find the row most consistent with column headers (>=2 known tokens)."""
    best_idx, best_count = -1, 0
    for idx, row in enumerate(rows):
        count = sum(1 for b in row if is_known_metric_header(b.text))
        if count > best_count:
            best_count = count
            best_idx = idx
    if best_idx == -1 or best_count < 2:
        return None
    return best_idx, rows[best_idx]


def detect_sorted_by_label(rows: list[list[Box]], header_idx: int) -> str | None:
    """
    The 'sorted by' pill sits in the SAME row as the column headers, far
    to the right of the rightmost metric header. Fallback: rightmost long
    text token in the header row that is NOT a known metric header.
    """
    if not (0 <= header_idx < len(rows)):
        return None
    header_row = rows[header_idx]
    if not header_row:
        return None
    metric_anchors = [b for b in header_row if is_known_metric_header(b.text)]
    if not metric_anchors:
        return None
    rightmost_metric_x = max(b.x_centre for b in metric_anchors)
    # Candidate boxes: in the header row, to the right of the rightmost
    # metric anchor, with multi-character (label-shaped) text.
    candidates = [
        b
        for b in header_row
        if b.x_centre > rightmost_metric_x and len(b.text) >= 3 and not is_known_metric_header(b.text)
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda b: b.x_left)
    raw = " ".join(b.text for b in candidates).strip()
    return raw.title() if raw else None


# ---------------------------------------------------------------------------
# Data-row parsing
# ---------------------------------------------------------------------------

LVL_PATTERN = re.compile(r"\bLVL\b", re.IGNORECASE)
INT_RE = re.compile(r"^[+-]?\d{1,4}$")
PCT_RE = re.compile(r"^\d{1,3}(?:\.\d+)?%?$")


def parse_metric_value(text: str) -> int | float | None:
    """Return an int, a float (for percentages), or None."""
    t = text.strip().replace(",", "")
    if INT_RE.match(t):
        try:
            return int(t)
        except ValueError:
            return None
    if PCT_RE.match(t.rstrip("%")):
        try:
            return float(t.rstrip("%"))
        except ValueError:
            return None
    # GAA/SV-pct decimal like "5.08" or "70.0":
    if re.match(r"^\d+\.\d+$", t):
        try:
            return float(t)
        except ValueError:
            return None
    return None


@dataclass(slots=True)
class DataRow:
    gamertag_snapshot: str
    player_name_snapshot: str | None
    player_level_snapshot: str | None
    stats: dict[str, Any]
    row_confidence: float
    warnings: list[str] = field(default_factory=list)


def assign_metrics_to_columns(
    row_boxes: list[Box],
    header_anchors: list[tuple[str, float]],
) -> tuple[dict[str, Any], list[str]]:
    """
    Given a row's boxes (sorted by x_left) and a list of (metric_name,
    x_centre) anchors from the header row, assign each numeric box to the
    nearest header anchor. Returns the parsed stats dict and any warnings.
    """
    warnings: list[str] = []
    if not header_anchors:
        return {}, ["no header anchors"]

    numeric_boxes: list[Box] = []
    for b in row_boxes:
        if parse_metric_value(b.text) is not None:
            numeric_boxes.append(b)

    stats: dict[str, Any] = {}
    used_metric: set[str] = set()
    for box in numeric_boxes:
        # Pick the closest header anchor x-centre.
        nearest = min(header_anchors, key=lambda a: abs(a[1] - box.x_centre))
        metric, anchor_x = nearest
        if metric in used_metric:
            warnings.append(
                f"duplicate assignment to {metric} (existing={stats[metric]}, new={box.text})"
            )
            continue
        # Reject if the box is more than half a column-pitch away from any anchor.
        if len(header_anchors) >= 2:
            pitches = [
                abs(header_anchors[i + 1][1] - header_anchors[i][1])
                for i in range(len(header_anchors) - 1)
            ]
            median_pitch = sorted(pitches)[len(pitches) // 2]
            if abs(anchor_x - box.x_centre) > median_pitch * 0.7:
                warnings.append(
                    f"box '{box.text}' x={box.x_centre:.0f} too far from {metric} x={anchor_x:.0f}"
                )
                continue
        value = parse_metric_value(box.text)
        stats[metric] = value
        used_metric.add(metric)

    return stats, warnings


def parse_data_row(
    row_boxes: list[Box],
    header_anchors: list[tuple[str, float]],
) -> DataRow | None:
    if not row_boxes:
        return None

    leftmost = row_boxes[0]
    gamertag = leftmost.text.strip()
    if not gamertag:
        return None

    # Pick player level (token containing 'LVL').
    level_box = next((b for b in row_boxes if LVL_PATTERN.search(b.text)), None)
    player_level = level_box.text.strip() if level_box else None

    # Pick player name: middle-band non-numeric, non-LVL token closest in
    # x-centre to the median between the gamertag and the leftmost numeric.
    numeric_xs = [b.x_centre for b in row_boxes if parse_metric_value(b.text) is not None]
    name_band_max = min(numeric_xs) if numeric_xs else float("inf")
    middle_candidates = [
        b
        for b in row_boxes
        if b is not leftmost
        and b is not level_box
        and parse_metric_value(b.text) is None
        and len(b.text.strip()) >= 2
        and b.x_centre < name_band_max
    ]
    player_name: str | None = None
    if middle_candidates:
        # Pick the one with the most letters — typical "Lane Hutson" style.
        middle_candidates.sort(
            key=lambda b: sum(c.isalpha() for c in b.text), reverse=True
        )
        player_name = middle_candidates[0].text.strip()

    stats, warnings = assign_metrics_to_columns(row_boxes, header_anchors)

    confidences = [b.conf for b in row_boxes if b.conf > 0]
    row_conf = round(sum(confidences) / len(confidences), 3) if confidences else 0.0

    return DataRow(
        gamertag_snapshot=gamertag,
        player_name_snapshot=player_name,
        player_level_snapshot=player_level,
        stats=stats,
        row_confidence=row_conf,
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

FOOTER_STOP_PATTERN = re.compile(
    r"\b(?:Club Founder|MEMBERS ONLINE|MEMBERS IN DRESSING|OVERALL RECORD|"
    r"OTHER PLATFORM|LAST\s*10\s*GAMES|SELECT|BACK|INVITE|SORT|SET CAPTAIN|EASHL)\b",
    re.IGNORECASE,
)


def is_footer_row(row: list[Box]) -> bool:
    text_blob = " ".join(b.text for b in row)
    return bool(FOOTER_STOP_PATTERN.search(text_blob))


def infer_extra_column_anchors(
    data_rows: list[list[Box]],
    known_anchors: list[tuple[str, float]],
) -> list[tuple[str, float]]:
    """
    If data rows have numeric x-centres beyond the rightmost known header
    anchor, cluster those positions and emit synthetic column names. This
    recovers columns whose single-letter headers (G, A, S, ...) were
    dropped by OCR.
    """
    if not data_rows:
        return []
    rightmost_known_x = max((x for _, x in known_anchors), default=0.0)
    extra_xs: list[float] = []
    for row in data_rows:
        for b in row:
            if parse_metric_value(b.text) is None:
                continue
            if b.x_centre > rightmost_known_x + 30.0:  # 30px past the last known column
                extra_xs.append(b.x_centre)
    if not extra_xs:
        return []
    extra_xs.sort()
    # Cluster close x-centres (within 25 px) into one column.
    clusters: list[list[float]] = [[extra_xs[0]]]
    for x in extra_xs[1:]:
        if x - clusters[-1][-1] <= 25.0:
            clusters[-1].append(x)
        else:
            clusters.append([x])
    return [
        (f"col_{i + 1}", sum(c) / len(c))
        for i, c in enumerate(clusters)
    ]


def extract(
    image_path: Path,
    title_slug: str,
    game_mode: str,
    role_group: str,
) -> dict[str, Any]:
    boxes, img, ocr = run_ocr(image_path)
    rows = cluster_rows(boxes)

    header = detect_header_row(rows)
    if header is None:
        return {
            "titleSlug": title_slug,
            "gameMode": game_mode,
            "roleGroup": role_group,
            "sourceAssetPath": str(image_path),
            "sortedByMetricLabel": None,
            "visibleMetricNames": [],
            "rows": [],
            "warnings": ["no column header row detected"],
        }
    header_idx, header_row = header

    header_anchors = [
        (normalise_metric_token(b.text), b.x_centre)
        for b in header_row
        if is_known_metric_header(b.text)
    ]

    sorted_label = detect_sorted_by_label(rows, header_idx)

    # Collect candidate data rows up to the first footer marker.
    candidate_data_rows: list[list[Box]] = []
    for idx in range(header_idx + 1, len(rows)):
        row = rows[idx]
        if is_footer_row(row):
            break
        if not any(parse_metric_value(b.text) is not None for b in row):
            continue
        candidate_data_rows.append(row)

    # Recover columns whose headers were dropped by OCR.
    extra_anchors = infer_extra_column_anchors(candidate_data_rows, header_anchors)
    full_anchors = [*header_anchors, *extra_anchors]
    visible_metrics = [m for m, _ in full_anchors]

    data_rows: list[DataRow] = []
    parsed_row_boxes: list[list[Box]] = []
    for row in candidate_data_rows:
        parsed = parse_data_row(row, full_anchors)
        if parsed is None:
            continue
        data_rows.append(parsed)
        parsed_row_boxes.append(row)

    # Per-cell OCR gap-fill — only fires for missing column values.
    filled = fill_numeric_gaps(img, ocr, data_rows, parsed_row_boxes, full_anchors)

    # Apply per-view canonical metric mapping.
    view_key = (sorted_label or "").lower()
    view_config = VIEW_COLUMN_MAP.get(view_key)
    canonical_metrics: list[str] = list(visible_metrics)
    role_group_effective = role_group
    canonical_mapping_applied = False
    mapping_warnings: list[str] = []

    if view_config is not None:
        canonical_columns: list[str | None] = view_config["columns"]
        role_group_effective = view_config.get("role_group", role_group)
        if len(canonical_columns) == len(visible_metrics):
            canonical_mapping_applied = True
            new_visible: list[str] = []
            # Translate each row's stats dict from synthetic/header keys to canonical keys.
            for parsed in data_rows:
                old_stats = parsed.stats
                new_stats: dict[str, Any] = {}
                kept_count = 0
                for old_key, canonical_key in zip(visible_metrics, canonical_columns):
                    if canonical_key is None:
                        continue
                    if old_key in old_stats:
                        new_stats[canonical_key] = old_stats[old_key]
                        kept_count += 1
                parsed.stats = new_stats
                # Add review-oriented warnings on the row.
                expected_canonical = [c for c in canonical_columns if c is not None]
                missing_canonical = [c for c in expected_canonical if c not in new_stats]
                if missing_canonical:
                    parsed.warnings.append(
                        f"missing canonical cells: {missing_canonical}"
                    )
                if kept_count == 0:
                    parsed.warnings.append("row produced zero canonical metric values")
            new_visible = [c for c in canonical_columns if c is not None]
            canonical_metrics = new_visible
        else:
            mapping_warnings.append(
                f"view '{sorted_label}' expects {len(canonical_columns)} columns; "
                f"detected {len(visible_metrics)} — mapping skipped"
            )

    # Top-level warnings useful for review.
    top_warnings: list[str] = []
    if filled:
        top_warnings.append(f"per-cell OCR filled {filled} cell(s)")
    top_warnings.extend(mapping_warnings)
    if canonical_mapping_applied:
        top_warnings.append(f"canonical mapping applied for view '{sorted_label}'")
    if not view_config:
        top_warnings.append("no canonical view mapping for sort label — synthetic col_N kept")
    if not data_rows:
        top_warnings.append("no data rows extracted")

    return {
        "titleSlug": title_slug,
        "gameMode": game_mode,
        "roleGroup": role_group_effective,
        "sourceAssetPath": str(image_path),
        "sortedByMetricLabel": sorted_label,
        "visibleMetricNames": canonical_metrics,
        "rawMetricColumns": visible_metrics,
        "canonicalMappingApplied": canonical_mapping_applied,
        "rows": [
            {
                "gamertagSnapshot": r.gamertag_snapshot,
                "playerNameSnapshot": r.player_name_snapshot,
                "playerLevelSnapshot": r.player_level_snapshot,
                "stats": r.stats,
                "rowConfidence": r.row_confidence,
                "warnings": r.warnings,
            }
            for r in data_rows
        ],
        "warnings": top_warnings,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Club-member screenshot extractor pilot")
    parser.add_argument("image", type=Path, help="Path to the screenshot PNG")
    parser.add_argument("--title-slug", required=True, help="e.g. nhl25")
    parser.add_argument("--game-mode", required=True, choices=["6s", "3s"])
    parser.add_argument("--role-group", required=True, choices=["skater", "goalie"])
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output JSON path. Default: <image_stem>.extract.json next to the image",
    )
    args = parser.parse_args(argv)

    if not args.image.exists():
        print(f"Image not found: {args.image}", file=sys.stderr)
        return 1

    result = extract(
        image_path=args.image,
        title_slug=args.title_slug,
        game_mode=args.game_mode,
        role_group=args.role_group,
    )

    out_path = args.output or args.image.with_suffix(".extract.json")
    out_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"Wrote {out_path}")
    print(
        json.dumps(
            {
                "rowCount": len(result["rows"]),
                "sortedByMetricLabel": result["sortedByMetricLabel"],
                "visibleMetricNames": result["visibleMetricNames"],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
