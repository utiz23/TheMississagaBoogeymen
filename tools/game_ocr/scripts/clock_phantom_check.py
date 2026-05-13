"""Clock-OCR phantom detector — post-ingestion sanity sweep.

Runs AFTER the three OCR position tiers (single-capture promoter +
inventory_consensus_match.py + cutoff_event_recovery.py). Handles the
class of duplicate left over when the actor and event type are correct
but OCR misread the clock — e.g. `11:10` parsed as `1:10`. Fuzzy actor
dedup at promoter time can't catch these because the clock is part of
the dedup key.

Heuristic, per (match, period, event_type, actor_player_id) bucket
(resolved actors only — `actor_player_id IS NOT NULL`):

  For every pair (A, B) of rows in the bucket:
    1. Clock-similarity:
       - Digit-string contiguous-substring with length-diff == 1
         (catches '1:10' ⊂ '11:10', rejects '1:10' vs '21:10').
       - OR Levenshtein(clockA, clockB) ≤ 1 (catches '5:07' ↔ '5:09').
    2. Position-asymmetry: exactly one of A, B has `x IS NULL`.

  Both must pass. The unpositioned row is the phantom and is deleted;
  the positioned row is the canonical survivor.

Skips:
  - Pairs where both rows have positions (likely two real events at
    close clocks).
  - Pairs where both rows lack positions (can't tell which is the
    phantom — emits a warning).
  - Buckets with null actor_player_id (opp players aren't in `players`
    or aliases; a future enhancement could fuzzy-match on actor strings
    inside the bucket, but no known instances exist today).

Usage:
  docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -tAc \\
    "SELECT json_agg(json_build_object('id', id, 'period_number', period_number, \\
        'event_type', event_type, 'clock', clock, \\
        'actor_player_id', actor_player_id, 'actor', actor_gamertag_snapshot, \\
        'x', x, 'y', y)) \\
     FROM match_events WHERE match_id=250 AND source='ocr' \\
       AND event_type IN ('shot','hit','goal','penalty')" \\
    | python3 tools/game_ocr/scripts/clock_phantom_check.py 250 --apply \\
    | docker exec -i eanhl-team-website-db-1 psql -U eanhl -d eanhl

Without `--apply` (default): emits BEGIN/COMMIT shell only on stdout;
predictions on stderr. With `--apply`: emits actual `DELETE` statements.
Idempotent — a second run after a successful apply finds 0 phantoms.
"""

from __future__ import annotations

import json
import subprocess
import sys


def levenshtein(a: str, b: str, max_distance: int) -> int:
    """Levenshtein distance, capped at maxDistance + 1 for early exit.
    Mirrors apps/worker/src/ocr-promoters/resolve-identity.ts:54 in Python."""
    if abs(len(a) - len(b)) > max_distance:
        return max_distance + 1
    m, n = len(a), len(b)
    if m == 0:
        return n
    if n == 0:
        return m
    prev = list(range(n + 1))
    curr = [0] * (n + 1)
    for i in range(1, m + 1):
        curr[0] = i
        min_row = i
        for j in range(1, n + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            v = min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
            curr[j] = v
            if v < min_row:
                min_row = v
        if min_row > max_distance:
            return max_distance + 1
        prev, curr = curr, prev
    return prev[n]


def clock_substring(a: str, b: str) -> bool:
    """True if one clock's digit-string is a contiguous substring of the
    other AND the length difference is exactly 1.

    The length-diff == 1 constraint avoids false positives like
    '1:10' vs '21:10' (digits 110 ⊂ 2110 but length diff 2 — different
    events). The expected phantom pattern is dropping a single leading
    digit during OCR: 11:10 → 1:10.
    """
    da = a.replace(":", "")
    db = b.replace(":", "")
    if abs(len(da) - len(db)) != 1:
        return False
    if len(da) < len(db):
        return da in db
    return db in da


def fetch_match_events(match_id: int) -> list[dict]:
    sql = (
        "SELECT json_agg(json_build_object("
        "'id', id, 'period_number', period_number, 'event_type', event_type, "
        "'team_side', team_side, 'clock', clock, "
        "'actor_player_id', actor_player_id, 'actor', actor_gamertag_snapshot, "
        "'x', x, 'y', y)) "
        f"FROM match_events WHERE match_id={match_id} "
        "AND source='ocr' "
        "AND event_type IN ('shot', 'hit', 'goal', 'penalty')"
    )
    res = subprocess.run(
        ["docker", "exec", "eanhl-team-website-db-1",
         "psql", "-U", "eanhl", "-d", "eanhl", "-tAc", sql],
        check=True, capture_output=True, text=True,
    )
    data = res.stdout.strip()
    return json.loads(data) if data and data != "null" else []


def find_phantoms(events: list[dict]) -> list[tuple[dict, dict, str]]:
    """Returns (phantom_row, canonical_row, rationale) triples."""
    buckets: dict[tuple, list[dict]] = {}
    for e in events:
        if e.get("actor_player_id") is None:
            continue
        key = (e["period_number"], e["event_type"], e["actor_player_id"])
        buckets.setdefault(key, []).append(e)

    out: list[tuple[dict, dict, str]] = []
    for _key, rows in buckets.items():
        if len(rows) < 2:
            continue
        for i, a in enumerate(rows):
            for b in rows[i + 1:]:
                ac = a.get("clock") or ""
                bc = b.get("clock") or ""
                if not ac or not bc:
                    continue
                sub = clock_substring(ac, bc)
                lev = levenshtein(ac, bc, 1) <= 1
                if not (sub or lev):
                    continue
                a_has = a.get("x") is not None
                b_has = b.get("x") is not None
                if a_has == b_has:
                    continue  # both positioned or both null → skip
                phantom = b if not b_has else a
                canonical = a if b is phantom else b
                kind = "substring" if sub else "levenshtein-1"
                rationale = (
                    f"clock pair ({a['clock']}, {b['clock']}) via {kind}; "
                    f"phantom = unpositioned row"
                )
                out.append((phantom, canonical, rationale))
    return out


def main() -> int:
    apply = "--apply" in sys.argv
    args = [a for a in sys.argv[1:] if a not in ("--apply", "--dry-run")]
    if not args:
        print(
            "usage: clock_phantom_check.py <match_id> [--apply]",
            file=sys.stderr,
        )
        return 2
    match_id = int(args[0])

    events = fetch_match_events(match_id)
    print(
        f"-- clock_phantom_check: match_id={match_id} events={len(events)} apply={apply}",
        file=sys.stderr,
    )

    phantoms = find_phantoms(events)

    print("BEGIN;")
    for phantom, canonical, rationale in phantoms:
        print(
            f"\n== phantom candidate match_id={match_id} ==",
            file=sys.stderr,
        )
        print(
            f"  phantom:   id={phantom['id']} clock={phantom['clock']!r} "
            f"actor={phantom.get('actor')!r} player_id={phantom['actor_player_id']}",
            file=sys.stderr,
        )
        print(
            f"  canonical: id={canonical['id']} clock={canonical['clock']!r} "
            f"x={canonical['x']} y={canonical['y']}",
            file=sys.stderr,
        )
        print(f"  rationale: {rationale}", file=sys.stderr)
        if apply:
            # Order matters: clear extension-table FK rows first, then the
            # parent match_events row. Both extension tables are CASCADE-free,
            # so explicit DELETEs are required even when no extension row exists
            # (the no-op DELETE is fine).
            print(f"DELETE FROM match_goal_events WHERE event_id={phantom['id']};")
            print(f"DELETE FROM match_penalty_events WHERE event_id={phantom['id']};")
            print(f"DELETE FROM match_events WHERE id={phantom['id']};")

    print("COMMIT;")
    print(
        f"\n-- summary: phantoms={len(phantoms)} apply={apply}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
