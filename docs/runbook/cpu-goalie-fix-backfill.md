# CPU-Goalie Fix — Backfill Runbook

## Purpose

Stopgap SQL for matches where reprocess is impractical and the CPU goalie is
**confirmed** (BGM or opponent goalie known to be CPU-controlled). This is not
auto-applied — see "Why not auto-applied" below.

## Default path: reprocess

Reprocess is the source of truth. The Python lobby extractor's
`_is_cpu_or_empty()` signal flows through the lobby-v2 promoter, which writes
`player_loadout_snapshots.is_cpu` from raw OCR evidence.

```bash
PYTHONPATH=tools/video_ingest:tools/game_ocr \
  python3 -m video_ingest.cli reprocess --match-id <N>
```

Use this whenever the raw OCR evidence still exists for the match.

## Stopgap SQL (operator-curated, per-slot)

Only for confirmed CPU slots in matches where reprocess is impractical. Apply
**one row at a time**, parameterized by `(match_id, team_side, position)`:

```sql
UPDATE player_loadout_snapshots
SET    is_cpu = true
WHERE  match_id  = $1   -- e.g. 250
  AND  team_side = $2   -- 'for' | 'against'
  AND  position  = $3;  -- e.g. 'G'
```

Then re-run the consolidate step so the now-CPU row is dropped from the
reviewed-anchors set:

```bash
pnpm --filter worker consolidate-loadouts-cli --match-id $1
```

### Caveats

- Only for **confirmed** CPU. Operator must have ground-truth (V2 benchmark,
  video review, or opponent-team knowledge).
- **Never generalize** to a blanket `WHERE position = 'G'` update — see below.
- One slot per statement; do not batch across matches.

## Why this is not auto-applied

User-controlled goalies exist in lower-tier EASHL modes and are coming back per
the master plan. A blanket "every goalie before date X was CPU" backfill would
silently corrupt those lineups when we re-enable the relevant modes. Forcing
the operator to confirm each match preserves the invariant that `is_cpu = true`
means "OCR or operator verified this slot has no human."
