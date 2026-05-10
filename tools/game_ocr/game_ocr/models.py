from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class FieldStatus(str, Enum):
    OK = "ok"
    UNCERTAIN = "uncertain"
    MISSING = "missing"


class ExtractionField(BaseModel):
    raw_text: str | None = None
    value: Any = None
    confidence: float | None = None
    status: FieldStatus = FieldStatus.MISSING


class PlayerSlot(BaseModel):
    slot_index: int
    raw_lines: list[str] = Field(default_factory=list)
    fields: dict[str, ExtractionField] = Field(default_factory=dict)


class TeamSummary(BaseModel):
    roster: list[PlayerSlot] = Field(default_factory=list)
    raw_lines: list[str] = Field(default_factory=list)


class ExtractionMeta(BaseModel):
    screen_type: str
    source_path: str
    processed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    ocr_backend: str
    overall_confidence: float | None = None
    duplicate_of: str | None = None


class BaseExtractionResult(BaseModel):
    success: bool
    meta: ExtractionMeta
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class FailedExtractionResult(BaseExtractionResult):
    success: Literal[False] = False


class PreGameLobbyResult(BaseExtractionResult):
    success: Literal[True] = True
    game_mode: ExtractionField
    our_team_name: ExtractionField
    opponent_team_name: ExtractionField
    our_team: TeamSummary
    opponent_team: TeamSummary


class AttributeGroup(BaseModel):
    values: dict[str, ExtractionField] = Field(default_factory=dict)


class PlayerLoadoutResult(BaseExtractionResult):
    success: Literal[True] = True
    selected_player: ExtractionField
    player_position: ExtractionField
    player_name: ExtractionField
    player_level: ExtractionField
    player_platform: ExtractionField
    gamertag: ExtractionField
    home_team: ExtractionField
    build_class: ExtractionField
    height: ExtractionField
    weight: ExtractionField
    handedness: ExtractionField
    x_factors: list[ExtractionField] = Field(default_factory=list)
    attributes: dict[str, AttributeGroup] = Field(default_factory=dict)


class PostGamePlayerRecord(BaseModel):
    side: str
    gamertag: ExtractionField
    player_rank: ExtractionField
    position_played: ExtractionField
    rp: ExtractionField
    goals: ExtractionField
    assists: ExtractionField
    saves: ExtractionField
    save_percentage: ExtractionField


class PostGamePlayerSummaryResult(BaseExtractionResult):
    success: Literal[True] = True
    away_team: ExtractionField
    away_team_abbreviation: ExtractionField
    away_team_final_score: ExtractionField
    home_team: ExtractionField
    home_team_abbreviation: ExtractionField
    home_team_final_score: ExtractionField
    players: list[PostGamePlayerRecord] = Field(default_factory=list)


# ─── Box Score (3 sub-tabs: goals / shots / faceoffs) ─────────────────────────


class BoxScorePeriodCell(BaseModel):
    """One cell from a Box Score grid row.

    period_label: 'Pre' (away/home team-name col), '1ST', '2ND', 'OT', 'TOT', etc.
    period_number: 1=1st, 2=2nd, 3=3rd, 4=OT, 5=OT2, 6=SO, -1=TOT (not a real period).
    """

    period_label: str
    period_number: int
    away_value: ExtractionField
    home_value: ExtractionField


class PostGameBoxScoreResult(BaseExtractionResult):
    success: Literal[True] = True
    # 'goals' | 'shots' | 'faceoffs', sourced from screen_type.
    stat_kind: Literal["goals", "shots", "faceoffs"]
    tab_label: ExtractionField
    away_team: ExtractionField
    home_team: ExtractionField
    period_headers: list[ExtractionField] = Field(default_factory=list)
    periods: list[BoxScorePeriodCell] = Field(default_factory=list)


# ─── Net Chart (shot-type breakdown) ──────────────────────────────────────────


class NetChartSideStats(BaseModel):
    """Per-side shot-type counts. All fields nullable — OCR may miss cells."""

    total_shots: ExtractionField
    wrist_shots: ExtractionField
    slap_shots: ExtractionField
    backhand_shots: ExtractionField
    snap_shots: ExtractionField
    deflections: ExtractionField
    power_play_shots: ExtractionField


class PostGameNetChartResult(BaseExtractionResult):
    success: Literal[True] = True
    period_label: ExtractionField
    """period_number derived from period_label: 1/2/3/4/5/6 for periods, -1 for ALL PERIODS aggregate."""
    period_number: int
    away_label: ExtractionField
    home_label: ExtractionField
    away: NetChartSideStats
    home: NetChartSideStats


# ─── Faceoff Map (audit-only — text panel of zone splits) ─────────────────────


class FaceoffSideStats(BaseModel):
    """Per-side faceoff zone breakdown. Audit-only in v1; no domain promoter."""

    overall_win_pct: ExtractionField
    offensive_zone: ExtractionField  # verbatim "wins/total" string
    defensive_zone: ExtractionField  # verbatim "wins/total" string


class PostGameFaceoffMapResult(BaseExtractionResult):
    success: Literal[True] = True
    period_label: ExtractionField
    period_number: int
    away_label: ExtractionField
    home_label: ExtractionField
    away: FaceoffSideStats
    home: FaceoffSideStats


# ─── Events log (goals + penalties) ───────────────────────────────────────────


class EventRow(BaseModel):
    """One event from the post-game Events screen list.

    event_type: 'goal' | 'penalty' | 'unknown'.
    team_abbreviation: 'BM' | '4TH' (etc) — the team that committed the action.
    period_number / period_label: derived from the most recent period header.
    actor_snapshot: scorer (goal) or culprit (penalty) — verbatim OCR.
    goal_number_in_game: the [N] bracket on goal rows ("nth goal of game" for
        the scorer). Null for non-goal events or when OCR fails to read it.
    assists_snapshot: list of verbatim assist names (only meaningful for goals).
    infraction / penalty_type: only set on penalty events.
    raw_text: the full event line preserved verbatim for review.
    """

    raw_text: ExtractionField
    period_label: str
    period_number: int
    event_type: Literal["goal", "penalty", "unknown"]
    team_abbreviation: ExtractionField
    clock: ExtractionField
    actor_snapshot: ExtractionField
    goal_number_in_game: ExtractionField
    assists_snapshot: list[ExtractionField] = Field(default_factory=list)
    infraction: ExtractionField
    penalty_type: ExtractionField


class PostGameEventsResult(BaseExtractionResult):
    success: Literal[True] = True
    filter_label: ExtractionField
    events: list[EventRow] = Field(default_factory=list)


# ─── Action Tracker (per-period in-game event list) ───────────────────────────


class ActionTrackerEvent(BaseModel):
    """One row from the Action Tracker per-period event list.

    event_type: 'shot' | 'hit' | 'penalty' | 'goal' | 'faceoff' | 'unknown'.
    relation: 'ON' (actor → target action) or 'VS' (faceoff). Verbatim.
    target_snapshot: opposing player involved (faceoff opponent, or hit/shot recipient).
    """

    raw_text: ExtractionField
    period_label: str
    period_number: int
    event_type: Literal["shot", "hit", "penalty", "goal", "faceoff", "unknown"]
    actor_snapshot: ExtractionField
    target_snapshot: ExtractionField
    relation: ExtractionField
    clock: ExtractionField


class PostGameActionTrackerResult(BaseExtractionResult):
    success: Literal[True] = True
    filter_label: ExtractionField
    period_label: ExtractionField
    period_number: int
    events: list[ActionTrackerEvent] = Field(default_factory=list)

