"""Phase 2A (revised): subject-bundle assembler — one subject per frame, deduped by gamertag.

Public API
----------
assemble_loadout_subject_bundles(frames, *, segment_index, ocr_lines_per_frame)
    -> list[LoadoutSubjectBundle]
    Per-frame: extract one subject. Across frames: dedupe by fuzzy gamertag match.

LoadoutSubjectBundle
    Frozen dataclass.  One instance per distinct subject observed across all
    frames in the segment.

Design notes
------------
- Each frame has exactly ONE subject (the player the operator has currently
  selected). The right-pane (X-Factors, attributes, build_class) belongs
  ONLY to that subject.
- Deduplication: two SubjectIdentity instances are the same subject when
  their normalized gamertags are fuzzy-equal (Levenshtein ≤2 on the first
  min(6, len) chars). This tolerates per-frame OCR noise without splitting
  one subject into multiple bundles.
- Best frame: highest blur_score (Laplacian variance = sharper edges).
- Frames where extract_subject_identity returns None are silently skipped.
- The legacy assemble_loadout_bundles / LoadoutFrameBundle names are
  preserved as deprecated backward-compat wrappers so existing callers
  and tests continue to work during the Phase 2A → 2B transition.

Architecture fix (first real-data run on match-250)
---------------------------------------------------
The previous design ("all visible rows per frame get right-pane data")
was wrong. The EA NHL loadout-view shows ONE subject per frame. The
operator must navigate to each slot in turn; to capture all 10 roster
slots the segment must include multiple frames as the operator scrolls.
See HANDOFF.md Phase 2A notes for full root-cause analysis.
"""

from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Sequence

import cv2
import numpy as np

from .loadout_extractors.slot_identity import (
    SubjectIdentity,
    SlotIdentity,
    extract_subject_identity,
    extract_slot_identities,
    _normalize_tag,
    _levenshtein,
)
from .frame_features import blur_score

logger = logging.getLogger(__name__)

POSITION_STABILITY_THRESHOLD = 0.80
"""Modal position must appear in >= 80% of frames in a bundle for 'observable'."""

_FUZZY_GAMERTAG_DISTANCE: int = 2
"""Maximum Levenshtein distance (on 6-char prefix) to consider two gamertags the same subject."""


# ---------------------------------------------------------------------------
# LoadoutSubjectBundle — new dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LoadoutSubjectBundle:
    """All frames in a Pass-1 segment where the same SUBJECT was selected.

    Aggregated by fuzzy gamertag match (Levenshtein ≤2 on 6-char prefix)
    across frames, so OCR variation in the gamertag doesn't split one subject
    into multiple bundles.

    observability values
    --------------------
    ``'observable'``
        Subject identified in at least one frame above the confidence threshold.
    ``'low_quality'``
        Subject identified but all per-frame identities have low confidence.
    ``'not_observable_from_source'``
        No frames yielded a valid subject identity.
    """

    slot_key: str
    """Per-segment ordinal: ``"loadout_slot_seg{NNNN}_subject{NN}"``."""

    subject_ordinal: int
    """0-indexed ordinal of distinct subjects ordered by first-frame appearance."""

    segment_index: int
    """Pass-1 segment index this bundle belongs to."""

    canonical_subject: SubjectIdentity
    """The highest-confidence merged identity for this subject."""

    frame_paths: tuple[Path, ...]
    """All frames where this subject was selected (in input order)."""

    best_frame_path: Path
    """Frame path with the highest blur_score (sharpest)."""

    best_frame_sharpness_score: float
    """Laplacian variance of the best frame. Higher = sharper edges."""

    all_subject_identities: tuple[SubjectIdentity, ...]
    """One SubjectIdentity per contributing frame (parallel to frame_paths)."""

    support_frame_indices: tuple[int, ...]
    """Global frame indices (offsets into the input ``frames`` list)."""

    observability: str = "observable"
    """'observable' | 'low_quality' | 'not_observable_from_source'"""


# ---------------------------------------------------------------------------
# LoadoutFrameBundle — DEPRECATED backward-compat alias
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LoadoutFrameBundle:
    """DEPRECATED: use LoadoutSubjectBundle instead.

    Kept for backward compatibility with existing tests and callers.
    Will be removed in Phase 2B.
    """

    slot_key: str
    row_ordinal: int
    segment_index: int
    frame_paths: tuple[Path, ...]
    best_frame_path: Path
    best_frame_blur_score: float
    slot_identities: tuple[SlotIdentity, ...]
    support_frame_indices: tuple[int, ...]
    observability: str = "observable"
    position_stability: float = 1.0


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _subjects_are_same(a: SubjectIdentity, b: SubjectIdentity) -> bool:
    """Return True if two SubjectIdentity instances represent the same player.

    Matching strategy (in order):
    1. Exact normalized gamertag match.
    2. Levenshtein ≤ FUZZY_GAMERTAG_DISTANCE on the 6-char prefix.
    3. If both have position + jersey_number, use those as tiebreak when
       the gamertag edit distance is on the edge (distance == 2).
    """
    na = _normalize_tag(a.gamertag)
    nb = _normalize_tag(b.gamertag)
    if na == nb:
        return True
    head_len = min(6, len(na), len(nb))
    if head_len < 3:
        # Short tags: require exact match to avoid false positives
        return na == nb
    dist = _levenshtein(na[:head_len], nb[:head_len])
    if dist > _FUZZY_GAMERTAG_DISTANCE:
        return False
    if dist == _FUZZY_GAMERTAG_DISTANCE:
        # Use position + jersey as tiebreak when both are available
        if (a.position is not None and b.position is not None and a.position != b.position):
            return False
        if (a.jersey_number is not None and b.jersey_number is not None
                and a.jersey_number != b.jersey_number):
            return False
    return True


def _merge_identities(identities: list[SubjectIdentity]) -> SubjectIdentity:
    """Merge multiple per-frame SubjectIdentity instances into one canonical identity.

    Strategy: for each field, pick the value from the frame with the highest
    confidence for that specific field.
    """
    if not identities:
        raise ValueError("Cannot merge empty list of identities")
    if len(identities) == 1:
        return identities[0]

    # Gamertag: highest confidence
    best_gt = max(identities, key=lambda s: s.gamertag_confidence)
    gamertag = best_gt.gamertag
    gamertag_confidence = best_gt.gamertag_confidence

    # Position: highest confidence among those that have it
    pos_ids = [(s.position, s.position_confidence) for s in identities if s.position is not None]
    if pos_ids:
        best_pos, best_pos_conf = max(pos_ids, key=lambda t: t[1] or 0)
    else:
        best_pos, best_pos_conf = None, None

    # Jersey number: highest confidence
    jersey_ids = [(s.jersey_number, s.jersey_confidence) for s in identities if s.jersey_number is not None]
    if jersey_ids:
        best_jersey, best_jersey_conf = max(jersey_ids, key=lambda t: t[1] or 0)
    else:
        best_jersey, best_jersey_conf = None, None

    # Player name: highest confidence
    name_ids = [(s.player_name_full, s.player_name_confidence) for s in identities if s.player_name_full is not None]
    if name_ids:
        best_name, best_name_conf = max(name_ids, key=lambda t: t[1] or 0)
    else:
        best_name, best_name_conf = None, None

    # Captain: True wins over None
    captain = next((s.is_captain for s in identities if s.is_captain is True), None)
    captain_conf = next((s.is_captain_confidence for s in identities if s.is_captain is True), None)

    # Build class: highest confidence
    bc_ids = [(s.build_class_raw, s.build_class_confidence) for s in identities if s.build_class_raw is not None]
    if bc_ids:
        best_bc, best_bc_conf = max(bc_ids, key=lambda t: t[1] or 0)
    else:
        best_bc, best_bc_conf = None, None

    # Anchor Y: from the best-position frame (most confident position match)
    anchor_y = best_pos_conf and next(
        (s.anchor_y for s in identities if s.position_confidence == best_pos_conf),
        None,
    )
    if anchor_y is None:
        anchor_y = next((s.anchor_y for s in identities if s.anchor_y is not None), None)

    # Observability: best (observable > low_quality > not_observable_from_source)
    obs_order = {"observable": 0, "low_quality": 1, "not_observable_from_source": 2}
    best_obs = min(identities, key=lambda s: obs_order.get(s.observability, 3))
    observability = best_obs.observability

    return SubjectIdentity(
        gamertag=gamertag,
        gamertag_confidence=gamertag_confidence,
        position=best_pos,
        position_confidence=best_pos_conf,
        jersey_number=best_jersey,
        jersey_confidence=best_jersey_conf,
        player_name_full=best_name,
        player_name_confidence=best_name_conf,
        is_captain=captain,
        is_captain_confidence=captain_conf,
        build_class_raw=best_bc,
        build_class_confidence=best_bc_conf,
        anchor_y=anchor_y,
        observability=observability,
    )


# ---------------------------------------------------------------------------
# Public API — new contract
# ---------------------------------------------------------------------------


def assemble_loadout_subject_bundles(
    frames: Sequence[Path],
    *,
    segment_index: int,
    ocr_lines_per_frame: Sequence[Sequence] | None = None,
) -> list[LoadoutSubjectBundle]:
    """Per-frame: extract one subject. Across frames: dedupe by fuzzy gamertag match.

    Returns one LoadoutSubjectBundle per distinct subject observed. The
    operator may have navigated through all 10 slots → up to 10 bundles; or
    through some → fewer bundles.

    Parameters
    ----------
    frames:
        Paths to PNGs from one Pass-1 segment.
    segment_index:
        Pass-1 segment_index (for slot_key construction).
    ocr_lines_per_frame:
        One OCRLine list per frame (parallel to ``frames``).  Required — the
        bundle assembler does not re-run OCR.

    Returns
    -------
    list[LoadoutSubjectBundle]
        One bundle per distinct subject, ordered by first-frame appearance.

    Raises
    ------
    ValueError
        If ``ocr_lines_per_frame`` is None or has a different length than ``frames``.
    """
    if ocr_lines_per_frame is None:
        raise ValueError(
            "ocr_lines_per_frame is required; bundle assembler does not re-run OCR"
        )
    frames = list(frames)
    ocr_lines_per_frame = list(ocr_lines_per_frame)
    if len(frames) != len(ocr_lines_per_frame):
        raise ValueError(
            f"frames count {len(frames)} != ocr_lines_per_frame count {len(ocr_lines_per_frame)}"
        )

    # Per-frame: read image + extract one subject identity
    # Groups: list of (subject_ordinal, list of (frame_idx, frame_path, image, SubjectIdentity))
    # We maintain insertion order (first appearance of each subject)
    subject_groups: list[list[tuple[int, Path, np.ndarray, SubjectIdentity]]] = []
    canonical_per_group: list[SubjectIdentity] = []

    for frame_idx, (frame_path, lines) in enumerate(zip(frames, ocr_lines_per_frame)):
        image = cv2.imread(str(frame_path))
        if image is None:
            logger.warning("Could not read frame %d: %s", frame_idx, frame_path)
            continue

        subject = extract_subject_identity(image, ocr_lines=lines)
        if subject is None:
            continue  # No recognisable subject in this frame

        # Find the matching group or create a new one
        matched_group_idx: int | None = None
        for g_idx, rep in enumerate(canonical_per_group):
            if _subjects_are_same(rep, subject):
                matched_group_idx = g_idx
                break

        if matched_group_idx is None:
            # New subject
            subject_groups.append([(frame_idx, frame_path, image, subject)])
            canonical_per_group.append(subject)
        else:
            subject_groups[matched_group_idx].append((frame_idx, frame_path, image, subject))

    # Build bundles
    bundles: list[LoadoutSubjectBundle] = []
    for subject_ordinal, group in enumerate(subject_groups):
        frame_indices = [e[0] for e in group]
        frame_paths_group = [e[1] for e in group]
        images = [e[2] for e in group]
        identities = [e[3] for e in group]

        # Best frame: highest blur_score
        sharpness_scores = [blur_score(img) for img in images]
        best_idx_in_group = int(np.argmax(sharpness_scores))

        # Merge identities into canonical
        canonical = _merge_identities(identities)

        slot_key = f"loadout_slot_seg{segment_index:04d}_subject{subject_ordinal:02d}"

        bundles.append(
            LoadoutSubjectBundle(
                slot_key=slot_key,
                subject_ordinal=subject_ordinal,
                segment_index=segment_index,
                canonical_subject=canonical,
                frame_paths=tuple(frame_paths_group),
                best_frame_path=frame_paths_group[best_idx_in_group],
                best_frame_sharpness_score=sharpness_scores[best_idx_in_group],
                all_subject_identities=tuple(identities),
                support_frame_indices=tuple(frame_indices),
                observability=canonical.observability,
            )
        )

    return bundles


# ---------------------------------------------------------------------------
# Backward-compat shim — assemble_loadout_bundles (deprecated)
# ---------------------------------------------------------------------------


def assemble_loadout_bundles(
    frames: Sequence[Path],
    *,
    segment_index: int,
    ocr_lines_per_frame: Sequence[Sequence] | None = None,
) -> list[LoadoutFrameBundle]:
    """DEPRECATED: use assemble_loadout_subject_bundles instead.

    Preserved for backward compatibility with existing tests that mock
    extract_slot_identities and patch game_ocr.loadout_bundle.extract_slot_identities.
    Callers should migrate to assemble_loadout_subject_bundles.

    This retains the OLD "one SlotIdentity per visible row" grouping logic.
    """
    if ocr_lines_per_frame is None:
        raise ValueError(
            "ocr_lines_per_frame is required; bundle assembler does not re-run OCR"
        )
    frames = list(frames)
    ocr_lines_per_frame = list(ocr_lines_per_frame)
    if len(frames) != len(ocr_lines_per_frame):
        raise ValueError(
            f"frames count {len(frames)} != ocr_lines_per_frame count {len(ocr_lines_per_frame)}"
        )

    per_frame_data: list[tuple[int, Path, np.ndarray, list[SlotIdentity]]] = []
    for frame_idx, (frame_path, lines) in enumerate(zip(frames, ocr_lines_per_frame)):
        image = cv2.imread(str(frame_path))
        if image is None:
            logger.warning("Could not read frame %d: %s", frame_idx, frame_path)
            continue
        identities = extract_slot_identities(image, segment_index=segment_index, ocr_lines=lines)
        if not identities:
            continue
        per_frame_data.append((frame_idx, frame_path, image, identities))

    slot_groups: dict[str, list[tuple[int, Path, np.ndarray, SlotIdentity]]] = {}
    for frame_idx, frame_path, image, identities in per_frame_data:
        for identity in identities:
            slot_groups.setdefault(identity.slot_key, []).append(
                (frame_idx, frame_path, image, identity)
            )

    bundles: list[LoadoutFrameBundle] = []
    for slot_key, entries in slot_groups.items():
        frame_indices = [e[0] for e in entries]
        frame_paths_group = [e[1] for e in entries]
        images = [e[2] for e in entries]
        identities = [e[3] for e in entries]

        blur_scores = [blur_score(img) for img in images]
        best_idx_in_group = int(np.argmax(blur_scores))

        positions = [i.position for i in identities if i.position is not None]
        position_stability = 1.0
        observability = "observable"
        if positions:
            modal_position, modal_count = Counter(positions).most_common(1)[0]
            position_stability = modal_count / len(positions)
            if position_stability < POSITION_STABILITY_THRESHOLD:
                logger.warning(
                    "Intra-segment position instability for %s: modal '%s' in %.0f%% of frames"
                    " (threshold %.0f%%)",
                    slot_key,
                    modal_position,
                    100.0 * position_stability,
                    100.0 * POSITION_STABILITY_THRESHOLD,
                )
                observability = "obstructed"

        bundles.append(
            LoadoutFrameBundle(
                slot_key=slot_key,
                row_ordinal=identities[0].row_ordinal,
                segment_index=segment_index,
                frame_paths=tuple(frame_paths_group),
                best_frame_path=frame_paths_group[best_idx_in_group],
                best_frame_blur_score=blur_scores[best_idx_in_group],
                slot_identities=tuple(identities),
                support_frame_indices=tuple(frame_indices),
                observability=observability,
                position_stability=position_stability,
            )
        )

    bundles.sort(key=lambda b: b.row_ordinal)
    return bundles
