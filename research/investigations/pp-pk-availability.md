# PP% / PK% Availability — Status

_2026-05-10_

## Question

Is power-play % and penalty-kill % available anywhere we can surface on the
team stats page? The original Team Averages grid showed Faceoff%/Pass% but not
PP/PK; the archive `historical_club_team_stats` table had them captured.

## Short answer

**Yes for both** — for NHL 26 (live) AND for archive titles (historical
imports). No new data ingestion is needed.

## Sources

### Live — `clubs/matches` per-match payload (NHL 26)

EA emits per-club per-match:

- `clubs[clubId].ppg` — powerplay **goals scored**
- `clubs[clubId].ppo` — powerplay **opportunities** (number of times we were
  on the man advantage)

Both fields are CONFIRMED present in fixtures and already projected through:

- [`packages/ea-client/src/types.ts`](../../packages/ea-client/src/types.ts)
  declares them on `EaMatchClubData`.
- [`packages/db/src/schema/matches.ts`](../../packages/db/src/schema/matches.ts)
  stores them per row as `pp_goals`, `pp_opportunities`, plus the symmetric
  opponent fields `pp_goals_against`, `pp_opportunities_against`.

That gives us **PP%** = `Σ pp_goals / Σ pp_opportunities` and **PK%** =
`1 − Σ pp_goals_against / Σ pp_opportunities_against` aggregated over any
match window (season-to-date, mode-filtered, last-N, etc).

Live BGM totals for NHL 26 (regular-season, DNF excluded, as of 2026-05-10):

| | Σ ppg | Σ ppo | Σ ppg_against | Σ ppo_against | PP% | PK% |
|---|---:|---:|---:|---:|---:|---:|
| BGM | 12 | 59 | 11 | 53 | **20.3%** | **79.2%** |

### Archive — `historical_club_team_stats`

For NHL 22/23/24/25, the per-playlist screenshots we OCR'd already capture:

- `power_play_pct` — PP% as a `numeric` (e.g. `21.45`)
- `power_play_kill_pct` — PK% as a `numeric`
- `power_plays`, `power_play_goals` — raw counts
- `times_shorthanded`, `short_handed_goals`, `short_handed_goals_against` —
  raw PK counts
- `breakaway_pct`, `one_timer_pct` — bonus scoring-rate context
- `passing_pct`, `faceoff_pct`, `shooting_pct` — fully populated

The fields are split per playlist (`eashl_3v3`, `eashl_6v6`,
`6_player_full_team`, `clubs_3v3`, `clubs_6v6`, `clubs_6_players`, `threes`,
`quickplay_3v3`). Some 3v3 / Threes rows have null PP%/PK% because EA's
in-game UI didn't track them in those modes.

Sample (NHL 24 reviewed playlists):

| playlist | GP | W | L | OTL | PP% | PK% |
|---|---:|---:|---:|---:|---:|---:|
| eashl_6v6 | 294 | 152 | 125 | 17 | 27.46 | 74.62 |
| eashl_3v3 | 461 | 272 | 161 | 28 | (n/a) | (n/a) |
| 6_player_full_team | 106 | 48 | 53 | 5 | (varies) | (varies) |

## What this enables

- The active `/stats` page can show PP% and PK% alongside the existing
  Faceoff%/Pass% — no schema change, no new query, just an aggregation over
  `matches` rows.
- An archive team-stats consolidation can layer the live row on top of the
  reviewed historical rows for a complete career-team view.

## Source-of-truth note

Future work — surface PP%/PK% on the home `<RecordStrip>` next to W/L/OTL?
The strip's "Team Record · Season Ledger" framing supports it. Defer until
the active /stats team stats table proves the math, then promote.

## Pointers

- Schema: [`packages/db/src/schema/matches.ts`](../../packages/db/src/schema/matches.ts) lines 88–106.
- Schema: [`packages/db/src/schema/historical-club-team-stats.ts`](../../packages/db/src/schema/historical-club-team-stats.ts).
- Transform: [`apps/worker/src/transform.ts → buildMatchRow`](../../apps/worker/src/transform.ts) populates the live PP/PK fields.
