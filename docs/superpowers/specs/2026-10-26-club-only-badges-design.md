# Club-only badges and cards — design

Status: approved for planning after operator review. The build starts after the news desk release (operator, 2026-10-26).

Amends: `2026-10-07-player-cards-badges-design.md` (Part 1, badge inputs) and `2026-10-08-season-cards-design.md` (ladders, pace).

## Why

Badges and card levels must measure club play only. Today they do not.

The badge values come from EA's member totals (`ea_member_season_stats`, loaded by `loadSeasonTotals` in `packages/db/src/queries/card-mythics.ts`). For NHL 27, EA puts drop-in games into these totals. Proof from the live database on 2026-10-25:

- EA's club record for NHL 27 is 92 games. The site holds all 92 club games.
- EA's member totals give Stick Menace 122 games (66-49-7). That is 30 more than the club played.
- Badges went up nine times on 10-24. The club played no games that day, and the worker polled the club feed without error.

EA's NHL 26 member totals also include drop-ins (silkyjoker85: 665 games, club: 621). The current ladders were sized from these numbers, so they are a little too high.

The worker already stores every club game per player (`player_match_stats`). That is the club-only source. EA's totals become secondary.

## Goals

1. Badge values count club games only, from the site's per-game club records.
2. EA's totals are used only for stats that the per-game records do not have.
3. The ladders are checked for a club-only season, so the pace is sustainable (result: the 10-08 ladders stay; see Decisions).
4. The switch-over does not post a burst of false level-ups to Discord.

## Non-goals

- The stats, awards, positions and player pages that show EA totals. They get a separate project later.
- New badge families. The 21 families stay as they are.
- The card design, the badge UI layout and the featured-badge rule.
- NHL 26 and older titles. Cards exist only for NHL 27 and later (`FIRST_CARD_RELEASE_ORDER = 27`).

## Anti-goals (a failure even if it works)

- A drop-in game moves any badge other than the three EA-sourced ones.
- Discord posts level-ups that come from the switch-over and not from a game.
- A badge silently mixes club-only and EA numbers without a label (see "Never blend data sources silently" in the project conventions).

## Decisions (operator)

- **Source.** Badges and card levels count club games only, from the worker's per-game club records (operator, 2026-10-25).
- **Three stats with no per-game data.** Dekes made, fights won and skater breakaways keep using EA's totals, drop-ins included (operator, 2026-10-26).
- **Ladders.** Keep the 10-08 ladders (operator, 2026-10-26). The club is on pace for about 500 club games (October was unusually slow), and the concern was that cards moved too fast. Only Goals and Assists change, to round steps: 5s to 20, 10s to 150 at level 17, then 50s to 800. The AI goalies keep their ladders.
- **Pace (accepted).** With club games only and about 500 games, the top regulars reach Elite around week 28 and nobody reaches Franchise this season. The S5 goal (Franchise in the last month or two) no longer holds for a club-only season; the operator accepted this.
- **Season size (superseded).** The first sizing used about 300 club games. The operator replaced it with about 500 (2026-10-26).
- **Switch-over.** Badge values and levels drop to their true club-only numbers one time. Discord does not post about the switch-over (operator, 2026-10-25).

## Source of each badge value

All per-game values come from `player_match_stats` joined to `matches`, for that card's game title. A family not in the table below keeps its current source.

"Club games" means all three match types the worker ingests (`gameType5`, `gameType10`, `club_private`), the same as the per-title aggregates. EA's club record counts the same games (Claude's call, 2026-10-26).

| Family                | Name                   | New source (per-game club records)                                                                |
| --------------------- | ---------------------- | ------------------------------------------------------------------------------------------------- |
| `pwins`               | Wins                   | Club games the player played that the club won (`matches.result = 'WIN'`), skater or goalie       |
| `pgoals`              | Goals                  | Sum of `goals`                                                                                    |
| `pasts`               | Assists                | Sum of `assists`                                                                                  |
| `pshots`              | Shots                  | Sum of `shots`                                                                                    |
| `pht`                 | Hat-Tricks             | Count of games with `goals >= 3`                                                                  |
| `phits`               | Hits                   | Sum of `hits`                                                                                     |
| `pfo`                 | Faceoffs Won           | Sum of `faceoff_wins`                                                                             |
| `ptka`                | Takeaways              | Sum of `takeaways`                                                                                |
| `pblk`                | Blocked Shots          | Sum of `blocked_shots`                                                                            |
| `gg`                  | Goalie Games Completed | Count of goalie games the player completed (`is_goalie`, not `player_dnf`, club result not `DNF`) |
| `gw`                  | Goalie Wins            | Count of goalie games that the club won                                                           |
| `gsv`                 | Saves                  | Sum of `saves` in goalie games                                                                    |
| `gdsv`                | Desperation Saves      | Sum of `desp_saves` in goalie games                                                               |
| `gpoke`               | Poke-Checks            | Sum of `pokechecks` in goalie games                                                               |
| `gso`                 | Shutouts               | Count of completed goalie games (as `gg`) with `goals_against = 0`                                |
| `p3v3`, `p6v6`, `p6g` | Games by mode          | No change. These already use site records.                                                        |

Families that stay on EA's totals, drop-ins included:

| Family   | Name       | Source                              |
| -------- | ---------- | ----------------------------------- |
| `pdekes` | Dekes      | `ea_member_season_stats.dekes_made` |
| `pfight` | Fights Won | `ea_member_season_stats.fights_won` |
| `pbrk`   | Breakaways | `ea_member_season_stats.breakaways` |

The badge UI labels these three badges as EA season totals that include drop-ins. The other 18 badges are labeled as club games. (Wording and placement: builder's call.)

The AI goalies (Matteo Lehmann, Jonas Wagner) use the same per-game rules. They keep their own ladder set (`AI_GOALIE_LADDERS`) unchanged. A goalie game counts as completed (and can be a shutout) only when neither the goalie nor the team quit (`player_dnf`, `matches.result = 'DNF'`).

## Ladders

The 10-08 ladders stay (see Decisions). Goals and Assists:

`5 10 15 20 30 40 50 60 70 80 90 100 110 120 130 140 150 200 250 300 350 400 450 500 550 600 650 700 750 800`

Re-check the pace at mid-season with `apps/worker/src/__scripts__/card-ladder-sizing-2026-10.ts`.

## Ladder review (Task 3, 2026-10-26) — proposal rejected

A first proposal resized every ladder for a 300-game club season (Goals 240, Wins 140, Shots 1,350 at level 30). The operator rejected it: the season is closer to 500 games, and the old ladders fit years like NHL 24 and NHL 26.

Old ladders, club games only, 500-game season (week each tier is reached):

| Player          | Projected games |  T2 |  T3 |  T4 |  T5 |
| --------------- | --------------: | --: | --: | --: | --: |
| Stick Menace    |             462 |   2 |  10 |  28 |   – |
| silkyjoker85    |             435 |   2 |  10 |  28 |   – |
| HenryTheBobJr   |             348 |   3 |  13 |  36 |   – |
| camrazz         |             348 |   3 |  10 |  34 |   – |
| JoeyFlopfish    |             283 |   4 |  17 |  46 |   – |
| AI goalies      |       about 200 |  12 |  27 |  45 |   – |
| MrHomiecide     |             201 |   5 |  23 |   – |   – |
| Ordinary_Samich |             179 |   7 |  30 |   – |   – |

## Switch-over

- One recompute runs with the new sources and ladders. It writes the new values and levels to `player_badge_levels` and `player_card_progress`.
- This run writes no `player_card_events`. So Discord posts nothing about it, and the profile history does not show it.
- After this run, the normal rules apply again: increases make events, and Discord posts badge unlocks as it does today.
- A hand-awarded mythic card (pool `manual`) does not change.
- **Card tier and card level drop one time** to the new true standing (operator, 2026-10-26). The switch-over run does not apply the never-downgrade rule (`applyStanding`). After the run, the never-downgrade rule applies again.
- **Old history is deleted** (operator, 2026-10-26). Before the switch-over run, delete the NHL 27 `player_card_events` rows (except mythic events: `mythic_awarded`, `mythic_cleared`). The profile history starts clean on the switch-over day. The linked `discord_unlock_posts` rows go with them (`ON DELETE CASCADE`). Check `discord_card_posts` references before the delete. The messages already posted in Discord stay there. Take a database backup first.
- **Repeat Discord posts are accepted** (operator, 2026-10-26). If a badge drops at the switch-over, Discord posts its levels again when real games bring it back. No high-water-mark column.

## Left to the builder

- Where the per-game totals are computed (a new query beside `loadSeasonTotals`, or a change to it), and how the existing tests change.
- How rows with a `removed_reason` and DNF games are counted. Match the existing per-title aggregates (`player_game_title_stats`) unless that breaks a rule above.
- How to run the one-time silent recompute (a CLI flag or a one-off script), and how to keep the worker's normal recompute from running between the history delete and the switch-over run.
- The exact UI wording for the source labels.
