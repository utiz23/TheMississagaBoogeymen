# AI goalies as players (design)

Status: approved by the operator 2026-10-08 ("treat them as you would any other player"; same card rules; NHL 26 and NHL 27).

## Who

When no human BGM goalie plays, EASHL puts its default AI goaltender in net:

| Side | Name           | Jersey | `players.ai_goalie_side` |
| ---- | -------------- | -----: | ------------------------ |
| Home | Matteo Lehmann |     31 | `home`                   |
| Away | Jonas Wagner   |      1 | `away`                   |

Migration 0062 adds the column and the two player rows, with profiles (name, jersey number, preferred position G).

## Which games

- An **AI game** is a match with no `player_match_stats` goalie row from a human player.
- The side comes from `matches.bgm_was_home` (EA's `teamSide`; filled for every match on 2026-10-08).
- If the side is ever unknown, the match id's parity decides, so each goalie gets about half of those games.

## Their numbers

EA reports no AI-goalie stats, so each game's line comes from the team totals:

- shots against = `matches.shots_against`, goals against = `score_against`;
- saves = shots − goals, never below 0 (a few EA rows have shots < goals);
- TOI = the longest BGM player TOI in the game; result = the match result.

Season totals: GP, games completed (GP minus DNFs), W–L–OTL (a DNF counts in none), SV%, GAA over timed games, and shutouts (a completed game with 0 against). They're written in the EA season-stats shape.

## Where they're written

The worker's **AI-goalie sync** (`apps/worker/src/ai-goalie-sync.ts`) runs every cycle for active titles, before the aggregates. `pnpm --filter worker ai-goalie-sync` backfills archived titles. Both are idempotent: a game that gains a human goalie loses its AI line.

- `player_match_stats`: one goalie line per AI game. Game logs, lineups, local aggregates and mode filters all include it.
- `ea_member_season_stats`: one row per AI goalie and title. Roster, depth chart, stat tables, cards and badges read it.

## Kept human-only

- The **6's with Goalie** badge still means a human BGM goalie.
- **Video-OCR truth** (expected roster, L4 API stats) stays EA rows only. The AI lines aren't EA data.

## Known limits

- EA gives no desperation saves, poke checks or breakaway saves for the AI, so those badges stay locked for them.
- The goalie tier needs 4 goalie badges, so their 4th has to be Shutouts. On 2026-10-08 both are T1 L9, with 3 shutouts each against the 5 needed for T2.
