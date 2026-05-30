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
from typing import Optional, Protocol, Sequence

import cv2
import numpy as np


class FrameRecordLike(Protocol):
    """Structural type matching ``video_ingest.frame_provider.FrameRecord``.

    Using a Protocol avoids a hard import of ``video_ingest`` from
    ``game_ocr`` (which would create a circular dependency with
    ``video_ingest.pass2_extract`` → ``game_ocr.loadout_evidence``).
    """

    image: Optional[np.ndarray]
    frame_index: int

from .loadout_extractors.slot_identity import (
    SubjectIdentity,
    SlotIdentity,
    PositionGrid,
    extract_subject_identity,
    extract_slot_identities,
    extract_roster_only_identities,
    build_position_grids,
    _normalize_tag,
    _levenshtein,
    _extract_anchor_lines,
    _bucket_anchors,
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

    best_frame_sharpness_score: float
    """Laplacian variance of the best frame. Higher = sharper edges."""

    all_subject_identities: tuple[SubjectIdentity, ...]
    """One SubjectIdentity per contributing frame (parallel to
    ``support_frame_indices``)."""

    support_frame_indices: tuple[int, ...]
    """Global frame indices (offsets into the input ``frames`` list)."""

    best_frame_image: Optional[np.ndarray] = None
    """The sharpest frame's BGR pixels. Optional only so test fixtures
    constructed without pre-decoded pixels can still build a bundle;
    production assembly always populates this."""

    best_frame_index: Optional[int] = None
    """Global frame index of ``best_frame_image`` — the entry in
    ``support_frame_indices`` whose blur_score was highest. Used by the
    extractor to key per-frame OCR lines under the in-memory provider where
    paths are not available."""

    observability: str = "observable"
    """'observable' | 'low_quality' | 'not_observable_from_source'"""

    is_subject_view: bool = True
    """True if at least one contributing frame had the operator navigated to this
    player (subject-view bundle). False for roster-only bundles — players visible
    in the left strip but never selected by the operator. Roster-only bundles have
    identity fields only (no build_class / X-Factor / attribute right-pane data)."""


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

    # Position: prefer the most-frequently observed position; tiebreak by
    # highest confidence.  Counting observations across frames is more robust
    # than max-confidence alone, because a single noisy frame (e.g. an
    # intro/splash transitional frame) can produce a phantom position label
    # with conf=1.0 that wins over many consistent observations.
    pos_obs = [(s.position, s.position_confidence) for s in identities if s.position is not None]
    if pos_obs:
        # Build (position, vote_count, max_conf) per distinct position
        counts: dict[str, list[float]] = {}
        for pos, conf in pos_obs:
            counts.setdefault(pos, []).append(conf or 0.0)
        ranked = sorted(
            counts.items(),
            key=lambda kv: (len(kv[1]), max(kv[1])),
            reverse=True,
        )
        best_pos = ranked[0][0]
        best_pos_conf = max(counts[best_pos])
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

    # Player level: highest confidence
    lvl_ids = [(s.player_level_raw, s.player_level_confidence) for s in identities if s.player_level_raw is not None]
    if lvl_ids:
        best_lvl, best_lvl_conf = max(lvl_ids, key=lambda t: t[1] or 0)
    else:
        best_lvl, best_lvl_conf = None, None

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
        player_level_raw=best_lvl,
        player_level_confidence=best_lvl_conf,
        anchor_y=anchor_y,
        observability=observability,
    )


# ---------------------------------------------------------------------------
# Public API — new contract
# ---------------------------------------------------------------------------


def assemble_loadout_subject_bundles(
    frame_records: Sequence[FrameRecordLike],
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
    frame_records:
        One ``FrameRecord``-like value per source frame (must expose ``image``
        and ``frame_index``). ``image`` may be ``None`` to signal an unreadable
        frame; such records are skipped with a warning.
    segment_index:
        Pass-1 segment_index (for slot_key construction).
    ocr_lines_per_frame:
        One OCRLine list per record (parallel to ``frame_records``). Required —
        the bundle assembler does not re-run OCR.

    Returns
    -------
    list[LoadoutSubjectBundle]
        One bundle per distinct subject, ordered by first-frame appearance.

    Raises
    ------
    ValueError
        If ``ocr_lines_per_frame`` is None or has a different length than ``frame_records``.
    """
    if ocr_lines_per_frame is None:
        raise ValueError(
            "ocr_lines_per_frame is required; bundle assembler does not re-run OCR"
        )
    frame_records = list(frame_records)
    ocr_lines_per_frame = list(ocr_lines_per_frame)
    if len(frame_records) != len(ocr_lines_per_frame):
        raise ValueError(
            f"frame_records count {len(frame_records)} != ocr_lines_per_frame count {len(ocr_lines_per_frame)}"
        )

    # Per-frame: extract one subject identity + roster-only identities.
    # Groups: list of (frame_idx, image, SubjectIdentity).
    # We maintain insertion order (first appearance of each subject).
    # subject_groups: entries where the player was actively selected (subject-view)
    # roster_groups: entries for players visible in left strip but never selected
    subject_groups: list[list[tuple[int, np.ndarray, SubjectIdentity]]] = []
    canonical_per_group: list[SubjectIdentity] = []

    # Roster-only groups: same shape as subject_groups but is_subject_view=False
    roster_groups: list[list[tuple[int, np.ndarray, SubjectIdentity]]] = []
    canonical_per_roster: list[SubjectIdentity] = []

    for record, lines in zip(frame_records, ocr_lines_per_frame):
        frame_idx = record.frame_index
        image = record.image
        if image is None:
            logger.warning("Could not read frame %d", frame_idx)
            continue

        subject = extract_subject_identity(image, ocr_lines=lines)

        # Build position grids for roster-only extraction
        raw_anchors = _extract_anchor_lines(lines)
        anchors = _bucket_anchors(raw_anchors)
        grids = build_position_grids(anchors)

        # Roster-only extraction: identity-only rows not matching the subject
        subject_gt = subject.gamertag if subject is not None else None
        roster_identities = extract_roster_only_identities(
            image,
            ocr_lines=lines,
            subject_gamertag=subject_gt,
            grids=grids,
        )

        # Process subject identity
        if subject is not None:
            matched_group_idx: int | None = None
            for g_idx, rep in enumerate(canonical_per_group):
                if _subjects_are_same(rep, subject):
                    matched_group_idx = g_idx
                    break

            if matched_group_idx is None:
                subject_groups.append([(frame_idx, image, subject)])
                canonical_per_group.append(subject)
            else:
                subject_groups[matched_group_idx].append((frame_idx, image, subject))

        # Process roster-only identities
        for roster_id in roster_identities:
            # Skip if this gamertag is already a subject-view bundle
            already_subject = any(
                _subjects_are_same(rep, roster_id) for rep in canonical_per_group
            )
            if already_subject:
                continue

            matched_roster_idx: int | None = None
            for r_idx, rep in enumerate(canonical_per_roster):
                if _subjects_are_same(rep, roster_id):
                    matched_roster_idx = r_idx
                    break

            if matched_roster_idx is None:
                roster_groups.append([(frame_idx, image, roster_id)])
                canonical_per_roster.append(roster_id)
            else:
                roster_groups[matched_roster_idx].append((frame_idx, image, roster_id))

    # After collecting all frames, merge each roster group into a canonical
    # identity and then drop any roster group whose merged identity matches
    # a subject-view group (exact OR fuzzy on gamertag, jersey+position
    # tiebreak).  This catches the case where the roster group's FIRST-frame
    # OCR reading differed from the subject group's eventual canonical
    # (e.g. "sllyjoker85" first → merged to "silkyjoker85" → must dedupe
    # against subject "silkyjoker85").  Also drop roster groups whose merged
    # identity fuzzy-matches another roster group's canonical to collapse
    # OCR variants ("sikyjoker85" / "sllyjoker85" / "silkyjoker85").
    subject_merged_canonicals = [
        _merge_identities([e[2] for e in g]) for g in subject_groups
    ]
    roster_merged_canonicals = [
        _merge_identities([e[2] for e in g]) for g in roster_groups
    ]
    final_roster_groups: list[tuple[list, SubjectIdentity]] = []
    kept_roster_canonicals: list[SubjectIdentity] = []
    for rg, merged in zip(roster_groups, roster_merged_canonicals):
        if any(_subjects_are_same(s, merged) for s in subject_merged_canonicals):
            continue
        if any(_subjects_are_same(k, merged) for k in kept_roster_canonicals):
            continue
        final_roster_groups.append((rg, merged))
        kept_roster_canonicals.append(merged)

    # Build subject-view bundles
    bundles: list[LoadoutSubjectBundle] = []
    for subject_ordinal, group in enumerate(subject_groups):
        frame_indices = [e[0] for e in group]
        images = [e[1] for e in group]
        identities = [e[2] for e in group]

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
                best_frame_sharpness_score=sharpness_scores[best_idx_in_group],
                all_subject_identities=tuple(identities),
                support_frame_indices=tuple(frame_indices),
                best_frame_image=images[best_idx_in_group],
                best_frame_index=frame_indices[best_idx_in_group],
                observability=canonical.observability,
                is_subject_view=True,
            )
        )

    # Build roster-only bundles (continuing the ordinal from subject bundles)
    next_ordinal = len(subject_groups)
    for rg_idx, (group, canonical_ro) in enumerate(final_roster_groups):
        frame_indices = [e[0] for e in group]
        images = [e[1] for e in group]
        identities = [e[2] for e in group]

        sharpness_scores = [blur_score(img) for img in images]
        best_idx_in_group = int(np.argmax(sharpness_scores))

        canonical = _merge_identities(identities)

        subject_ordinal = next_ordinal + rg_idx
        slot_key = f"loadout_slot_seg{segment_index:04d}_subject{subject_ordinal:02d}"

        bundles.append(
            LoadoutSubjectBundle(
                slot_key=slot_key,
                subject_ordinal=subject_ordinal,
                segment_index=segment_index,
                canonical_subject=canonical,
                best_frame_sharpness_score=sharpness_scores[best_idx_in_group],
                all_subject_identities=tuple(identities),
                support_frame_indices=tuple(frame_indices),
                best_frame_image=images[best_idx_in_group],
                best_frame_index=frame_indices[best_idx_in_group],
                observability=canonical.observability,
                is_subject_view=False,
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
