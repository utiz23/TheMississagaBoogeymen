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

import re
from dataclasses import asdict, replace
from pathlib import Path
from statistics import mean
from typing import Any, Optional, Sequence

import cv2
import numpy as np

from .lobby_extractors.row_grouping import (
    BGM_PANEL_X_RANGE,
    OPP_PANEL_X_RANGE,
    LobbyRow,
    detect_lobby_rows,
)
from .lobby_extractors.slot_identity import (
    CAPTAIN_STAR_THRESHOLD,
    LobbySubjectIdentity,
    identify_lobby_subjects,
    slot_key_for,
)
from .loadout_evidence import FieldEvidenceRecord
from .loadout_extractors.open_text import LoadoutOpenTextExtractor
from .ocr import OCRLine, RapidOCRBackend
from .signal_utils import _levenshtein

EXTRACTOR_VERSION = "lobby-evidence-v2"
SCREEN_STATE = "pre_game_lobby_state_2"


# ─── Public entry point ─────────────────────────────────────────────────────


def extract_lobby_evidence(
    bundle_dir: Optional[Path] = None,
    *,
    segment_index: int,
    extractor_version: str = EXTRACTOR_VERSION,
    ocr_lines_per_frame: Sequence[Sequence[OCRLine]] | None = None,
    use_gpu: bool = False,
    frame_provider: Optional[Any] = None,
) -> tuple[list[FieldEvidenceRecord], int]:
    """Top-level entry: frames → ``(records, frame_count)``.

    Pass either ``bundle_dir`` (legacy disk path — reads PNGs from the
    directory) OR ``frame_provider`` (Phase 3b in-memory path). Exactly one
    must be supplied.

    Detects lobby rows + identifies subjects on every frame, picks the best
    frame per ``(team_side, position)`` slot (highest mean row confidence),
    and emits per-field ``FieldEvidenceRecord``s for the chosen slot/frame.

    Returns
    -------
    tuple[list[FieldEvidenceRecord], int]
        Flat list of evidence records and the number of frames observed.
        The frame count is what the caller writes into Pass-2's manifest.

    Raises
    ------
    ValueError
        When neither (or both) ``bundle_dir`` and ``frame_provider`` are
        supplied, or when ``bundle_dir`` contains no PNGs.
    """
    if (bundle_dir is None) == (frame_provider is None):
        raise ValueError(
            "extract_lobby_evidence requires exactly one of bundle_dir or frame_provider"
        )

    # 1. Materialize the per-frame image sequence (used only for OCR; lobby
    #    has no subject bundle layer and never holds an image past this loop).
    if bundle_dir is not None:
        frame_paths = sorted(bundle_dir.glob("[0-9]*.png"))
        if not frame_paths:
            raise ValueError(f"No PNG frames found in {bundle_dir}")
        frame_images: list[Optional[np.ndarray]] = [
            cv2.imread(str(fp)) for fp in frame_paths
        ]
    else:
        records_list = list(frame_provider.iter_frames())
        frame_images = [getattr(r, "image", None) for r in records_list]

    frame_count = len(frame_images)

    # 2. Obtain OCR lines (one per frame).
    if ocr_lines_per_frame is None:
        backend = RapidOCRBackend(use_gpu=use_gpu)
        ocr_lines_per_frame_computed: list[list[OCRLine]] = []
        for img in frame_images:
            if img is None:
                ocr_lines_per_frame_computed.append([])
            else:
                ocr_lines_per_frame_computed.append(backend.read(img))
        ocr_lines_per_frame = ocr_lines_per_frame_computed
    else:
        ocr_lines_per_frame = [list(lines) for lines in ocr_lines_per_frame]
        if len(ocr_lines_per_frame) != frame_count:
            raise ValueError(
                f"ocr_lines_per_frame count {len(ocr_lines_per_frame)} != "
                f"frame count {frame_count}"
            )

    open_text_extractor = LoadoutOpenTextExtractor()

    # 3. Per-frame: detect rows + identify subjects. Cache so we can pick the
    # best frame per slot without re-running.
    per_frame_subjects: list[list[LobbySubjectIdentity]] = []
    for frame_idx, frame_lines in enumerate(ocr_lines_per_frame):
        rows = detect_lobby_rows(list(frame_lines))
        subjects = identify_lobby_subjects(
            rows,
            open_text_extractor=open_text_extractor,
            # Phase D: hand the frame pixels to the identifier so the visual
            # captain-★ score drives is_captain (None when the frame is absent,
            # e.g. frameless unit tests → legacy glyph fallback).
            frame_bgr=frame_images[frame_idx],
        )
        per_frame_subjects.append(subjects)

    # 4. Drop mid-scroll transition frames, then majority-vote each slot across
    #    the surviving settled frames.
    #
    #    During EA's roster-slide animation the rosters slide between the L/R
    #    panels; a transition frame duplicates a player's gamertag across
    #    adjacent slots on one panel (match-250 segment 4 read "Stick Menace"
    #    into both C and LW, "HenryTheBobJr" into both RW and LD). Such frames
    #    OCR crisply (~0.97), so the old highest-mean-confidence best-frame pick
    #    could promote a scrambled read over the settled frames. A settled lobby
    #    panel always lists distinct human gamertags, so a within-panel
    #    duplicate is the transition signature (cross-panel duplicates are CPU
    #    placeholders, already demoted upstream by _demote_cross_team_duplicates).
    settled_frame_indices = [
        i for i, subjects in enumerate(per_frame_subjects)
        if not _frame_is_transition(subjects)
    ]
    # Fallback: if the frame budget captured only transition frames, vote over
    # all of them rather than dropping the slot entirely — degraded data beats
    # no data.
    voting_frame_indices = settled_frame_indices or list(range(len(per_frame_subjects)))

    observations_by_slot: dict[str, list[LobbySubjectIdentity]] = {}
    for frame_idx in voting_frame_indices:
        for subject in per_frame_subjects[frame_idx]:
            observations_by_slot.setdefault(subject.slot_key, []).append(subject)

    best_per_slot: dict[str, LobbySubjectIdentity] = {
        slot_key: _vote_slot_identity(observations)
        for slot_key, observations in observations_by_slot.items()
    }

    # 5. Phase D: resolve captain per slot by the cross-frame MAX visual ★ score,
    #    decoupled from the majority-vote identity pick above. A clean non-star
    #    frame must not discard a star observed in another frame. Restricted to
    #    the settled voting frames so a stray star glyph on a transition frame
    #    (the G1.1 t10 residual) can't create a false captain. Only populated
    #    when frames were available (captain_star_score is not None); otherwise
    #    the voted subject's legacy glyph result stands.
    captain_star_by_slot: dict[str, float] = {}
    for frame_idx in voting_frame_indices:
        for subject in per_frame_subjects[frame_idx]:
            if subject.captain_star_score is None:
                continue
            prev = captain_star_by_slot.get(subject.slot_key)
            if prev is None or subject.captain_star_score > prev:
                captain_star_by_slot[subject.slot_key] = subject.captain_star_score

    records: list[FieldEvidenceRecord] = []
    for slot_key, subject in best_per_slot.items():
        star = captain_star_by_slot.get(slot_key)
        if star is not None:
            subject = replace(
                subject,
                is_captain=star >= CAPTAIN_STAR_THRESHOLD,
                is_captain_confidence=star,
                captain_star_score=star,
            )
        records.extend(
            _records_for_subject(
                subject,
                segment_index=segment_index,
                extractor_version=extractor_version,
            )
        )
    return records, frame_count


# ─── Per-subject record builder ─────────────────────────────────────────────


def _subject_quality_score(subject: LobbySubjectIdentity) -> float:
    """Higher = better. Average of the non-None per-field confidences.

    CPU/empty subjects score 0.0 so any observable subject in another frame
    will replace them. Observability low_quality also scores 0 unless other
    fields contributed confidence values.
    """
    confidences: list[float] = []
    # Phase D: is_captain is intentionally EXCLUDED — captain is resolved by
    # cross-frame max ★ score (see extract_lobby_evidence), so its per-frame
    # confidence (the star score, ~0 for non-captains) must not skew which
    # frame is picked as "best" for the other identity fields.
    for value, conf in (
        (subject.gamertag, subject.gamertag_confidence),
        (subject.player_number, subject.player_number_confidence),
        (subject.player_name_persona, subject.player_name_persona_confidence),
        (subject.build_class_raw, subject.build_class_confidence),
        (subject.player_level_raw, subject.player_level_confidence),
        (subject.is_ready, subject.is_ready_confidence),
        (subject.height_text, subject.height_confidence),
        (subject.weight_lbs, subject.weight_confidence),
        (subject.handedness, subject.handedness_confidence),
    ):
        if value is not None and conf is not None:
            confidences.append(conf)
    return mean(confidences) if confidences else 0.0


def _normalize_gamertag_for_vote(gamertag: Optional[str]) -> Optional[str]:
    """Alphanumeric-lowercase key for grouping identical gamertag reads.

    Mirrors ``slot_identity._normalize_for_cross_team_dedup``: strips to
    alphanumerics, lowercases, and treats <3-char results as noise (None) so
    OCR fragments don't false-positive as duplicates.
    """
    if gamertag is None:
        return None
    stripped = re.sub(r"[^A-Za-z0-9]", "", gamertag).lower()
    return stripped if len(stripped) >= 3 else None


_FUZZY_MERGE_GAMERTAG_DISTANCE = 2
"""Max Levenshtein distance (6-char prefix) for two gamertag reads to count as
the same player when merging a slot's toggle phases. Mirrors
``loadout_bundle._FUZZY_GAMERTAG_DISTANCE`` so the lobby and loadout paths share
one fuzzy-identity rule."""


def _gamertag_keys_mergeable(a: str, b: str) -> bool:
    """True when two normalized vote keys are the same player up to OCR glyph
    drift: exact, or Levenshtein <= 2 on the 6-char prefix.

    RapidOCR reads a gamertag inconsistently across frames (``silkyjoker85`` ->
    ``sillkyjoker85`` / ``sllkyjokerBn``); those drift variants must merge into
    one subject. A cross-panel bleed carries a DIFFERENT player's gamertag
    (edit-distant — ``henrythebobjr`` is 5 prefix-edits from ``silkyjoker85``),
    so it stays excluded. A short key (<3 chars) requires an exact match to
    avoid fragment false-positives.
    """
    if a == b:
        return True
    head = min(6, len(a), len(b))
    if head < 3:
        return False
    return (
        _levenshtein(a[:head], b[:head], _FUZZY_MERGE_GAMERTAG_DISTANCE)
        <= _FUZZY_MERGE_GAMERTAG_DISTANCE
    )


def _frame_is_transition(subjects: Sequence[LobbySubjectIdentity]) -> bool:
    """True when either team panel shows the same human gamertag in 2+ slots.

    A settled EASHL lobby panel lists distinct human gamertags; a within-panel
    duplicate only occurs mid-scroll, when a row is animating between anchor
    bands. (Cross-panel duplicates are CPU placeholders, demoted upstream.)
    """
    for side in ("our_team", "opponent_team"):
        seen: set[str] = set()
        for s in subjects:
            if s.team_side != side or s.is_empty_or_cpu:
                continue
            norm = _normalize_gamertag_for_vote(s.gamertag)
            if norm is None:
                continue
            if norm in seen:
                return True
            seen.add(norm)
    return False


# Identity fields merged per-field across the winning gamertag group. Each
# tuple is (guard_attr, confidence_attr, [attrs_to_copy_together]). state_2
# toggles the two team panels on opposite phases, so a slot's build-class and
# its #NN/persona land on DIFFERENT settled frames — a single representative
# frame can carry only one phase. Merging per-field over the winning group
# reunites the phases. Coupled fields (level raw+number) copy as a unit from
# the same observation. slot_key/team_side/position/gamertag/anchor_y stay
# from the representative and are NOT merged.
_MERGEABLE_FIELDS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("player_number", "player_number_confidence",
     ("player_number", "player_number_confidence")),
    ("player_name_persona", "player_name_persona_confidence",
     ("player_name_persona", "player_name_persona_confidence")),
    ("build_class_raw", "build_class_confidence",
     ("build_class_raw", "build_class_confidence")),
    ("player_level_raw", "player_level_confidence",
     ("player_level_raw", "player_level_number", "player_level_confidence")),
    ("height_text", "height_confidence", ("height_text", "height_confidence")),
    ("weight_lbs", "weight_confidence", ("weight_lbs", "weight_confidence")),
    ("handedness", "handedness_confidence", ("handedness", "handedness_confidence")),
    ("is_ready", "is_ready_confidence", ("is_ready", "is_ready_confidence")),
)


def _merge_best_field(
    group: Sequence[LobbySubjectIdentity],
    guard_attr: str,
    conf_attr: str,
    copy_attrs: Sequence[str],
) -> dict[str, object]:
    """From the observation whose ``guard_attr`` is non-None with the highest
    ``conf_attr``, return ``{attr: value}`` for each of ``copy_attrs``.

    Empty when no observation in the group populated the field. A missing
    confidence sorts below any present confidence, so a confidently-read value
    always wins over an unscored one.
    """
    best: Optional[LobbySubjectIdentity] = None
    best_conf = float("-inf")
    for s in group:
        if getattr(s, guard_attr) is None:
            continue
        conf = getattr(s, conf_attr)
        conf = conf if conf is not None else float("-inf")
        if best is None or conf > best_conf:
            best = s
            best_conf = conf
    if best is None:
        return {}
    return {attr: getattr(best, attr) for attr in copy_attrs}


def _vote_slot_identity(
    observations: Sequence[LobbySubjectIdentity],
) -> LobbySubjectIdentity:
    """Majority-vote one slot's identity across the (settled) voting frames.

    Groups the human observations by normalized gamertag, picks the group with
    the most votes (ties broken by summed quality score), then MERGES per-field
    over that group PLUS its glyph-drift variants: the representative is the
    highest-quality observation in the exact winning group (source of
    slot_key/team_side/position/gamertag/anchor_y), and every identity field
    (number/persona/build/level/measurements) is filled from the
    highest-confidence observation whose gamertag is the same player up to OCR
    drift. This reunites state_2's toggled panel phases (one frame carries
    #NN+persona, the next carries build-class) into one complete subject even
    when the gamertag reads differently across those phases — the match-250
    for_RW failure, where every #NN read landed on a frame whose gamertag
    drifted off the exact winning key and was dropped. A cross-panel bleed
    carries a DIFFERENT player's (edit-distant) gamertag, so
    ``_gamertag_keys_mergeable`` still keeps it out of this slot. When no frame
    read a human in this slot, returns the best CPU/empty observation so the
    slot is still emitted.
    """
    human = [s for s in observations if not s.is_empty_or_cpu and s.gamertag is not None]
    if not human:
        return max(observations, key=_subject_quality_score)

    def vote_key(s: LobbySubjectIdentity) -> str:
        return _normalize_gamertag_for_vote(s.gamertag) or s.gamertag.lower()

    tally: dict[str, list[LobbySubjectIdentity]] = {}
    for s in human:
        tally.setdefault(vote_key(s), []).append(s)
    winner = max(
        tally,
        key=lambda k: (len(tally[k]), sum(_subject_quality_score(s) for s in tally[k])),
    )
    # Representative (and thus the emitted gamertag) comes from the EXACT
    # winning key group, so a drift variant never becomes the slot's gamertag.
    representative = max(tally[winner], key=_subject_quality_score)
    # But per-field merging spans the winner's glyph-drift variants too, so a
    # #NN/persona read stranded on a drifted-gamertag frame is still recovered.
    merge_group = [s for s in human if _gamertag_keys_mergeable(winner, vote_key(s))]
    merged: dict[str, object] = {}
    for guard_attr, conf_attr, copy_attrs in _MERGEABLE_FIELDS:
        merged.update(_merge_best_field(merge_group, guard_attr, conf_attr, copy_attrs))
    return replace(representative, **merged)


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
