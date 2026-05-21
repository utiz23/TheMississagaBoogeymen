"""Phase 2A-9: typed extractor entry point + FieldEvidenceRecord JSON contract.

Public API
----------
FieldEvidenceRecord
    Frozen dataclass mirroring ``ocr_field_evidence`` Drizzle columns 1:1.
    ``to_dict()`` produces the exact JSON contract consumed by the worker's
    ``writeFieldEvidenceForBatch`` (Task 2A-14).

extract_loadout_evidence(bundle_dir, *, segment_index, extractor_version)
    Top-level entry point: reads frames + per-frame OCR lines from
    ``bundle_dir``, runs the four family extractors over each per-slot bundle,
    and returns a flat list of FieldEvidenceRecord ready to JSON-serialize.

Family → FieldEvidenceRecord adapter rules
------------------------------------------
closed_vocab  (LoadoutClosedVocabExtractor → ClosedVocabCandidate)
    field_family = extractor_family = 'closed_vocab'
    candidate_value = candidate.value (str)
    raw/calibrated_confidence = candidate values
    roi_bbox from candidate.roi_bbox (already normalised dict or None)
    normalization_status = 'normalized'

tabular_numeric  (LoadoutTabularExtractor → NumericCellEvidence)
    field_family = extractor_family = 'tabular_numeric'
    candidate_value = evidence.value (int | None)
    row_key = evidence.row_key,  column_key = evidence.column_key
    normalization_status = 'normalized' when value is not None else 'failed'

icon  (LoadoutIconExtractor → IconEvidence)
    field_family = extractor_family = 'icon'
    candidate_value = evidence.shape_or_icon_class (str)
    shape_or_icon_class = evidence.shape_or_icon_class
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
from typing import Any, Optional

import cv2
import numpy as np

from .loadout_bundle import assemble_loadout_bundles, LoadoutFrameBundle
from .loadout_extractors.closed_vocab import LoadoutClosedVocabExtractor, ClosedVocabCandidate
from .loadout_extractors.tabular_numeric import LoadoutTabularExtractor, NumericCellEvidence
from .loadout_extractors.icon import LoadoutIconExtractor, IconEvidence
from .loadout_extractors.open_text import LoadoutOpenTextExtractor, OpenTextEvidence
from .ocr import OCRLine

EXTRACTOR_VERSION = "loadout-evidence-v1"
SCREEN_STATE = "player_loadout_view"

# ---------------------------------------------------------------------------
# ROI constants for the three open-text fields we extract per slot
# (mirrored from parsers.py geometry)
# ---------------------------------------------------------------------------

# Gamertag: top-right, y≈130-170, x>1500
_ROI_GAMERTAG: dict[str, float] = {"x": 1500.0, "y": 130.0, "w": 420.0, "h": 40.0}

# Build class / persona raw: y≈110-175, wide centre band
_ROI_PERSONA_RAW: dict[str, float] = {"x": 300.0, "y": 110.0, "w": 1100.0, "h": 65.0}

# Player level: tight strip-level band, y≈(subject_row_y, +50), x 60-220
# We use a broad default here; the bundle anchors are not yet passed down.
_ROI_PLAYER_LEVEL: dict[str, float] = {"x": 60.0, "y": 180.0, "w": 160.0, "h": 800.0}

# ---------------------------------------------------------------------------
# Column centres for the tabular extractor (fallback empirical values from parsers.py)
# ---------------------------------------------------------------------------

_FALLBACK_COLUMN_CX: dict[str, float] = {
    "technique": 491.0,
    "power": 769.0,
    "playstyle": 1076.0,
    "tenacity": 1363.0,
    "tactics": 1652.0,
}

# Use the first column as the default when we don't have per-column routing
_DEFAULT_COLUMN_CX = _FALLBACK_COLUMN_CX["technique"]


# ---------------------------------------------------------------------------
# FieldEvidenceRecord
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FieldEvidenceRecord:
    """1:1 mirror of the ocr_field_evidence Drizzle row shape.

    Serialized as JSON via to_dict() for worker consumption.
    Column naming uses snake_case to match the Drizzle ORM's Postgres column
    names (the TS layer maps camelCase ↔ snake_case via Drizzle conventions).
    """

    screen_state: str
    field_key: str
    field_family: str   # 'open_text' | 'closed_vocab' | 'tabular_numeric' | 'icon' | 'geometry'
    candidate_value: Any  # str | int | float | dict | None
    candidate_rank: int
    raw_confidence: float
    calibrated_confidence: float
    extractor_family: str   # same OcrExtractorFamily enum
    extractor_version: str
    observability_status: str  # 'observable' | 'not_observable_from_source' | 'obstructed' | 'low_quality'
    normalization_status: str  # 'normalized' | 'unnormalized' | 'failed'

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
        # support_frame_ids is a tuple; JSON wants list
        d["support_frame_ids"] = list(self.support_frame_ids)
        return d


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def extract_loadout_evidence(
    bundle_dir: Path,
    *,
    segment_index: int,
    extractor_version: str = EXTRACTOR_VERSION,
) -> list[FieldEvidenceRecord]:
    """Top-level entry point: bundle_dir → list[FieldEvidenceRecord].

    Reads frames + per-frame OCR lines from bundle_dir, runs the bundle
    assembler, then dispatches each bundle to the 4 family extractors.
    Returns flat list of evidence records ready to JSON-serialize.

    bundle_dir convention (mirrors Pass-2 output):
        bundle_dir/frame_NNNN.png
        bundle_dir/ocr_lines_NNNN.json   (RapidOCR output per frame, where NNNN
                                          matches the 4-digit suffix of frame_NNNN.png)

    Parameters
    ----------
    bundle_dir:
        Directory containing frame PNGs + matching ocr_lines JSON files.
    segment_index:
        Pass-1 segment index (used in slot_key construction).
    extractor_version:
        Version string stamped onto every FieldEvidenceRecord.

    Returns
    -------
    list[FieldEvidenceRecord]
        Flat list, one record per (slot × field × candidate_rank).

    Raises
    ------
    FileNotFoundError:
        When a per-frame ocr_lines file is missing.
    ValueError:
        When no frames are found in bundle_dir.
    """
    # 1. Discover frames + OCR lines
    frame_paths = sorted(bundle_dir.glob("frame_*.png"))
    if not frame_paths:
        raise ValueError(f"No frame_*.png files found in {bundle_dir}")

    ocr_lines_per_frame: list[list[OCRLine]] = []
    for frame_path in frame_paths:
        ocr_lines_per_frame.append(_load_frame_ocr_lines(frame_path))

    # 2. Assemble bundles
    bundles = assemble_loadout_bundles(
        frame_paths,
        segment_index=segment_index,
        ocr_lines_per_frame=ocr_lines_per_frame,
    )

    # 3. Run extractors per bundle
    closed_vocab = LoadoutClosedVocabExtractor()
    tabular = LoadoutTabularExtractor()
    icon = LoadoutIconExtractor()
    open_text = LoadoutOpenTextExtractor()

    records: list[FieldEvidenceRecord] = []
    for bundle in bundles:
        records.extend(
            _evidence_for_bundle(
                bundle, closed_vocab, tabular, icon, open_text, extractor_version
            )
        )

    return records


# ---------------------------------------------------------------------------
# Per-bundle dispatcher
# ---------------------------------------------------------------------------


def _load_frame_ocr_lines(frame_path: Path) -> list[OCRLine]:
    """Load per-frame OCR lines from the sibling ocr_lines_NNNN.json file.

    Separated into its own function so tests can patch it independently from
    all other Path.open calls (e.g., YAML config file reads in extractor inits).
    """
    suffix = frame_path.stem.split("_", 1)[1]
    lines_path = frame_path.parent / f"ocr_lines_{suffix}.json"
    if not lines_path.exists():
        raise FileNotFoundError(f"OCR lines file missing: {lines_path}")
    with lines_path.open() as fp:
        lines_data = json.load(fp)
    return [_ocr_line_from_dict(d) for d in lines_data]


def _evidence_for_bundle(
    bundle: LoadoutFrameBundle,
    closed_vocab: LoadoutClosedVocabExtractor,
    tabular: LoadoutTabularExtractor,
    icon: LoadoutIconExtractor,
    open_text: LoadoutOpenTextExtractor,
    extractor_version: str,
) -> list[FieldEvidenceRecord]:
    """Run all 4 extractors on one bundle and convert to FieldEvidenceRecord list."""
    records: list[FieldEvidenceRecord] = []
    support_frames = bundle.support_frame_indices
    slot_key = bundle.slot_key
    bundle_observability = bundle.observability

    # ── Load best frame image ────────────────────────────────────────────────
    image_bgr: Optional[np.ndarray] = cv2.imread(str(bundle.best_frame_path))

    # Best frame's OCR lines (for open-text and closed-vocab text extraction).
    # We use the first frame's lines as a proxy when the best frame has no match.
    best_frame_idx_in_bundle = list(bundle.frame_paths).index(bundle.best_frame_path)
    # Collect all OCR lines across all frames in the bundle for richer coverage.
    # Since the bundle assembler groups consistent slots, merging is safe.
    all_ocr_lines: list[OCRLine] = []
    # We load OCR lines directly from the bundle's slot_identities (they were
    # already read by the assembler) — but they are not stored in the bundle.
    # Instead we must re-read the per-frame JSON files that were consumed upstream.
    # However, at this layer we only have the frame paths, not a ref to the
    # original per-frame OCR line lists (they were consumed by assemble_loadout_bundles
    # and are not stored in LoadoutFrameBundle).
    #
    # Design decision (Task 2A-9): the best-frame image is used for CV-based
    # extractors (tabular, icon, closed_vocab HSV). For OCR-based open-text, we
    # infer the best-frame OCR lines by loading them from the bundle_dir-relative
    # path convention.  The frame_path suffix gives us the lines file name.
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
    # We need OCR text for the closed-vocab text-based classifiers.  We extract
    # these from the open-text ROI lines collected above.
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
# Closed-vocab helper — text extraction from OCR lines
# ---------------------------------------------------------------------------


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
    """Extract closed-vocab evidence (build_class, position, x_factor_name, tier) for one bundle."""
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
                    subject_slot_key=bundle.slot_key,
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
            # Emit a low_quality sentinel when the vocab matcher had no result.
            out.append(
                FieldEvidenceRecord(
                    screen_state=SCREEN_STATE,
                    subject_slot_key=bundle.slot_key,
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

    # --- build_class (title band y≈110-175)
    title_text = _join_lines_in_band(ocr_lines, y_min=110.0, y_max=175.0, x_min=300.0, x_max=1400.0)
    records.extend(_cv_to_record(extractor.classify_build_class(title_text), "build_class"))

    # --- position (left strip, y 180-980, x < 130)
    pos_text = _join_lines_in_band(ocr_lines, y_min=180.0, y_max=980.0, x_min=0.0, x_max=130.0)
    records.extend(_cv_to_record(extractor.classify_position(pos_text), "position"))

    # --- x_factor names (3 slots; x_factor_name band is y≈310-430 with 3 column centres)
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

    # --- x_factor tier from image (HSV color sampling)
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
    """Propagate the bundle-level observability when it's worse than the field-level one.

    Priority (worst first): not_observable_from_source > obstructed > low_quality > observable
    """
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


def _ocr_line_from_dict(d: dict) -> OCRLine:
    """Reconstruct an OCRLine from a JSON dict (as serialized by Pass-2 output).

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
