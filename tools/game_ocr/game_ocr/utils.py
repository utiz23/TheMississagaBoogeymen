from __future__ import annotations

import hashlib
import re
from pathlib import Path


SPACE_RE = re.compile(r"\s+")


def normalize_text(text: str | None) -> str:
    if not text:
        return ""
    return SPACE_RE.sub(" ", text.replace("\n", " ")).strip()


def parse_int(value: str | None) -> int | None:
    if not value:
        return None
    digits = re.findall(r"\d+", value.replace(",", ""))
    if not digits:
        return None
    return int("".join(digits))


def parse_percentage(value: str | None) -> float | None:
    if not value:
        return None
    match = re.search(r"(\d+(?:\.\d+)?)", value.replace("%", ""))
    return float(match.group(1)) if match else None


def split_height_weight(value: str | None) -> tuple[str | None, str | None]:
    if not value:
        return None, None
    text = normalize_text(value).replace("I", "|")
    height = None
    weight = None
    height_match = re.search(r"(\d+'\d+\")", text)
    if height_match:
        height = height_match.group(1)
    weight_match = re.search(r"(\d+)\s*LBS", text.upper())
    if weight_match:
        weight = f"{weight_match.group(1)} lbs"
    return height, weight


def file_sha1(path: Path) -> str:
    digest = hashlib.sha1()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()

