"""Phase 2A-8: frame bundle assembler with position-stability validation.

Public API
----------
assemble_loadout_bundles(frames, *, segment_index, ocr_lines_per_frame) -> list[LoadoutFrameBundle]
    Group frames from one Pass-1 loadout segment into per-slot bundles.

LoadoutFrameBundle
    Frozen dataclass.  One instance per detected geometric slot within a
    segment.  Carries all frames that show that slot, the best (sharpest)
    frame, slot identities per frame, and a position-stability score.

Design notes
------------
- Grouping is purely geometric: slot_key from Task 2A-3 is the group key.
  OCR text variation does not affect grouping.
- Best frame selection uses blur_score (Laplacian variance) from Phase 1's
  frame_features module. Laplacian variance is higher-is-sharper: higher
  variance = sharper edges. We pick argmax(blur_scores) to select the sharpest
  frame in the group. The field best_frame_blur_score carries the variance value.
- Position stability: for each bundle, compute the fraction of frames where
  the modal position appears.  If < POSITION_STABILITY_THRESHOLD (0.80),
  log a WARNING and set observability='obstructed'.  Frames with position=None
  are excluded from the stability calculation.
- Frames where extract_slot_identities returns [] are silently skipped.
- Return value is sorted by row_ordinal ascending.

Round 4 §2 Stage C: extraction downstream runs on bundles, not raw segments.
Each bundle is the unit of typed extraction — the closed-vocab/tabular/icon/
open-text extractors will be called once per bundle (Task 2A-9 wires this).
"""

from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Sequence

import cv2
import numpy as np

from .loadout_extractors.slot_identity import SlotIdentity, extract_slot_identities
from .frame_features import blur_score

logger = logging.getLogger(__name__)

POSITION_STABILITY_THRESHOLD = 0.80
"""Modal position must appear in >= 80% of frames in a bundle for observability='observable'."""


# ---------------------------------------------------------------------------
# Dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LoadoutFrameBundle:
    """All frames in a Pass-1 segment that show the same geometric slot.

    ``slot_key`` is purely geometric — the same Y-bucket across every frame in
    this bundle produces the same slot_key.  Evidence (position, gamertag, etc.)
    lives in ``slot_identities`` (one per frame).

    observability values
    --------------------
    ``'observable'``
        Position stability is at or above POSITION_STABILITY_THRESHOLD.
    ``'obstructed'``
        Position stability fell below POSITION_STABILITY_THRESHOLD — the
        modal position appeared in fewer than 80% of frames, indicating a
        possible roster switch or heavily noisy OCR within the segment.
    ``'low_quality'``
        Reserved for future use (e.g. all per-frame observabilities are
        low_quality).
    ``'not_observable_from_source'``
        Reserved for future use.
    """

    slot_key: str
    """Geometric slot identifier: ``"loadout_slot_seg{NNNN}_row{R}"``."""

    row_ordinal: int
    """0-indexed row position from top; derived from the first SlotIdentity in the group."""

    segment_index: int
    """Pass-1 segment index this bundle belongs to."""

    frame_paths: tuple[Path, ...]
    """All frame paths where this slot was detected (in input order)."""

    best_frame_path: Path
    """Frame path with the highest blur_score (== sharpest / least blurry)."""

    best_frame_blur_score: float
    """Laplacian variance of the best frame. Higher = sharper."""

    slot_identities: tuple[SlotIdentity, ...]
    """One SlotIdentity per entry in frame_paths (parallel list)."""

    support_frame_indices: tuple[int, ...]
    """Global frame indices (offsets into the input ``frames`` list) for each
    entry in ``frame_paths``.  Used downstream for support_frame_ids tracking."""

    observability: str = "observable"
    """'observable' | 'low_quality' | 'not_observable_from_source' | 'obstructed'"""

    position_stability: float = 1.0
    """Fraction of frames (with non-None position) where the modal position appears."""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def assemble_loadout_bundles(
    frames: Sequence[Path],
    *,
    segment_index: int,
    ocr_lines_per_frame: Sequence[Sequence] | None = None,
) -> list[LoadoutFrameBundle]:
    """Assemble per-slot bundles from a list of loadout-view frames.

    Steps
    -----
    1. Validate inputs.
    2. For each frame, read the image and run extract_slot_identities() to get
       the slot_keys present.  Frames that cannot be read or yield no identities
       are skipped.
    3. Group (frame_index, frame_path, image, SlotIdentity) tuples by slot_key.
    4. For each group, compute blur_score per frame and pick argmax (sharpest).
    5. Validate position stability: modal position across the group's frames
       must appear in >= POSITION_STABILITY_THRESHOLD of frames; otherwise log
       a WARNING and set observability='obstructed'.
    6. Return bundles sorted by row_ordinal ascending.

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
    list[LoadoutFrameBundle]
        One bundle per detected slot, sorted by row_ordinal.

    Raises
    ------
    ValueError
        If ``ocr_lines_per_frame`` is None or has a different length than ``frames``.
    """
    # 1. Validate inputs
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

    # 2. Per-frame: read image + extract slot identities
    per_frame_data: list[tuple[int, Path, np.ndarray, list[SlotIdentity]]] = []
    for frame_idx, (frame_path, lines) in enumerate(zip(frames, ocr_lines_per_frame)):
        image = cv2.imread(str(frame_path))
        if image is None:
            logger.warning("Could not read frame %d: %s", frame_idx, frame_path)
            continue
        identities = extract_slot_identities(image, segment_index=segment_index, ocr_lines=lines)
        if not identities:
            continue  # no recognisable slot in this frame — skip
        per_frame_data.append((frame_idx, frame_path, image, identities))

    # 3. Group by slot_key
    # Each entry in the group: (global_frame_idx, frame_path, image, SlotIdentity)
    slot_groups: dict[str, list[tuple[int, Path, np.ndarray, SlotIdentity]]] = {}
    for frame_idx, frame_path, image, identities in per_frame_data:
        for identity in identities:
            slot_groups.setdefault(identity.slot_key, []).append(
                (frame_idx, frame_path, image, identity)
            )

    # 4 & 5. Build bundles with blur-score selection and position-stability check
    bundles: list[LoadoutFrameBundle] = []
    for slot_key, entries in slot_groups.items():
        frame_indices = [e[0] for e in entries]
        frame_paths_group = [e[1] for e in entries]
        images = [e[2] for e in entries]
        identities = [e[3] for e in entries]

        # Best frame: highest blur_score (= sharpest).
        # blur_score() returns Laplacian variance: higher = sharper edges.
        # We pick argmax to select the sharpest frame in the group.
        blur_scores = [blur_score(img) for img in images]
        best_idx_in_group = int(np.argmax(blur_scores))

        # Position stability: fraction of frames where modal position appears
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

    # 6. Sort by row_ordinal ascending
    bundles.sort(key=lambda b: b.row_ordinal)
    return bundles
