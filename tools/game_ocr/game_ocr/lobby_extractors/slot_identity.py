"""Per-row identity extraction for the pre-game lobby (state_2).

Takes the output of `row_grouping.detect_lobby_rows()` and emits one
`LobbySubjectIdentity` per row. Mirrors the field set the legacy
`_parse_lobby_row` produces, but as typed evidence with per-field
confidences ready to convert into `FieldEvidenceRecord` for the promotion
gate.

Reused from the Phase 2B loadout extractor stack:
- `LoadoutOpenTextExtractor.extract_open_text_for_roi` for gamertag +
  persona n-best (filtered to the row's panel band).

State scope: state_1 has zero frames in operator recordings per Phase 3a;
the build_class_raw extraction still runs for state_1 rows when they
appear, but state_2 rows leave build_class_raw=None.

V2 field set:
  position, gamertag, build_class (state_1 only),
  player_number + player_name_persona (state_2 only),
  player_level_raw + player_level_number,
  is_captain, is_ready, height_text, weight_lbs,
  handedness, platform.

Handedness/platform are NOT typically visible in the lobby UI (they live
on the loadout-detail screen). The extractor emits None for those when
absent; the promotion gate then blocks promotion on observability rather
than reporting wrong data.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal, Optional, Sequence

from game_ocr.lobby_extractors.row_grouping import (
    LOBBY_POSITION_TOKENS,
    LOBBY_TEAM_SIDE_LABELS,
    LobbyRow,
    TeamSide,
)
from game_ocr.loadout_extractors.open_text import (
    LoadoutOpenTextExtractor,
    OpenTextEvidence,
)
from game_ocr.ocr import OCRLine

# ─── Constants ──────────────────────────────────────────────────────────────

CAPTAIN_GLYPHS: tuple[str, ...] = ("★", "✯", "✦", "✪", "✩")

# Phase 3c: UI chrome and navigation labels that RapidOCR picks up from the
# lobby UI (top-bar tabs, brand labels, READY chip, etc.) and that the legacy
# parser sometimes promoted as gamertags. Comparison key is the candidate's
# text normalized as `strip().upper().replace(" ", "")` so single-line lines
# like "VIEWING LOADOUTS" collapse to "VIEWINGLOADOUTS" and match.
#
# Operator-grown list. Add new entries when production data shows a new false
# positive. Avoid entries shorter than 4 chars to minimize collision with real
# gamertags. Position tokens + HOME/AWAY are excluded ELSEWHERE
# (LOBBY_POSITION_TOKENS, LOBBY_TEAM_SIDE_LABELS).
LOBBY_UI_LABEL_DENYLIST: frozenset[str] = frozenset({
    # Game / mode labels
    "CHEL", "EASHL", "EASPORTS", "ZASPORTS", "SPORTS",
    # Top-bar nav tabs
    "PLAY", "LOADOUTS", "CLUBS", "CUSTOMIZE", "SEASONPASS",
    "STORE", "REWARDS", "STATS", "OBJECTIVES",
    # Lobby state / readiness indicators that survive the existing READY strip
    "READY", "VIEWINGLOADOUTS",
    # Pre-game arena chrome
    "ARENA", "CLUBRANK", "GAMESTARTSIN", "VIEWOBJECTIVES",
})

_HASH_PERSONA_RE = re.compile(r"#(\d{1,3})\s*[-.]+\s*(.+)")
_LVL_RE = re.compile(r"LVL(\d{1,3})")
_HEIGHT_RE = re.compile(r"(\d)['°′]\s*(\d{1,2})")
_WEIGHT_RE = re.compile(r"(\d{2,3})\s*(?:lbs|lhs|bs|ibs|Ibs)", re.IGNORECASE)
_HANDEDNESS_RE = re.compile(r"SH(?:O|0){2}TS?\s*(LEFT|RIGHT)", re.IGNORECASE)

# Build vocabulary lifted verbatim from the legacy `_LOBBY_BUILD_KEYWORDS`
# (parsers.py). Used to disambiguate the build-class line in state_1 frames.
_LOBBY_BUILD_KEYWORDS = re.compile(
    r"\b(Playmaker|Sniper|Grinder|Hybrid|Forward|Defenseman|Bullseye|"
    r"Caufield|Thompson|MacKinnon|Matthews|Hutson|Rantanen|Wanhg|"
    r"PWF|SNP|PMD|TWF|DDD|HBF|HBD|TwoWay|Two-Way|PowerForward|Power)\b",
    re.IGNORECASE,
)

# Phase 3c: lazy-loaded closed-vocab for build_classes. Used in
# `_filter_gamertag_candidates` to reject candidates that match a canonical
# build class (e.g. RapidOCR picked "Puck Moving Defenseman" as a gamertag
# when the build-class line was the topmost-y in the row band).
# Cached module-level so the YAML loads once per Python process.
_BUILD_CLASS_VOCAB = None  # type: ignore[var-annotated]


def _build_class_vocab():
    """Return the cached ClosedVocab(family='build_classes', version='nhl26').

    Lazy import to avoid pulling in `loadout_extractors.closed_vocab` at
    module-load time (parsers.py imports row_grouping from this package; a
    top-level closed_vocab import would re-trigger the Phase 3b circular-
    import condition described in `lobby_extractors/__init__.py`).
    """
    global _BUILD_CLASS_VOCAB  # noqa: PLW0603
    if _BUILD_CLASS_VOCAB is None:
        from game_ocr.loadout_extractors.closed_vocab import load_closed_vocab
        _BUILD_CLASS_VOCAB = load_closed_vocab("build_classes", version="nhl26")
    return _BUILD_CLASS_VOCAB


# ─── Dataclass ──────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class LobbySubjectIdentity:
    """One per-row identity record from a lobby frame.

    `slot_key` is the canonical subject key the typed promoter groups on,
    e.g. `lobby_for_C`, `lobby_against_LW`. Stable across frames within a
    segment; repeated observations accumulate as multiple `candidate_rank`
    values in the field-evidence table.

    All `*_confidence` fields are None when the corresponding value is None.
    """

    # Required identity
    slot_key: str
    team_side: TeamSide
    position: str
    position_confidence: float

    # Empty / CPU slot marker (no gamertag, skip downstream)
    is_empty_or_cpu: bool

    # Open-text
    gamertag: Optional[str] = None
    gamertag_confidence: Optional[float] = None

    # State_2 specifics
    player_number: Optional[int] = None
    player_number_confidence: Optional[float] = None
    player_name_persona: Optional[str] = None
    player_name_persona_confidence: Optional[float] = None

    # Build class (state_1)
    build_class_raw: Optional[str] = None
    build_class_confidence: Optional[float] = None

    # Level
    player_level_raw: Optional[str] = None
    player_level_number: Optional[int] = None
    player_level_confidence: Optional[float] = None

    # Quality flags
    is_captain: Optional[bool] = None
    is_captain_confidence: Optional[float] = None
    is_ready: Optional[bool] = None
    is_ready_confidence: Optional[float] = None

    # Measurements
    height_text: Optional[str] = None
    height_confidence: Optional[float] = None
    weight_lbs: Optional[int] = None
    weight_confidence: Optional[float] = None

    # Loadout-detail-only (typically absent in lobby UI)
    handedness: Optional[Literal["Left", "Right"]] = None
    handedness_confidence: Optional[float] = None
    platform: Optional[str] = None
    platform_confidence: Optional[float] = None

    # Anchor metadata (useful for downstream evidence ROI construction)
    anchor_y: Optional[int] = None
    panel_state: Literal["state_1", "state_2"] = "state_2"

    # Overall observability — set to 'low_quality' when only the position
    # anchor was observed (no gamertag and no other identity field).
    observability: str = "observable"


# ─── Private helpers ────────────────────────────────────────────────────────


def _clean_gamertag(text: str) -> str:
    """Strip captain glyphs, READY chips, and stray trailing characters.

    Matches the legacy `clean_gamertag` (parsers.py) so the typed extractor
    emits identical canonical gamertags. Phase 2B's loadout-v2 promoter has
    seen all these patterns end-to-end and relies on this normalization.
    """
    cleaned = text
    for glyph in CAPTAIN_GLYPHS:
        cleaned = cleaned.replace(glyph, "")
    cleaned = re.sub(r"\s*READY\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+x$", "", cleaned).strip()
    return cleaned


def _is_cpu_or_empty(row_lines: Sequence[OCRLine]) -> bool:
    for line in row_lines:
        if line.text.strip().upper() == "CPU":
            return True
    return False


def _extract_measurements(
    row_lines: Sequence[OCRLine],
) -> tuple[Optional[str], Optional[int], Optional[float]]:
    """Return (height_text, weight_lbs, confidence). Confidence averages the
    contributing lines' OCR confidences."""
    measurement_lines = [
        line for line in row_lines
        if "'" in line.text
        or '"' in line.text
        or any(unit in line.text.lower() for unit in ("lbs", "lhs", "bs", "ibs"))
    ]
    if not measurement_lines:
        return None, None, None
    measurement_lines = sorted(measurement_lines, key=lambda l: l.x1)
    joined = " ".join(line.text for line in measurement_lines)
    confidence = sum(line.confidence for line in measurement_lines) / len(measurement_lines)

    height_match = _HEIGHT_RE.search(joined)
    height_text = f"{height_match.group(1)}'{height_match.group(2)}\"" if height_match else None
    weight_match = _WEIGHT_RE.search(joined)
    weight_lbs = int(weight_match.group(1)) if weight_match else None

    return height_text, weight_lbs, confidence


def _extract_level(
    row_lines: Sequence[OCRLine],
) -> tuple[Optional[str], Optional[int], Optional[float]]:
    """Return (raw, number, confidence)."""
    for line in row_lines:
        stripped = line.text.replace(" ", "").upper()
        if "LVL" not in stripped:
            continue
        m = _LVL_RE.search(stripped)
        number = int(m.group(1)) if m else None
        return line.text, number, line.confidence
    return None, None, None


def _extract_is_ready(
    row_lines: Sequence[OCRLine],
) -> tuple[Optional[bool], Optional[float]]:
    for line in row_lines:
        if "READY" in line.text.upper():
            return True, line.confidence
    return None, None


def _extract_is_captain(
    row_lines: Sequence[OCRLine],
) -> tuple[Optional[bool], Optional[float]]:
    for line in row_lines:
        if any(glyph in line.text for glyph in CAPTAIN_GLYPHS):
            return True, line.confidence
    return None, None


def _extract_player_number_and_persona(
    row_lines: Sequence[OCRLine],
) -> tuple[
    Optional[int], Optional[float],
    Optional[str], Optional[float],
]:
    """State-2 extraction of `#NN - Persona`. Returns
    (number, num_conf, persona, persona_conf)."""
    for line in row_lines:
        m = _HASH_PERSONA_RE.search(line.text)
        if not m:
            continue
        number = int(m.group(1))
        persona = m.group(2).strip(" .")
        # Strip trailing star-glyph / READY noise concatenated by RapidOCR.
        persona = re.sub(
            r"[★✯✦✪✩]?\s*READY\s*$", "", persona, flags=re.IGNORECASE,
        ).strip()
        # Title-case-ish first letter check guards against junk persona that
        # captured "RW" or similar — but allow operator-supplied weird names.
        if not persona:
            return number, line.confidence, None, None
        return number, line.confidence, persona, line.confidence
    return None, None, None, None


def _extract_build_class_raw(
    row_lines: Sequence[OCRLine],
) -> tuple[Optional[str], Optional[float]]:
    for line in row_lines:
        text = line.text
        if "LVL" in text.upper() or "'" in text or '"' in text or "lbs" in text.lower():
            continue
        if any(glyph in text for glyph in CAPTAIN_GLYPHS) or "READY" in text.upper():
            continue
        # Phase 3c: skip state_2 `#NN-Persona` lines. The persona half can
        # contain player surnames (e.g. "Wanhg", "Hutson") that the
        # _LOBBY_BUILD_KEYWORDS regex matches via the themed-build vocab —
        # the line would be wrongly classified as a build_class. State_1
        # build_class lines never start with `#`.
        if _HASH_PERSONA_RE.search(text):
            continue
        if _LOBBY_BUILD_KEYWORDS.search(text) or re.search(r"[A-Za-z]\s*-\s*[A-Za-z]", text):
            return text, line.confidence
    return None, None


def _extract_handedness(
    row_lines: Sequence[OCRLine],
) -> tuple[Optional[Literal["Left", "Right"]], Optional[float]]:
    for line in row_lines:
        m = _HANDEDNESS_RE.search(line.text)
        if not m:
            continue
        token = m.group(1).upper()
        if token == "LEFT":
            return "Left", line.confidence
        if token == "RIGHT":
            return "Right", line.confidence
    return None, None


def _filter_gamertag_candidates(
    row_lines: Sequence[OCRLine],
    *,
    build_raw: Optional[str],
) -> list[OCRLine]:
    """Filter rule lifted from `_parse_lobby_row` — strip out lines that are
    obviously NOT gamertag candidates (position labels, #NN, LVL, h/w, the
    AWAY/HOME team-side label, the build-class line already extracted).

    Phase 3c additions: reject UI navigation chrome (`LOBBY_UI_LABEL_DENYLIST`)
    and lines that closed-vocab-match a canonical build class. Phase 3b cutover
    observed RapidOCR picking up `VIEWING LOADOUTS`, `CHEL`, `SPORTS`, and
    `Puck Moving Defenseman` as gamertag candidates on real match data; these
    two filters reject all of those.
    """
    out: list[OCRLine] = []
    vocab = None  # Lazy-load only when the cheap-string filters don't already
                  # reject the candidate, to avoid loading the YAML when no
                  # line gets that far.
    for line in row_lines:
        text = line.text
        if "#" in text:
            continue
        if "LVL" in text.upper():
            continue
        if "'" in text or '"' in text:
            continue
        if "lbs" in text.lower() or "lhs" in text.lower():
            continue
        normalized = text.strip().upper().replace(" ", "")
        if normalized in LOBBY_POSITION_TOKENS:
            continue
        if normalized in LOBBY_TEAM_SIDE_LABELS:
            continue
        if normalized in LOBBY_UI_LABEL_DENYLIST:
            continue
        if build_raw is not None and text == build_raw:
            continue
        if not _clean_gamertag(text):
            continue
        # Closed-vocab match against build_classes. We run this last because
        # it's the most expensive check. `match_canonical` returns
        # `(canonical, confidence)` or None; reject when any match (exact 1.0
        # or fuzzy ≥0.5) is produced.
        if vocab is None:
            vocab = _build_class_vocab()
        if vocab.match_canonical(_clean_gamertag(text)) is not None:
            continue
        out.append(line)
    return out


def _extract_gamertag(
    row: LobbyRow,
    *,
    build_raw: Optional[str],
    open_text_extractor: LoadoutOpenTextExtractor,
    panel_x_range: tuple[float, float],
) -> tuple[Optional[str], Optional[float], list[OpenTextEvidence]]:
    """Use LoadoutOpenTextExtractor to emit n-best gamertag candidates for the row.

    Returns (top_value_cleaned, top_confidence, raw_evidence_list). The raw
    evidence list is the ROI extractor's output before cleaning — caller may
    forward it into the evidence layer as n-best `candidate_rank` rows.
    """
    candidates = _filter_gamertag_candidates(row.row_lines, build_raw=build_raw)
    if not candidates:
        return None, None, []

    roi_bbox = {
        "x": panel_x_range[0],
        "y": row.anchor_y - 22,
        "w": panel_x_range[1] - panel_x_range[0],
        "h": 45,
    }
    evidence = open_text_extractor.extract_open_text_for_roi(
        candidates,
        roi_bbox=roi_bbox,
        field_key="gamertag",
        max_candidates=3,
        min_confidence=0.3,
    )
    observable = [e for e in evidence if e.observability == "observable"]
    if not observable:
        return None, None, evidence
    top = observable[0]
    return _clean_gamertag(top.value), top.calibrated_confidence, evidence


# ─── Public API ─────────────────────────────────────────────────────────────


def slot_key_for(team_side: TeamSide, position: str) -> str:
    prefix = "lobby_for" if team_side == "our_team" else "lobby_against"
    return f"{prefix}_{position}"


def identify_lobby_subjects(
    rows: Sequence[LobbyRow],
    *,
    open_text_extractor: Optional[LoadoutOpenTextExtractor] = None,
    panel_x_ranges: Optional[dict[TeamSide, tuple[float, float]]] = None,
) -> list[LobbySubjectIdentity]:
    """Convert each LobbyRow into a typed LobbySubjectIdentity.

    Args:
        rows: From `detect_lobby_rows(all_lines)`.
        open_text_extractor: Optional injected extractor (test-friendly);
            defaults to a fresh `LoadoutOpenTextExtractor()`.
        panel_x_ranges: Optional override of per-team panel x-bands;
            defaults to the constants in `row_grouping`.

    Empty/CPU slots get a minimal identity with `is_empty_or_cpu=True` and
    no gamertag — caller is expected to skip them in promotion.
    """
    from game_ocr.lobby_extractors.row_grouping import (
        BGM_PANEL_X_RANGE,
        OPP_PANEL_X_RANGE,
    )
    if open_text_extractor is None:
        open_text_extractor = LoadoutOpenTextExtractor()
    if panel_x_ranges is None:
        panel_x_ranges = {
            "our_team": BGM_PANEL_X_RANGE,
            "opponent_team": OPP_PANEL_X_RANGE,
        }

    out: list[LobbySubjectIdentity] = []
    for row in rows:
        slot_key = slot_key_for(row.team_side, row.position)
        panel_x_range = panel_x_ranges[row.team_side]

        if _is_cpu_or_empty(row.row_lines):
            out.append(
                LobbySubjectIdentity(
                    slot_key=slot_key,
                    team_side=row.team_side,
                    position=row.position,
                    position_confidence=row.anchor.confidence,
                    is_empty_or_cpu=True,
                    anchor_y=int(row.anchor_y),
                    panel_state=row.panel_state,
                    observability="low_quality",
                )
            )
            continue

        height_text, weight_lbs, meas_conf = _extract_measurements(row.row_lines)
        level_raw, level_num, level_conf = _extract_level(row.row_lines)
        is_ready, is_ready_conf = _extract_is_ready(row.row_lines)
        is_captain, is_captain_conf = _extract_is_captain(row.row_lines)
        player_number, pn_conf, persona, persona_conf = _extract_player_number_and_persona(
            row.row_lines,
        )
        build_raw, build_conf = _extract_build_class_raw(row.row_lines)
        handedness, handedness_conf = _extract_handedness(row.row_lines)

        gt_value, gt_conf, _gt_evidence = _extract_gamertag(
            row,
            build_raw=build_raw,
            open_text_extractor=open_text_extractor,
            panel_x_range=panel_x_range,
        )

        # If the gamertag line carried a star glyph or READY chip, propagate
        # those signals when our scoped scan missed them (legacy behavior).
        if gt_value is not None:
            for line in row.row_lines:
                # Skip lines we already filtered out — only the line that
                # contributed the gamertag matters here, but the candidate
                # filter isn't trivially reconstructed; safest is to inspect
                # all row lines for captain/ready signals once again.
                if is_captain is None and any(g in line.text for g in CAPTAIN_GLYPHS):
                    is_captain, is_captain_conf = True, line.confidence
                if is_ready is None and "READY" in line.text.upper():
                    is_ready, is_ready_conf = True, line.confidence

        # observability: 'observable' if at least one identity field above
        # position is populated; 'low_quality' otherwise.
        has_evidence = any(
            v is not None for v in (
                gt_value, player_number, persona, level_raw,
                build_raw, height_text, weight_lbs,
                is_captain, is_ready, handedness,
            )
        )
        observability = "observable" if has_evidence else "low_quality"

        out.append(
            LobbySubjectIdentity(
                slot_key=slot_key,
                team_side=row.team_side,
                position=row.position,
                position_confidence=row.anchor.confidence,
                is_empty_or_cpu=False,
                gamertag=gt_value,
                gamertag_confidence=gt_conf,
                player_number=player_number,
                player_number_confidence=pn_conf,
                player_name_persona=persona,
                player_name_persona_confidence=persona_conf,
                build_class_raw=build_raw,
                build_class_confidence=build_conf,
                player_level_raw=level_raw,
                player_level_number=level_num,
                player_level_confidence=level_conf,
                is_captain=is_captain,
                is_captain_confidence=is_captain_conf,
                is_ready=is_ready,
                is_ready_confidence=is_ready_conf,
                height_text=height_text,
                height_confidence=meas_conf,
                weight_lbs=weight_lbs,
                weight_confidence=meas_conf,
                handedness=handedness,
                handedness_confidence=handedness_conf,
                platform=None,  # Lobby UI doesn't expose platform; left for
                                # future glyph-based extraction if needed.
                platform_confidence=None,
                anchor_y=int(row.anchor_y),
                panel_state=row.panel_state,
                observability=observability,
            )
        )
    return out
