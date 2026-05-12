"""Benchmark OCR-derived data against the manually-recorded ground truth.

The ground truth markdown lives at:
  research/OCR-SS/Manual OCR benchmark for verification.md

It contains per-screen tables with the canonical values for one match
(currently match 250 / BGM 4-3 4th Line). This script:

  1. Parses every relevant table from the markdown.
  2. Queries the DB for that match's OCR-derived rows.
  3. Compares cell-by-cell, emitting a per-screen report:
       - matches  → counted toward accuracy
       - missing  → in ground truth but not in DB
       - extra    → in DB but not in ground truth
       - mismatched → present in both but value differs

Usage:
    python3 tools/game_ocr/scripts/benchmark_vs_truth.py [--match-id 250]

Reads DATABASE_URL from the environment. Run from repo root:
    set -a && source .env && set +a && \\
    python3 tools/game_ocr/scripts/benchmark_vs_truth.py --match-id 250

Reports go to stdout. Exit code 0 on a successful run regardless of accuracy
(this is a diagnostic tool, not a CI gate).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


# ─── Markdown parsing ────────────────────────────────────────────────────────


@dataclass
class MarkdownTable:
    """A pipe-delimited markdown table parsed into header + rows."""

    headers: list[str]
    rows: list[list[str]]

    def find_header(self, name: str) -> int | None:
        for i, h in enumerate(self.headers):
            if h.strip().lower() == name.strip().lower():
                return i
        return None


def _parse_md_tables(lines: list[str], start_idx: int, stop_at_heading: str | None = None) -> list[MarkdownTable]:
    """Walk forward through `lines` from `start_idx`, return all pipe tables.

    Stops at the next markdown heading whose level is <= stop_at_heading
    (a sentinel string match — naive but works for this doc's structure).

    `start_idx` is treated as the heading line itself, so we begin scanning
    from `start_idx + 1`.
    """
    out: list[MarkdownTable] = []
    i = start_idx + 1
    while i < len(lines):
        line = lines[i].rstrip()
        # Bail at the next major heading if requested.
        if stop_at_heading and line.startswith(stop_at_heading):
            break
        if line.startswith('|') and '|' in line[1:]:
            headers = _split_md_row(line)
            # Next line must be a separator '---' row to qualify.
            if i + 1 < len(lines) and re.match(r'^\|[\s|:-]+\|\s*$', lines[i + 1]):
                rows: list[list[str]] = []
                j = i + 2
                while j < len(lines) and lines[j].lstrip().startswith('|'):
                    rows.append(_split_md_row(lines[j]))
                    j += 1
                out.append(MarkdownTable(headers=headers, rows=rows))
                i = j
                continue
        i += 1
    return out


def _split_md_row(line: str) -> list[str]:
    """Split a `| a | b | c |` row into ['a', 'b', 'c']."""
    line = line.strip()
    if line.startswith('|'):
        line = line[1:]
    if line.endswith('|'):
        line = line[:-1]
    cells = [c.strip() for c in line.split('|')]
    return cells


def _find_section(lines: list[str], heading_re: re.Pattern[str]) -> int:
    """Return line index of the first heading matching the regex."""
    for i, ln in enumerate(lines):
        if heading_re.match(ln):
            return i
    return -1


# ─── Ground truth extraction ──────────────────────────────────────────────────


@dataclass
class TruthBoxScore:
    period_label: str  # '1st', '2nd', '3rd', 'OT'
    period_number: int
    away_goals: int | None
    home_goals: int | None
    away_shots: int | None
    home_shots: int | None
    away_faceoffs: int | None
    home_faceoffs: int | None


@dataclass
class TruthGoal:
    period_number: int
    period_label: str
    team: str  # 'BM' or '4th'
    clock: str  # 'MM:SS'
    scorer: str  # normalized
    primary_assist: str | None
    secondary_assist: str | None


@dataclass
class TruthEvent:
    period_number: int
    period_label: str
    event_type: str  # 'shot' | 'hit' | 'faceoff' | 'goal' | 'penalty'
    clock: str  # 'MM:SS' normalized
    initiator: str  # normalized
    receiver: str  # normalized


@dataclass
class TruthData:
    box_score: list[TruthBoxScore] = field(default_factory=list)
    goals: list[TruthGoal] = field(default_factory=list)
    action_tracker: list[TruthEvent] = field(default_factory=list)


_PERIOD_LABEL_TO_NUMBER = {
    '1st': 1,
    '2nd': 2,
    '3rd': 3,
    'OT': 4,
    'Overtime': 4,
}


def _normalize_clock(raw: str) -> str:
    """Canonicalize various clock formats to 'MM:SS'.

    Examples:
      '0:01'   → '00:01'
      '06:19'  → '06:19'
      '14:53'  → '14:53'
      '933'    → '09:33'  (3 digits = M:SS)
      '1020'   → '10:20'  (4 digits = MM:SS)
      '1913'   → '19:13'
    """
    raw = raw.strip()
    if not raw:
        return ''
    # Try MM:SS or M:SS first.
    m = re.match(r'^(\d{1,2}):(\d{2})$', raw)
    if m:
        return f"{int(m.group(1)):02d}:{m.group(2)}"
    # Bare digits (no colon).
    if raw.isdigit():
        if len(raw) == 3:
            return f"0{raw[0]}:{raw[1:]}"
        if len(raw) == 4:
            return f"{raw[:2]}:{raw[2:]}"
    return raw  # leave malformed values intact for the diff to flag


# Map possessive ornament prefixes to canonical names. The benchmark uses
# variants like '-, Silky', '-. Silky', 'SILKY', 'Silky' — all the same player.
def _normalize_name(raw: str) -> str:
    s = raw.strip()
    # Strip leading "-, " / "-. " / "-." ornaments.
    s = re.sub(r'^[-,.\s]+', '', s)
    # Drop trailing punctuation noise.
    s = re.sub(r'[\s,.]+$', '', s)
    # Lowercase for case-insensitive comparison; keep the dot in 'M. Lehmann'.
    s = re.sub(r'\s+', ' ', s).strip()
    return s.lower()


def parse_truth(md_path: Path) -> TruthData:
    text = md_path.read_text()
    lines = text.splitlines()

    truth = TruthData()

    # ─── Box Score ────────────────────────────────────────────────────────
    bs_idx = _find_section(lines, re.compile(r'^##\s+Box-Score\s*$'))
    if bs_idx >= 0:
        # Three subsections: Goal Summary, Shot Summary, Faceoff Summary.
        # Each has a 2-row table (one per team) with columns:
        #   Team | (blank) | 1st | 2nd | 3rd | OT | TOT | (final)
        bs_tables = _parse_md_tables(lines, bs_idx, stop_at_heading='## ')
        # Expect exactly 3 tables in order: goals, shots, faceoffs.
        labels = ['1st', '2nd', '3rd', 'OT']
        kinds = ['goals', 'shots', 'faceoffs']
        if len(bs_tables) >= 3:
            box_by_period: dict[str, dict[str, dict[str, int | None]]] = {
                lbl: {k: {'away': None, 'home': None} for k in kinds} for lbl in labels
            }
            for kind, table in zip(kinds, bs_tables[:3]):
                # Map column header → index. Table headers look like:
                # ['Team', '', '1st', '2nd', '3rd', 'OT', 'TOT', '']
                col_idx = {h: i for i, h in enumerate(table.headers)}
                # Two data rows: away (BGM = "The Boogeymen") and home ("4th Line").
                if len(table.rows) >= 2:
                    away_row, home_row = table.rows[0], table.rows[1]
                    for lbl in labels:
                        if lbl in col_idx:
                            box_by_period[lbl][kind]['away'] = _to_int(
                                away_row[col_idx[lbl]] if col_idx[lbl] < len(away_row) else ''
                            )
                            box_by_period[lbl][kind]['home'] = _to_int(
                                home_row[col_idx[lbl]] if col_idx[lbl] < len(home_row) else ''
                            )
            for lbl in labels:
                truth.box_score.append(
                    TruthBoxScore(
                        period_label=lbl,
                        period_number=_PERIOD_LABEL_TO_NUMBER[lbl],
                        away_goals=box_by_period[lbl]['goals']['away'],
                        home_goals=box_by_period[lbl]['goals']['home'],
                        away_shots=box_by_period[lbl]['shots']['away'],
                        home_shots=box_by_period[lbl]['shots']['home'],
                        away_faceoffs=box_by_period[lbl]['faceoffs']['away'],
                        home_faceoffs=box_by_period[lbl]['faceoffs']['home'],
                    )
                )

    # ─── Events (goals only) ────────────────────────────────────────────
    ev_idx = _find_section(lines, re.compile(r'^##\s+Events\s*$'))
    if ev_idx >= 0:
        ev_tables = _parse_md_tables(lines, ev_idx, stop_at_heading='## ')
        # The Events markdown is ONE big table whose first column carries
        # period headings (e.g. "1st Period:") in some rows and is blank in
        # event rows. Track the active period as we walk down.
        if ev_tables:
            t = ev_tables[0]
            period_now = ''
            for row in t.rows:
                if not row:
                    continue
                first = row[0].strip() if row else ''
                period_match = re.match(
                    r'^(\d+(?:st|nd|rd)|Overtime)(?:\s*Period)?:?$',
                    first,
                    re.IGNORECASE,
                )
                if period_match:
                    period_now = period_match.group(1)
                    continue
                if 'No Events' in (first or ''):
                    continue
                # Row schema: [period?, Team Abbv., Time, Scorer, Assists]
                if len(row) >= 5 and row[1].strip():  # team col present
                    team = row[1].strip()
                    clock = _normalize_clock(row[2])
                    scorer_raw = row[3].strip()
                    # Scorer like "-, Silky(1)" or "M. Rantanen(1)" — strip the goal-number bracket.
                    scorer = re.sub(r'\(\d+\)', '', scorer_raw).strip()
                    assists_raw = row[4].strip()
                    # Assists like "(E. Wanhg, -, SIlky)" — strip parens, split on comma.
                    inner = assists_raw.strip('()').strip()
                    parts = [p.strip() for p in inner.split(',') if p.strip()]
                    # Filter out lone "-" tokens from "-, Silky" splits — group adjacent pairs.
                    assists: list[str] = []
                    j = 0
                    while j < len(parts):
                        p = parts[j]
                        if p == '-' and j + 1 < len(parts):
                            assists.append(f"{p}, {parts[j + 1]}")
                            j += 2
                        else:
                            assists.append(p)
                            j += 1
                    primary = assists[0] if len(assists) >= 1 else None
                    secondary = assists[1] if len(assists) >= 2 else None

                    period_label = period_now
                    period_number = _PERIOD_LABEL_TO_NUMBER.get(period_label, 0)
                    truth.goals.append(
                        TruthGoal(
                            period_number=period_number,
                            period_label=period_label,
                            team=team,
                            clock=clock,
                            scorer=scorer,
                            primary_assist=primary,
                            secondary_assist=secondary,
                        )
                    )

    # ─── Action Tracker (events per period) ───────────────────────────────
    # Each period subsection (### 2nd Period, ### 3rd Period, ### Overtime)
    # has multiple small tables; the LAST table per period contains the events.
    action_periods = [
        ('2nd', re.compile(r'^###\s+2nd Period\s*$')),
        ('3rd', re.compile(r'^###\s+3rd Period\s*$')),
        ('OT', re.compile(r'^###\s+Overtime\s*$')),
    ]
    for label, heading_re in action_periods:
        idx = _find_section(lines, heading_re)
        if idx < 0:
            continue
        period_number = _PERIOD_LABEL_TO_NUMBER[label]
        tables = _parse_md_tables(lines, idx, stop_at_heading='### ')
        # Find the events table — it has columns like 'Event Type', 'Initiator', etc.
        ev_table: MarkdownTable | None = None
        for t in tables:
            if any('Event Type' in h for h in t.headers):
                ev_table = t
                break
        if ev_table is None:
            continue
        col_type = ev_table.find_header('Event Type')
        col_clock = next((i for i, h in enumerate(ev_table.headers) if 'Event Time' in h), None)
        col_init = next(
            (i for i, h in enumerate(ev_table.headers) if 'Initiator' in h or 'Scorer' in h),
            None,
        )
        col_recv = next(
            (i for i, h in enumerate(ev_table.headers) if 'Receiver' in h or 'Goalie' in h),
            None,
        )
        if None in (col_type, col_clock, col_init, col_recv):
            continue
        for row in ev_table.rows:
            if len(row) <= max(col_type, col_clock, col_init, col_recv):
                continue
            etype_raw = row[col_type].strip().lower()
            if not etype_raw:
                continue
            truth.action_tracker.append(
                TruthEvent(
                    period_number=period_number,
                    period_label=label,
                    event_type=etype_raw,
                    clock=_normalize_clock(row[col_clock]),
                    initiator=row[col_init].strip(),
                    receiver=row[col_recv].strip(),
                )
            )

    return truth


def _to_int(raw: str) -> int | None:
    raw = raw.strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


# ─── DB queries ──────────────────────────────────────────────────────────────


def _run_psql(sql: str, container: str, db_user: str, db_name: str) -> list[dict[str, Any]]:
    """Run a SQL query via `docker exec psql` and parse its JSON output."""
    wrapped = f"SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)::text FROM ({sql}) t"
    proc = subprocess.run(
        [
            'docker', 'exec', '-i', container,
            'psql', '-U', db_user, '-d', db_name, '-At', '-c', wrapped,
        ],
        capture_output=True, text=True, check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f'psql failed: {proc.stderr.strip()}')
    return json.loads(proc.stdout.strip() or '[]')


def fetch_db_state(match_id: int, container: str, db_user: str, db_name: str) -> dict[str, Any]:
    period_summaries = _run_psql(
        f"""
        SELECT period_number, period_label,
               goals_for, goals_against,
               shots_for, shots_against,
               faceoffs_for, faceoffs_against,
               source, review_status
          FROM match_period_summaries
         WHERE match_id = {match_id}
         ORDER BY period_number, source
        """,
        container, db_user, db_name,
    )

    events = _run_psql(
        f"""
        SELECT me.id, me.period_number, me.period_label, me.clock,
               me.event_type, me.team_side, me.team_abbreviation,
               me.actor_gamertag_snapshot, me.target_gamertag_snapshot,
               me.x, me.y, me.rink_zone, me.source, me.review_status,
               mge.scorer_snapshot, mge.primary_assist_snapshot,
               mge.secondary_assist_snapshot
          FROM match_events me
          LEFT JOIN match_goal_events mge ON mge.event_id = me.id
         WHERE me.match_id = {match_id}
         ORDER BY me.period_number, me.clock
        """,
        container, db_user, db_name,
    )

    return {'period_summaries': period_summaries, 'events': events}


# ─── Comparison logic ─────────────────────────────────────────────────────────


@dataclass
class Discrepancy:
    section: str
    severity: str  # 'missing' | 'extra' | 'mismatched'
    detail: str


@dataclass
class ScreenReport:
    name: str
    matched: int = 0
    total_truth: int = 0
    total_db: int = 0
    discrepancies: list[Discrepancy] = field(default_factory=list)

    def accuracy_pct(self) -> float:
        denom = max(self.total_truth, self.total_db, 1)
        return 100.0 * self.matched / denom


def compare_box_score(truth: TruthData, db: dict[str, Any]) -> ScreenReport:
    """Compare per-period goal/shot/faceoff cells.

    OCR rows are BGM-perspective (`for/against`). Truth recorded BGM as the
    AWAY team. So `away_goals` (truth) ↔ `goals_for` (OCR).
    """
    rep = ScreenReport(name='Box Score')
    by_period_db: dict[int, dict[str, Any]] = {}
    for r in db['period_summaries']:
        if r['source'] != 'ocr':
            continue
        if r['review_status'] != 'reviewed':
            continue
        by_period_db[r['period_number']] = r

    cells_to_check = [
        ('goals_for', 'away_goals', 'goals_for/away'),
        ('goals_against', 'home_goals', 'goals_against/home'),
        ('shots_for', 'away_shots', 'shots_for/away'),
        ('shots_against', 'home_shots', 'shots_against/home'),
        ('faceoffs_for', 'away_faceoffs', 'faceoffs_for/away'),
        ('faceoffs_against', 'home_faceoffs', 'faceoffs_against/home'),
    ]
    for tbs in truth.box_score:
        db_row = by_period_db.get(tbs.period_number)
        for db_field, truth_field, label in cells_to_check:
            truth_val = getattr(tbs, truth_field)
            rep.total_truth += 1
            if db_row is None:
                rep.discrepancies.append(
                    Discrepancy(
                        section=f'Box Score {tbs.period_label}',
                        severity='missing',
                        detail=f'no DB row; truth {label}={truth_val}',
                    )
                )
                continue
            db_val = db_row.get(db_field)
            if db_val is not None:
                rep.total_db += 1
            if truth_val == db_val:
                rep.matched += 1
            else:
                rep.discrepancies.append(
                    Discrepancy(
                        section=f'Box Score {tbs.period_label}',
                        severity='mismatched' if db_val is not None else 'missing',
                        detail=f'{label}: truth={truth_val} db={db_val}',
                    )
                )
    return rep


def compare_events(truth: TruthData, db: dict[str, Any]) -> ScreenReport:
    """Compare goals from the Events screen.

    The Events screen renders the clock as time REMAINING in the period; the
    DB stores ELAPSED (matches Action Tracker convention). Convert truth's
    remaining→elapsed before matching so the same goal lines up regardless
    of which screen it came from.

    Match key: (period_number, normalized_scorer, elapsed_clock_within_2s).
    """
    rep = ScreenReport(name='Events (goals)')
    rep.total_truth = len(truth.goals)

    db_goals = [e for e in db['events'] if e['event_type'] == 'goal']
    rep.total_db = len(db_goals)

    matched_db_ids: set[int] = set()
    for tg in truth.goals:
        truth_remaining_sec = _clock_to_seconds(tg.clock)
        truth_elapsed_sec = (20 * 60 - truth_remaining_sec) if truth_remaining_sec is not None else None
        truth_elapsed_clock = (
            f'{truth_elapsed_sec // 60}:{truth_elapsed_sec % 60:02d}'
            if truth_elapsed_sec is not None else tg.clock
        )
        truth_scorer_norm = _normalize_name(tg.scorer)
        match = None
        for d in db_goals:
            if d['period_number'] != tg.period_number:
                continue
            if d['id'] in matched_db_ids:
                continue
            scorer_norm = _normalize_name(d.get('scorer_snapshot') or d.get('actor_gamertag_snapshot') or '')
            if scorer_norm != truth_scorer_norm:
                continue
            if _clocks_within(d.get('clock') or '', truth_elapsed_clock, 2):
                match = d
                break
        if match is not None:
            matched_db_ids.add(match['id'])
            rep.matched += 1
            db_clock = match.get('clock') or ''
            if db_clock and _clock_to_seconds(db_clock) != truth_elapsed_sec:
                rep.discrepancies.append(
                    Discrepancy(
                        section='Events',
                        severity='mismatched',
                        detail=(
                            f'goal {tg.period_label} {tg.scorer} '
                            f'truth_elapsed={truth_elapsed_clock} db_clock={db_clock}'
                        ),
                    )
                )
        else:
            rep.discrepancies.append(
                Discrepancy(
                    section='Events',
                    severity='missing',
                    detail=(
                        f'goal {tg.period_label} {tg.clock} (≡{truth_elapsed_clock} elapsed) {tg.scorer}'
                    ),
                )
            )

    for d in db_goals:
        if d['id'] not in matched_db_ids:
            scorer = d.get('scorer_snapshot') or d.get('actor_gamertag_snapshot') or '?'
            rep.discrepancies.append(
                Discrepancy(
                    section='Events',
                    severity='extra',
                    detail=f"db goal P{d['period_number']} {d.get('clock') or '?'} {scorer}",
                )
            )

    return rep


def compare_action_tracker(truth: TruthData, db: dict[str, Any]) -> ScreenReport:
    """Compare full event log from Action Tracker.

    Match key: (period_number, event_type, clock_within_2s, normalized_initiator).
    Reports missing-from-db, extra-in-db, and clock mismatches.
    """
    rep = ScreenReport(name='Action Tracker')
    truth_events = truth.action_tracker
    rep.total_truth = len(truth_events)

    db_events = [
        e for e in db['events']
        if e['source'] == 'ocr' and e['review_status'] == 'reviewed'
    ]
    rep.total_db = len(db_events)

    matched_db_ids: set[int] = set()
    for te in truth_events:
        truth_init = _normalize_name(te.initiator)
        match = None
        for d in db_events:
            if d['id'] in matched_db_ids:
                continue
            if d['period_number'] != te.period_number:
                continue
            if d['event_type'] != te.event_type:
                continue
            actor = _normalize_name(d.get('actor_gamertag_snapshot') or '')
            if actor != truth_init:
                continue
            if _clocks_within(d.get('clock') or '', te.clock, 2):
                match = d
                break
        if match is not None:
            matched_db_ids.add(match['id'])
            rep.matched += 1
        else:
            rep.discrepancies.append(
                Discrepancy(
                    section=f'Action Tracker {te.period_label}',
                    severity='missing',
                    detail=f'{te.event_type:7} {te.clock} {te.initiator} → {te.receiver}',
                )
            )

    for d in db_events:
        if d['id'] in matched_db_ids:
            continue
        # Skip rows that came from the Events screen only (no Action Tracker
        # equivalent — we'd double-count). Heuristic: if the actor matches a
        # truth-side gamertag, but no Action Tracker truth event matched,
        # it's "extra" or "OCR misclassification".
        actor = d.get('actor_gamertag_snapshot') or '?'
        rep.discrepancies.append(
            Discrepancy(
                section=f"Action Tracker P{d['period_number']}",
                severity='extra',
                detail=f"{d['event_type']:7} {d.get('clock') or '?'} {actor}",
            )
        )

    return rep


def _clocks_within(a: str, b: str, tolerance_sec: int) -> bool:
    a_n = _clock_to_seconds(a)
    b_n = _clock_to_seconds(b)
    if a_n is None or b_n is None:
        return a == b
    return abs(a_n - b_n) <= tolerance_sec


def _clock_to_seconds(raw: str) -> int | None:
    raw = (raw or '').strip()
    if not raw:
        return None
    norm = _normalize_clock(raw)
    m = re.match(r'^(\d{1,2}):(\d{2})$', norm)
    if not m:
        return None
    return int(m.group(1)) * 60 + int(m.group(2))


# ─── Report formatting ────────────────────────────────────────────────────────


def render_report(reports: list[ScreenReport]) -> str:
    out: list[str] = []
    out.append('OCR vs Manual Ground Truth — Match Benchmark')
    out.append('=' * 50)
    out.append('')

    for r in reports:
        line = f'{r.name:30} matched={r.matched:>3}/{r.total_truth:<3}  db={r.total_db:<3}  acc={r.accuracy_pct():5.1f}%'
        out.append(line)

    out.append('')
    out.append('─' * 50)

    by_section: dict[str, list[Discrepancy]] = {}
    for r in reports:
        for d in r.discrepancies:
            by_section.setdefault(d.section, []).append(d)
    for section, items in sorted(by_section.items()):
        out.append(f'\n{section}  ({len(items)} discrepanc{"y" if len(items) == 1 else "ies"})')
        for d in items:
            out.append(f'  [{d.severity:11}] {d.detail}')
    return '\n'.join(out)


# ─── Main ─────────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--match-id', type=int, default=250)
    parser.add_argument(
        '--truth',
        default='research/OCR-SS/Manual OCR benchmark for verification V2.md',
        help='Path to the markdown ground-truth file (relative to repo root)',
    )
    parser.add_argument('--container', default='eanhl-team-website-db-1')
    parser.add_argument('--db-user', default='eanhl')
    parser.add_argument('--db-name', default='eanhl')
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent.parent.parent
    truth_path = repo_root / args.truth
    if not truth_path.exists():
        print(f'Truth file not found: {truth_path}', file=sys.stderr)
        return 2

    truth = parse_truth(truth_path)
    print(
        f'Parsed truth: {len(truth.box_score)} box-score periods, '
        f'{len(truth.goals)} goals, {len(truth.action_tracker)} action-tracker events',
        file=sys.stderr,
    )

    db = fetch_db_state(args.match_id, args.container, args.db_user, args.db_name)

    reports = [
        compare_box_score(truth, db),
        compare_events(truth, db),
        compare_action_tracker(truth, db),
    ]
    print(render_report(reports))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
