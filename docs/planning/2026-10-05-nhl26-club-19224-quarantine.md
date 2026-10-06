# NHL 26: quarantine the "Chipstuttar" matches on club 19224

Status: **Step 0 applied; step 1 committed (`09ba638`, not deployed); step 2
rehearsed on a copy. Production apply awaiting operator go-ahead.**
Opened 2026-10-05.

## What happened

- NHL 26 polls EA club **19224**. Up to the last Boogeymen match (2026-08-06),
  EA's payloads name that club "The Boogeymen" (crest 857, region 6).
- From **2026-09-07** the same club ID comes back as **"Chipstuttar"** (crest 103,
  region 5) with a different set of players. Either EA reassigned the ID or the
  club was taken over; our data can't tell which.
- The Boogeymen moved to NHL 27 as club **1650**. Its payloads still say "The
  Boogeymen" (crest 857), and the established roster plays there.
- The worker kept polling 19224 and ingested Chipstuttar's games as ours:
  **172 of the 376 NHL 26 matches** (all 3s, 09-07 → 10-04).
- The two selection rules agree exactly. "Payload club name = Chipstuttar" and
  "trollet06 or willeG2006 on our side" pick the same 172 matches (204 / 172
  split). None of their players appear on the opponent side, and none of our
  players appear in any Chipstuttar match.

### What is contaminated (live, counted 2026-10-06 ~03:20 UTC)

| Where                                                | Rows                                           |
| ---------------------------------------------------- | ---------------------------------------------- |
| `matches` (NHL 26)                                   | 172                                            |
| `player_match_stats`                                 | 411                                            |
| `opponent_player_match_stats`                        | 440                                            |
| Players who appear ONLY in those matches             | 6 (ids 206, 207, 208, 209, 213, 228)           |
| …their `player_game_title_stats`                     | 12                                             |
| …their `ea_member_season_stats`                      | 2 (trollet06, willeG2006)                      |
| …their `player_profiles` / `player_gamertag_history` | 6 / 6                                          |
| `club_seasonal_stats` NHL 26 (record strip)          | overwritten: 95-67-10 / 172 GP = Chipstuttar's |
| `club_season_rank` NHL 26                            | overwritten: Chipstuttar's Division 1 3-3-0    |
| `club_game_title_stats` NHL 26 (local aggregate)     | includes the 172 (recomputed in step 2)        |

Not touched by Chipstuttar: no OCR, event, loadout, claim, note or alias rows,
and no historical tables. Your players' `ea_member_season_stats` rows are
unchanged; they match the 09-03 dump.

### The real NHL 26 official record survives

`~/backups/pre-rotation-20260903/eanhl-pre-rotation.dump` (main PC, taken
before the switch) holds the true row:

- `club_seasonal_stats`: **365-229-27, 621 GP**, ranking points 2173, GF 2238,
  GA 1825, fetched 2026-08-18 02:05:20.414+00.
- `club_season_rank`: 0-0-0, Division 1, fetched 2026-08-18 02:05:22.75+00.

## Step 0 — stop new contamination (DONE 2026-10-06 03:17 UTC)

`game_titles.is_active = false` for `nhl26` (was `true`). Verified: the 03:19:49
cycle polled NHL 27 only. The NHL 26 match count stays at 376. Undo: set it back
to `true`. The site still shows NHL 26 because a title with matches counts as
live.

## Step 1 — guard: never re-create these matches (code) — COMMITTED `09ba638`

`reprocess` retries error rows, and `reprocess --all` re-transforms every
payload. Either would re-create the 172 matches from the stored raw payloads
today. So the guard ships **before** the data change.

1. Migration `0058` (hand-written, idempotent, the 0054+ pattern): add nullable
   `game_titles.ea_club_name`. Set it to `'The Boogeymen'` for nhl26 and nhl27.
   NULL means no check (older archive titles).
2. `transformMatch`: if `ea_club_name` is set and
   `clubs[ourClubId].details.name` differs, throw
   `club identity mismatch: expected "…", got "…"`. The raw payload is kept and
   the row is marked `error`, as with any failed transform.
3. Unit tests in `transform.test.ts` (name match, mismatch, NULL = no check).
   Typecheck plus the worker tests.

If the team renames the club for real, transforms fail loudly. The fix is to
update `ea_club_name` and run `reprocess`. Nothing is lost.

Verified: 9/9 transform tests pass. Run against every stored NHL 26/27 payload,
the guard accepts 204 + 73 and refuses exactly the 172 Chipstuttar matches.
Deploy the **worker image only**: the web perf commits still awaiting deploy
shouldn't ship as a side effect. Apply 0058 before the new image starts.

## Step 2 — quarantine the data (live DB, one transaction)

Script: `apps/worker/src/__scripts__/nhl26-chipstuttar-quarantine-2026-10-05.sql`
(the apply command is in its header). Before: take a fresh `pg_dump` on Hotel-Echo.

All of this runs in one transaction that checks each row count against the
table above and rolls back on any mismatch:

1. Mark the 172 raw payloads `transform_status = 'error'`,
   `transform_error = 'quarantined 2026-10: club 19224 is "Chipstuttar", not
The Boogeymen — see docs/planning/2026-10-05-nhl26-club-19224-quarantine.md'`.
   **The raw payloads themselves are kept, verbatim.**
2. Delete their `player_match_stats` (411), `opponent_player_match_stats`
   (440), then the `matches` (172).
3. Delete the 6 outsider players' rows: `player_game_title_stats` (12),
   `ea_member_season_stats` (2), `player_profiles` (6),
   `player_gamertag_history` (6), then `players` (6).
4. Restore NHL 26 `club_seasonal_stats` and `club_season_rank` to the 09-03
   dump values above.
5. After COMMIT, recompute NHL 26 aggregates. NHL 26 is no longer polled, so
   the worker won't do it itself:
   `docker exec -w /app/apps/worker eanhl-team-website-worker-1 node -e "import('./dist/aggregate.js').then(m=>m.recomputeAggregates(1)).then(()=>process.exit(0),e=>{console.error(e);process.exit(1)})"`

Everything deleted can be rebuilt from the kept raw payloads plus the
pre-change dump.

### Expected NHL 26 after (local aggregate, from the 204 kept matches)

| Mode | GP  | W   | L   | OTL | DNF | GF  | GA  |
| ---- | --- | --- | --- | --- | --- | --- | --- |
| All  | 204 | 126 | 36  | 11  | 31  | 737 | 541 |
| 6s   | 143 | 86  | 25  | 8   | 24  | 457 | 353 |
| 3s   | 61  | 40  | 11  | 3   | 7   | 280 | 188 |

The 6s row equals today's live 6s row, because all 172 Chipstuttar games were
3s. The record strip shows 365-229-27. None of the six outsiders appear in
any table, including All Time. NHL 27 is unchanged.

### Rehearsal (2026-10-05, throwaway container, Hotel-Echo daily dump of 10-06 02:19 UTC)

- Without its preconditions (flag on, no 0058) the script refused and changed nothing.
- 0058 set both titles; a second run was a no-op (`UPDATE 0`).
- The script committed with every row count as listed, then post-check: 204
  matches, 172 refused payloads, 0 outsiders, record 365-229-27 / 621 GP.
- `recomputeAggregates(1)` produced exactly the table above. The NHL 26 EA
  skater list is the 10 Boogeymen members. NHL 27 stayed at 73 matches.
- `reprocess` afterwards refused all 172 ("club identity mismatch") and created
  nothing. It overwrites the quarantine note with the guard's message.

## Step 3 — catch it next time (later, smaller)

The match guard (step 1) covers match ingestion. The member, record and
season-rank endpoints carry no club name, so they need their own check: one
`clubs/info` lookup per cycle that compares the name and skips those writes
on a mismatch. Scope that separately.

## Review and approvals

- Policy: deleting data and changing the live DB means **Codex adversarial
  review** before applying (operator runs
  `/codex:adversarial-review --wait <focus>`), and **operator approval of
  step 2**.
- Order: step 1 (commit, deploy) → backup → rehearse → review → step 2 →
  verify on the live site.

## Open questions for the operator

- Delete the 6 outsider `players` rows (proposed) or keep them hidden?
  Deleting is cleaner; they are re-derivable from raw payloads.
- The 621-GP record is EA's as of 2026-08-18. Any NHL 26 games played after
  that and before NHL 27 aren't in it, but no Boogeymen NHL 26 match exists
  after 08-06 in our data.
