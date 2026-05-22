"""Phase 2A (revised): typed extractor entry point + FieldEvidenceRecord JSON contract.

Public API
----------
FieldEvidenceRecord
    Frozen dataclass mirroring ``ocr_field_evidence`` Drizzle columns 1:1.
    ``to_dict()`` produces the exact JSON contract consumed by the worker's
    ``writeFieldEvidenceForBatch`` (Task 2A-14).

extract_loadout_evidence(bundle_dir, *, segment_index, extractor_version,
                         ocr_lines_per_frame, use_gpu)
    Top-level entry point: reads frames from ``bundle_dir``, optionally runs
    RapidOCR when ``ocr_lines_per_frame`` is not provided, assembles
    subject bundles (one per distinct player the operator navigated to),
    runs the four family extractors ONCE per bundle on the BEST FRAME ONLY,
    and returns a flat list of FieldEvidenceRecord ready to JSON-serialize.

KEY ARCHITECTURAL CHANGE (first real-data run on match-250)
------------------------------------------------------------
The previous design ran extractors once per FRAME and attributed all
right-pane data (X-Factors, attributes, build_class) to every visible
left-strip row. This was wrong.

The EA NHL loadout-view shows:
  - ONE subject's right-pane data per frame.
  - LEFT STRIP shows roster context (all visible rows) — NOT right-pane data.

The new design:
  1. Assembles subject bundles: one bundle per distinct subject (player)
     observed across the segment's frames, deduped by fuzzy gamertag match.
  2. Per bundle: runs extractors ONCE on the best frame (highest sharpness).
  3. Attributes right-pane data (build_class, X-Factors, attributes) only
     to that bundle's subject (its slot_key).

Frame naming convention (Pass-2 output):
    bundle_dir/00001.png  (5-digit zero-padded, NO "frame_" prefix)

Family → FieldEvidenceRecord adapter rules
------------------------------------------
closed_vocab  (LoadoutClosedVocabExtractor → ClosedVocabCandidate)
    field_family = extractor_family = 'closed_vocab'
    candidate_value = candidate.value (str)
    roi_bbox from candidate.roi_bbox
    normalization_status = 'normalized'

tabular_numeric  (LoadoutTabularExtractor → NumericCellEvidence)
    field_family = extractor_family = 'tabular_numeric'
    candidate_value = evidence.value (int | None)
    row_key = evidence.row_key, column_key = evidence.column_key
    normalization_status = 'normalized' when value is not None else 'failed'

icon  (LoadoutIconExtractor → IconEvidence)
    field_family = extractor_family = 'icon'
    candidate_value = evidence.shape_or_icon_class (str)
    x_norm, y_norm from evidence
    normalization_status = 'normalized'

open_text  (LoadoutOpenTextExtractor → OpenTextEvidence)
    field_family = extractor_family = 'open_text'
    candidate_value = evidence.value (str)
    normalization_status = 'normalized' when value non-empty else 'unnormalized'
"""

from __future__ import annotations

import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Optional, Sequence

import cv2
import numpy as np

from .loadout_bundle import (
    assemble_loadout_bundles,       # kept for backward-compat
    assemble_loadout_subject_bundles,
    LoadoutFrameBundle,             # kept for backward-compat
    LoadoutSubjectBundle,
)
from .loadout_extractors.closed_vocab import LoadoutClosedVocabExtractor, ClosedVocabCandidate
from .loadout_extractors.tabular_numeric import LoadoutTabularExtractor, NumericCellEvidence
from .loadout_extractors.icon import LoadoutIconExtractor, IconEvidence
from .loadout_extractors.open_text import LoadoutOpenTextExtractor, OpenTextEvidence
from .ocr import OCRLine, RapidOCRBackend

EXTRACTOR_VERSION = "loadout-evidence-v2"
SCREEN_STATE = "player_loadout_view"

# ---------------------------------------------------------------------------
# ROI constants (mirrored from parsers.py geometry)
# ---------------------------------------------------------------------------

# Gamertag: top-right, y≈130-170, x>1500
_ROI_GAMERTAG: dict[str, float] = {"x": 1500.0, "y": 130.0, "w": 420.0, "h": 40.0}

# Build class / persona raw: title bar, y≈110-175, wide centre band
_ROI_PERSONA_RAW: dict[str, float] = {"x": 300.0, "y": 110.0, "w": 1100.0, "h": 65.0}

# Player level: broad left-strip band (fallback; anchor_y-scoped when available)
_ROI_PLAYER_LEVEL: dict[str, float] = {"x": 60.0, "y": 180.0, "w": 160.0, "h": 800.0}

# ---------------------------------------------------------------------------
# Column centres for the tabular extractor (empirical from parsers.py)
# ---------------------------------------------------------------------------

_FALLBACK_COLUMN_CX: dict[str, float] = {
    "technique": 491.0,
    "power": 769.0,
    "playstyle": 1076.0,
    "tenacity": 1363.0,
    "tactics": 1652.0,
}


# ---------------------------------------------------------------------------
# FieldEvidenceRecord
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FieldEvidenceRecord:
    """1:1 mirror of the ocr_field_evidence Drizzle row shape.

    Serialized as JSON via to_dict() for worker consumption.
    Column naming uses snake_case to match the Drizzle ORM's Postgres column
    names (the TS layer maps camelCase ↔ snake_case via Drizzle conventions).

    NOTE (Phase 2A): calibrated_confidence == raw_confidence everywhere in this
    extractor stack. The two-track design ships now so the evidence schema
    matches Phase 3+'s contract; per-extractor sigmoid calibration is deferred.
    """

    screen_state: str
    field_key: str
    field_family: str    # 'open_text' | 'closed_vocab' | 'tabular_numeric' | 'icon' | 'geometry'
    candidate_value: Any  # str | int | float | dict | None
    candidate_rank: int
    raw_confidence: float
    calibrated_confidence: float
    extractor_family: str
    extractor_version: str
    observability_status: str   # 'observable' | 'not_observable_from_source' | 'obstructed' | 'low_quality'
    normalization_status: str   # 'normalized' | 'unnormalized' | 'failed'

    # Optional / nullable columns
    screen_instance_key: Optional[str] = None
    subject_slot_key: Optional[str] = None
    support_frame_ids: tuple[int, ...] = ()
    roi_bbox: Optional[dict[str, float]] = None
    template_version: Optional[str] = None
    row_key: Optional[str] = None
    column_key: Optional[str] = None
    x_norm: Optional[float] = None
    y_norm: Optional[float] = None
    shape_or_icon_class: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        """Serialize for JSON output (snake_case keys to match Postgres column names)."""
        d = asdict(self)
        d["support_frame_ids"] = list(self.support_frame_ids)
        return d


# ---------------------------------------------------------------------------
# Public entry point (new contract)
# ---------------------------------------------------------------------------


def extract_loadout_evidence(
    bundle_dir: Path,
    *,
    segment_index: int,
    extractor_version: str = EXTRACTOR_VERSION,
    ocr_lines_per_frame: Sequence[Sequence[OCRLine]] | None = None,
    use_gpu: bool = False,
) -> list[FieldEvidenceRecord]:
    """Top-level entry point: bundle_dir → list[FieldEvidenceRecord].

    Reads PNG frames from bundle_dir, assembles subject bundles (one per
    distinct player navigated to), then runs 4 family extractors ONCE per
    bundle on the best frame, attributing right-pane data only to that
    subject.

    Frame naming convention (Pass-2 output):
        bundle_dir/00001.png  (5-digit zero-padded, NO "frame_" prefix)

    When ``ocr_lines_per_frame`` is None (the default), RapidOCR is run
    internally on each PNG.  Pass the list explicitly to reuse pre-computed
    OCR output (e.g. from worker-time invocation or tests).

    Parameters
    ----------
    bundle_dir:
        Directory containing 5-digit zero-padded PNGs (00001.png, …).
    segment_index:
        Pass-1 segment index (used in slot_key construction).
    extractor_version:
        Version string stamped onto every FieldEvidenceRecord.
    ocr_lines_per_frame:
        Optional pre-computed OCR lines, one sequence per frame.
        When None, RapidOCR is run internally.
    use_gpu:
        Passed to RapidOCRBackend when OCR is run internally.

    Returns
    -------
    list[FieldEvidenceRecord]
        Flat list, one record per (subject × field × candidate_rank).

    Raises
    ------
    ValueError:
        When no frames are found in bundle_dir.
    """
    # 1. Discover frames
    frame_paths = sorted(bundle_dir.glob("[0-9]*.png"))
    if not frame_paths:
        raise ValueError(f"No PNG frames found in {bundle_dir}")

    # 2. Obtain OCR lines
    if ocr_lines_per_frame is None:
        backend = RapidOCRBackend(use_gpu=use_gpu)
        computed: list[list[OCRLine]] = []
        for fp in frame_paths:
            img = cv2.imread(str(fp))
            if img is None:
                computed.append([])
            else:
                computed.append(backend.read(img))
        resolved_ocr: list[list[OCRLine]] = computed
    else:
        resolved_ocr = [list(lines) for lines in ocr_lines_per_frame]

    # 3. Assemble subject bundles (new contract)
    bundles = assemble_loadout_subject_bundles(
        frame_paths,
        segment_index=segment_index,
        ocr_lines_per_frame=resolved_ocr,
    )

    # 4. Run extractors per bundle (ONCE, on best frame only)
    closed_vocab = LoadoutClosedVocabExtractor()
    tabular = LoadoutTabularExtractor()
    icon = LoadoutIconExtractor()
    open_text = LoadoutOpenTextExtractor()

    # Build a Path → ocr_lines lookup so per-bundle extraction can use the
    # already-computed OCR data instead of trying to load from disk.
    ocr_lines_by_path: dict[Path, list[OCRLine]] = {
        fp: list(lines) for fp, lines in zip(frame_paths, resolved_ocr)
    }

    records: list[FieldEvidenceRecord] = []
    for bundle in bundles:
        best_frame_lines = ocr_lines_by_path.get(bundle.best_frame_path, [])
        records.extend(
            _evidence_for_subject_bundle(
                bundle, closed_vocab, tabular, icon, open_text, extractor_version,
                best_frame_ocr_lines=best_frame_lines,
            )
        )

    return records


# ---------------------------------------------------------------------------
# Per-bundle dispatcher (new contract)
# ---------------------------------------------------------------------------


def _evidence_for_subject_bundle(
    bundle: LoadoutSubjectBundle,
    closed_vocab: LoadoutClosedVocabExtractor,
    tabular: LoadoutTabularExtractor,
    icon: LoadoutIconExtractor,
    open_text: LoadoutOpenTextExtractor,
    extractor_version: str,
    *,
    best_frame_ocr_lines: list[OCRLine] | None = None,
) -> list[FieldEvidenceRecord]:
    """Run all 4 extractors on one subject bundle (on the best frame only).

    Identity fields (gamertag, position, jersey_number, is_captain,
    persona_raw, player_level_raw, build_class) are emitted DIRECTLY from
    bundle.canonical_subject — NOT from static-ROI open_text calls.  The old
    approach used fixed ROI windows that don't align with the subject's
    variable left-strip row Y, producing None values for every identity field.

    NOTE: The visual HOME/AWAY section headers in the loadout pregame menu are
    NOT read here and are NOT a source of team_side.  team_side is determined
    exclusively by the worker promoter via resolveGamertagToPlayer with
    opponent_player_match_stats fallback.
    """
    records: list[FieldEvidenceRecord] = []
    support_frames = bundle.support_frame_indices
    slot_key = bundle.slot_key
    bundle_observability = bundle.observability
    identity = bundle.canonical_subject

    # Load best frame image
    image_bgr: Optional[np.ndarray] = cv2.imread(str(bundle.best_frame_path))

    # Use OCR lines passed in by the orchestrator (already computed during
    # bundle assembly). Fall back to JSON sidecar load only if the caller
    # didn't supply them (e.g., unit tests using legacy disk-based fixtures).
    if best_frame_ocr_lines is not None:
        all_ocr_lines = best_frame_ocr_lines
    else:
        try:
            all_ocr_lines = _load_frame_ocr_lines(bundle.best_frame_path)
        except FileNotFoundError:
            all_ocr_lines = []

    # ── 1. Identity fields from canonical_subject ────────────────────────────
    # Each identity field emits ONE rank-0 FieldEvidenceRecord with the value
    # from canonical_subject.  If the value is None, the record is emitted with
    # observability='low_quality' so the promotion gate sees "tried but failed".
    #
    # persona_raw = player_name_full: the loadout view shows the in-game player
    # name (e.g. "Evgeni Wanhg") in the left-strip row.  The DB's persona_raw
    # is the short pre-game-lobby alias (e.g. "E. Wanhg"), which is cross-matched
    # in the promoter via pre_game_lobby_state_2.  We store player_name_full
    # here and let the promoter do the cross-match.
    _identity_field_defs: list[tuple[str, Any, Optional[float]]] = [
        ("gamertag",          identity.gamertag,          identity.gamertag_confidence),
        ("position",          identity.position,          identity.position_confidence),
        ("jersey_number",     identity.jersey_number,     identity.jersey_confidence),
        ("is_captain",        identity.is_captain,        identity.is_captain_confidence),
        ("persona_raw",       identity.player_name_full,  identity.player_name_confidence),
        ("player_level_raw",  identity.player_level_raw,  identity.player_level_confidence),
    ]
    for field_key, value, conf in _identity_field_defs:
        has_value = value is not None
        eff_conf = conf or 0.0
        obs_status = "observable" if has_value else "low_quality"
        norm_status = "normalized" if has_value else "unnormalized"
        records.append(
            FieldEvidenceRecord(
                screen_state=SCREEN_STATE,
                subject_slot_key=slot_key,
                field_key=field_key,
                field_family="open_text",
                candidate_value=value,
                candidate_rank=0,
                raw_confidence=eff_conf,
                calibrated_confidence=eff_conf,
                extractor_family="open_text",
                extractor_version=extractor_version,
                observability_status=_merge_observability(bundle_observability, obs_status),
                normalization_status=norm_status,
                support_frame_ids=support_frames,
            )
        )

    # build_class_raw as open_text (audit trail — raw value from title bar)
    bc_raw = identity.build_class_raw
    bc_raw_conf = identity.build_class_confidence or 0.0
    records.append(
        FieldEvidenceRecord(
            screen_state=SCREEN_STATE,
            subject_slot_key=slot_key,
            field_key="build_class_raw",
            field_family="open_text",
            candidate_value=bc_raw,
            candidate_rank=0,
            raw_confidence=bc_raw_conf,
            calibrated_confidence=bc_raw_conf,
            extractor_family="open_text",
            extractor_version=extractor_version,
            observability_status=_merge_observability(
                bundle_observability, "observable" if bc_raw else "low_quality"
            ),
            normalization_status="normalized" if bc_raw else "unnormalized",
            support_frame_ids=support_frames,
        )
    )

    # ── 2. Closed-vocab extractor ────────────────────────────────────────────
    cv_records = _closed_vocab_records_for_subject_bundle(
        bundle=bundle,
        ocr_lines=all_ocr_lines,
        image_bgr=image_bgr,
        extractor=closed_vocab,
        extractor_version=extractor_version,
        support_frames=support_frames,
        bundle_observability=bundle_observability,
        build_class_raw=bc_raw,
    )
    records.extend(cv_records)

    # ── 3. Tabular numeric extractor ─────────────────────────────────────────
    # Called ONCE via _extract_all_attribute_groups which iterates all 5 group
    # columns internally — NOT 5× in a loop.  slot_anchor_y=0 means the
    # attribute grid uses its fixed empirical row-y constants (598, 656, …)
    # which are correct for the right pane (not the left-strip row Y).
    if image_bgr is not None:
        tab_evidences = _extract_all_attribute_groups(
            tabular=tabular,
            image_bgr=image_bgr,
            ocr_lines=all_ocr_lines,
        )
        for tab_ev in tab_evidences:
            norm_status = "normalized" if tab_ev.value is not None else "failed"
            records.append(
                FieldEvidenceRecord(
                    screen_state=SCREEN_STATE,
                    subject_slot_key=slot_key,
                    field_key=f"attribute_{tab_ev.row_key}_{tab_ev.column_key}",
                    field_family="tabular_numeric",
                    candidate_value=tab_ev.value,
                    candidate_rank=tab_ev.candidate_rank,
                    raw_confidence=tab_ev.raw_confidence,
                    calibrated_confidence=tab_ev.calibrated_confidence,
                    extractor_family="tabular_numeric",
                    extractor_version=extractor_version,
                    observability_status=_merge_observability(bundle_observability, tab_ev.observability),
                    normalization_status=norm_status,
                    support_frame_ids=support_frames,
                    roi_bbox=tab_ev.roi_bbox,
                    row_key=tab_ev.row_key,
                    column_key=tab_ev.column_key,
                )
            )

    # ── 4. Icon extractor ─────────────────────────────────────────────────────
    if image_bgr is not None:
        icon_evidences = icon.extract_xfactor_icons(image_bgr)
        for ic_ev in icon_evidences:
            records.append(
                FieldEvidenceRecord(
                    screen_state=SCREEN_STATE,
                    subject_slot_key=slot_key,
                    field_key=ic_ev.field_key,
                    field_family="icon",
                    candidate_value=ic_ev.shape_or_icon_class or None,
                    candidate_rank=0,
                    raw_confidence=ic_ev.raw_confidence,
                    calibrated_confidence=ic_ev.calibrated_confidence,
                    extractor_family="icon",
                    extractor_version=extractor_version,
                    observability_status=_merge_observability(bundle_observability, ic_ev.observability),
                    normalization_status="normalized",
                    support_frame_ids=support_frames,
                    roi_bbox=ic_ev.roi_bbox,
                    x_norm=ic_ev.x_norm,
                    y_norm=ic_ev.y_norm,
                    shape_or_icon_class=ic_ev.shape_or_icon_class or None,
                )
            )

    return records


# ---------------------------------------------------------------------------
# Backward-compat dispatcher for old LoadoutFrameBundle tests
# ---------------------------------------------------------------------------


def _evidence_for_bundle(
    bundle: LoadoutFrameBundle,
    closed_vocab: LoadoutClosedVocabExtractor,
    tabular: LoadoutTabularExtractor,
    icon: LoadoutIconExtractor,
    open_text: LoadoutOpenTextExtractor,
    extractor_version: str,
) -> list[FieldEvidenceRecord]:
    """Run all 4 extractors on one bundle (old LoadoutFrameBundle contract).

    DEPRECATED: kept so existing tests that use _make_bundle() with
    LoadoutFrameBundle continue to pass. Delegates to the same extractor
    logic as _evidence_for_subject_bundle but adapts the old bundle shape.
    """
    records: list[FieldEvidenceRecord] = []
    support_frames = bundle.support_frame_indices
    slot_key = bundle.slot_key
    bundle_observability = bundle.observability

    image_bgr: Optional[np.ndarray] = cv2.imread(str(bundle.best_frame_path))

    best_frame_path = bundle.best_frame_path
    try:
        all_ocr_lines = _load_frame_ocr_lines(best_frame_path)
    except FileNotFoundError:
        all_ocr_lines = []

    # ── 1. Open-text extractor ───────────────────────────────────────────────
    open_text_fields = [
        ("gamertag", _ROI_GAMERTAG),
        ("persona_raw", _ROI_PERSONA_RAW),
        ("player_level_raw", _ROI_PLAYER_LEVEL),
    ]
    for field_key, roi in open_text_fields:
        candidates = open_text.extract_open_text_for_roi(
            all_ocr_lines,
            roi_bbox=roi,
            field_key=field_key,
        )
        for ot_ev in candidates:
            norm_status = "normalized" if ot_ev.value else "unnormalized"
            records.append(
                FieldEvidenceRecord(
                    screen_state=SCREEN_STATE,
                    subject_slot_key=slot_key,
                    field_key=ot_ev.field_key,
                    field_family="open_text",
                    candidate_value=ot_ev.value,
                    candidate_rank=ot_ev.candidate_rank,
                    raw_confidence=ot_ev.raw_confidence,
                    calibrated_confidence=ot_ev.calibrated_confidence,
                    extractor_family="open_text",
                    extractor_version=extractor_version,
                    observability_status=_merge_observability(bundle_observability, ot_ev.observability),
                    normalization_status=norm_status,
                    support_frame_ids=support_frames,
                    roi_bbox=ot_ev.roi_bbox,
                )
            )

    # ── 2. Closed-vocab extractor ────────────────────────────────────────────
    _cv_records = _closed_vocab_records_for_bundle(
        bundle=bundle,
        ocr_lines=all_ocr_lines,
        image_bgr=image_bgr,
        extractor=closed_vocab,
        extractor_version=extractor_version,
        support_frames=support_frames,
        bundle_observability=bundle_observability,
    )
    records.extend(_cv_records)

    # ── 3. Tabular numeric extractor ─────────────────────────────────────────
    if image_bgr is not None:
        for group_name, cx in _FALLBACK_COLUMN_CX.items():
            tab_evidences = tabular.extract_attribute_grid(
                image_bgr,
                slot_anchor_y=0,
                ocr_lines=all_ocr_lines,
                column_cx=cx,
            )
            for tab_ev in tab_evidences:
                norm_status = "normalized" if tab_ev.value is not None else "failed"
                records.append(
                    FieldEvidenceRecord(
                        screen_state=SCREEN_STATE,
                        subject_slot_key=slot_key,
                        field_key=f"attribute_{tab_ev.row_key}_{tab_ev.column_key}",
                        field_family="tabular_numeric",
                        candidate_value=tab_ev.value,
                        candidate_rank=tab_ev.candidate_rank,
                        raw_confidence=tab_ev.raw_confidence,
                        calibrated_confidence=tab_ev.calibrated_confidence,
                        extractor_family="tabular_numeric",
                        extractor_version=extractor_version,
                        observability_status=_merge_observability(bundle_observability, tab_ev.observability),
                        normalization_status=norm_status,
                        support_frame_ids=support_frames,
                        roi_bbox=tab_ev.roi_bbox,
                        row_key=tab_ev.row_key,
                        column_key=tab_ev.column_key,
                    )
                )

    # ── 4. Icon extractor ─────────────────────────────────────────────────────
    if image_bgr is not None:
        icon_evidences = icon.extract_xfactor_icons(image_bgr)
        for ic_ev in icon_evidences:
            records.append(
                FieldEvidenceRecord(
                    screen_state=SCREEN_STATE,
                    subject_slot_key=slot_key,
                    field_key=ic_ev.field_key,
                    field_family="icon",
                    candidate_value=ic_ev.shape_or_icon_class or None,
                    candidate_rank=0,
                    raw_confidence=ic_ev.raw_confidence,
                    calibrated_confidence=ic_ev.calibrated_confidence,
                    extractor_family="icon",
                    extractor_version=extractor_version,
                    observability_status=_merge_observability(bundle_observability, ic_ev.observability),
                    normalization_status="normalized",
                    support_frame_ids=support_frames,
                    roi_bbox=ic_ev.roi_bbox,
                    x_norm=ic_ev.x_norm,
                    y_norm=ic_ev.y_norm,
                    shape_or_icon_class=ic_ev.shape_or_icon_class or None,
                )
            )

    return records


# ---------------------------------------------------------------------------
# Tabular attribute extraction helper
# ---------------------------------------------------------------------------


def _extract_all_attribute_groups(
    *,
    tabular: LoadoutTabularExtractor,
    image_bgr: Any,
    ocr_lines: list[OCRLine],
) -> list[NumericCellEvidence]:
    """Extract attribute grid records for ALL 5 groups, deduped per (row_key, column_key).

    Background: ``LoadoutTabularExtractor.extract_attribute_grid`` iterates all 23
    attribute keys for a single column_cx.  Since the attribute grid has 5 groups at
    different X positions, naive iteration over all 5 group columns would produce
    23×5 = 115 records per (value|delta) column — each attribute key appearing 5×.

    Correct approach: call the extractor ONCE PER GROUP cx, then keep only the records
    whose row_key belongs to that group.  The group membership is loaded from
    attribute_keys.yaml (same source as the tabular extractor's own key list).

    slot_anchor_y=0 is correct: the right-pane attribute grid uses fixed empirical
    y-centres (598, 656, 714, 771, 830) that don't shift with the subject's left-strip
    row Y position.
    """
    from .loadout_extractors.closed_vocab import load_attribute_keys
    attr_groups = load_attribute_keys()  # {group_name: [key, ...]}

    all_evidences: list[NumericCellEvidence] = []
    for group_name, cx in _FALLBACK_COLUMN_CX.items():
        group_keys = set(attr_groups.get(group_name, []))
        if not group_keys:
            continue  # skip unknown groups
        group_evidences = tabular.extract_attribute_grid(
            image_bgr,
            slot_anchor_y=0,
            ocr_lines=ocr_lines,
            column_cx=cx,
        )
        # Keep only records for THIS group's attribute keys
        for ev in group_evidences:
            if ev.row_key in group_keys:
                all_evidences.append(ev)
    return all_evidences


# ---------------------------------------------------------------------------
# Closed-vocab helpers
# ---------------------------------------------------------------------------


def _closed_vocab_records_for_subject_bundle(
    *,
    bundle: LoadoutSubjectBundle,
    ocr_lines: list[OCRLine],
    image_bgr: Any,
    extractor: LoadoutClosedVocabExtractor,
    extractor_version: str,
    support_frames: tuple[int, ...],
    bundle_observability: str,
    build_class_raw: Optional[str] = None,
) -> list[FieldEvidenceRecord]:
    """Extract closed-vocab evidence for a subject bundle.

    For the new-contract subject bundles, build_class is classified from the
    canonical_subject's build_class_raw (passed in) rather than by re-reading
    the title bar from OCR lines.  position is now emitted from identity fields
    and is NOT re-classified here for subject bundles.
    """
    return _closed_vocab_core(
        slot_key=bundle.slot_key,
        ocr_lines=ocr_lines,
        image_bgr=image_bgr,
        extractor=extractor,
        extractor_version=extractor_version,
        support_frames=support_frames,
        bundle_observability=bundle_observability,
        build_class_raw=build_class_raw,
        emit_position=False,  # position comes from identity field emission
    )


def _closed_vocab_records_for_bundle(
    *,
    bundle: LoadoutFrameBundle,
    ocr_lines: list[OCRLine],
    image_bgr: Any,
    extractor: LoadoutClosedVocabExtractor,
    extractor_version: str,
    support_frames: tuple[int, ...],
    bundle_observability: str,
) -> list[FieldEvidenceRecord]:
    """Extract closed-vocab evidence for a (deprecated) LoadoutFrameBundle."""
    return _closed_vocab_core(
        slot_key=bundle.slot_key,
        ocr_lines=ocr_lines,
        image_bgr=image_bgr,
        extractor=extractor,
        extractor_version=extractor_version,
        support_frames=support_frames,
        bundle_observability=bundle_observability,
        build_class_raw=None,  # use OCR band (legacy path)
        emit_position=True,    # legacy bundles still need position from closed-vocab
    )


def _closed_vocab_core(
    *,
    slot_key: str,
    ocr_lines: list[OCRLine],
    image_bgr: Any,
    extractor: LoadoutClosedVocabExtractor,
    extractor_version: str,
    support_frames: tuple[int, ...],
    bundle_observability: str,
    build_class_raw: Optional[str] = None,
    emit_position: bool = True,
) -> list[FieldEvidenceRecord]:
    """Core closed-vocab evidence extraction (shared by old and new bundle types).

    Parameters
    ----------
    build_class_raw:
        When provided (new subject-bundle path), classify_build_class is called
        on this raw text (from canonical_subject.build_class_raw, e.g. the full
        title-bar string like "TAGETHOMPSON-PWF").  When None (legacy path),
        the title-bar OCR band is re-read from ocr_lines.
    emit_position:
        When False (new subject-bundle path), position is NOT emitted here —
        it was already emitted as an open_text record from canonical_subject.
    """
    records: list[FieldEvidenceRecord] = []

    def _cv_to_record(
        candidates: list[ClosedVocabCandidate],
        field_key: str,
    ) -> list[FieldEvidenceRecord]:
        out = []
        for rank, cand in enumerate(candidates):
            out.append(
                FieldEvidenceRecord(
                    screen_state=SCREEN_STATE,
                    subject_slot_key=slot_key,
                    field_key=field_key,
                    field_family="closed_vocab",
                    candidate_value=cand.value,
                    candidate_rank=rank,
                    raw_confidence=cand.raw_confidence,
                    calibrated_confidence=cand.calibrated_confidence,
                    extractor_family="closed_vocab",
                    extractor_version=extractor_version,
                    observability_status=bundle_observability,
                    normalization_status="normalized",
                    support_frame_ids=support_frames,
                    roi_bbox=cand.roi_bbox,
                )
            )
        if not out:
            out.append(
                FieldEvidenceRecord(
                    screen_state=SCREEN_STATE,
                    subject_slot_key=slot_key,
                    field_key=field_key,
                    field_family="closed_vocab",
                    candidate_value=None,
                    candidate_rank=0,
                    raw_confidence=0.0,
                    calibrated_confidence=0.0,
                    extractor_family="closed_vocab",
                    extractor_version=extractor_version,
                    observability_status="low_quality",
                    normalization_status="failed",
                    support_frame_ids=support_frames,
                )
            )
        return out

    # build_class: canonical name via closed-vocab classifier
    # New path: use build_class_raw from canonical_subject (e.g. "TAGETHOMPSON-PWF")
    # Legacy path: re-read title bar band from OCR lines
    if build_class_raw is not None:
        bc_text = build_class_raw
    else:
        bc_text = _join_lines_in_band(ocr_lines, y_min=110.0, y_max=175.0, x_min=300.0, x_max=1400.0)
    records.extend(_cv_to_record(extractor.classify_build_class(bc_text), "build_class"))

    # position (left strip, y 180-980, x < 130) — only for legacy bundles
    if emit_position:
        pos_text = _join_lines_in_band(ocr_lines, y_min=180.0, y_max=980.0, x_min=0.0, x_max=130.0)
        records.extend(_cv_to_record(extractor.classify_position(pos_text), "position"))

    # x_factor names (3 slots)
    _XFACTOR_SLOT_CENTERS = [500, 1000, 1500]
    for slot_idx, cx in enumerate(_XFACTOR_SLOT_CENTERS):
        xf_text = _join_lines_in_band(
            ocr_lines,
            y_min=300.0, y_max=430.0,
            x_min=cx - 200.0, x_max=cx + 200.0,
        )
        records.extend(_cv_to_record(
            extractor.classify_x_factor_name(xf_text),
            f"x_factor_name_{slot_idx}",
        ))

    # x_factor tier from image (HSV color sampling)
    if image_bgr is not None:
        H, W = image_bgr.shape[:2]
        _ICON_CENTROIDS = [(500, 340), (1000, 340), (1500, 340)]
        for slot_idx, (cx, cy) in enumerate(_ICON_CENTROIDS):
            roi_w = 70.0 / W
            roi_h = 70.0 / H
            roi_bbox = {
                "x": max(0.0, (cx - 35) / W),
                "y": max(0.0, (cy - 35) / H),
                "w": roi_w,
                "h": roi_h,
            }
            tier_cands = extractor.classify_x_factor_tier_from_image(
                image_bgr,
                cx=cx,
                cy=cy,
                roi_bbox=roi_bbox,
            )
            records.extend(_cv_to_record(tier_cands, f"x_factor_tier_{slot_idx}"))

    return records


# ---------------------------------------------------------------------------
# Observability merge helper
# ---------------------------------------------------------------------------


def _merge_observability(bundle_obs: str, field_obs: str) -> str:
    """Propagate the bundle-level observability when it's worse than the field-level one."""
    _ORDER = {
        "observable": 0,
        "low_quality": 1,
        "obstructed": 2,
        "not_observable_from_source": 3,
    }
    if _ORDER.get(bundle_obs, 0) >= _ORDER.get(field_obs, 0):
        return bundle_obs
    return field_obs


# ---------------------------------------------------------------------------
# OCR line helpers
# ---------------------------------------------------------------------------


def _load_frame_ocr_lines(frame_path: Path) -> list[OCRLine]:
    """Load per-frame OCR lines from the sibling ocr_lines_{stem}.json file."""
    lines_path = frame_path.parent / f"ocr_lines_{frame_path.stem}.json"
    if not lines_path.exists():
        raise FileNotFoundError(f"OCR lines file missing: {lines_path}")
    with lines_path.open() as fp:
        lines_data = json.load(fp)
    return [_ocr_line_from_dict(d) for d in lines_data]


def _ocr_line_from_dict(d: dict) -> OCRLine:
    """Reconstruct an OCRLine from a JSON dict.

    Supports two shapes:
      {"text": ..., "confidence": ..., "x1": ..., "y1": ..., "x2": ..., "y2": ...}
      {"text": ..., "confidence": ..., "bbox": [x1, y1, x2, y2]}
    """
    text = d.get("text", "")
    confidence = float(d.get("confidence", 0.0))
    if "x1" in d:
        return OCRLine(
            text=text,
            confidence=confidence,
            x1=float(d.get("x1", 0.0)),
            y1=float(d.get("y1", 0.0)),
            x2=float(d.get("x2", 0.0)),
            y2=float(d.get("y2", 0.0)),
        )
    bbox = d.get("bbox", [0.0, 0.0, 0.0, 0.0])
    return OCRLine(
        text=text,
        confidence=confidence,
        x1=float(bbox[0]) if len(bbox) > 0 else 0.0,
        y1=float(bbox[1]) if len(bbox) > 1 else 0.0,
        x2=float(bbox[2]) if len(bbox) > 2 else 0.0,
        y2=float(bbox[3]) if len(bbox) > 3 else 0.0,
    )


def _join_lines_in_band(
    lines: list[OCRLine],
    *,
    y_min: float,
    y_max: float,
    x_min: float = 0.0,
    x_max: float = 1920.0,
) -> str:
    """Return space-joined text of all OCR lines whose centre falls in the band."""
    filtered = [
        l for l in lines
        if y_min <= l.y_center <= y_max and x_min <= l.x_center <= x_max
    ]
    return " ".join(l.text for l in sorted(filtered, key=lambda l: l.x_center))
