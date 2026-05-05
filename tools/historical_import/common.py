from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import csv
import json
import re
from typing import Iterable


VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
TITLE_PATTERN = re.compile(r"nhl[_\-\s]?(2[2-5])", re.IGNORECASE)


@dataclass(slots=True)
class ManifestRow:
    title_slug: str
    gamertag: str
    game_mode: str
    position_scope: str
    role_group: str
    source_game_mode_label: str
    source_position_label: str
    asset_path: str


def normalize_title_slug(raw: str) -> str:
    match = TITLE_PATTERN.search(raw)
    if not match:
        raise ValueError(f"Unable to infer title slug from {raw}")
    return f"nhl{match.group(1)}"


def ensure_video_path(path: Path) -> None:
    if path.suffix.lower() not in VIDEO_EXTENSIONS:
        raise ValueError(f"Unsupported asset type: {path}")


def load_manifest(path: Path) -> list[ManifestRow]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = [
            ManifestRow(
                title_slug=(row.get("title_slug") or "").strip(),
                gamertag=(row.get("gamertag") or "").strip(),
                game_mode=(row.get("game_mode") or "").strip(),
                position_scope=(row.get("position_scope") or "").strip(),
                role_group=(row.get("role_group") or "").strip(),
                source_game_mode_label=(row.get("source_game_mode_label") or "").strip(),
                source_position_label=(row.get("source_position_label") or "").strip(),
                asset_path=(row.get("asset_path") or "").strip(),
            )
            for row in reader
        ]
    return rows


def write_manifest(path: Path, rows: Iterable[ManifestRow]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "title_slug",
                "gamertag",
                "game_mode",
                "position_scope",
                "role_group",
                "source_game_mode_label",
                "source_position_label",
                "asset_path",
            ],
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(row.__dict__)


def dump_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")
