# Authority Model Check

Use this skill when reviewing whether a UI component or query is using the correct data source.

## The Authority Model

| Data type | Authoritative source | Table |
|-----------|---------------------|-------|
| Player season-total stats (GP, G, A, PTS, +/-, SV%, GAA, etc.) | EA `/members/stats` | `ea_member_season_stats` |
| Team season-total player stats for scoring leaders, carousel | EA `/members/stats` | `ea_member_season_stats` |
| Recent match results (score, opponent, date) | Local match ingestion | `matches` |
| Team W/L/OTL record | Local match aggregates (only source) | `club_game_title_stats` |
| Per-game player lines | Local match ingestion | `player_match_stats` |
| Player career/profile page stats | EA baseline via `ea_member_season_stats` | `ea_member_season_stats` |
| Opponent records | **No source — never fabricate** | — |

## Diagnostic Workflow

1. **Read the component** — what props does it receive?

2. **Trace to the page** — which Server Component fetches the data?

3. **Find the query call** — which function in `@eanhl/db/queries` is called?

4. **Find the table** — which Drizzle table does that query read from?

5. **Compare to the authority model** — does the table match the correct authority for this data type?

6. **If mismatched** — identify the correct query or new query needed, then make the smallest fix.

## Query → Table Map (current)

| Query | Table | Authority |
|-------|-------|-----------|
| `getSkaterStats(gameTitleId)` | `ea_member_season_stats` | ✅ EA baseline |
| `getGoalieStats(gameTitleId)` | `ea_member_season_stats` | ✅ EA baseline |
| `getEAMemberRoster(gameTitleId)` | `ea_member_season_stats` | ✅ EA baseline |
| `getRoster(gameTitleId)` | `player_game_title_stats` | ⚠️ Local aggregates (~15 matches) — do not use for season totals |
| `getClubStats(gameTitleId)` | `club_game_title_stats` | ✅ Correct for team W/L/OTL (no EA alternative) |
| `getRecentMatches(...)` | `matches` | ✅ Correct for recent results |
| `getPlayerMatchStats(matchId)` | `player_match_stats` | ✅ Correct for per-game lines |
| `getPlayerCareerStats(playerId)` | `player_game_title_stats` | ⚠️ Local aggregates — consider switching to EA baseline |

## Rules

- `getRoster` reads from `player_game_title_stats` (local aggregates). Never use it where EA season totals are the authority.
- Opponent records cannot be sourced — hardcoded placeholders are correct.
- `club_game_title_stats` is the only source for team W/L/OTL — the EA members/stats fixture has no club record.
- If a component shows season-total player stats and reads from `player_game_title_stats`, it's using the wrong source.
