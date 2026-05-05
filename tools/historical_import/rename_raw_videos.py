#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from common import VIDEO_EXTENSIONS, normalize_title_slug
from extract_review_artifacts import ROI, crop, load_runtime, normalize_text, ocr_tokens

TIMESTAMP_STEM = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$")

TOP_GAMERTAG_ROI = (90, 140, 430, 205)
FILTERS_ROI = ROI["filters"]
FOOTER_GAMERTAG_ROI = ROI["footer_gamertag"]

STOP_TOKENS = {
    "viewing",
    "stats",
    "for",
    "local",
    "seasons",
    "career",
    "eashl",
    "position",
    "overall",
}


@dataclass(slots=True)
class Proposal:
    source_path: Path
    target_name: str
    gamertag: str
    game_mode: str
    position_scope: str
    role_group: str
    source_game_mode_label: str
    source_position_label: str
    title_slug: str


def crop_rect(image, rect: tuple[int, int, int, int]):
    x1, y1, x2, y2 = rect
    return image[y1:y2, x1:x2]


def sample_frames(cv2, asset_path: Path, *, max_frames: int = 5) -> list[Any]:
    capture = cv2.VideoCapture(str(asset_path))
    if not capture.isOpened():
        raise SystemExit(f"Unable to open video asset: {asset_path}")

    fps = capture.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        fps = 30.0

    sample_seconds = [0, 1, 2, 4, 8]
    frames: list[Any] = []
    seen_indexes: set[int] = set()
    for second in sample_seconds[:max_frames]:
        frame_index = int(round(second * fps))
        if frame_index in seen_indexes:
            continue
        seen_indexes.add(frame_index)
        capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
        ok, image = capture.read()
        if ok:
            frames.append(image)

    capture.release()
    return frames


def clean_token(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]", "", text)


def extract_gamertag_from_tokens(tokens: list[str]) -> str | None:
    for index, token in enumerate(tokens):
        marker = normalize_text(token).replace("0", "o")
        if "viewingstatsfor" in marker:
            suffix = clean_token(re.sub(r"(?i)^.*viewing\s*stats\s*for[:\s]*", "", token))
            if len(suffix) >= 3 and not re.fullmatch(r"(?:lvl|p)\d+", suffix, re.IGNORECASE):
                return suffix
            for next_token in tokens[index + 1 :]:
                cleaned = clean_token(next_token)
                if len(cleaned) >= 3 and not re.fullmatch(r"(?:lvl|p)\d+", cleaned, re.IGNORECASE):
                    return cleaned

    candidates: list[str] = []
    for token in tokens:
        cleaned = clean_token(token)
        if len(cleaned) < 3:
            continue
        if re.fullmatch(r"(?:lvl|p)\d+", cleaned, re.IGNORECASE):
            continue
        marker = normalize_text(cleaned).replace("0", "o")
        if marker in STOP_TOKENS or "viewingstatsfor" in marker:
            continue
        candidates.append(cleaned)

    if not candidates:
        return None

    candidates.sort(key=lambda item: (any(ch.isdigit() for ch in item), len(item)), reverse=True)
    return candidates[0]


def extract_gamertag(ocr, image) -> str | None:
    top_tokens = ocr_tokens(
        ocr,
        crop_rect(image, TOP_GAMERTAG_ROI),
        x_offset=TOP_GAMERTAG_ROI[0],
        y_offset=TOP_GAMERTAG_ROI[1],
    )
    candidate = extract_gamertag_from_tokens([token.text for token in top_tokens])
    if candidate:
        return candidate

    footer_tokens = ocr_tokens(
        ocr,
        crop_rect(image, FOOTER_GAMERTAG_ROI),
        x_offset=FOOTER_GAMERTAG_ROI[0],
        y_offset=FOOTER_GAMERTAG_ROI[1],
    )
    return extract_gamertag_from_tokens([token.text for token in footer_tokens])


def mode_label_from_filter_tokens(filter_texts: list[str]) -> str:
    normalized = [normalize_text(text).replace("0", "o") for text in filter_texts]
    joined = " ".join(normalized)
    collapsed = joined.replace("'", "")

    if "6v6" in joined or "6sgame" in collapsed:
        return "SEASONS EASHL 6V6"
    if "3v3" in joined or "3sgame" in collapsed:
        return "SEASONS EASHL 3V3"
    return ""


def position_label_from_filter_tokens(filter_texts: list[str]) -> str:
    normalized = [normalize_text(text).replace("0", "o") for text in filter_texts]
    joined = " ".join(normalized)

    if "allgoalies" in joined:
        return "GOALIE"
    if "allskaters" in joined:
        return "ALL SKATERS"
    if "position:center" in joined or "center" in joined:
        return "CENTER"
    if "position:leftwing" in joined or "leftwing" in joined:
        return "LEFT WING"
    if "position:rightwing" in joined or "rightwing" in joined:
        return "RIGHT WING"
    if "position:wing" in joined or re.search(r"\bwing\b", joined):
        return "WING"
    if "position:defensemen" in joined or "defensemen" in joined:
        return "DEFENSEMEN"
    if "position:defense" in joined or re.search(r"\bdefense\b", joined):
        return "DEFENSEMEN"
    if "position:goalie" in joined or "goalie" in joined:
        return "GOALIE"
    return ""


def extract_filter_labels(ocr, image) -> tuple[str, str]:
    tokens = ocr_tokens(
        ocr,
        crop_rect(image, FILTERS_ROI),
        x_offset=FILTERS_ROI[0],
        y_offset=FILTERS_ROI[1],
    )
    token_texts = [token.text for token in tokens]
    return mode_label_from_filter_tokens(token_texts), position_label_from_filter_tokens(token_texts)


def normalized_mode(label: str) -> str:
    lowered = normalize_text(label)
    if "6v6" in lowered:
        return "6s"
    if "3v3" in lowered:
        return "3s"
    raise ValueError(f"Unable to normalize game mode from label: {label}")


def normalized_position(label: str) -> tuple[str, str]:
    lowered = normalize_text(label)
    if lowered == "allskaters":
        return "all_skaters", "skater"
    if lowered == "center":
        return "center", "skater"
    if lowered == "leftwing":
        return "leftWing", "skater"
    if lowered == "rightwing":
        return "rightWing", "skater"
    if lowered == "wing":
        return "wing", "skater"
    if lowered == "defensemen":
        return "defenseMen", "skater"
    if lowered == "goalie":
        return "goalie", "goalie"
    raise ValueError(f"Unable to normalize position label: {label}")


def title_prefix(title_slug: str) -> str:
    match = re.fullmatch(r"nhl(\d+)", title_slug)
    if not match:
        raise ValueError(f"Unsupported title slug for rename prefix: {title_slug}")
    return f"NHL_{match.group(1)}"


def build_proposal(cv2, ocr, title_slug: str, path: Path) -> Proposal:
    frames = sample_frames(cv2, path)
    if not frames:
        raise ValueError(f"No sample frames available for {path}")

    gamertag = ""
    source_game_mode_label = ""
    source_position_label = ""

    for image in frames:
        gamertag = gamertag or (extract_gamertag(ocr, image) or "")
        game_mode_label, position_label = extract_filter_labels(ocr, image)
        source_game_mode_label = source_game_mode_label or game_mode_label
        source_position_label = source_position_label or position_label
        if gamertag and source_game_mode_label and source_position_label:
            break

    if not gamertag:
        raise ValueError(f"Unable to extract gamertag from {path.name}")
    if not source_game_mode_label:
        raise ValueError(f"Unable to extract game mode label from {path.name}")
    if not source_position_label:
        raise ValueError(f"Unable to extract position label from {path.name}")

    game_mode = normalized_mode(source_game_mode_label)
    position_scope, role_group = normalized_position(source_position_label)
    target_name = (
        f"{title_prefix(title_slug)}__{gamertag}__{game_mode}__{position_scope}{path.suffix.lower()}"
    )

    return Proposal(
        source_path=path,
        target_name=target_name,
        gamertag=gamertag,
        game_mode=game_mode,
        position_scope=position_scope,
        role_group=role_group,
        source_game_mode_label=source_game_mode_label,
        source_position_label=source_position_label,
        title_slug=title_slug,
    )


def discover_paths(root: Path) -> list[Path]:
    return sorted(
        path
        for path in root.iterdir()
        if path.is_file()
        and path.suffix.lower() in VIDEO_EXTENSIONS
        and TIMESTAMP_STEM.fullmatch(path.stem)
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Rename raw historical stat videos from OCR-detected metadata.")
    parser.add_argument("input_root", type=Path, help="Directory containing raw timestamped video files.")
    parser.add_argument(
        "--title-slug",
        help="Title slug to use when filenames do not already encode the NHL title (example: nhl24).",
    )
    parser.add_argument("--apply", action="store_true", help="Perform renames. Default is dry-run only.")
    parser.add_argument("--output-csv", type=Path, help="Optional path to write rename proposals as CSV.")
    args = parser.parse_args()

    title_slug = normalize_title_slug(args.title_slug) if args.title_slug else ""
    if not title_slug:
        raise SystemExit("--title-slug is required for raw timestamped files")

    cv2, _np, RapidOCR, _ort = load_runtime()
    ocr = RapidOCR()

    paths = discover_paths(args.input_root)
    if not paths:
        raise SystemExit(f"No timestamped raw video files found in {args.input_root}")

    proposals: list[Proposal] = []
    errors: list[tuple[str, str]] = []

    for path in paths:
        try:
            proposals.append(build_proposal(cv2, ocr, title_slug, path))
        except Exception as exc:
            errors.append((path.name, str(exc)))

    if args.output_csv:
        with args.output_csv.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=[
                    "source_path",
                    "target_name",
                    "gamertag",
                    "game_mode",
                    "position_scope",
                    "role_group",
                    "source_game_mode_label",
                    "source_position_label",
                    "title_slug",
                ],
            )
            writer.writeheader()
            for proposal in proposals:
                writer.writerow(
                    {
                        "source_path": str(proposal.source_path),
                        "target_name": proposal.target_name,
                        "gamertag": proposal.gamertag,
                        "game_mode": proposal.game_mode,
                        "position_scope": proposal.position_scope,
                        "role_group": proposal.role_group,
                        "source_game_mode_label": proposal.source_game_mode_label,
                        "source_position_label": proposal.source_position_label,
                        "title_slug": proposal.title_slug,
                    }
                )

    for proposal in proposals:
        print(f"{proposal.source_path.name} -> {proposal.target_name}")
    for name, error in errors:
        print(f"ERROR {name}: {error}")

    if errors:
        raise SystemExit(f"Unable to build proposals for {len(errors)} file(s)")

    if not args.apply:
        return

    occupied = {proposal.source_path.parent / proposal.target_name for proposal in proposals}
    if len(occupied) != len(proposals):
        raise SystemExit("Rename proposals contain duplicate target names")

    for proposal in proposals:
        target_path = proposal.source_path.with_name(proposal.target_name)
        if target_path.exists():
            raise SystemExit(f"Target already exists: {target_path}")

    for proposal in proposals:
        proposal.source_path.rename(proposal.source_path.with_name(proposal.target_name))


if __name__ == "__main__":
    main()
