from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from statistics import mean
from typing import Callable

from game_ocr.config import ScreenConfig, load_screen_config
from game_ocr.image import crop_region, load_image, preprocess_image
from game_ocr.models import BaseExtractionResult, ExtractionMeta, FailedExtractionResult
from game_ocr.ocr import OCRBackend, OCRLine, RapidOCRBackend
from game_ocr.parsers import (
    parse_loadout_result,
    parse_post_game_action_tracker,
    parse_post_game_box_score,
    parse_post_game_events,
    parse_post_game_faceoff_map,
    parse_post_game_net_chart,
    parse_post_game_player_summary,
    parse_pre_game_result,
)
from game_ocr.utils import file_sha1


Parser = Callable[[ExtractionMeta, dict[str, list[OCRLine]]], BaseExtractionResult]


@dataclass(frozen=True)
class ScreenDefinition:
    screen_type: str
    config: ScreenConfig
    parser: Parser


class ScreenRegistry:
    def __init__(self) -> None:
        self._definitions = {
            "pre_game_lobby_state_1": ScreenDefinition(
                screen_type="pre_game_lobby_state_1",
                config=load_screen_config("pre_game_lobby_state_1"),
                parser=lambda meta, regions: parse_pre_game_result(meta, regions, include_player_name=False),
            ),
            "pre_game_lobby_state_2": ScreenDefinition(
                screen_type="pre_game_lobby_state_2",
                config=load_screen_config("pre_game_lobby_state_2"),
                parser=lambda meta, regions: parse_pre_game_result(meta, regions, include_player_name=True),
            ),
            "player_loadout_view": ScreenDefinition(
                screen_type="player_loadout_view",
                config=load_screen_config("player_loadout_view"),
                parser=parse_loadout_result,
            ),
            "post_game_player_summary": ScreenDefinition(
                screen_type="post_game_player_summary",
                config=load_screen_config("post_game_player_summary"),
                parser=parse_post_game_player_summary,
            ),
            "post_game_box_score_goals": ScreenDefinition(
                screen_type="post_game_box_score_goals",
                config=load_screen_config("post_game_box_score_goals"),
                parser=lambda meta, regions: parse_post_game_box_score(meta, regions, stat_kind="goals"),
            ),
            "post_game_box_score_shots": ScreenDefinition(
                screen_type="post_game_box_score_shots",
                config=load_screen_config("post_game_box_score_shots"),
                parser=lambda meta, regions: parse_post_game_box_score(meta, regions, stat_kind="shots"),
            ),
            "post_game_box_score_faceoffs": ScreenDefinition(
                screen_type="post_game_box_score_faceoffs",
                config=load_screen_config("post_game_box_score_faceoffs"),
                parser=lambda meta, regions: parse_post_game_box_score(meta, regions, stat_kind="faceoffs"),
            ),
            "post_game_net_chart": ScreenDefinition(
                screen_type="post_game_net_chart",
                config=load_screen_config("post_game_net_chart"),
                parser=parse_post_game_net_chart,
            ),
            "post_game_faceoff_map": ScreenDefinition(
                screen_type="post_game_faceoff_map",
                config=load_screen_config("post_game_faceoff_map"),
                parser=parse_post_game_faceoff_map,
            ),
            "post_game_events": ScreenDefinition(
                screen_type="post_game_events",
                config=load_screen_config("post_game_events"),
                parser=parse_post_game_events,
            ),
            "post_game_action_tracker": ScreenDefinition(
                screen_type="post_game_action_tracker",
                config=load_screen_config("post_game_action_tracker"),
                parser=parse_post_game_action_tracker,
            ),
        }

    def get(self, screen_type: str) -> ScreenDefinition:
        return self._definitions[screen_type]

    def list_screen_types(self) -> list[str]:
        return sorted(self._definitions.keys())


class Extractor:
    def __init__(self, backend: OCRBackend | None = None, registry: ScreenRegistry | None = None) -> None:
        self.backend = backend or RapidOCRBackend()
        self.registry = registry or ScreenRegistry()

    def extract_path(self, screen_type: str, path: Path, duplicate_of: str | None = None) -> BaseExtractionResult:
        definition = self.registry.get(screen_type)
        meta = ExtractionMeta(
            screen_type=screen_type,
            source_path=str(path),
            ocr_backend=self.backend.name,
            duplicate_of=duplicate_of,
        )
        try:
            image = load_image(str(path))
            regions: dict[str, list[OCRLine]] = {}
            for region_name, region in definition.config.regions.items():
                crop = crop_region(image, region)
                processed = preprocess_image(crop, region.preprocess)
                regions[region_name] = self.backend.read(processed)
            result = definition.parser(meta, regions)
            result.meta.overall_confidence = self._compute_overall_confidence(result)
            if not self._has_any_text(regions):
                result.warnings.append("No OCR text found in configured regions.")
            return result
        except Exception as exc:
            return FailedExtractionResult(meta=meta, errors=[str(exc)])

    def extract_input(self, screen_type: str, input_path: Path) -> list[BaseExtractionResult]:
        if input_path.is_dir():
            files = sorted(
                [path for path in input_path.iterdir() if path.is_file() and path.suffix.lower() in {".png", ".jpg", ".jpeg", ".bmp"}]
            )
        else:
            files = [input_path]

        seen_hashes: dict[str, str] = {}
        results: list[BaseExtractionResult] = []
        for path in files:
            digest = file_sha1(path)
            duplicate_of = seen_hashes.get(digest)
            if not duplicate_of:
                seen_hashes[digest] = str(path)
            results.append(self.extract_path(screen_type, path, duplicate_of=duplicate_of))
        return results

    @staticmethod
    def _has_any_text(regions: dict[str, list[OCRLine]]) -> bool:
        return any(lines for lines in regions.values())

    @staticmethod
    def _compute_overall_confidence(result: BaseExtractionResult) -> float | None:
        scores: list[float] = []
        for value in result.__dict__.values():
            scores.extend(_collect_confidences(value))
        return round(mean(scores), 4) if scores else None


def _collect_confidences(value) -> list[float]:
    scores: list[float] = []
    if hasattr(value, "confidence") and getattr(value, "confidence") is not None:
        scores.append(float(value.confidence))
    if isinstance(value, dict):
        for nested in value.values():
            scores.extend(_collect_confidences(nested))
        return scores
    if isinstance(value, list):
        for nested in value:
            scores.extend(_collect_confidences(nested))
        return scores
    if hasattr(value, "model_dump"):
        scores.extend(_collect_confidences(value.__dict__))
    return scores
