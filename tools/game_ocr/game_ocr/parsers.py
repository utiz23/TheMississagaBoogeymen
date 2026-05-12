from __future__ import annotations

import re
from statistics import mean

from game_ocr.models import (
    ActionTrackerEvent,
    AttributeGroup,
    BoxScorePeriodCell,
    EventRow,
    ExtractionField,
    FaceoffSideStats,
    FieldStatus,
    NetChartSideStats,
    PlayerSlot,
    PlayerLoadoutResult,
    PostGameActionTrackerResult,
    PostGameBoxScoreResult,
    PostGameEventsResult,
    PostGameFaceoffMapResult,
    PostGameNetChartResult,
    PostGamePlayerRecord,
    PostGamePlayerSummaryResult,
    PreGameLobbyResult,
    TeamSummary,
)
from game_ocr.ocr import OCRLine
from game_ocr.utils import normalize_text, parse_int, parse_percentage, split_height_weight


def field_from_lines(lines: list[OCRLine], *, parser=None, raw_override: str | None = None) -> ExtractionField:
    if not lines and not raw_override:
        return ExtractionField(status=FieldStatus.MISSING)
    raw = raw_override if raw_override is not None else " ".join(line.text for line in lines)
    raw = normalize_text(raw)
    confidence = mean([line.confidence for line in lines]) if lines else None
    value = parser(raw) if parser else raw or None
    if value is None and raw:
        status = FieldStatus.UNCERTAIN
    elif value is None:
        status = FieldStatus.MISSING
    elif confidence is not None and confidence < 0.72:
        status = FieldStatus.UNCERTAIN
    else:
        status = FieldStatus.OK
    return ExtractionField(raw_text=raw or None, value=value, confidence=confidence, status=status)


def enum_parser(options: set[str]):
    def parse(text: str) -> str | None:
        cleaned = normalize_text(text).upper()
        for option in options:
            if option in cleaned:
                return option
        return cleaned or None

    return parse


def average_confidence(fields: list[ExtractionField]) -> float | None:
    values = [field.confidence for field in fields if field.confidence is not None]
    return round(mean(values), 4) if values else None


# ─── Pre-game lobby: anchor-based full-frame parser ──────────────────────────
#
# The lobby shows both teams' 6-player rosters side-by-side. Each player card
# alternates between two visual states (state_1 = build class visible;
# state_2 = #N + persona name visible). The two teams alternate INDEPENDENTLY,
# so a single capture can have one team in each state.
#
# Strategy mirrors the loadout parser:
#   1. RapidOCR runs once on the full 1920x1080 frame.
#   2. Position labels (C/LW/RW/LD/RD/G) at the panel edges anchor each row:
#      - BGM (our team): position labels at x_center ~77
#      - Opp:            position labels at x_center ~1844
#   3. Within each row band (±45 px of anchor y), classify lines by text
#      pattern + x-range relative to the anchor.
#   4. Detect per-team state by counting `#NN` patterns in the panel.

_LOBBY_POSITION_TOKENS = {"C", "LW", "RW", "LD", "RD", "G"}
# Build vocabulary for state-1 detection / build-class extraction. Includes both
# generic builds ("Playmaker", "Sniper", ...) and themed-build keywords seen in V2.
_LOBBY_BUILD_KEYWORDS = re.compile(
    r"\b(Playmaker|Sniper|Grinder|Hybrid|Forward|Defenseman|Bullseye|"
    r"Caufield|Thompson|MacKinnon|Matthews|Hutson|Rantanen|Wanhg|"
    r"PWF|SNP|PMD|TWF|DDD|HBF|HBD|TwoWay|Two-Way|PowerForward|Power)\b",
    re.IGNORECASE,
)
_LOBBY_HASH_RE = re.compile(r"#\d{1,3}")


_LOBBY_CANONICAL_ROW_ORDER = ["C", "LW", "RW", "LD", "RD", "G"]


def _fill_missing_position_anchors(detected: list[OCRLine]) -> list[OCRLine]:
    """Synthesize anchors for rows whose position label RapidOCR failed to read.

    The lobby panel has 6 rows in canonical order C / LW / RW / LD / RD / G with
    a stable ~88 px y-gap between rows. Single-character position labels (notably
    'C') sometimes don't get tokenized by the OCR backend even when the row is
    fully visible. When that happens, we infer the missing anchor's y by
    extrapolating from the detected anchors' median gap, and synthesize an
    OCRLine with the correct position text and the inferred y_center.

    Returns the (possibly-augmented) anchor list, sorted by y_center, in canonical
    row order.
    """
    if not detected:
        return []
    detected_set = {a.text.strip().upper().replace(" ", "") for a in detected}
    # Median gap between adjacent detected anchors (fallback 88 px).
    gaps = [
        detected[i + 1].y_center - detected[i].y_center
        for i in range(len(detected) - 1)
    ]
    median_gap = sorted(gaps)[len(gaps) // 2] if gaps else 88.0
    # Detected position → canonical index lookup.
    canonical_index = {pos: i for i, pos in enumerate(_LOBBY_CANONICAL_ROW_ORDER)}
    # Anchor with the smallest canonical index that we DID detect → use it as the
    # reference for back-fill / forward-fill.
    anchored = sorted(detected, key=lambda l: canonical_index.get(l.text.strip().upper().replace(" ", ""), 999))
    ref = anchored[0]
    ref_idx = canonical_index.get(ref.text.strip().upper().replace(" ", ""), 0)

    result: list[OCRLine] = []
    for i, pos in enumerate(_LOBBY_CANONICAL_ROW_ORDER):
        if pos in detected_set:
            # Use the real detected line.
            real = next(l for l in detected if l.text.strip().upper().replace(" ", "") == pos)
            result.append(real)
            continue
        # Synthesize: y_center = ref.y_center + (i - ref_idx) * median_gap.
        synth_y = ref.y_center + (i - ref_idx) * median_gap
        result.append(
            OCRLine(
                text=pos,
                confidence=0.0,  # synthetic — downstream can downweight if needed
                x1=ref.x1, x2=ref.x2,
                y1=synth_y - 12, y2=synth_y + 12,
            )
        )
    result.sort(key=lambda l: l.y_center)
    # Only keep anchors that fall within the panel's vertical range.
    return [l for l in result if 250 < l.y_center < 980]


def _detect_panel_state(panel_lines: list[OCRLine]) -> str:
    """Per-team state detection by `#NN` pattern count.

    State 2 ('identity state') shows `#11 - E. Wanhg` style rows for every player.
    State 1 ('class state') shows build class names instead. >= 3 hash patterns →
    state_2; otherwise state_1. With 5 skater rows on each team in a 6v6 lobby, a
    fully-rendered state_2 panel emits 5 hash patterns; partial captures emit fewer.
    """
    joined = " ".join(l.text for l in panel_lines)
    n_hash = len(_LOBBY_HASH_RE.findall(joined))
    return "state_2" if n_hash >= 3 else "state_1"


def parse_lobby_team(
    all_lines: list[OCRLine],
    *,
    panel_x_range: tuple[float, float],
    anchor_x_max: float | None = None,
    anchor_x_min: float | None = None,
) -> TeamSummary:
    """Parse a single team panel from full-frame OCR lines.

    panel_x_range: x-band of the panel's data lines (gamertag, build, level, etc.).
    anchor_x_max: position labels are at x_center < this value (BGM panel: ~130).
    anchor_x_min: position labels are at x_center > this value (Opp panel: ~1820).
    Exactly one of anchor_x_min / anchor_x_max must be set.

    Returns a TeamSummary with one PlayerSlot per detected position-label anchor,
    plus the detected per-team state.
    """
    if (anchor_x_max is None) == (anchor_x_min is None):
        raise ValueError("Provide exactly one of anchor_x_min or anchor_x_max")

    # Find position-label anchors. Each anchor's y_center is the row centre.
    detected_anchors: list[OCRLine] = []
    for line in all_lines:
        if line.text.strip().upper().replace(" ", "") not in _LOBBY_POSITION_TOKENS:
            continue
        if not (250 < line.y_center < 980):
            continue
        if anchor_x_max is not None and line.x_center > anchor_x_max:
            continue
        if anchor_x_min is not None and line.x_center < anchor_x_min:
            continue
        detected_anchors.append(line)
    detected_anchors.sort(key=lambda l: l.y_center)
    anchors = _fill_missing_position_anchors(detected_anchors)

    # Panel content lines for state detection (everything in the data x-band).
    panel_lines = [
        l for l in all_lines
        if panel_x_range[0] <= l.x_center <= panel_x_range[1] and 250 < l.y_center < 980
    ]
    state = _detect_panel_state(panel_lines)

    roster: list[PlayerSlot] = []
    for idx, anchor in enumerate(anchors, start=1):
        # Row content sits within ±45 px of anchor.y_center, restricted to the
        # data x-band so we don't accidentally pull text from the opposite team.
        row_lines = [
            l for l in all_lines
            if abs(l.y_center - anchor.y_center) < 45
            and panel_x_range[0] <= l.x_center <= panel_x_range[1]
        ]
        fields = _parse_lobby_row(anchor, row_lines, state)
        roster.append(
            PlayerSlot(
                slot_index=idx,
                raw_lines=[anchor.text] + [l.text for l in row_lines],
                fields=fields,
            )
        )
    return TeamSummary(
        roster=roster,
        raw_lines=[l.text for l in panel_lines],
        state=state,
    )


def _parse_lobby_row(anchor: OCRLine, row_lines: list[OCRLine], state: str) -> dict[str, ExtractionField]:
    """Classify the OCR lines within one player row into structured fields."""
    fields: dict[str, ExtractionField] = {
        "position": ExtractionField(
            raw_text=anchor.text,
            value=anchor.text.strip().upper().replace(" ", ""),
            confidence=anchor.confidence,
            status=FieldStatus.OK,
        ),
        "empty_or_cpu": ExtractionField(status=FieldStatus.MISSING),
        "gamertag": ExtractionField(status=FieldStatus.MISSING),
        "level": ExtractionField(status=FieldStatus.MISSING),
        "build": ExtractionField(status=FieldStatus.MISSING),
        "raw_measurements": ExtractionField(status=FieldStatus.MISSING),
        "is_captain": ExtractionField(status=FieldStatus.MISSING),
        "is_ready": ExtractionField(status=FieldStatus.MISSING),
        "player_number": ExtractionField(status=FieldStatus.MISSING),
        "player_name": ExtractionField(status=FieldStatus.MISSING),
    }
    captain_glyphs = {"★", "✯", "✦", "✪", "✩"}

    # CPU detection: any line in the row whose text contains 'CPU' → mark and bail.
    for line in row_lines:
        if line.text.strip().upper() == "CPU":
            fields["empty_or_cpu"] = ExtractionField(
                raw_text="CPU", value="CPU", confidence=line.confidence, status=FieldStatus.OK
            )
            return fields

    # Measurements (height/weight): contains `'` or `"` or `lbs`/`lhs`/`bs`.
    measurement_lines = [
        l for l in row_lines
        if "'" in l.text or '"' in l.text or any(unit in l.text.lower() for unit in ("lbs", "lhs", "bs"))
    ]
    if measurement_lines:
        joined = " ".join(l.text for l in sorted(measurement_lines, key=lambda l: l.x1))
        confidence = mean([l.confidence for l in measurement_lines])
        fields["raw_measurements"] = ExtractionField(
            raw_text=joined, value=joined, confidence=confidence, status=FieldStatus.OK
        )

    # Level: contains 'LVL' (e.g. P1LVL17, P2 LVL34, LVL34).
    for line in row_lines:
        stripped = line.text.replace(" ", "").upper()
        if "LVL" in stripped:
            m = re.search(r"LVL(\d{1,3})", stripped)
            fields["level"] = ExtractionField(
                raw_text=line.text,
                value=int(m.group(1)) if m else None,
                confidence=line.confidence,
                status=FieldStatus.OK if m else FieldStatus.UNCERTAIN,
            )
            break

    # READY indicator: text contains 'READY' (case-insensitive).
    for line in row_lines:
        if "READY" in line.text.upper():
            fields["is_ready"] = ExtractionField(
                raw_text=line.text, value=True, confidence=line.confidence, status=FieldStatus.OK
            )
            break

    # Captain ★ glyph: appears either as its own OCR line or concatenated into
    # the gamertag line (e.g. "XZ4RKY★READY").
    for line in row_lines:
        if any(g in line.text for g in captain_glyphs):
            fields["is_captain"] = ExtractionField(
                raw_text=line.text, value=True, confidence=line.confidence, status=FieldStatus.OK
            )
            break

    # State 2: pull #N + persona name from the line that matches `#NN-Name`.
    if state == "state_2":
        for line in row_lines:
            m = re.search(r"#(\d{1,3})\s*[-.]+\s*(.+)", line.text)
            if not m:
                continue
            fields["player_number"] = ExtractionField(
                raw_text=line.text, value=int(m.group(1)), confidence=line.confidence, status=FieldStatus.OK
            )
            persona = m.group(2).strip(" .")
            # Strip trailing ★READY / READY noise if it concatenated into the line.
            persona = re.sub(r"[★✯✦✪✩]?\s*READY\s*$", "", persona, flags=re.IGNORECASE).strip()
            fields["player_name"] = ExtractionField(
                raw_text=line.text, value=persona, confidence=line.confidence, status=FieldStatus.OK
            )
            break

    # State 1: build class — any non-level / non-measurement / non-gamertag line
    # whose content matches the build vocabulary OR contains a hyphen (themed
    # builds like "Tage Thompson - PWF" / "Cole Caufield - SNP").
    if state == "state_1":
        for line in row_lines:
            text = line.text
            if "LVL" in text.upper() or "'" in text or '"' in text or "lbs" in text.lower():
                continue
            if any(g in text for g in captain_glyphs) or "READY" in text.upper():
                continue
            # Build keyword present OR contains " - " / "-" between words (themed build).
            if _LOBBY_BUILD_KEYWORDS.search(text) or re.search(r"[A-Za-z]\s*-\s*[A-Za-z]", text):
                fields["build"] = ExtractionField(
                    raw_text=text, value=text, confidence=line.confidence, status=FieldStatus.OK
                )
                break

    # Gamertag: typically the TOP-MOST text line in the row (smallest y_center).
    # RapidOCR sometimes concatenates the captain ★ glyph and the READY indicator
    # into the gamertag line (e.g. "XZ4RKY★READY"). Include those lines as
    # candidates and strip the noise during normalisation.
    gt_candidates = [
        l for l in row_lines
        if "#" not in l.text
        and "LVL" not in l.text.upper()
        and "'" not in l.text
        and '"' not in l.text
        and "lbs" not in l.text.lower()
        and "lhs" not in l.text.lower()
        and l.text.strip().upper().replace(" ", "") not in _LOBBY_POSITION_TOKENS
        # Reject the build-class line if we already extracted it (avoid picking
        # "Two-Way Forward" as a gamertag when the actual gamertag is "XZ4RKY★READY").
        and (fields["build"].status == FieldStatus.MISSING or l.text != fields["build"].raw_text)
    ]
    def clean_gamertag(text: str) -> str:
        cleaned = text
        for g in captain_glyphs:
            cleaned = cleaned.replace(g, "")
        cleaned = re.sub(r"\s*READY\s*", "", cleaned, flags=re.IGNORECASE)
        # RapidOCR sometimes emits a stray trailing 'x' for the READY chip remnant.
        cleaned = re.sub(r"\s+x$", "", cleaned).strip()
        return cleaned

    # Rank candidates by (y_center ascending, cleaned-text length descending).
    # When the row's top y has multiple OCR tokens (e.g. READY chip + gamertag
    # both at the same y), the longer cleaned string wins.
    scored = [(l.y_center, -len(clean_gamertag(l.text)), l) for l in gt_candidates if clean_gamertag(l.text)]
    if scored:
        scored.sort()
        top = scored[0][2]
        cleaned = clean_gamertag(top.text)
        fields["gamertag"] = ExtractionField(
            raw_text=top.text, value=cleaned, confidence=top.confidence, status=FieldStatus.OK
        )
        # If captain glyph or READY indicator was concatenated to the gamertag,
        # also mark those signals from this line.
        if fields["is_captain"].status == FieldStatus.MISSING and any(g in top.text for g in captain_glyphs):
            fields["is_captain"] = ExtractionField(
                raw_text=top.text, value=True, confidence=top.confidence, status=FieldStatus.OK
            )
        if fields["is_ready"].status == FieldStatus.MISSING and "READY" in top.text.upper():
            fields["is_ready"] = ExtractionField(
                raw_text=top.text, value=True, confidence=top.confidence, status=FieldStatus.OK
            )

    return fields


def parse_pre_game_result(meta, regions: dict[str, list[OCRLine]], include_player_name: bool, **_kwargs) -> PreGameLobbyResult:
    """Parse a single lobby capture. The `include_player_name` arg is now a no-op:
    state detection is automatic per team via `#NN` regex count. Kept for backward
    compatibility with the extractor registry."""
    lines: list[OCRLine] = regions.get("full_frame", [])

    # ── Anchor: game mode (top-left, e.g. "EASHL 6v6") ──
    gm_band = [l for l in lines if 110 < l.y_center < 160 and l.x_center < 350]
    # Game mode is typically a "<n>v<n>" pattern; capture the line with the digit.
    game_mode_line = next(
        (l for l in gm_band if re.search(r"\d+\s*[vV]\s*\d+", l.text)),
        max(gm_band, key=lambda l: l.x2 - l.x1, default=None) if gm_band else None,
    )
    game_mode_field = (
        field_from_lines([game_mode_line]) if game_mode_line else ExtractionField(status=FieldStatus.MISSING)
    )

    # ── Anchor: team name headers (y ~211; our left, opp right) ──
    our_team_line = max(
        (l for l in lines if 180 < l.y_center < 240 and l.x_center < 700),
        key=lambda l: l.x2 - l.x1,
        default=None,
    )
    opp_team_line = max(
        (l for l in lines if 180 < l.y_center < 240 and l.x_center > 1400),
        key=lambda l: l.x2 - l.x1,
        default=None,
    )
    our_team_name_field = (
        field_from_lines([our_team_line]) if our_team_line else ExtractionField(status=FieldStatus.MISSING)
    )
    opp_team_name_field = (
        field_from_lines([opp_team_line]) if opp_team_line else ExtractionField(status=FieldStatus.MISSING)
    )

    # ── Per-team panel parse ──
    our_team = parse_lobby_team(
        lines,
        panel_x_range=(85, 410),
        anchor_x_max=130,  # BGM position labels at far left (x_center ~77)
    )
    opp_team = parse_lobby_team(
        lines,
        panel_x_range=(1500, 1825),
        anchor_x_min=1820,  # Opp position labels at far right (x_center ~1844)
    )

    return PreGameLobbyResult(
        meta=meta,
        game_mode=game_mode_field,
        our_team_name=our_team_name_field,
        opponent_team_name=opp_team_name_field,
        our_team=our_team,
        opponent_team=opp_team,
    )


# ─── Loadout view: anchor-based full-frame parser ────────────────────────────
#
# Replaces the previous per-ROI approach that had ROIs misaligned (gamertag
# pointed at the LEFT-STRIP avatar; build_class clipped half the title; each
# attribute ROI captured 1 of 5 rows). See docs/ocr/pre-game-extraction-research.md
# for the full diagnosis. New approach:
#   1. RapidOCR runs once on the full 1920x1080 frame.
#   2. Locate stable anchors (column headers, X-FACTORS header, etc.).
#   3. Snap OCR lines into the implied 5-column × 4-or-5-row attribute grid.
#   4. Sample HSV at fixed X-Factor icon centroids to classify tier.

_LOADOUT_ATTR_GROUPS = ["technique", "power", "playstyle", "tenacity", "tactics"]
_LOADOUT_ATTRS_PER_GROUP = {
    "technique": ["wrist_shot_accuracy", "slap_shot_accuracy", "speed", "balance", "agility"],
    "power": ["wrist_shot_power", "slap_shot_power", "acceleration", "puck_control", "endurance"],
    "playstyle": ["passing", "offensive_awareness", "body_checking", "stick_checking", "defensive_awareness"],
    "tenacity": ["hand_eye", "strength", "durability", "shot_blocking"],
    "tactics": ["deking", "faceoffs", "discipline", "fighting_skill"],
}
# Empirical row y-centres for the attribute grid, observed across all 11
# match-250 loadout captures (vlcsnap-2026-05-10-01h48m53s424.png onward).
_LOADOUT_ATTR_ROW_YS = [598, 656, 714, 771, 830]
# Empirical X-Factor icon centroids (validated 18/18 in xfactor_tier_spike.py).
_LOADOUT_XFACTOR_ICON_CENTROIDS = [(500, 340), (1000, 340), (1500, 340)]
_LOADOUT_XFACTOR_ICON_RADIUS = 35


def _classify_xfactor_tier(image, cx: int, cy: int, radius: int = _LOADOUT_XFACTOR_ICON_RADIUS) -> str | None:
    """HSV-sample at fixed icon centroid; classify tier by hue cluster.

    Returns 'Elite' (red), 'All Star' (blue), 'Specialist' (yellow), or None
    when there's no saturated icon at that location (transitional capture).
    Verified 100% accuracy on 18/18 non-transitional match-250 captures.
    """
    import cv2  # local import to avoid circular at module load
    import numpy as np

    if image is None:
        return None
    h, w = image.shape[:2]
    x1, x2 = max(0, cx - radius), min(w, cx + radius)
    y1, y2 = max(0, cy - radius), min(h, cy + radius)
    patch = image[y1:y2, x1:x2]
    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
    pixels = hsv.reshape(-1, 3)
    mask = (pixels[:, 1] > 100) & (pixels[:, 2] > 60)
    if int(mask.sum()) < 50:
        return None  # transitional capture: icon not rendered yet
    sat = pixels[mask]
    hues = sat[:, 0].astype(np.float64) * (2 * np.pi / 180)
    mean_h = (np.arctan2(np.mean(np.sin(hues)), np.mean(np.cos(hues))) * 180 / (2 * np.pi)) % 180
    if mean_h <= 15 or mean_h >= 165:
        return "Elite"
    if 95 <= mean_h <= 135:
        return "All Star"
    if 15 < mean_h < 35:
        return "Specialist"
    return None


def _lines_in_bbox(lines: list[OCRLine], y_range: tuple[float, float], x_range: tuple[float, float] | None = None) -> list[OCRLine]:
    ymin, ymax = y_range
    out = [l for l in lines if ymin <= l.y_center <= ymax]
    if x_range is not None:
        xmin, xmax = x_range
        out = [l for l in out if xmin <= l.x_center <= xmax]
    return out


def _parse_loadout_left_strip_with_anchor_y(
    lines: list[OCRLine], gamertag_text: str | None
) -> tuple[dict[str, ExtractionField], float | None]:
    """Wrapper around _parse_loadout_left_strip that also returns the subject's anchor y.

    The y is the y_center of the position-label line; useful for downstream level / captain
    detection that needs to scope to the subject's row, not other rows in the strip.
    """
    fields = _parse_loadout_left_strip(lines, gamertag_text)
    pos = fields["player_position"]
    if pos.status != FieldStatus.OK:
        return fields, None
    # Re-find the anchor line for its y.
    pos_set = {"C", "LW", "RW", "LD", "RD", "G"}
    target = pos.value
    for line in lines:
        if (
            line.x_center < 130
            and line.text.strip().upper().replace(" ", "") == target
            and target in pos_set
            and 180 < line.y_center < 980
        ):
            return fields, line.y_center
    return fields, None


def _parse_loadout_left_strip(lines: list[OCRLine], gamertag_text: str | None) -> dict[str, ExtractionField]:
    """Find the subject's row in the HOME/AWAY left strip and pull full name + number + position.

    The left strip uses position-label lines (C/LW/RW/LD/RD/G at x_center<130) as row
    anchors — they appear exactly once per visible player. Each anchor's y_center IS the
    row centre. The "subject" of the loadout view is identified by matching the top-right
    gamertag against the gamertag line ~x[200..390] in each anchored row.

    Returns full_name (e.g. "Evgeni Wanhg") under `player_name_full`. The short persona
    "E. Wanhg" only appears on lobby state-2 captures.
    """
    fields: dict[str, ExtractionField] = {
        "player_position": ExtractionField(status=FieldStatus.MISSING),
        "player_name_full": ExtractionField(status=FieldStatus.MISSING),
        "player_number": ExtractionField(status=FieldStatus.MISSING),
        "is_captain": ExtractionField(status=FieldStatus.MISSING),
    }
    if not gamertag_text:
        return fields

    pos_set = {"C", "LW", "RW", "LD", "RD", "G"}
    # Position-label anchors: text in pos_set, at x_center < 130, anywhere in the strip y-range.
    anchors: list[OCRLine] = [
        l for l in lines
        if l.y_center > 180
        and l.y_center < 980
        and l.x_center < 130
        and l.text.strip().upper().replace(" ", "") in pos_set
    ]
    if not anchors:
        return fields

    # Identify the subject row by matching the gamertag text inside each anchored row.
    gt_normalized = re.sub(r"[^a-z0-9]", "", gamertag_text.lower())
    if not gt_normalized:
        return fields
    head = gt_normalized[: min(6, len(gt_normalized))]

    subject_anchor: OCRLine | None = None
    for anchor in anchors:
        # Row content sits within ±45 px of anchor_y, at x_center in [180, 400].
        row_lines = [
            l for l in lines
            if abs(l.y_center - anchor.y_center) < 45 and 180 < l.x_center < 400
        ]
        joined = re.sub(r"[^a-z0-9]", "", " ".join(l.text for l in row_lines).lower())
        if head and head in joined:
            subject_anchor = anchor
            break
    if subject_anchor is None:
        return fields

    pos_upper = subject_anchor.text.strip().upper().replace(" ", "")
    fields["player_position"] = ExtractionField(
        raw_text=subject_anchor.text, value=pos_upper, confidence=subject_anchor.confidence, status=FieldStatus.OK
    )

    # Now harvest the subject row's other content: gamertag, #N, full name, captain.
    subject_row = [
        l for l in lines
        if abs(l.y_center - subject_anchor.y_center) < 45 and 180 < l.x_center < 400
    ]
    number_re = re.compile(r"#(\d{1,3})")
    name_re = re.compile(r"#\d{1,3}\s*[-.]+\s*(.+)")
    captain_glyphs = {"★", "✯", "✦", "✪", "✩"}

    for line in subject_row:
        text = line.text.strip()
        if any(g in text for g in captain_glyphs):
            fields["is_captain"] = ExtractionField(
                raw_text=text, value=True, confidence=line.confidence, status=FieldStatus.OK
            )
        m = number_re.search(text)
        if m and fields["player_number"].status == FieldStatus.MISSING:
            fields["player_number"] = ExtractionField(
                raw_text=text, value=int(m.group(1)), confidence=line.confidence, status=FieldStatus.OK
            )
        m2 = name_re.search(text)
        if m2 and fields["player_name_full"].status == FieldStatus.MISSING:
            full_name = m2.group(1).strip(". ")
            fields["player_name_full"] = ExtractionField(
                raw_text=text, value=full_name, confidence=line.confidence, status=FieldStatus.OK
            )

    return fields


def _parse_loadout_measurements(measurement_lines: list[OCRLine]) -> tuple[ExtractionField, ExtractionField, ExtractionField]:
    """Parse the top-right "<H> | <W> | SHOOTS <hand>" strip into (height, weight, handedness)."""
    if not measurement_lines:
        empty = ExtractionField(status=FieldStatus.MISSING)
        return empty, empty, empty
    sorted_lines = sorted(measurement_lines, key=lambda l: l.x1)
    raw = " ".join(l.text for l in sorted_lines)
    confidence = mean([l.confidence for l in sorted_lines]) if sorted_lines else None
    raw_upper = raw.upper()
    height_value, weight_value = split_height_weight(raw)
    # OCR commonly mis-reads 6'0" as 0.9 etc.; if split_height_weight failed, try
    # a more permissive fallback.
    if not height_value:
        m = re.search(r"(\d)'?\s*(\d{1,2})\"?", raw)
        if m:
            height_value = f"{m.group(1)}'{m.group(2)}\""
    hand_value: str | None = None
    if "RIGHT" in raw_upper:
        hand_value = "Right"
    elif "LEFT" in raw_upper:
        hand_value = "Left"
    h = ExtractionField(
        raw_text=raw,
        value=height_value,
        confidence=confidence,
        status=FieldStatus.OK if height_value else FieldStatus.UNCERTAIN,
    )
    w = ExtractionField(
        raw_text=raw,
        value=weight_value,
        confidence=confidence,
        status=FieldStatus.OK if weight_value else FieldStatus.UNCERTAIN,
    )
    hd = ExtractionField(
        raw_text=raw,
        value=hand_value,
        confidence=confidence,
        status=FieldStatus.OK if hand_value else FieldStatus.UNCERTAIN,
    )
    return h, w, hd


def _parse_loadout_attributes(
    lines: list[OCRLine], column_centers: dict[str, float]
) -> tuple[dict[str, AttributeGroup], dict[str, ExtractionField]]:
    """Snap OCR lines into the 5×5 (or 5×4) attribute grid and parse R + Δ per cell."""
    attributes: dict[str, AttributeGroup] = {g: AttributeGroup() for g in _LOADOUT_ATTR_GROUPS}
    deltas: dict[str, ExtractionField] = {}

    for group in _LOADOUT_ATTR_GROUPS:
        if group not in column_centers:
            # Column header not found; fill the group with MISSING placeholders.
            for key in _LOADOUT_ATTRS_PER_GROUP[group]:
                attributes[group].values[key] = ExtractionField(status=FieldStatus.MISSING)
            continue
        cx = column_centers[group]
        keys = _LOADOUT_ATTRS_PER_GROUP[group]
        n_rows = len(keys)
        for row_idx in range(n_rows):
            row_y = _LOADOUT_ATTR_ROW_YS[row_idx]
            # Cell x-band is asymmetric — label sits near cx, Δ + R extend far right.
            cell_lines = _lines_in_bbox(lines, (row_y - 25, row_y + 25), (cx - 80, cx + 260))
            value_field, delta_field = _extract_cell(cell_lines, cx)
            key = keys[row_idx]
            attributes[group].values[key] = value_field
            if delta_field is not None:
                deltas[key] = delta_field
    return attributes, deltas


def _extract_cell(cell_lines: list[OCRLine], cx: float) -> tuple[ExtractionField, ExtractionField | None]:
    """Within a single attribute-grid cell, identify the Δ chip and the R rating.

    Layout per column relative to header x-centre `cx`:
      - label x_center : cx-30..cx+90   (text content, ignored for keying)
      - Δ     x_center : cx+90..cx+170  (signed +N or -N, OCR may also read "+5" as "4")
      - R     x_center : cx+170..cx+260 (1-2 digit integer 0-99)
    """
    value: int | None = None
    value_conf: float | None = None
    value_raw: str | None = None
    delta: int | None = None
    delta_conf: float | None = None
    delta_raw: str | None = None

    for line in cell_lines:
        text = line.text.strip()
        x_rel = line.x_center - cx
        # R value: short int in the rightmost sub-band.
        if 160 <= x_rel <= 270 and re.fullmatch(r"\d{1,2}", text):
            value = int(text)
            value_conf = line.confidence
            value_raw = text
            continue
        # Δ chip: signed int in the middle sub-band.
        if 80 <= x_rel <= 170:
            m = re.fullmatch(r"([+\-]?)(\d{1,2})", text)
            if m:
                sign = -1 if m.group(1) == "-" else 1
                delta = sign * int(m.group(2))
                delta_conf = line.confidence
                delta_raw = text

    value_field = ExtractionField(
        raw_text=value_raw,
        value=value,
        confidence=value_conf,
        status=FieldStatus.OK if value is not None else FieldStatus.MISSING,
    )
    delta_field = (
        ExtractionField(
            raw_text=delta_raw,
            value=delta,
            confidence=delta_conf,
            status=FieldStatus.OK,
        )
        if delta is not None
        else None
    )
    return value_field, delta_field


def parse_loadout_result(meta, regions: dict[str, list[OCRLine]], *, image=None, **_kwargs) -> PlayerLoadoutResult:
    lines: list[OCRLine] = regions.get("full_frame", [])

    # ── Anchor: page header & build class title ──
    # Build class is the big centered text below the PLAYER LOADOUTS page header.
    # Page header is at y≈72; build class at y≈137.
    title_band = _lines_in_bbox(lines, (110, 175), (300, 1400))
    build_class_line = max(title_band, key=lambda l: (l.y2 - l.y1) * (l.x2 - l.x1), default=None)
    build_class_field = (
        field_from_lines([build_class_line], raw_override=build_class_line.text)
        if build_class_line
        else ExtractionField(status=FieldStatus.MISSING)
    )

    # ── Anchor: top-right gamertag (y≈146, x>1500) ──
    gt_band = _lines_in_bbox(lines, (130, 170), (1500, 1920))
    gamertag_line = max(gt_band, key=lambda l: l.x2 - l.x1, default=None) if gt_band else None
    gamertag_field = (
        field_from_lines([gamertag_line])
        if gamertag_line
        else ExtractionField(status=FieldStatus.MISSING)
    )
    gamertag_text = gamertag_line.text if gamertag_line else None

    # ── Anchor: measurements strip (y≈189, x>1400) ──
    meas_lines = _lines_in_bbox(lines, (170, 215), (1400, 1920))
    height_f, weight_f, hand_f = _parse_loadout_measurements(meas_lines)

    # ── Anchor: X-FACTORS header at y≈254 ──
    xf_header = next((l for l in lines if "X-FACTOR" in l.text.upper() and l.y_center < 320), None)
    xf_header_y = xf_header.y_center if xf_header else 254.0
    # X-Factor names live in a band ~60-90px below the header.
    xf_name_band = _lines_in_bbox(lines, (xf_header_y + 55, xf_header_y + 90))
    # Bucket by expected slot x-centre (500/1000/1500); pick the closest per slot.
    slot_names: list[ExtractionField] = []
    slot_tiers: list[ExtractionField] = []
    for slot_idx, (cx, _) in enumerate(_LOADOUT_XFACTOR_ICON_CENTROIDS):
        candidates = [l for l in xf_name_band if abs(l.x_center - cx) < 200]
        # If multiple candidates fall in band, the X-Factor NAME is typically the
        # longer / wider line; descriptions are at y_center > name_y.
        if candidates:
            top = sorted(candidates, key=lambda l: (l.y_center, -(l.x2 - l.x1)))[0]
            slot_names.append(field_from_lines([top], raw_override=top.text))
        else:
            slot_names.append(ExtractionField(status=FieldStatus.MISSING))
        tier_value = _classify_xfactor_tier(image, cx, _LOADOUT_XFACTOR_ICON_CENTROIDS[slot_idx][1])
        slot_tiers.append(
            ExtractionField(
                value=tier_value,
                status=FieldStatus.OK if tier_value else FieldStatus.MISSING,
            )
        )

    # ── Anchor: ATTRIBUTES header at y≈529 ──
    attr_header = next((l for l in lines if l.text.strip().upper() == "ATTRIBUTES" and 500 < l.y_center < 560), None)
    attr_header_y = attr_header.y_center if attr_header else 529.0
    # Column headers sit at y ≈ attr_header_y + 35.
    column_header_band = _lines_in_bbox(lines, (attr_header_y + 15, attr_header_y + 55))
    column_centers: dict[str, float] = {}
    for line in column_header_band:
        upper = line.text.upper().replace(" ", "")
        if upper in {"TECHNIQUE", "POWER", "PLAYSTYLE", "TENACITY", "TACTICS"}:
            column_centers[upper.lower()] = line.x_center
    # Fallback hardcoded centres if OCR missed any header.
    fallback_centres = {"technique": 491.0, "power": 769.0, "playstyle": 1076.0, "tenacity": 1363.0, "tactics": 1652.0}
    for g, cx in fallback_centres.items():
        column_centers.setdefault(g, cx)

    attributes, attribute_deltas = _parse_loadout_attributes(lines, column_centers)

    # ── Anchor: Active Ability Points (AP) ──
    # OCR usually splits into "ACTIVEABILITYPOINTS(AP):" + "<N>/100". Locate the N/100.
    ap_used_val: int | None = None
    ap_total_val: int | None = None
    ap_conf: float | None = None
    for line in lines:
        m = re.fullmatch(r"(\d{1,3})\s*/\s*(\d{1,3})", line.text.strip())
        if m and 440 < line.y_center < 500:
            ap_used_val = int(m.group(1))
            ap_total_val = int(m.group(2))
            ap_conf = line.confidence
            break
    ap_used_field = ExtractionField(
        value=ap_used_val,
        confidence=ap_conf,
        status=FieldStatus.OK if ap_used_val is not None else FieldStatus.MISSING,
    )
    ap_total_field = ExtractionField(
        value=ap_total_val,
        confidence=ap_conf,
        status=FieldStatus.OK if ap_total_val is not None else FieldStatus.MISSING,
    )

    # ── Anchor: left strip (HOME/AWAY rosters) — pull persona + number + position + captain ──
    strip_fields, subject_row_y = _parse_loadout_left_strip_with_anchor_y(lines, gamertag_text)

    # ── Player level — appears in the subject row in the strip (typically y_center + ~30) ──
    # Format can be "P<n>LVL<n>" or just "LVL<n>" depending on platform/locale.
    player_level_field = ExtractionField(status=FieldStatus.MISSING)
    if subject_row_y is not None:
        # Scan the strip-narrow x-band within ±50 px of the subject's anchor row.
        for line in lines:
            if not (subject_row_y - 10 < line.y_center < subject_row_y + 60):
                continue
            if not (60 < line.x_center < 220):
                continue
            stripped = line.text.replace(" ", "").upper()
            if re.search(r"LVL\d{1,3}", stripped):
                m = re.search(r"LVL(\d{1,3})", stripped)
                player_level_field = ExtractionField(
                    raw_text=line.text,
                    value=int(m.group(1)) if m else None,
                    confidence=line.confidence,
                    status=FieldStatus.OK,
                )
                break

    # ── Full real name resolution ──
    # Always sourced from the left strip's "#N - <Full Name>" line. The title bar
    # for themed builds ("COLE CAUFIELD - SNP") names the NHL player the BUILD mimics,
    # not the loadout subject's real name — don't try to split it.
    player_name_full_field = strip_fields["player_name_full"]

    return PlayerLoadoutResult(
        meta=meta,
        player_position=strip_fields["player_position"],
        # `player_name` (short persona "E. Wanhg") is only on lobby state-2; not derivable
        # from the loadout view. Promoter / cross-frame consensus fills it in later.
        player_name=ExtractionField(status=FieldStatus.MISSING),
        player_name_full=player_name_full_field,
        player_number=strip_fields["player_number"],
        player_level=player_level_field,
        player_platform=ExtractionField(status=FieldStatus.MISSING),
        gamertag=gamertag_field,
        is_captain=strip_fields["is_captain"],
        build_class=build_class_field,
        height=height_f,
        weight=weight_f,
        handedness=hand_f,
        ap_used=ap_used_field,
        ap_total=ap_total_field,
        x_factors=slot_names,
        x_factor_tiers=slot_tiers,
        attributes=attributes,
        attribute_deltas=attribute_deltas,
    )


def build_player_record(side: str, row: list[OCRLine]) -> PostGamePlayerRecord:
    ordered = sorted(row, key=lambda item: item.x1)
    gamertag = [
        item
        for item in ordered
        if re.search(r"[A-Za-z]", item.text)
        and len(item.text.strip()) > 2
        and item.text.upper() not in {"LW", "RW", "C", "LD", "RD", "G"}
    ][:1]
    position_lines = [item for item in row if item.text.upper() in {"LW", "RW", "C", "LD", "RD", "G"}]
    numeric_lines = [item for item in ordered if re.search(r"\d", item.text) and item not in gamertag]
    goals_line = numeric_lines[1:2] if len(numeric_lines) > 1 else []
    assists_line = numeric_lines[2:3] if len(numeric_lines) > 2 else []
    saves_line = numeric_lines[3:4] if len(numeric_lines) > 3 else []
    save_pct_line = numeric_lines[4:5] if len(numeric_lines) > 4 else []
    return PostGamePlayerRecord(
        side=side,
        gamertag=field_from_lines(gamertag),
        player_rank=field_from_lines([]),
        position_played=field_from_lines(position_lines),
        rp=field_from_lines(numeric_lines[:1], parser=parse_int),
        goals=field_from_lines(goals_line, parser=parse_int),
        assists=field_from_lines(assists_line, parser=parse_int),
        saves=field_from_lines(saves_line, parser=parse_int),
        save_percentage=field_from_lines(save_pct_line, parser=parse_percentage),
    )


def group_lines_by_row(lines: list[OCRLine], threshold: float = 24.0) -> list[list[OCRLine]]:
    ordered = sorted(lines, key=lambda line: (line.y_center, line.x1))
    rows: list[list[OCRLine]] = []
    for line in ordered:
        if any(header in line.text.upper() for header in ("GAMERTAG", "RANK", "POS", "RP", "SAVE", "SV%", "SV")):
            continue
        if not rows or abs(rows[-1][0].y_center - line.y_center) > threshold:
            rows.append([line])
        else:
            rows[-1].append(line)
    filtered: list[list[OCRLine]] = []
    for row in rows:
        has_position = any(item.text.upper() in {"LW", "RW", "C", "LD", "RD", "G"} for item in row)
        has_number = any(re.search(r"\d", item.text) for item in row)
        has_name = any(re.search(r"[A-Za-z]", item.text) and len(item.text.strip()) > 2 for item in row)
        if has_position and has_number and has_name:
            filtered.append(sorted(row, key=lambda item: item.x1))
    return filtered


_BOX_SCORE_PERIOD_NUMBER = {
    "1ST": 1,
    "2ND": 2,
    "3RD": 3,
    "OT": 4,
    "OT2": 5,
    "OT3": 6,
    "TOT": -1,
    "FINAL": -1,
}

# Common OCR misreads of period header tokens, mapped to their canonical form.
# EASHL has no shootout — any "SO"-shaped header is either OCR garbage or a
# screen from a non-EASHL mode and is ignored downstream.
_BOX_SCORE_PERIOD_ALIASES = {
    "1S": "1ST",
    "1SI": "1ST",
    "2N": "2ND",
    "3R": "3RD",
    "0T": "OT",
    "OT1": "OT",
    "T0T": "TOT",
}


def _normalize_period_label(text: str) -> str:
    """Map an OCR'd period header to a canonical label (or '' if unrecognized)."""
    cleaned = re.sub(r"[^A-Z0-9]", "", text.upper())
    if cleaned in _BOX_SCORE_PERIOD_NUMBER:
        return cleaned
    if cleaned in _BOX_SCORE_PERIOD_ALIASES:
        return _BOX_SCORE_PERIOD_ALIASES[cleaned]
    return ""


def _split_into_columns(lines: list[OCRLine], min_gap_factor: float = 0.6) -> list[list[OCRLine]]:
    """Group OCR lines into columns by horizontal position.

    Sorts by x_center, then introduces a column break whenever the gap to the
    previous line exceeds min_gap_factor × the median line height (a heuristic
    that works well for evenly-spaced numeric scoreboard rows).
    """
    if not lines:
        return []
    ordered = sorted(lines, key=lambda line: line.x_center)
    heights = [max(1.0, line.y2 - line.y1) for line in ordered]
    median_h = sorted(heights)[len(heights) // 2]
    threshold = max(median_h * min_gap_factor, 12.0)

    columns: list[list[OCRLine]] = [[ordered[0]]]
    for line in ordered[1:]:
        prev = columns[-1][-1]
        gap = line.x1 - prev.x2
        if gap > threshold:
            columns.append([line])
        else:
            columns[-1].append(line)
    return columns


def _column_text(column: list[OCRLine]) -> str:
    return normalize_text(" ".join(item.text for item in sorted(column, key=lambda l: l.x1)))


def _column_confidence(column: list[OCRLine]) -> float | None:
    if not column:
        return None
    return mean([item.confidence for item in column])


def _explode_digit_token(line: OCRLine) -> list[OCRLine]:
    """Split an OCR line whose text is N digits (possibly with leading FINAL/etc.)
    into N synthetic single-digit OCRLines positioned proportionally across the
    original token's x span.
    """
    digits_only = re.sub(r"[^0-9]", "", line.text)
    if not digits_only:
        return [line]
    span = max(1.0, line.x2 - line.x1)
    slice_w = span / len(digits_only)
    out: list[OCRLine] = []
    for i, ch in enumerate(digits_only):
        x1 = line.x1 + i * slice_w
        out.append(
            OCRLine(
                text=ch,
                confidence=line.confidence,
                x1=x1,
                y1=line.y1,
                x2=x1 + slice_w,
                y2=line.y2,
            )
        )
    return out


def _align_row_to_headers(
    row_lines: list[OCRLine],
    header_columns: list[list[OCRLine]],
) -> list[list[OCRLine]]:
    """Anchor a stats row to the header column x-positions.

    For each header column, return the subset of row OCRLines whose x_center is
    closer to that header than to any other. Multi-digit row tokens are first
    exploded into per-character synthetic lines so glued strings like "2331"
    distribute correctly across columns.

    Empty result lists for a column mean the OCR didn't capture a digit there;
    field_from_lines() will produce a MISSING / UNCERTAIN ExtractionField, which
    is the correct outcome.
    """
    if not header_columns:
        return []
    header_centers = [
        (sum(line.x_center for line in col) / len(col)) if col else 0.0
        for col in header_columns
    ]

    # Explode pure-digit multi-character tokens into per-character pieces.
    exploded: list[OCRLine] = []
    for line in row_lines:
        text = line.text.strip()
        # Only explode if the token is *purely* digits (no FINAL, no letters).
        # For mixed tokens like "9FINAL", strip non-digit chars and explode the digits portion.
        digits_only = re.sub(r"[^0-9]", "", text)
        if digits_only and len(digits_only) >= 2 and len(digits_only) <= 6:
            # Explode if the digit portion fills most of the token, OR if the
            # token has any letters (FINAL suffix etc — keep only digits).
            non_digit = re.sub(r"[0-9]", "", text)
            if not non_digit or len(digits_only) >= 2:
                exploded.extend(_explode_digit_token(line))
                continue
        exploded.append(line)

    bins: list[list[OCRLine]] = [[] for _ in header_columns]
    for line in exploded:
        # Pick the nearest header column for this line's x_center.
        nearest = min(range(len(header_centers)), key=lambda i: abs(line.x_center - header_centers[i]))
        bins[nearest].append(line)
    return bins


def parse_post_game_box_score(
    meta,
    regions: dict[str, list[OCRLine]],
    *,
    stat_kind: str,
    **_kwargs,
) -> PostGameBoxScoreResult:
    """Parse one of the three Box Score tabs (goals/shots/faceoffs).

    The grid is small and tabular: headers are short tokens (1ST 2ND 3RD OT SO TOT)
    and each team row is a sequence of integers in matching column positions.
    Strategy:
      1. Split each row into columns by horizontal gap.
      2. If a row has fewer columns than the header but its lone column is a
         pure-digit string of header-length characters, treat each character as
         its own column (handles RapidOCR's tendency to glue tightly-spaced
         digit rows into a single token).
      3. Zip columns by index against the header columns.
    """
    tab_label = field_from_lines(regions.get("tab_label", []))

    away_team = field_from_lines(regions.get("away_team_name", []))
    home_team = field_from_lines(regions.get("home_team_name", []))

    header_columns = _split_into_columns(regions.get("period_header_row", []))
    away_columns = _align_row_to_headers(regions.get("away_stats_row", []), header_columns)
    home_columns = _align_row_to_headers(regions.get("home_stats_row", []), header_columns)

    # Build per-period header ExtractionFields for audit/debug.
    period_headers = [
        field_from_lines(col, parser=lambda text: _normalize_period_label(text) or None)
        for col in header_columns
    ]

    # Pair away/home columns to each header. Headers drive the layout; each row
    # is anchored to header x-centers so missing digits become None values
    # rather than collapsing the whole row.
    periods: list[BoxScorePeriodCell] = []
    for i in range(len(header_columns)):
        header_text = _column_text(header_columns[i])
        label = _normalize_period_label(header_text) or header_text or f"col_{i}"
        period_number = _BOX_SCORE_PERIOD_NUMBER.get(label, 0)

        away_field = field_from_lines(
            away_columns[i] if i < len(away_columns) else [],
            parser=parse_int,
        )
        home_field = field_from_lines(
            home_columns[i] if i < len(home_columns) else [],
            parser=parse_int,
        )

        periods.append(
            BoxScorePeriodCell(
                period_label=label,
                period_number=period_number,
                away_value=away_field,
                home_value=home_field,
            )
        )

    # TOT-sum sanity check: periods 1..6 (1ST/2ND/3RD/OT/OT2/OT3) should add
    # up to the TOT column. EASHL has no shootout, so no SO bucket. RapidOCR misreads digits in this font (most often
    # '9'→'6' or '9'→'g'), so when the column sum disagrees with TOT we surface
    # a warning so the operator can pinpoint the bad cell during review.
    warnings: list[str] = []
    tot_cell = next((c for c in periods if c.period_number == -1), None)
    if tot_cell is not None:
        for side in ("away", "home"):
            tot_field = tot_cell.away_value if side == "away" else tot_cell.home_value
            tot_val = tot_field.value if isinstance(tot_field.value, int) else None
            if tot_val is None:
                continue
            period_vals: list[int] = []
            missing = False
            for c in periods:
                if c.period_number < 1 or c.period_number > 6:
                    continue
                cell = c.away_value if side == "away" else c.home_value
                if isinstance(cell.value, int):
                    period_vals.append(cell.value)
                else:
                    missing = True
                    break
            if missing or not period_vals:
                continue
            summed = sum(period_vals)
            if summed != tot_val:
                warnings.append(
                    f"{stat_kind} {side} TOT mismatch: periods sum to {summed} "
                    f"but TOT reads {tot_val} (delta {tot_val - summed})"
                )

    return PostGameBoxScoreResult(
        meta=meta,
        stat_kind=stat_kind,  # type: ignore[arg-type]
        tab_label=tab_label,
        away_team=away_team,
        home_team=home_team,
        period_headers=period_headers,
        periods=periods,
        warnings=warnings,
    )


# ─── Net Chart parser ─────────────────────────────────────────────────────────

_NET_CHART_PERIOD_NUMBER = {
    "1ST": 1,
    "2ND": 2,
    "3RD": 3,
    "OT": 4,
    "OT2": 5,
    "OT3": 6,
    "ALLPERIODS": -1,
    "ALL": -1,
}

_NET_CHART_LABEL_KEYS = {
    # canonical_key: list of substring matchers (uppercase, no spaces)
    "total_shots": ["TOTALSHOTS"],
    "wrist_shots": ["WRISTSHOTS"],
    "slap_shots": ["SLAPSHOTS", "SLAPSHOT"],
    "backhand_shots": ["BACKHANDSHOTS", "BACKHANDSHOT"],
    "snap_shots": ["SNAPSHOTS", "SNAPSHOT"],
    "deflections": ["DEFLECTIONS", "DEFLECTION"],
    "power_play_shots": ["SHOTSONPP", "SHOTSPP", "PPSHOTS"],
}


def _net_chart_row_key(text: str) -> str | None:
    """Map an OCR'd row label to its canonical key, or None if unrecognized."""
    cleaned = re.sub(r"[^A-Z]", "", text.upper())
    for key, matchers in _NET_CHART_LABEL_KEYS.items():
        for m in matchers:
            if m in cleaned:
                return key
    return None


def _net_chart_period_number(label_text: str) -> int:
    """Parse a UI period label into a period number (-1 = ALL PERIODS aggregate).

    The period selector tab also renders an "RT" / "LT" controller-prompt glyph
    that OCR pulls in alongside the actual label. We strip those prefixes
    before lookup.
    """
    cleaned = re.sub(r"[^A-Z0-9]", "", label_text.upper())
    for prefix in ("RT", "LT", "RB", "LB"):
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix):]
            break
    for suffix in ("RT", "LT", "RB", "LB"):
        if cleaned.endswith(suffix):
            cleaned = cleaned[: -len(suffix)]
            break
    if cleaned.endswith("PERIOD"):
        cleaned = cleaned[: -len("PERIOD")]
    return _NET_CHART_PERIOD_NUMBER.get(cleaned, -1)


def parse_post_game_net_chart(meta, regions: dict[str, list[OCRLine]], **_kwargs) -> PostGameNetChartResult:
    """Parse the Net Chart stats panel into per-side shot-type counts.

    Layout: 7 rows (TOTAL/WRIST/SLAP/BACKHAND/SNAP/DEFLECTIONS/SHOTS ON PP),
    each containing an away value (left), a label (middle), and a home value (right).
    Strategy: group stats_panel lines by y, identify each row by its label
    keyword, then take the leftmost numeric token as away_value and the
    rightmost as home_value.
    """
    period_label_field = field_from_lines(regions.get("period_label", []))
    away_label_field = field_from_lines(regions.get("away_label", []))
    home_label_field = field_from_lines(regions.get("home_label", []))

    period_text = period_label_field.raw_text or ""
    period_number = _net_chart_period_number(period_text)

    panel_lines = regions.get("stats_panel", [])
    rows = _group_lines_by_y(panel_lines, threshold=20.0)

    # Initialize all 7 stat fields as MISSING.
    canonical_keys = list(_NET_CHART_LABEL_KEYS.keys())
    away_fields: dict[str, ExtractionField] = {k: ExtractionField(status=FieldStatus.MISSING) for k in canonical_keys}
    home_fields: dict[str, ExtractionField] = {k: ExtractionField(status=FieldStatus.MISSING) for k in canonical_keys}

    for row in rows:
        # Find label among row members.
        label_token = None
        label_x_center = None
        for line in row:
            key = _net_chart_row_key(line.text)
            if key is not None:
                label_token = key
                label_x_center = line.x_center
                break
        if label_token is None or label_x_center is None:
            continue
        # Pick numeric tokens by side relative to the label.
        numeric_lines = [
            line for line in row if re.search(r"[0-9]", line.text) and line is not row[0] or re.search(r"[0-9]", line.text)
        ]
        away_lines = [line for line in numeric_lines if line.x_center < label_x_center]
        home_lines = [line for line in numeric_lines if line.x_center > label_x_center]
        # Allow lone-letter "g" / "S" / "O" tokens to still surface as raw_text.
        if not away_lines:
            away_lines = [line for line in row if line.x_center < label_x_center and line.text.strip()]
        if not home_lines:
            home_lines = [line for line in row if line.x_center > label_x_center and line.text.strip()]
        away_fields[label_token] = field_from_lines(away_lines, parser=parse_int)
        home_fields[label_token] = field_from_lines(home_lines, parser=parse_int)

    return PostGameNetChartResult(
        meta=meta,
        period_label=period_label_field,
        period_number=period_number,
        away_label=away_label_field,
        home_label=home_label_field,
        away=NetChartSideStats(**away_fields),
        home=NetChartSideStats(**home_fields),
    )


# ─── Faceoff Map parser (audit-only) ──────────────────────────────────────────

_FACEOFF_LABEL_KEYS = {
    "overall_win_pct": ["OVERALLWIN", "OVERALL"],
    "offensive_zone": ["OFFENSIVEZONE", "OFFENSIVE"],
    "defensive_zone": ["DEFENSIVEZONE", "DEFENSIVE"],
}


def _faceoff_row_key(text: str) -> str | None:
    cleaned = re.sub(r"[^A-Z]", "", text.upper())
    for key, matchers in _FACEOFF_LABEL_KEYS.items():
        for m in matchers:
            if m in cleaned:
                return key
    return None


def parse_post_game_faceoff_map(meta, regions: dict[str, list[OCRLine]], **_kwargs) -> PostGameFaceoffMapResult:
    """Parse the Faceoff Map text panel. Audit-only — no domain rows.

    Three rows: OVERALL WIN % / OFFENSIVE ZONE / DEFENSIVE ZONE. Each has an
    away value (left), label (middle), home value (right). Values are stored
    verbatim; the offensive/defensive entries look like "2/3" (wins/total) and
    are kept as strings rather than parsed into separate columns.
    """
    period_label_field = field_from_lines(regions.get("period_label", []))
    away_label_field = field_from_lines(regions.get("away_label", []))
    home_label_field = field_from_lines(regions.get("home_label", []))
    period_number = _net_chart_period_number(period_label_field.raw_text or "")

    panel_lines = regions.get("stats_panel", [])
    rows = _group_lines_by_y(panel_lines, threshold=24.0)

    canonical_keys = list(_FACEOFF_LABEL_KEYS.keys())
    away: dict[str, ExtractionField] = {k: ExtractionField(status=FieldStatus.MISSING) for k in canonical_keys}
    home: dict[str, ExtractionField] = {k: ExtractionField(status=FieldStatus.MISSING) for k in canonical_keys}

    for row in rows:
        label_token = None
        label_x_center = None
        for line in row:
            key = _faceoff_row_key(line.text)
            if key is not None:
                label_token = key
                label_x_center = line.x_center
                break
        if label_token is None or label_x_center is None:
            continue
        away_lines = [line for line in row if line.x_center < label_x_center and line.text.strip()]
        home_lines = [line for line in row if line.x_center > label_x_center and line.text.strip()]
        # Filter labels out of value lists.
        away_lines = [l for l in away_lines if _faceoff_row_key(l.text) is None]
        home_lines = [l for l in home_lines if _faceoff_row_key(l.text) is None]
        # Use parse_percentage for overall row, otherwise raw text.
        if label_token == "overall_win_pct":
            away[label_token] = field_from_lines(away_lines, parser=parse_percentage)
            home[label_token] = field_from_lines(home_lines, parser=parse_percentage)
        else:
            away[label_token] = field_from_lines(away_lines)
            home[label_token] = field_from_lines(home_lines)

    return PostGameFaceoffMapResult(
        meta=meta,
        period_label=period_label_field,
        period_number=period_number,
        away_label=away_label_field,
        home_label=home_label_field,
        away=FaceoffSideStats(**away),
        home=FaceoffSideStats(**home),
    )


# ─── Events parser ────────────────────────────────────────────────────────────

_EVENT_PERIOD_HEADER_RE = re.compile(
    r"^\s*(\d+(?:ST|ND|RD)|OVERTIME(?:\s*\d+)?|OT\d?)\s*PERIOD?:?\s*$",
    re.IGNORECASE,
)
_EVENT_PERIOD_NUMBER = {
    "1ST": 1,
    "2ND": 2,
    "3RD": 3,
    "OVERTIME": 4,
    "OT": 4,
    "OT2": 5,
    "OT3": 6,
}

# Goal event:
#   <CLOCK> <SCORER>[goal_number_brackets] [assist1, assist2]
# Brackets vary in OCR: ( ) vs [ ] interchangeably. Trailing ) sometimes glued.
#
# Clock format constrained to MM ∈ [0, 19], SS ∈ [00, 59] — periods are 20:00
# long. The earlier `\d{1,2}:\d{2}` regex matched bogus OCR clocks like
# "71:10", which then made it through to the DB.
_CLOCK_PATTERN = r"[01]?\d:[0-5]\d"
_EVENT_CLOCK_RE = re.compile(rf"({_CLOCK_PATTERN})")
_EVENT_GOAL_RE = re.compile(
    rf"^\s*"
    rf"(?P<clock>{_CLOCK_PATTERN})\s+"
    r"(?P<scorer>.+?)\s*"
    r"[\[\(](?P<goal_num>\d+)[\]\)]\s*"
    r"[\[\(](?P<assists>.+?)[\]\)]\s*$",
    re.IGNORECASE,
)
# Goal event without explicit goal number (sometimes OT entries):
#   <CLOCK> <SCORER> [assist1, assist2]
_EVENT_GOAL_NO_NUM_RE = re.compile(
    rf"^\s*"
    rf"(?P<clock>{_CLOCK_PATTERN})\s+"
    r"(?P<scorer>.+?)\s*"
    r"[\[\(](?P<assists>[^\[\(\]\)]+)[\]\)]\s*$",
    re.IGNORECASE,
)
_EVENT_PENALTY_RE = re.compile(
    rf"^\s*"
    rf"(?P<clock>{_CLOCK_PATTERN})\s+"
    r"(?P<player>.+?)\s+"
    r"(?P<infraction>[A-Za-z][A-Za-z\s\-]*?)\s+"
    r"(?P<ptype>Minor|Major)\s*$",
    re.IGNORECASE,
)


def _normalize_period_header(text: str) -> tuple[str, int] | None:
    """Match a period header line, tolerating common OCR corruptions.

    Real-world OCR samples seen:
      "1ST PERIOD:" → "STPERIOD:" (leading 1 dropped on invert-threshold)
      "3RD PERIOD:" → "BRDPERIOD:" (3 → B misread)
      "OVERTIME" → "OVERTIME"
    Strategy: if the line contains "PERIOD" or equals "OVERTIME", infer the
    ordinal from suffix tokens (ST/ND/RD) and any leading digit.
    """
    cleaned = re.sub(r"[^A-Za-z0-9]", "", text).upper()
    if not cleaned:
        return None
    # Overtime variants.
    if cleaned in {"OVERTIME", "OT"}:
        return ("OVERTIME", 4)
    if cleaned.startswith("OVERTIME"):
        return ("OVERTIME", 4)
    if re.fullmatch(r"OT\d", cleaned):
        return (cleaned, 3 + int(cleaned[2]))
    # Period rows: must contain "PERIOD" (or close enough — at least 5 contiguous PERIOD letters).
    if "PERIOD" not in cleaned:
        return None
    head = cleaned.replace("PERIOD", "")
    # Heuristic: leading digit OR ordinal suffix tells us the period number.
    digit_match = re.search(r"\d", head)
    if digit_match:
        n = int(digit_match.group())
        if 1 <= n <= 6:
            return (f"{n}{['ST','ND','RD'][n-1] if n <= 3 else 'TH'}", n)
    # No digit — fall back to suffix matching.
    if head.endswith("ST"):
        return ("1ST", 1)
    if head.endswith("ND"):
        return ("2ND", 2)
    if head.endswith("RD") or head.endswith("BRD"):
        return ("3RD", 3)
    if head.endswith("TH"):
        return ("4TH", 4)
    # Couldn't determine period number, but "PERIOD" was present. Mark as unknown.
    return ("?PERIOD", 0)


def _split_assists(text: str) -> list[str]:
    """Split assist list on commas, strip ornaments and whitespace."""
    pieces = re.split(r"\s*,\s*", text.strip())
    return [p.strip() for p in pieces if p.strip()]


def _strip_ornament(name: str) -> str:
    """Remove leading '-.' decoration that prefixes player names in the UI."""
    return re.sub(r"^\s*[-.]+\s*", "", name).strip()


def _parse_event_line(
    detail_text: str,
    detail_confidence: float | None,
    team_abbr: str | None,
    team_confidence: float | None,
    period_label: str,
    period_number: int,
) -> EventRow:
    """Classify an event line as goal/penalty/unknown and extract structured fields."""
    raw_field = ExtractionField(
        raw_text=detail_text,
        value=detail_text,
        confidence=detail_confidence,
        status=FieldStatus.OK if detail_confidence and detail_confidence >= 0.72 else FieldStatus.UNCERTAIN,
    )
    team_field = ExtractionField(
        raw_text=team_abbr,
        value=team_abbr,
        confidence=team_confidence,
        status=FieldStatus.OK if team_abbr and (team_confidence or 0) >= 0.72 else FieldStatus.UNCERTAIN if team_abbr else FieldStatus.MISSING,
    )

    # Try goal-with-number first.
    m = _EVENT_GOAL_RE.match(detail_text)
    if m:
        clock = m.group("clock")
        scorer = _strip_ornament(m.group("scorer"))
        goal_num = int(m.group("goal_num"))
        assists = [_strip_ornament(a) for a in _split_assists(m.group("assists"))]
        return EventRow(
            raw_text=raw_field,
            period_label=period_label,
            period_number=period_number,
            event_type="goal",
            team_abbreviation=team_field,
            clock=ExtractionField(raw_text=clock, value=clock, confidence=detail_confidence, status=FieldStatus.OK),
            actor_snapshot=ExtractionField(raw_text=scorer, value=scorer, confidence=detail_confidence, status=FieldStatus.OK),
            goal_number_in_game=ExtractionField(raw_text=str(goal_num), value=goal_num, confidence=detail_confidence, status=FieldStatus.OK),
            assists_snapshot=[
                ExtractionField(raw_text=a, value=a, confidence=detail_confidence, status=FieldStatus.OK)
                for a in assists
            ],
            infraction=ExtractionField(status=FieldStatus.MISSING),
            penalty_type=ExtractionField(status=FieldStatus.MISSING),
        )

    # Goal without explicit number (OT-winner edge case).
    m = _EVENT_GOAL_NO_NUM_RE.match(detail_text)
    if m:
        clock = m.group("clock")
        scorer = _strip_ornament(m.group("scorer"))
        assists = [_strip_ornament(a) for a in _split_assists(m.group("assists"))]
        return EventRow(
            raw_text=raw_field,
            period_label=period_label,
            period_number=period_number,
            event_type="goal",
            team_abbreviation=team_field,
            clock=ExtractionField(raw_text=clock, value=clock, confidence=detail_confidence, status=FieldStatus.OK),
            actor_snapshot=ExtractionField(raw_text=scorer, value=scorer, confidence=detail_confidence, status=FieldStatus.OK),
            goal_number_in_game=ExtractionField(status=FieldStatus.MISSING),
            assists_snapshot=[
                ExtractionField(raw_text=a, value=a, confidence=detail_confidence, status=FieldStatus.OK)
                for a in assists
            ],
            infraction=ExtractionField(status=FieldStatus.MISSING),
            penalty_type=ExtractionField(status=FieldStatus.MISSING),
        )

    # Penalty event.
    m = _EVENT_PENALTY_RE.match(detail_text)
    if m:
        clock = m.group("clock")
        player = _strip_ornament(m.group("player"))
        infraction = m.group("infraction").strip()
        ptype = m.group("ptype").strip().capitalize()
        return EventRow(
            raw_text=raw_field,
            period_label=period_label,
            period_number=period_number,
            event_type="penalty",
            team_abbreviation=team_field,
            clock=ExtractionField(raw_text=clock, value=clock, confidence=detail_confidence, status=FieldStatus.OK),
            actor_snapshot=ExtractionField(raw_text=player, value=player, confidence=detail_confidence, status=FieldStatus.OK),
            goal_number_in_game=ExtractionField(status=FieldStatus.MISSING),
            assists_snapshot=[],
            infraction=ExtractionField(raw_text=infraction, value=infraction, confidence=detail_confidence, status=FieldStatus.OK),
            penalty_type=ExtractionField(raw_text=ptype, value=ptype, confidence=detail_confidence, status=FieldStatus.OK),
        )

    # Unknown — surface raw text only for review.
    clock_match = _EVENT_CLOCK_RE.search(detail_text)
    clock_value = clock_match.group(1) if clock_match else None
    return EventRow(
        raw_text=raw_field,
        period_label=period_label,
        period_number=period_number,
        event_type="unknown",
        team_abbreviation=team_field,
        clock=ExtractionField(raw_text=clock_value, value=clock_value, confidence=detail_confidence, status=FieldStatus.UNCERTAIN if clock_value else FieldStatus.MISSING),
        actor_snapshot=ExtractionField(status=FieldStatus.MISSING),
        goal_number_in_game=ExtractionField(status=FieldStatus.MISSING),
        assists_snapshot=[],
        infraction=ExtractionField(status=FieldStatus.MISSING),
        penalty_type=ExtractionField(status=FieldStatus.MISSING),
    )


def parse_post_game_events(meta, regions: dict[str, list[OCRLine]], **_kwargs) -> PostGameEventsResult:
    """Parse the Events screen's scrollable list into event rows.

    Each event row is typically two OCR detections: a team-abbreviation chip
    (left) and a single-line event detail (right). Period headers ("1ST PERIOD:")
    appear on their own y-row.
    """
    filter_label = field_from_lines(regions.get("filter_label", []))
    panel_lines = regions.get("events_panel", [])
    rows = _group_lines_by_y(panel_lines, threshold=24.0)

    current_period_label = "?"
    current_period_number = 0

    events: list[EventRow] = []
    for row in rows:
        ordered = sorted(row, key=lambda l: l.x1)
        joined = " ".join(line.text for line in ordered).strip()

        # Period header?
        header = _normalize_period_header(joined)
        if header is not None:
            current_period_label, current_period_number = header
            continue

        # "NO EVENTS" filler row — skip silently.
        if re.search(r"NO\s*EVENTS", joined.upper()):
            continue

        # Identify the team-abbreviation token. Skip leading UI ornaments
        # (loss-indicator badges show as 1-2 char tokens like "L", "TL", "IL"
        # rendered to the left of the team logo). Walk forward until we hit a
        # plausible team abbreviation: ≥2 chars, fully alphanumeric, contains
        # at least one digit OR ≥3 chars OR matches a known BGM alias.
        team_abbr = None
        team_confidence: float | None = None
        ornament_rejects = {"L", "TL", "IL", "LL", "TI", "T", "I"}
        while ordered:
            candidate = ordered[0]
            ctext = candidate.text.strip()
            if not ctext:
                ordered = ordered[1:]
                continue
            if (
                len(ctext) >= 2
                and len(ctext) <= 5
                and re.fullmatch(r"[A-Za-z0-9]+", ctext)
                and not _EVENT_CLOCK_RE.match(ctext)
                and ctext.upper() not in ornament_rejects
                and (any(ch.isdigit() for ch in ctext) or len(ctext) >= 3 or ctext.upper() in {"BM", "BG"})
            ):
                team_abbr = ctext.upper()
                team_confidence = candidate.confidence
                ordered = ordered[1:]
                break
            if ctext.upper() in ornament_rejects or len(ctext) == 1:
                ordered = ordered[1:]
                continue
            break

        if not ordered:
            continue
        detail_text = " ".join(line.text for line in ordered).strip()
        detail_conf = mean([line.confidence for line in ordered]) if ordered else None

        events.append(
            _parse_event_line(
                detail_text,
                detail_conf,
                team_abbr,
                team_confidence,
                current_period_label,
                current_period_number,
            )
        )

    return PostGameEventsResult(meta=meta, filter_label=filter_label, events=events)


# ─── Action Tracker parser ────────────────────────────────────────────────────

_ACTION_TRACKER_TYPES = {
    "SHOT": "shot",
    "HIT": "hit",
    "PENALTY": "penalty",
    "GOAL": "goal",
    "FACEOFF": "faceoff",
    "FACE OFF": "faceoff",
    "FACE": "faceoff",
}

_ACTION_RELATION_RE = re.compile(r"\s+(ON|VS)\s+", re.IGNORECASE)


def _action_tracker_event_type(text: str) -> str:
    cleaned = re.sub(r"[^A-Z]", "", text.upper())
    for key, mapped in _ACTION_TRACKER_TYPES.items():
        if key.replace(" ", "") == cleaned:
            return mapped
    return "unknown"


def parse_post_game_action_tracker(
    meta,
    regions: dict[str, list[OCRLine]],
    *,
    image=None,
    **_kwargs,
) -> PostGameActionTrackerResult:
    """Parse the Action Tracker left-panel event list + (Phase 5) the rink-map
    spatial position of the highlighted (selected) event.

    Each event renders as TWO OCR rows in vertical proximity:
      Row A:  "<ACTOR> ON|VS <TARGET>"   (and a chip 'S/H/P/G/F' to the right)
      Row B:  "<EVENT_TYPE> <CLOCK>|<period text>"

    Strategy: tightly group rows by y, then walk in pairs. The first row gives
    actor/target/relation; the second gives event_type and clock.

    If `image` is provided (full-frame BGR np.ndarray), also runs the spatial
    extractor on the rink panel to detect the yellow (selected) marker and
    compute its hockey-standard (x, y). The result is attached as the
    `selected_event_*` fields. The first event in the parsed list corresponds
    to this position because the highlighted row is rendered topmost.
    """
    filter_label = field_from_lines(regions.get("filter_label", []))
    period_label_field = field_from_lines(regions.get("period_label", []))
    period_number_top = _net_chart_period_number(period_label_field.raw_text or "")

    panel_lines = regions.get("list_panel", [])
    # Threshold tuned to keep each event's 3 visual sub-rows together (actor,
    # right-edge chip, and detail line w/ clock are within ~80px of the actor's
    # y-center) while separating distinct events (~140+ px apart).
    rows = _group_lines_by_y(panel_lines, threshold=85.0)

    events: list[ActionTrackerEvent] = []
    # Parallel list of cropped-panel y-centers for each parsed event row. Used
    # later to match the red selection bar to a specific event.
    event_cropped_y_centers: list[float] = []
    for row in rows:
        joined = " ".join(line.text for line in sorted(row, key=lambda l: (l.y_center, l.x1)))
        rel_match = _ACTION_RELATION_RE.search(joined)
        if not rel_match:
            continue

        # Extract the actor "ON|VS" target slice from the actor sub-row only.
        # Use the FIRST OCRLine that contains the relation token, since the
        # other lines in the group are the chip and the detail row.
        actor_line = next(
            (line for line in row if _ACTION_RELATION_RE.search(line.text)),
            None,
        )
        if actor_line is None:
            continue
        actor_text_full = actor_line.text.strip()
        actor_match = _ACTION_RELATION_RE.search(actor_text_full)
        if actor_match is None:
            continue
        relation = actor_match.group(1).upper()
        actor_text = _strip_ornament(actor_text_full[: actor_match.start()])
        target_text = _strip_ornament(actor_text_full[actor_match.end():])
        # Drop a trailing single-letter chip if it bled into the actor line.
        target_text = re.sub(r"\s+[A-Z]\s*$", "", target_text).strip()
        actor_conf = actor_line.confidence

        # Find the clock token in any other line of the group.
        clock: str | None = None
        clock_conf: float | None = None
        event_type = "unknown"
        for line in row:
            if line is actor_line:
                continue
            # Clock format bounded to MM ∈ [0, 19], SS ∈ [00, 59] — periods are
            # 20:00 long. Without bounds, OCR misreads like "71:10" leaked
            # through and ended up in the DB as bogus clocks.
            m = re.search(r"([01]?\d:[0-5]\d)", line.text)
            if m and clock is None:
                clock = m.group(1)
                clock_conf = line.confidence
            et = _action_tracker_event_type(line.text)
            if et != "unknown" and event_type == "unknown":
                event_type = et

        events.append(
            ActionTrackerEvent(
                raw_text=ExtractionField(
                    raw_text=joined,
                    value=joined,
                    confidence=actor_conf,
                    status=FieldStatus.OK if actor_conf and actor_conf >= 0.72 else FieldStatus.UNCERTAIN,
                ),
                period_label=period_label_field.raw_text or "",
                period_number=period_number_top,
                event_type=event_type,  # type: ignore[arg-type]
                actor_snapshot=ExtractionField(
                    raw_text=actor_text,
                    value=actor_text,
                    confidence=actor_conf,
                    status=FieldStatus.OK if actor_text else FieldStatus.MISSING,
                ),
                target_snapshot=ExtractionField(
                    raw_text=target_text,
                    value=target_text,
                    confidence=actor_conf,
                    status=FieldStatus.OK if target_text else FieldStatus.MISSING,
                ),
                relation=ExtractionField(
                    raw_text=relation,
                    value=relation,
                    confidence=actor_conf,
                    status=FieldStatus.OK,
                ),
                clock=ExtractionField(
                    raw_text=clock,
                    value=clock,
                    confidence=clock_conf,
                    status=FieldStatus.OK if clock else FieldStatus.MISSING,
                ),
            )
        )
        # Record the actor sub-row's y-center for selection-bar matching.
        # OCR runs on a 2x-upscaled crop (see image.preprocess_image), so
        # divide by 2 to bring the value back to original panel pixel space.
        event_cropped_y_centers.append(actor_line.y_center / 2.0)

    # Phase 5: spatial extraction. Only runs if a full-frame image is supplied
    # (the extractor passes one in production; unit tests may not).
    selected_x: float | None = None
    selected_y: float | None = None
    selected_zone: str | None = None
    selected_confidence: float | None = None
    spatial_marker_count = 0
    spatial_yellow_count = 0
    spatial_warnings: list[str] = []
    detected_markers_payload: list[dict] = []
    # Detect which row in `events` is currently highlighted in the UI by
    # finding the red selection bar on the left edge of the list panel and
    # matching its y-centre against each event's actor-row y-centre.
    selected_event_index: int | None = None
    if image is not None:
        try:
            from game_ocr.spatial import (
                DetectedMarker,
                detect_rink_markers,
                detect_selected_row_index,
                extract_selected_event_position,
                load_rink_calibration,
                pixel_to_hockey,
            )

            cal = load_rink_calibration("post_game_action_tracker")
            spatial = extract_selected_event_position(image, cal)
            spatial_marker_count = spatial.detected_marker_count
            spatial_yellow_count = spatial.yellow_marker_count
            spatial_warnings = list(spatial.warnings)
            if spatial.selected_coordinate is not None:
                selected_x = spatial.selected_coordinate.x
                selected_y = spatial.selected_coordinate.y
                selected_zone = spatial.selected_coordinate.rink_zone
                selected_confidence = spatial.selected_coordinate.confidence

            # Layer-2: emit every detected & classified marker on the rink
            # so the inventory consensus matcher can use them across captures.
            for m in detect_rink_markers(image, cal):
                coord = pixel_to_hockey(m, cal)
                detected_markers_payload.append({
                    "pixel_x": round(m.pixel_x, 2),
                    "pixel_y": round(m.pixel_y, 2),
                    "hockey_x": coord.x,
                    "hockey_y": coord.y,
                    "rink_zone": coord.rink_zone,
                    "confidence": coord.confidence,
                    "color": m.color,
                    "shape_type": m.shape_type,
                    "fill_style": m.fill_style,
                    "area_px": round(m.area_px, 1),
                })

            # Pick which event in `events` is the currently-highlighted one
            # (red row tint in the list panel). list_panel ROI ratios from
            # configs/roi/post_game_action_tracker.yaml.
            if events and event_cropped_y_centers:
                full_h, full_w = image.shape[:2]
                panel_x1 = int(0.075 * full_w)
                panel_y1 = int(0.190 * full_h)
                panel_x2 = int((0.075 + 0.395) * full_w)
                panel_y2 = int((0.190 + 0.700) * full_h)
                selected_event_index = detect_selected_row_index(
                    image,
                    panel_x1,
                    panel_y1,
                    panel_x2,
                    panel_y2,
                    event_cropped_y_centers,
                )
                if selected_event_index is None:
                    spatial_warnings.append(
                        "No highlighted event row detected in list panel"
                    )
        except FileNotFoundError as exc:
            spatial_warnings.append(f"Rink calibration missing: {exc}")
        except Exception as exc:  # noqa: BLE001
            spatial_warnings.append(f"Spatial extraction failed: {exc}")

    return PostGameActionTrackerResult(
        meta=meta,
        filter_label=filter_label,
        period_label=period_label_field,
        period_number=period_number_top,
        events=events,
        selected_event_index=selected_event_index,
        selected_event_x=selected_x,
        selected_event_y=selected_y,
        selected_event_rink_zone=selected_zone,
        selected_event_confidence=selected_confidence,
        spatial_marker_count=spatial_marker_count,
        spatial_yellow_count=spatial_yellow_count,
        spatial_warnings=spatial_warnings,
        detected_markers=detected_markers_payload,
    )


def _group_lines_by_y(lines: list[OCRLine], threshold: float = 20.0) -> list[list[OCRLine]]:
    """Group OCR lines into rows by y-position (cropped image coordinates)."""
    if not lines:
        return []
    ordered = sorted(lines, key=lambda line: (line.y_center, line.x1))
    rows: list[list[OCRLine]] = [[ordered[0]]]
    for line in ordered[1:]:
        last_y = rows[-1][0].y_center
        if abs(line.y_center - last_y) > threshold:
            rows.append([line])
        else:
            rows[-1].append(line)
    return rows


def parse_post_game_player_summary(meta, regions: dict[str, list[OCRLine]], **_kwargs) -> PostGamePlayerSummaryResult:
    away_split = group_lines_by_row(regions["away_players"])[:6]
    home_split = group_lines_by_row(regions["home_players"])[:6]

    players = [build_player_record("away", row) for row in away_split if row]
    players.extend(build_player_record("home", row) for row in home_split if row)

    return PostGamePlayerSummaryResult(
        meta=meta,
        away_team=field_from_lines(regions["away_team"]),
        away_team_abbreviation=field_from_lines(regions["away_team_abbreviation"]),
        away_team_final_score=field_from_lines(regions["away_team_score"], parser=parse_int),
        home_team=field_from_lines(regions["home_team"]),
        home_team_abbreviation=field_from_lines(regions["home_team_abbreviation"]),
        home_team_final_score=field_from_lines(regions["home_team_score"], parser=parse_int),
        players=players,
    )
