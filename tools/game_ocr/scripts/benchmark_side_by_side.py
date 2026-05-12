"""Side-by-side comparison of OCR-extracted values vs manual ground truth.

Prints markdown tables showing each discrepancy as paired columns so the
operator can quickly tell which side is wrong.

Usage:
    python3 tools/game_ocr/scripts/benchmark_side_by_side.py [--match-id 250]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Reuse the parser + DB code from the diff tool.
_THIS = Path(__file__).resolve()
sys.path.insert(0, str(_THIS.parent))
from benchmark_vs_truth import (  # noqa: E402
    _normalize_name,
    _normalize_clock,
    _clocks_within,
    _clock_to_seconds,
    fetch_db_state,
    parse_truth,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--match-id', type=int, default=250)
    parser.add_argument(
        '--truth',
        default='research/OCR-SS/Manual OCR benchmark for verification V2.md',
    )
    parser.add_argument('--container', default='eanhl-team-website-db-1')
    parser.add_argument('--db-user', default='eanhl')
    parser.add_argument('--db-name', default='eanhl')
    args = parser.parse_args()

    repo_root = _THIS.parent.parent.parent.parent
    truth = parse_truth(repo_root / args.truth)
    db = fetch_db_state(args.match_id, args.container, args.db_user, args.db_name)

    print(f'# OCR vs Manual benchmark — match {args.match_id} (side-by-side)\n')

    _print_box_score(truth, db)
    print()
    _print_events_goals(truth, db)
    print()
    _print_action_tracker(truth, db)
    return 0


# ─── Box Score ────────────────────────────────────────────────────────────


def _print_box_score(truth, db) -> None:
    by_period_db = {
        r['period_number']: r
        for r in db['period_summaries']
        if r['source'] == 'ocr' and r['review_status'] == 'reviewed'
    }
    print('## Box Score (only mismatched cells shown)\n')
    print('| Period | Stat | Side | Manual | OCR | Match? |')
    print('|---|---|---|---|---|---|')
    cells = [
        ('goals_for', 'away_goals', 'goals', 'BGM'),
        ('goals_against', 'home_goals', 'goals', 'OPP'),
        ('shots_for', 'away_shots', 'shots', 'BGM'),
        ('shots_against', 'home_shots', 'shots', 'OPP'),
        ('faceoffs_for', 'away_faceoffs', 'faceoffs', 'BGM'),
        ('faceoffs_against', 'home_faceoffs', 'faceoffs', 'OPP'),
    ]
    rows: list[tuple] = []
    for tbs in truth.box_score:
        db_row = by_period_db.get(tbs.period_number)
        for db_field, truth_field, stat, side in cells:
            t = getattr(tbs, truth_field)
            d = db_row.get(db_field) if db_row else None
            if t == d:
                continue
            rows.append((tbs.period_label, stat, side, t, d))
    if not rows:
        print('| _all cells match_ | | | | | |')
        return
    for r in rows:
        period, stat, side, t, d = r
        match_mark = '✗'
        print(f'| {period} | {stat} | {side} | `{t}` | `{d}` | {match_mark} |')


# ─── Events (goals) ───────────────────────────────────────────────────────


def _print_events_goals(truth, db) -> None:
    """Show every goal in either source, paired across the clock-convention.

    Events screen shows time remaining; Action Tracker shows time elapsed.
    A 20-minute period means: elapsed = 20:00 - remaining.
    """
    print('## Goals — Manual Events screen (time-remaining) vs DB (mixed sources)\n')
    print('| Period | Manual clock | Manual scorer | DB clock | DB scorer | DB source(s) | Note |')
    print('|---|---|---|---|---|---|---|')

    db_goals = [e for e in db['events'] if e['event_type'] == 'goal']
    paired_db_ids: set[int] = set()
    period_minutes = {1: 20, 2: 20, 3: 20, 4: 20}

    for tg in truth.goals:
        truth_clock_secs = _clock_to_seconds(tg.clock)
        period_secs = period_minutes.get(tg.period_number, 20) * 60
        elapsed_secs = period_secs - truth_clock_secs if truth_clock_secs is not None else None
        elapsed_clock = (
            f'{elapsed_secs // 60:02d}:{elapsed_secs % 60:02d}'
            if elapsed_secs is not None else '?'
        )
        truth_scorer = _normalize_name(tg.scorer)

        # Find DB matches by scorer + period (any clock).
        candidates = [
            d for d in db_goals
            if d['period_number'] == tg.period_number
            and _normalize_name(d.get('scorer_snapshot') or d.get('actor_gamertag_snapshot') or '') == truth_scorer
        ]
        if not candidates:
            print(f'| {tg.period_label} | {tg.clock} | {tg.scorer} | — | — | — | manual present, no DB row |')
            continue
        for d in candidates:
            paired_db_ids.add(d['id'])
            db_clock = d.get('clock') or '?'
            db_clock_secs = _clock_to_seconds(db_clock)
            note: list[str] = []
            if db_clock_secs == truth_clock_secs:
                note.append('clock=remaining')
            elif db_clock_secs == elapsed_secs:
                note.append('clock=elapsed')
            else:
                note.append(f'clock-mismatch (manual=remaining {tg.clock} ≡ elapsed {elapsed_clock})')
            scorer_db = d.get('scorer_snapshot') or d.get('actor_gamertag_snapshot') or '?'
            print(
                f'| {tg.period_label} | {tg.clock} | {tg.scorer} | {db_clock} | {scorer_db} | ocr | {"; ".join(note)} |'
            )

    extras = [d for d in db_goals if d['id'] not in paired_db_ids]
    if extras:
        print()
        print('### Extra goals in DB without a manual entry')
        print('| Period | DB clock | DB scorer | Note |')
        print('|---|---|---|---|')
        for d in extras:
            scorer = d.get('scorer_snapshot') or d.get('actor_gamertag_snapshot') or '?'
            print(f'| P{d["period_number"]} | {d.get("clock") or "?"} | {scorer} | likely OCR misclassification or duplicate |')


# ─── Action Tracker ───────────────────────────────────────────────────────


def _print_action_tracker(truth, db) -> None:
    print('## Action Tracker discrepancies (per period)\n')
    db_events = [
        e for e in db['events']
        if e['source'] == 'ocr' and e['review_status'] == 'reviewed'
    ]

    # For each period: list (a) truth events with no DB match (missing),
    # (b) DB events with no truth match (extra), (c) matched events with
    # clock or actor differences.
    by_period: dict[int, dict[str, list]] = {2: {}, 3: {}, 4: {}}
    truth_by_period: dict[int, list] = {2: [], 3: [], 4: []}
    for te in truth.action_tracker:
        truth_by_period.setdefault(te.period_number, []).append(te)

    for period_num in sorted(truth_by_period.keys()):
        truth_events = truth_by_period[period_num]
        if not truth_events:
            continue
        period_label = {2: '2nd', 3: '3rd', 4: 'OT'}.get(period_num, f'P{period_num}')
        print(f'### {period_label} period\n')

        matched_db_ids: set[int] = set()
        matched_pairs: list[tuple] = []
        missing: list = []

        for te in truth_events:
            truth_init = _normalize_name(te.initiator)
            best = None
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
                    best = d
                    break
            if best is not None:
                matched_db_ids.add(best['id'])
                matched_pairs.append((te, best))
            else:
                missing.append(te)

        extras = [
            d for d in db_events
            if d['period_number'] == period_num and d['id'] not in matched_db_ids
        ]

        if missing:
            print(f'#### Missing from DB ({len(missing)}) — manual says present, OCR didn\'t catch')
            print('| Manual type | Manual clock | Manual initiator | Manual receiver |')
            print('|---|---|---|---|')
            for te in missing:
                print(f'| {te.event_type} | {te.clock} | {te.initiator} | {te.receiver} |')
            print()

        if extras:
            print(f'#### Extra in DB ({len(extras)}) — OCR captured, no manual entry')
            print('| DB type | DB clock | DB actor | DB target | Suspected cause |')
            print('|---|---|---|---|---|')
            for d in extras:
                actor = d.get('actor_gamertag_snapshot') or '?'
                target = d.get('target_gamertag_snapshot') or ''
                cause = _suspected_cause(d, truth_events)
                clock_disp = d.get('clock') or '?'
                print(f'| {d["event_type"]} | {clock_disp} | {actor} | {target} | {cause} |')
            print()

        # Matched-with-difference pairs (clocks within tolerance but not exact, or any annotation worth showing)
        diff_pairs = [
            (te, d) for te, d in matched_pairs
            if _normalize_clock(d.get('clock') or '') != te.clock
        ]
        if diff_pairs:
            print(f'#### Matched but clock differs ({len(diff_pairs)})')
            print('| Type | Manual clock | DB clock | Manual actor | DB actor |')
            print('|---|---|---|---|---|')
            for te, d in diff_pairs:
                print(
                    f'| {te.event_type} | {te.clock} | {d.get("clock") or "?"} '
                    f'| {te.initiator} | {d.get("actor_gamertag_snapshot") or "?"} |'
                )
            print()


def _suspected_cause(db_row, truth_events) -> str:
    actor = (db_row.get('actor_gamertag_snapshot') or '').strip()
    if not actor:
        return 'no actor'
    actor_norm = _normalize_name(actor)
    # Check if a truth event has very similar actor name (Levenshtein-1) and same clock
    db_clock = db_row.get('clock') or ''
    db_clock_secs = _clock_to_seconds(db_clock)
    for te in truth_events:
        truth_norm = _normalize_name(te.initiator)
        if _levenshtein(actor_norm, truth_norm) <= 1 and te.event_type == db_row['event_type']:
            te_clock_secs = _clock_to_seconds(te.clock)
            if te_clock_secs is not None and db_clock_secs is not None and abs(te_clock_secs - db_clock_secs) <= 2:
                return f'OCR letter misread of {te.initiator!r}'
    # Bogus clock?
    if db_clock_secs is not None and db_clock_secs > 20 * 60:
        return 'bogus clock (>20:00)'
    # Goal events that are duplicates of Events-screen rows (clock-convention).
    if db_row['event_type'] == 'goal':
        return 'likely Events/Action Tracker clock-convention duplicate'
    return 'unmatched'


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if abs(len(a) - len(b)) > 3:
        return 99
    m, n = len(a), len(b)
    if m == 0:
        return n
    if n == 0:
        return m
    prev = list(range(n + 1))
    curr = [0] * (n + 1)
    for i in range(1, m + 1):
        curr[0] = i
        for j in range(1, n + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            curr[j] = min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
        prev, curr = curr, prev
    return prev[n]


if __name__ == '__main__':
    raise SystemExit(main())
