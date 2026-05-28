"""Phase 3b typed extractor entry point for the pre-game lobby.

Mirrors `loadout_evidence.py`'s contract: reads PNG frames from a
Pass-2-extracted segment directory, optionally runs RapidOCR on each frame
(or uses pre-computed lines), produces a flat list of `FieldEvidenceRecord`
ready for the worker to insert into `ocr_field_evidence`.

Architectural difference vs loadout-view:
- The lobby shows BOTH teams' 6-row rosters simultaneously on every frame.
  There are 12 fixed subjects per frame keyed by (team_side, position) —
  not a single navigated subject like loadout-detail.
- We pick the SINGLE best frame per `(team_side, position)` slot across the
  segment (highest mean OCR confidence in the row band), then emit
  per-field evidence from THAT frame for that slot.

Frame naming: same as loadout (`bundle_dir/00001.png` 5-digit padded).
"""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from statistics import mean
from typing import Any, Optional, Sequence

import cv2

from .lobby_extractors.row_grouping import (
    BGM_PANEL_X_RANGE,
    OPP_PANEL_X_RANGE,
    LobbyRow,
    detect_lobby_rows,
)
from .lobby_extractors.slot_identity import (
    LobbySubjectIdentity,
    identify_lobby_subjects,
    slot_key_for,
)
from .loadout_evidence import FieldEvidenceRecord
from .loadout_extractors.open_text import LoadoutOpenTextExtractor
from .ocr import OCRLine, RapidOCRBackend

EXTRACTOR_VERSION = "lobby-evidence-v1"
SCREEN_STATE = "pre_game_lobby_state_2"


# ─── Public entry point ─────────────────────────────────────────────────────


def extract_lobby_evidence(
    bundle_dir: Path,
    *,
    segment_index: int,
    extractor_version: str = EXTRACTOR_VERSION,
    ocr_lines_per_frame: Sequence[Sequence[OCRLine]] | None = None,
    use_gpu: bool = False,
) -> list[FieldEvidenceRecord]:
    """Top-level entry: bundle_dir → list[FieldEvidenceRecord].

    Reads PNG frames from `bundle_dir`, optionally runs RapidOCR per frame,
    detects lobby rows and identifies subjects on every frame, picks the
    best frame per slot (highest mean row confidence), and emits per-field
    `FieldEvidenceRecord`s for the chosen slot/frame.

    Parameters
    ----------
    bundle_dir:
        Directory containing 5-digit zero-padded PNGs.
    segment_index:
        Pass-1 segment index — included in `support_frame_ids` for the
        chosen frame.
    extractor_version:
        Stamped onto every emitted FieldEvidenceRecord.
    ocr_lines_per_frame:
        Optional pre-computed OCR lines (one sequence per frame). When
        None, RapidOCR is run internally.
    use_gpu:
        Forwarded to RapidOCRBackend when OCR is run internally.

    Returns
    -------
    list[FieldEvidenceRecord]
        Flat list, one record per (slot_key × field × candidate_rank).
        Slots that are CPU/empty emit a single low_quality marker on
        gamertag so the promoter can record the slot as
        blocked_observability.

    Raises
    ------
    ValueError:
        When no frames are found in bundle_dir.
    """
    frame_paths = sorted(bundle_dir.glob("[0-9]*.png"))
    if not frame_paths:
        raise ValueError(f"No PNG frames found in {bundle_dir}")

    if ocr_lines_per_frame is None:
        backend = RapidOCRBackend(use_gpu=use_gpu)
        ocr_lines_per_frame_computed: list[list[OCRLine]] = []
        for fp in frame_paths:
            img = cv2.imread(str(fp))
            if img is None:
                ocr_lines_per_frame_computed.append([])
            else:
                ocr_lines_per_frame_computed.append(backend.read(img))
        ocr_lines_per_frame = ocr_lines_per_frame_computed
    else:
        ocr_lines_per_frame = [list(lines) for lines in ocr_lines_per_frame]

    open_text_extractor = LoadoutOpenTextExtractor()

    # Per-frame: detect rows + identify subjects. Cache so we can pick the
    # best frame per slot without re-running.
    per_frame_subjects: list[list[LobbySubjectIdentity]] = []
    for frame_lines in ocr_lines_per_frame:
        rows = detect_lobby_rows(list(frame_lines))
        subjects = identify_lobby_subjects(
            rows, open_text_extractor=open_text_extractor,
        )
        per_frame_subjects.append(subjects)

    # Pick best frame per slot: highest mean confidence across the row's
    # populated identity fields. Ties broken by earliest frame index.
    best_per_slot: dict[str, tuple[int, LobbySubjectIdentity]] = {}
    for frame_idx, subjects in enumerate(per_frame_subjects):
        for subject in subjects:
            score = _subject_quality_score(subject)
            best = best_per_slot.get(subject.slot_key)
            if best is None or score > _subject_quality_score(best[1]):
                best_per_slot[subject.slot_key] = (frame_idx, subject)

    records: list[FieldEvidenceRecord] = []
    for slot_key, (frame_idx, subject) in best_per_slot.items():
        records.extend(
            _records_for_subject(
                subject,
                segment_index=segment_index,
                extractor_version=extractor_version,
            )
        )
    return records


# ─── Per-subject record builder ─────────────────────────────────────────────


def _subject_quality_score(subject: LobbySubjectIdentity) -> float:
    """Higher = better. Average of the non-None per-field confidences.

    CPU/empty subjects score 0.0 so any observable subject in another frame
    will replace them. Observability low_quality also scores 0 unless other
    fields contributed confidence values.
    """
    confidences: list[float] = []
    for value, conf in (
        (subject.gamertag, subject.gamertag_confidence),
        (subject.player_number, subject.player_number_confidence),
        (subject.player_name_persona, subject.player_name_persona_confidence),
        (subject.build_class_raw, subject.build_class_confidence),
        (subject.player_level_raw, subject.player_level_confidence),
        (subject.is_captain, subject.is_captain_confidence),
        (subject.is_ready, subject.is_ready_confidence),
        (subject.height_text, subject.height_confidence),
        (subject.weight_lbs, subject.weight_confidence),
        (subject.handedness, subject.handedness_confidence),
    ):
        if value is not None and conf is not None:
            confidences.append(conf)
    return mean(confidences) if confidences else 0.0


def _row_roi_bbox(subject: LobbySubjectIdentity) -> dict[str, float]:
    """Per-row ROI bbox in pixel coords for the row band."""
    panel_x = (
        BGM_PANEL_X_RANGE if subject.team_side == "our_team" else OPP_PANEL_X_RANGE
    )
    anchor_y = subject.anchor_y if subject.anchor_y is not None else 500
    return {
        "x": panel_x[0],
        "y": anchor_y - 22,
        "w": panel_x[1] - panel_x[0],
        "h": 45,
    }


def _records_for_subject(
    subject: LobbySubjectIdentity,
    *,
    segment_index: int,
    extractor_version: str,
) -> list[FieldEvidenceRecord]:
    """Emit one FieldEvidenceRecord per populated field."""
    roi_bbox = _row_roi_bbox(subject)
    support_frame_ids = (segment_index,)
    records: list[FieldEvidenceRecord] = []

    # Position is ALWAYS emitted (anchor is mandatory for the slot to exist).
    records.append(
        _record(
            subject=subject,
            field_key="position",
            field_family="closed_vocab",
            candidate_value=subject.position,
            raw_confidence=subject.position_confidence,
            observability_status="observable" if subject.position_confidence > 0 else "low_quality",
            normalization_status="normalized",
            roi_bbox=roi_bbox,
            support_frame_ids=support_frame_ids,
            extractor_version=extractor_version,
        )
    )

    # is_cpu — deterministic boolean emitted for EVERY slot (CPU and human).
    # Downstream promoter reads this via fieldDecisions to write the boolean
    # into player_loadout_snapshots.is_cpu (Commit 1 of CPU-goalie lineage fix).
    records.append(
        _record(
            subject=subject,
            field_key="is_cpu",
            field_family="icon",
            candidate_value=subject.is_empty_or_cpu,
            raw_confidence=1.0,        # deterministic boolean, not an OCR string
            observability_status="observable",
            normalization_status="normalized",
            roi_bbox=roi_bbox,
            support_frame_ids=support_frame_ids,
            extractor_version=extractor_version,
            shape_or_icon_class="cpu" if subject.is_empty_or_cpu else None,
        )
    )

    # CPU / empty: emit gamertag as low_quality marker and stop here.
    if subject.is_empty_or_cpu:
        records.append(
            _record(
                subject=subject,
                field_key="gamertag",
                field_family="open_text",
                candidate_value="",
                raw_confidence=0.0,
                observability_status="low_quality",
                normalization_status="unnormalized",
                roi_bbox=roi_bbox,
                support_frame_ids=support_frame_ids,
                extractor_version=extractor_version,
            )
        )
        return records

    # Gamertag — emit observable record if value present; else low_quality.
    if subject.gamertag is not None:
        records.append(
            _record(
                subject=subject,
                field_key="gamertag",
                field_family="open_text",
                candidate_value=subject.gamertag,
                raw_confidence=subject.gamertag_confidence or 0.0,
                observability_status="observable",
                normalization_status="normalized",
                roi_bbox=roi_bbox,
                support_frame_ids=support_frame_ids,
                extractor_version=extractor_version,
            )
        )
    else:
        records.append(
            _record(
                subject=subject,
                field_key="gamertag",
                field_family="open_text",
                candidate_value="",
                raw_confidence=0.0,
                observability_status="low_quality",
                normalization_status="unnormalized",
                roi_bbox=roi_bbox,
                support_frame_ids=support_frame_ids,
                extractor_version=extractor_version,
            )
        )

    # State_2 specifics: player_number + persona.
    if subject.player_number is not None:
        records.append(
            _record(
                subject=subject,
                field_key="player_number",
                field_family="tabular_numeric",
                candidate_value=subject.player_number,
                raw_confidence=subject.player_number_confidence or 0.0,
                observability_status="observable",
                normalization_status="normalized",
                roi_bbox=roi_bbox,
                support_frame_ids=support_frame_ids,
                extractor_version=extractor_version,
            )
        )
    if subject.player_name_persona is not None:
        records.append(
            _record(
                subject=subject,
                field_key="player_name_persona",
                field_family="open_text",
                candidate_value=subject.player_name_persona,
                raw_confidence=subject.player_name_persona_confidence or 0.0,
                observability_status="observable",
                normalization_status="normalized",
                roi_bbox=roi_bbox,
                support_frame_ids=support_frame_ids,
                extractor_version=extractor_version,
            )
        )

    # State_1 only: build_class_raw.
    if subject.build_class_raw is not None:
        records.append(
            _record(
                subject=subject,
                field_key="build_class",
                field_family="closed_vocab",
                candidate_value=subject.build_class_raw,
                raw_confidence=subject.build_class_confidence or 0.0,
                observability_status="observable",
                normalization_status="unnormalized",  # closed-vocab match happens in promoter
                roi_bbox=roi_bbox,
                support_frame_ids=support_frame_ids,
                extractor_version=extractor_version,
            )
        )

    # Level.
    if subject.player_level_raw is not None:
        records.append(
            _record(
                subject=subject,
                field_key="player_level_raw",
                field_family="open_text",
                candidate_value=subject.player_level_raw,
                raw_confidence=subject.player_level_confidence or 0.0,
                observability_status="observable",
                normalization_status="normalized",
                roi_bbox=roi_bbox,
                support_frame_ids=support_frame_ids,
                extractor_version=extractor_version,
            )
        )
    if subject.player_level_number is not None:
        records.append(
            _record(
                subject=subject,
                field_key="player_level_number",
                field_family="tabular_numeric",
                candidate_value=subject.player_level_number,
                raw_confidence=subject.player_level_confidence or 0.0,
                observability_status="observable",
                normalization_status="normalized",
                roi_bbox=roi_bbox,
                support_frame_ids=support_frame_ids,
                extractor_version=extractor_version,
            )
        )

    # Boolean flags via icon family.
    if subject.is_captain is not None:
        records.append(
            _record(
                subject=subject,
                field_key="is_captain",
                field_family="icon",
                candidate_value=subject.is_captain,
                raw_confidence=subject.is_captain_confidence or 0.0,
                observability_status="observable",
                normalization_status="normalized",
                roi_bbox=roi_bbox,
                support_frame_ids=support_frame_ids,
                extractor_version=extractor_version,
                shape_or_icon_class="star" if subject.is_captain else None,
            )
        )
    if subject.is_ready is not None:
        records.append(
            _record(
                subject=subject,
                field_key="is_ready",
                field_family="icon",
                candidate_value=subject.is_ready,
                raw_confidence=subject.is_ready_confidence or 0.0,
                observability_status="observable",
                normalization_status="normalized",
                roi_bbox=roi_bbox,
                support_frame_ids=support_frame_ids,
                extractor_version=extractor_version,
                shape_or_icon_class="ready_chip" if subject.is_ready else None,
            )
        )

    # Measurements.
    if subject.height_text is not None:
        records.append(
            _record(
                subject=subject,
                field_key="height_text",
                field_family="open_text",
                candidate_value=subject.height_text,
                raw_confidence=subject.height_confidence or 0.0,
                observability_status="observable",
                normalization_status="normalized",
                roi_bbox=roi_bbox,
                support_frame_ids=support_frame_ids,
                extractor_version=extractor_version,
            )
        )
    if subject.weight_lbs is not None:
        records.append(
            _record(
                subject=subject,
                field_key="weight_lbs",
                field_family="tabular_numeric",
                candidate_value=subject.weight_lbs,
                raw_confidence=subject.weight_confidence or 0.0,
                observability_status="observable",
                normalization_status="normalized",
                roi_bbox=roi_bbox,
                support_frame_ids=support_frame_ids,
                extractor_version=extractor_version,
            )
        )

    # Handedness (closed vocab Left/Right).
    if subject.handedness is not None:
        records.append(
            _record(
                subject=subject,
                field_key="handedness",
                field_family="closed_vocab",
                candidate_value=subject.handedness,
                raw_confidence=subject.handedness_confidence or 0.0,
                observability_status="observable",
                normalization_status="normalized",
                roi_bbox=roi_bbox,
                support_frame_ids=support_frame_ids,
                extractor_version=extractor_version,
            )
        )

    return records


def _record(
    *,
    subject: LobbySubjectIdentity,
    field_key: str,
    field_family: str,
    candidate_value: Any,
    raw_confidence: float,
    observability_status: str,
    normalization_status: str,
    roi_bbox: Optional[dict[str, float]],
    support_frame_ids: tuple[int, ...],
    extractor_version: str,
    shape_or_icon_class: Optional[str] = None,
) -> FieldEvidenceRecord:
    return FieldEvidenceRecord(
        screen_state=SCREEN_STATE,
        field_key=field_key,
        field_family=field_family,
        candidate_value=candidate_value,
        candidate_rank=0,
        raw_confidence=raw_confidence,
        calibrated_confidence=raw_confidence,
        extractor_family=field_family,
        extractor_version=extractor_version,
        observability_status=observability_status,
        normalization_status=normalization_status,
        subject_slot_key=subject.slot_key,
        support_frame_ids=support_frame_ids,
        roi_bbox=roi_bbox,
        shape_or_icon_class=shape_or_icon_class,
    )
