from __future__ import annotations

from dataclasses import dataclass
from importlib.resources import files

import yaml

from game_ocr.image import Region


@dataclass(frozen=True)
class ScreenConfig:
    screen_type: str
    expected_size: tuple[int, int]
    regions: dict[str, Region]


def load_screen_config(screen_type: str) -> ScreenConfig:
    base = files("game_ocr").joinpath("configs/roi").joinpath(f"{screen_type}.yaml")
    data = yaml.safe_load(base.read_text())
    regions = {
        name: Region(
            name=name,
            x=region_data["x"],
            y=region_data["y"],
            width=region_data["width"],
            height=region_data["height"],
            preprocess=region_data.get("preprocess", "default"),
        )
        for name, region_data in data["regions"].items()
    }
    return ScreenConfig(
        screen_type=data["screen_type"],
        expected_size=(data["expected_width"], data["expected_height"]),
        regions=regions,
    )

