from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import cv2
import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "tools" / "game_ocr"))

from game_ocr.ocr import OCRLine, RapidOCRBackend  # noqa: E402
from game_ocr.xfactor_icon_matcher import canonical_names  # noqa: E402


TAB_RECTS: dict[str, tuple[int, int, int, int]] = {
    "Skating/Strength": (183, 160, 334, 201),
    "Shooting/Passing": (340, 160, 493, 201),
    "Puck Skills": (495, 160, 603, 201),
    "Body/Stick Checking": (606, 160, 775, 201),
    "Goaltending": (779, 160, 892, 201),
}

TIER_REGIONS: dict[str, dict[str, tuple[int, int, int, int]]] = {
    "Specialist": {
        "label": (760, 0, 950, 215),
        "value": (960, 0, 1105, 215),
    },
    "All Star": {
        "label": (1138, 0, 1330, 215),
        "value": (1340, 0, 1486, 215),
    },
    "Elite": {
        "label": (1518, 0, 1710, 215),
        "value": (1720, 0, 1868, 215),
    },
}

LEFT_OCR_CROP = (60, 220, 760, 980)
ROW_TOP_OFFSET = 33
ROW_HEIGHT = 215

CANONICAL_NAMES = tuple(canonical_names())
STRIPPED_INDEX = {
    re.sub(r"[^A-Z0-9]", "", name.upper()): name for name in CANONICAL_NAMES
}
STRIPPED_ALIASES = {
    "PRESSURE": "PressurePlus",
    "PRESSUREPLUS": "PressurePlus",
}

VALUE_RE = re.compile(
    r"^\s*(?P<sign>[+-]?)\s*(?P<number>\d+(?:\.\d+)?)\s*(?P<unit>%?)\s*(?:\((?P<duration>[^)]+)\))?\s*$"
)


@dataclass(frozen=True)
class ParsedValue:
    raw: str
    numeric_value: float | None
    unit: str | None
    duration_text: str | None


def levenshtein_at_most_one(a: str, b: str) -> int:
    if a == b:
        return 0
    if abs(len(a) - len(b)) > 1:
        return 2
    if len(a) < len(b):
        a, b = b, a
    if len(a) == len(b):
        mismatches = sum(1 for x, y in zip(a, b) if x != y)
        return mismatches if mismatches <= 1 else 2
    # len(a) == len(b) + 1
    i = j = 0
    edits = 0
    while i < len(a) and j < len(b):
        if a[i] == b[j]:
            i += 1
            j += 1
            continue
        edits += 1
        if edits > 1:
            return 2
        i += 1
    return edits if edits == 1 else 1


def strip_name(text: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", text.upper())


def normalize_ocr_text(text: str) -> str:
    return (
        text.replace("（", "(")
        .replace("）", ")")
        .replace(" ", "")
        .strip()
    )


def canonicalize_name(raw: str) -> str | None:
    stripped = strip_name(raw)
    if not stripped:
        return None
    if stripped in STRIPPED_INDEX:
        return STRIPPED_INDEX[stripped]
    if stripped in STRIPPED_ALIASES:
        return STRIPPED_ALIASES[stripped]
    best: tuple[int, str] | None = None
    ambiguous = False
    for candidate_stripped, candidate in STRIPPED_INDEX.items():
        dist = levenshtein_at_most_one(stripped, candidate_stripped)
        if dist > 1:
            continue
        if best is None or dist < best[0]:
            best = (dist, candidate)
            ambiguous = False
        elif best is not None and dist == best[0]:
            ambiguous = True
    if best is not None and not ambiguous:
        return best[1]
    return None


def parse_value(raw: str) -> ParsedValue:
    compact = normalize_ocr_text(raw)
    match = VALUE_RE.match(compact)
    if not match:
        return ParsedValue(raw=raw, numeric_value=None, unit=None, duration_text=None)
    sign = -1.0 if match.group("sign") == "-" else 1.0
    number = float(match.group("number")) * sign
    unit = "percent" if match.group("unit") == "%" else None
    duration = match.group("duration")
    return ParsedValue(
        raw=raw,
        numeric_value=number,
        unit=unit,
        duration_text=duration,
    )


def first_sign(raw: str | None) -> str | None:
    if not raw:
        return None
    compact = normalize_ocr_text(raw)
    if compact.startswith("+"):
        return "+"
    if compact.startswith("-"):
        return "-"
    return None


def apply_sign(sign: str, metric: dict[str, object]) -> None:
    raw = metric.get("raw")
    if not isinstance(raw, str):
        return
    compact = normalize_ocr_text(raw)
    if compact.startswith(("+", "-")):
        return
    metric["raw"] = sign + compact
    if isinstance(metric.get("numericValue"), (int, float)):
        value = float(metric["numericValue"])
        metric["numericValue"] = abs(value) if sign == "+" else -abs(value)


def read_lines(ocr: RapidOCRBackend, image: np.ndarray) -> list[OCRLine]:
    lines = ocr.read(image)
    return sorted(lines, key=lambda line: (round(line.y1), line.x1))


def detect_active_category(image: np.ndarray) -> str:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    scores: list[tuple[float, str]] = []
    for category, (x1, y1, x2, y2) in TAB_RECTS.items():
        crop = gray[y1:y2, x1:x2]
        scores.append((float(crop.mean()), category))
    scores.sort(reverse=True)
    return scores[0][1]


def detect_highlighted_row_bounds(image: np.ndarray) -> tuple[int, int]:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mask = (
        (hsv[:, :, 0] > 10)
        & (hsv[:, :, 0] < 35)
        & (hsv[:, :, 1] > 80)
        & (hsv[:, :, 2] > 120)
    ).astype(np.uint8)
    profile = mask[:, 40:120].mean(axis=1)
    spans: list[tuple[int, int, float]] = []
    start: int | None = None
    for idx, value in enumerate(profile):
        if value > 0.03 and start is None:
            start = idx
        elif value <= 0.03 and start is not None:
            spans.append((start, idx - 1, float(profile[start:idx].mean())))
            start = None
    if start is not None:
        spans.append((start, len(profile) - 1, float(profile[start:].mean())))
    if not spans:
        raise RuntimeError("Could not detect highlighted row from left gold bar.")
    top, bottom, _ = max(spans, key=lambda item: (item[1] - item[0], item[2]))
    return top, bottom


def detect_row_headings(ocr: RapidOCRBackend, image: np.ndarray) -> list[dict[str, object]]:
    x1, y1, x2, y2 = LEFT_OCR_CROP
    crop = image[y1:y2, x1:x2]
    lines = read_lines(ocr, crop)
    out: list[dict[str, object]] = []
    for line in lines:
        txt = line.text.strip()
        if txt == "X-FACTORS":
            continue
        alpha = sum(ch.isalpha() for ch in txt)
        upper = sum(ch.isupper() for ch in txt if ch.isalpha())
        if alpha < 4 or upper < max(4, int(alpha * 0.75)) or len(txt.split()) > 3:
            continue
        abs_y1 = int(round(line.y1 + y1))
        abs_y2 = int(round(line.y2 + y1))
        row_top = max(0, abs_y1 - ROW_TOP_OFFSET)
        row_bottom = min(image.shape[0], row_top + ROW_HEIGHT)
        out.append(
            {
                "rawName": txt,
                "headingY1": abs_y1,
                "headingY2": abs_y2,
                "rowTop": row_top,
                "rowBottom": row_bottom,
            }
        )
    return out


def lines_to_text(lines: Iterable[OCRLine]) -> list[str]:
    return [line.text for line in lines if line.text]


def extract_left_block(ocr: RapidOCRBackend, row_image: np.ndarray) -> tuple[str | None, str | None, list[str]]:
    lines = read_lines(ocr, row_image[:, 0:700])
    if not lines:
        return None, None, []
    name = lines[0].text
    canonical = canonicalize_name(name)
    description = [line.text for line in lines[1:]]
    return name, canonical, description


def extract_tier_block(
    ocr: RapidOCRBackend,
    row_image: np.ndarray,
    tier_name: str,
) -> dict[str, object]:
    regions = TIER_REGIONS[tier_name]
    label_crop = row_image[
        regions["label"][1]:regions["label"][3],
        regions["label"][0]:regions["label"][2],
    ]
    value_crop = row_image[
        regions["value"][1]:regions["value"][3],
        regions["value"][0]:regions["value"][2],
    ]
    label_lines = read_lines(ocr, label_crop)
    value_lines = read_lines(ocr, value_crop)
    labels = lines_to_text(label_lines)
    values = [parse_value(line.text) for line in value_lines]
    metric_rows: list[dict[str, object]] = []
    for idx in range(max(len(labels), len(values))):
        label = labels[idx] if idx < len(labels) else None
        parsed = values[idx] if idx < len(values) else None
        metric_rows.append(
            {
                "metric": label,
                "raw": parsed.raw if parsed else None,
                "numericValue": parsed.numeric_value if parsed else None,
                "unit": parsed.unit if parsed else None,
                "durationText": parsed.duration_text if parsed else None,
            }
        )
    return {
        "labelsRaw": labels,
        "valuesRaw": [value.raw for value in values],
        "metrics": metric_rows,
    }


def extract_row(
    ocr: RapidOCRBackend,
    row_image: np.ndarray,
    *,
    screenshot_name: str,
    category: str,
    top: int,
    bottom: int,
    raw_name_hint: str | None = None,
    highlighted: bool = False,
) -> dict[str, object]:
    raw_name, canonical_name, description = extract_left_block(ocr, row_image)
    tiers = {
        tier_name: extract_tier_block(ocr, row_image, tier_name)
        for tier_name in TIER_REGIONS
    }
    return {
        "screenshot": screenshot_name,
        "category": category,
        "rowBounds": {"top": top, "bottom": bottom},
        "rawName": raw_name,
        "rawNameHint": raw_name_hint,
        "canonicalName": canonical_name,
        "descriptionLines": description,
        "highlighted": highlighted,
        "tiers": tiers,
    }


def extract_highlighted_row(path: Path, ocr: RapidOCRBackend) -> dict[str, object]:
    image = cv2.imread(str(path))
    if image is None:
        raise FileNotFoundError(path)
    active_category = detect_active_category(image)
    top, bottom = detect_highlighted_row_bounds(image)
    row_image = image[top:bottom, :, :]
    return extract_row(
        ocr,
        row_image,
        screenshot_name=path.name,
        category=active_category,
        top=top,
        bottom=bottom,
        highlighted=True,
    )


def extract_visible_rows(path: Path, ocr: RapidOCRBackend) -> dict[str, object]:
    image = cv2.imread(str(path))
    if image is None:
        raise FileNotFoundError(path)
    active_category = detect_active_category(image)
    highlighted_top, highlighted_bottom = detect_highlighted_row_bounds(image)
    headings = detect_row_headings(ocr, image)
    rows: list[dict[str, object]] = []
    for heading in headings:
        top = int(heading["rowTop"])
        bottom = int(heading["rowBottom"])
        row_image = image[top:bottom, :, :]
        is_highlighted = abs(top - highlighted_top) <= 5 and abs(bottom - highlighted_bottom) <= 5
        rows.append(
            extract_row(
                ocr,
                row_image,
                screenshot_name=path.name,
                category=active_category,
                top=top,
                bottom=bottom,
                raw_name_hint=str(heading["rawName"]),
                highlighted=is_highlighted,
            )
        )
    return {
        "screenshot": path.name,
        "category": active_category,
        "highlightedRowBounds": {"top": highlighted_top, "bottom": highlighted_bottom},
        "rows": rows,
    }


def merge_visible_rows(screenshots: list[dict[str, object]]) -> list[dict[str, object]]:
    merged: dict[tuple[str, str], dict[str, object]] = {}
    for screenshot in screenshots:
        for row in screenshot["rows"]:
            canonical_name = row.get("canonicalName")
            if not canonical_name:
                continue
            key = (str(row["category"]), str(canonical_name))
            current = merged.get(key)
            if current is None:
                merged[key] = {
                    "category": row["category"],
                    "canonicalName": canonical_name,
                    "sourceScreenshots": [row["screenshot"]],
                    "rawNames": [row["rawName"]],
                    "descriptionLines": row["descriptionLines"],
                    "tiers": row["tiers"],
                }
                continue

            current["sourceScreenshots"] = sorted(
                set(current["sourceScreenshots"]) | {row["screenshot"]}
            )
            current["rawNames"] = sorted(
                {name for name in current["rawNames"] if name} | ({row["rawName"]} if row["rawName"] else set())
            )

            if len(row["descriptionLines"]) > len(current["descriptionLines"]):
                current["descriptionLines"] = row["descriptionLines"]

            for tier_name, tier_data in row["tiers"].items():
                current_tier = current["tiers"][tier_name]
                if len(tier_data["metrics"]) > len(current_tier["metrics"]):
                    current["tiers"][tier_name] = tier_data
                    continue
                for idx, metric in enumerate(tier_data["metrics"]):
                    if idx >= len(current_tier["metrics"]):
                        current_tier["metrics"].append(metric)
                        continue
                    current_metric = current_tier["metrics"][idx]
                    if current_metric.get("metric") is None and metric.get("metric") is not None:
                        current_metric["metric"] = metric["metric"]
                    if current_metric.get("raw") is None and metric.get("raw") is not None:
                        current_metric["raw"] = metric["raw"]
                    if current_metric.get("numericValue") is None and metric.get("numericValue") is not None:
                        current_metric["numericValue"] = metric["numericValue"]
                    if current_metric.get("unit") is None and metric.get("unit") is not None:
                        current_metric["unit"] = metric["unit"]
                    if current_metric.get("durationText") is None and metric.get("durationText") is not None:
                        current_metric["durationText"] = metric["durationText"]
    merged_rows = sorted(merged.values(), key=lambda row: (str(row["category"]), str(row["canonicalName"])))
    for row in merged_rows:
        repair_metric_signs(row)
        repair_semantic_negative_signs(row)
    return merged_rows


def repair_metric_signs(row: dict[str, object]) -> None:
    tier_order = ("Specialist", "All Star", "Elite")
    metrics_by_idx: dict[int, list[dict[str, object]]] = {}
    tiers = row["tiers"]
    for tier_name in tier_order:
        for idx, metric in enumerate(tiers[tier_name]["metrics"]):
            metrics_by_idx.setdefault(idx, []).append(metric)
    for group in metrics_by_idx.values():
        signs = [first_sign(metric.get("raw")) for metric in group]
        known = [sign for sign in signs if sign is not None]
        if len(known) < 2 or len(set(known)) != 1:
            continue
        consensus = known[0]
        for metric in group:
            if first_sign(metric.get("raw")) is None:
                apply_sign(consensus, metric)


def repair_semantic_negative_signs(row: dict[str, object]) -> None:
    negative_tokens = ("DRAIN", "REDUCTION", "OPPONENTSPEED", "OPPONENTACCELERATION")
    for tier in row["tiers"].values():
        for metric in tier["metrics"]:
            label = metric.get("metric")
            if not isinstance(label, str):
                continue
            if first_sign(metric.get("raw")) is not None:
                continue
            normalized = normalize_ocr_text(label).upper()
            if any(token in normalized for token in negative_tokens):
                apply_sign("-", metric)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("screenshots", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--mode", choices=("highlighted", "visible", "merged"), default="highlighted")
    args = parser.parse_args()

    ocr = RapidOCRBackend(use_gpu=False)
    if args.mode == "highlighted":
        results: object = [extract_highlighted_row(path, ocr) for path in args.screenshots]
    elif args.mode == "visible":
        results = [extract_visible_rows(path, ocr) for path in args.screenshots]
    else:
        visible = [extract_visible_rows(path, ocr) for path in args.screenshots]
        results = merge_visible_rows(visible)
    payload = json.dumps(results, indent=2)
    if args.output is not None:
        args.output.write_text(payload + "\n")
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
