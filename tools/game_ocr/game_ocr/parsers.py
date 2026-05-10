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


def parse_lobby_team(lines: list[OCRLine], include_player_name: bool) -> TeamSummary:
    ordered = sorted(lines, key=lambda line: (line.y1, line.x1))
    grouped: list[list[OCRLine]] = []
    current: list[OCRLine] = []
    position_tokens = {"LW", "RW", "C", "LD", "RD", "G"}

    for line in ordered:
        upper = line.text.upper()
        if upper in position_tokens:
            if current:
                grouped.append(current)
            current = [line]
        elif current:
            current.append(line)
    if current:
        grouped.append(current)

    roster: list[PlayerSlot] = []
    for index, group in enumerate(grouped, start=1):
        raw_lines = [item.text for item in group]
        joined = " ".join(raw_lines)
        fields = {
            "position": field_from_lines([group[0]]),
            "empty_or_cpu": ExtractionField(
                raw_text="CPU" if "CPU" in joined.upper() else None,
                value="CPU" if "CPU" in joined.upper() else None,
                confidence=max((line.confidence for line in group if "CPU" in line.text.upper()), default=None),
                status=FieldStatus.OK if "CPU" in joined.upper() else FieldStatus.MISSING,
            ),
            "gamertag": field_from_lines(
                [line for line in group[1:] if not any(token in line.text.upper() for token in ("READY", "LVL", "LBS", "CPU", "#"))]
            ),
            "level": field_from_lines([line for line in group if "LVL" in line.text.upper()], parser=parse_int),
            "build": field_from_lines(
                [line for line in group if any(word in line.text.upper() for word in ("SNIPER", "PLAYMAKER", "DEFENSEMAN", "BULLSEYE", "GRINDER", "HYBRID"))]
            ),
            "readiness": field_from_lines([line for line in group if "READY" in line.text.upper()]),
            "raw_measurements": field_from_lines([line for line in group if "'" in line.text or "LBS" in line.text.upper() or "bs" in line.text]),
        }
        if include_player_name:
            fields["player_number"] = field_from_lines([line for line in group if "#" in line.text], parser=parse_int)
            fields["player_name"] = field_from_lines(
                [line for line in group if "#" in line.text],
                parser=lambda text: normalize_text(re.sub(r"^#\d+\s*[-.]*", "", text)),
            )
        roster.append(PlayerSlot(slot_index=index, raw_lines=raw_lines, fields=fields))
    return TeamSummary(roster=roster, raw_lines=[line.text for line in lines])


def parse_pre_game_result(meta, regions: dict[str, list[OCRLine]], include_player_name: bool) -> PreGameLobbyResult:
    our_team = parse_lobby_team(regions["our_team_panel"], include_player_name=include_player_name)
    opponent_team = parse_lobby_team(regions["opponent_team_panel"], include_player_name=include_player_name)
    base_fields = [
        field_from_lines(regions["game_mode"]),
        field_from_lines(regions["our_team_name"]),
        field_from_lines(regions["opponent_team_name"]),
    ]
    return PreGameLobbyResult(
        meta=meta,
        game_mode=base_fields[0],
        our_team_name=base_fields[1],
        opponent_team_name=base_fields[2],
        our_team=our_team,
        opponent_team=opponent_team,
    )


def parse_loadout_result(meta, regions: dict[str, list[OCRLine]]) -> PlayerLoadoutResult:
    height_weight_field = field_from_lines(regions["measurements"])
    height_value, weight_value = split_height_weight(height_weight_field.raw_text)

    x_factor_fields = [field_from_lines([line]) for line in regions["x_factors"][:3]]
    attributes = {
        "technique": AttributeGroup(
            values={
                "wrist_shot_accuracy": field_from_lines(regions["technique"]),
            }
        ),
        "power": AttributeGroup(
            values={
                "wrist_shot_power": field_from_lines(regions["power"]),
            }
        ),
        "playstyle": AttributeGroup(
            values={
                "passing": field_from_lines(regions["playstyle"]),
            }
        ),
        "tenacity": AttributeGroup(
            values={
                "hand_eye": field_from_lines(regions["tenacity"]),
            }
        ),
        "tactics": AttributeGroup(
            values={
                "deking": field_from_lines(regions["tactics"]),
            }
        ),
    }
    result = PlayerLoadoutResult(
        meta=meta,
        selected_player=field_from_lines(regions["selected_player"]),
        player_position=field_from_lines(regions["player_position"], parser=enum_parser({"LW", "RW", "C", "LD", "RD", "G"})),
        player_name=field_from_lines(regions["player_name"]),
        player_level=field_from_lines(regions["player_level"], parser=parse_int),
        player_platform=field_from_lines(regions["player_platform"]),
        gamertag=field_from_lines(regions["gamertag"]),
        home_team=field_from_lines(regions["home_team"]),
        build_class=field_from_lines(regions["build_class"]),
        height=ExtractionField(
            raw_text=height_weight_field.raw_text,
            value=height_value,
            confidence=height_weight_field.confidence,
            status=height_weight_field.status if height_value else FieldStatus.UNCERTAIN,
        ),
        weight=ExtractionField(
            raw_text=height_weight_field.raw_text,
            value=weight_value,
            confidence=height_weight_field.confidence,
            status=height_weight_field.status if weight_value else FieldStatus.UNCERTAIN,
        ),
        handedness=field_from_lines(regions["handedness"]),
        x_factors=x_factor_fields,
        attributes=attributes,
    )
    return result


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
    "SO": 7,
    "TOT": -1,
    "FINAL": -1,
}

# Common OCR misreads of period header tokens, mapped to their canonical form.
_BOX_SCORE_PERIOD_ALIASES = {
    "S0": "SO",
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

    return PostGameBoxScoreResult(
        meta=meta,
        stat_kind=stat_kind,  # type: ignore[arg-type]
        tab_label=tab_label,
        away_team=away_team,
        home_team=home_team,
        period_headers=period_headers,
        periods=periods,
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


def parse_post_game_net_chart(meta, regions: dict[str, list[OCRLine]]) -> PostGameNetChartResult:
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


def parse_post_game_faceoff_map(meta, regions: dict[str, list[OCRLine]]) -> PostGameFaceoffMapResult:
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
_EVENT_CLOCK_RE = re.compile(r"(\d{1,2}:\d{2})")
_EVENT_GOAL_RE = re.compile(
    r"^\s*"
    r"(?P<clock>\d{1,2}:\d{2})\s+"
    r"(?P<scorer>.+?)\s*"
    r"[\[\(](?P<goal_num>\d+)[\]\)]\s*"
    r"[\[\(](?P<assists>.+?)[\]\)]\s*$",
    re.IGNORECASE,
)
# Goal event without explicit goal number (sometimes OT entries):
#   <CLOCK> <SCORER> [assist1, assist2]
_EVENT_GOAL_NO_NUM_RE = re.compile(
    r"^\s*"
    r"(?P<clock>\d{1,2}:\d{2})\s+"
    r"(?P<scorer>.+?)\s*"
    r"[\[\(](?P<assists>[^\[\(\]\)]+)[\]\)]\s*$",
    re.IGNORECASE,
)
_EVENT_PENALTY_RE = re.compile(
    r"^\s*"
    r"(?P<clock>\d{1,2}:\d{2})\s+"
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


def parse_post_game_events(meta, regions: dict[str, list[OCRLine]]) -> PostGameEventsResult:
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


def parse_post_game_action_tracker(meta, regions: dict[str, list[OCRLine]]) -> PostGameActionTrackerResult:
    """Parse the Action Tracker left-panel event list.

    Each event renders as TWO OCR rows in vertical proximity:
      Row A:  "<ACTOR> ON|VS <TARGET>"   (and a chip 'S/H/P/G/F' to the right)
      Row B:  "<EVENT_TYPE> <CLOCK>|<period text>"

    Strategy: tightly group rows by y, then walk in pairs. The first row gives
    actor/target/relation; the second gives event_type and clock.
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
            m = re.search(r"(\d{1,2}:\d{2})", line.text)
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

    return PostGameActionTrackerResult(
        meta=meta,
        filter_label=filter_label,
        period_label=period_label_field,
        period_number=period_number_top,
        events=events,
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


def parse_post_game_player_summary(meta, regions: dict[str, list[OCRLine]]) -> PostGamePlayerSummaryResult:
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
