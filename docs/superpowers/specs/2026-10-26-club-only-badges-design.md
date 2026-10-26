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
3. The ladders are sized again for a club-only season, so the pace is sustainable.
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
- **Season size.** Size the ladders for about 300 club games in the NHL 27 season, half of NHL 26's 621 (operator, 2026-10-26).
- **Pace goal.** Unchanged from spec S5: a regular player gets to Franchise (tier 5) in the last month or two of the season. Part-timers finish around Stud or Elite.
- **Switch-over.** Badge values and levels drop to their true club-only numbers one time. Discord does not post about the switch-over (operator, 2026-10-25).

## Source of each badge value

All per-game values come from `player_match_stats` joined to `matches`, for that card's game title. A family not in the table below keeps its current source.

"Club games" means all three match types the worker ingests (`gameType5`, `gameType10`, `club_private`), the same as the per-title aggregates. EA's club record counts the same games (Claude's call, 2026-10-26).

| Family                | Name                   | New source (per-game club records)                                                          |
| --------------------- | ---------------------- | ------------------------------------------------------------------------------------------- |
| `pwins`               | Wins                   | Club games the player played that the club won (`matches.result = 'WIN'`), skater or goalie |
| `pgoals`              | Goals                  | Sum of `goals`                                                                              |
| `pasts`               | Assists                | Sum of `assists`                                                                            |
| `pshots`              | Shots                  | Sum of `shots`                                                                              |
| `pht`                 | Hat-Tricks             | Count of games with `goals >= 3`                                                            |
| `phits`               | Hits                   | Sum of `hits`                                                                               |
| `pfo`                 | Faceoffs Won           | Sum of `faceoff_wins`                                                                       |
| `ptka`                | Takeaways              | Sum of `takeaways`                                                                          |
| `pblk`                | Blocked Shots          | Sum of `blocked_shots`                                                                      |
| `gg`                  | Goalie Games Completed | Count of goalie games the player completed (`is_goalie`, not `player_dnf`)                  |
| `gw`                  | Goalie Wins            | Count of goalie games that the club won                                                     |
| `gsv`                 | Saves                  | Sum of `saves` in goalie games                                                              |
| `gdsv`                | Desperation Saves      | Sum of `desp_saves` in goalie games                                                         |
| `gpoke`               | Poke-Checks            | Sum of `pokechecks` in goalie games                                                         |
| `gso`                 | Shutouts               | Count of completed goalie games with `goals_against = 0`                                    |
| `p3v3`, `p6v6`, `p6g` | Games by mode          | No change. These already use site records.                                                  |

Families that stay on EA's totals, drop-ins included:

| Family   | Name       | Source                              |
| -------- | ---------- | ----------------------------------- |
| `pdekes` | Dekes      | `ea_member_season_stats.dekes_made` |
| `pfight` | Fights Won | `ea_member_season_stats.fights_won` |
| `pbrk`   | Breakaways | `ea_member_season_stats.breakaways` |

The badge UI labels these three badges as EA season totals that include drop-ins. The other 18 badges are labeled as club games. (Wording and placement: builder's call.)

The AI goalies (Matteo Lehmann, Jonas Wagner) use the same per-game rules. They keep their own ladder set (`AI_GOALIE_LADDERS`), which is sized again with the same method.

## Ladders: size again for a club-only season

Method (same as `2026-10-08-season-cards-design.md`, with new inputs):

1. Measure each player's per-game rate for every family from NHL 27 club games only.
2. Project each player to a 48-week season with about 300 club games for the club. A player's share of club games is their NHL 27 share so far.
3. Size the 30 levels of each ladder so the pace goal holds: regulars reach T5 in weeks 40–48, part-timers finish at T3 or T4.
4. Keep the nice-number rules: thresholds are multiples of 5, 10 or 50, except plain counts for the first levels of rare stats.
5. The three EA-sourced families are sized on their EA rates (drop-ins included).
6. Keep the tier bars (`TIER_BARS = [1, 5, 12, 20, 29]`) unless the simulation shows the pace goal cannot hold with the ladders alone.
7. Level-30 ceilings (Claude's call, 2026-10-26): on 10-08 the operator chose each ceiling. Now the builder proposes each ceiling from the projected club-only season (about the best regular's projected season total for that stat, rounded to a nice number). The `top × (L/30)²` curve below the ceiling stays. The operator approves the ceilings together with the pace table.

The design document for the build must include a simulated-pace table (week each tier is reached, per player), like the one in the 2026-10-08 spec, for the operator to approve before the ladders ship.

Note: NHL 27 club play dropped in October (16, 2 and 1 games in the last three weeks). The 300-game target already accounts for this. Re-check the pace at mid-season.

## Proposed ladders and pace (Task 3, data of 2026-10-26)

Status: waiting for operator approval.

Method: `apps/worker/src/__scripts__/card-ladder-sizing-2026-10.ts`, run read-only on live data. The club has played 92 NHL 27 club games. Each value is projected to a 300-game season (factor 3.26). The ceiling (level 30) is the best regular's projected value; regulars played at least half of the club's games. The goalie badges use the best human, because no regular plays goalie. Every ceiling is at least 30, because 30 levels need 30 different whole numbers. Ceilings from 51 to 99 round to 50 or 100 (the nice-number rules leave too few steps there). The tier bars stay as they are.

| Badge                  | Old L30 | New L30 | Levels 1–10                      | Level 20 |
| ---------------------- | ------: | ------: | -------------------------------- | -------: |
| 3v3 Games Completed    |     100 |      30 | 1 2 3 4 5 6 7 8 9 10             |       20 |
| 6v6 Games Completed    |     500 |     250 | 1 2 3 4 7 10 15 20 25 30         |      110 |
| 6's with Goalie        |     100 |      50 | 1 2 3 4 5 6 7 8 9 10             |       22 |
| Wins                   |     320 |     140 | 1 2 3 4 5 6 8 10 12 15           |       65 |
| Goals                  |     800 |     240 | 1 2 3 4 7 10 12 15 20 25         |      110 |
| Assists                |     800 |     280 | 1 2 3 5 8 11 15 20 25 30         |      120 |
| Shots                  |    2500 |    1350 | 5 10 15 25 35 55 75 95 120 150   |      600 |
| Dekes                  |     800 |     620 | 5 10 15 20 25 30 35 45 55 70     |      280 |
| Hat-Tricks             |     100 |      36 | 1 2 3 4 5 6 7 8 9 10             |       20 |
| Breakaways             |     200 |      50 | 1 2 3 4 5 6 7 8 9 10             |       22 |
| Hits                   |    2000 |     820 | 5 10 15 20 25 35 45 60 75 90     |      360 |
| Faceoffs Won           |    4000 |    1850 | 5 10 20 35 50 75 100 130 170 210 |      820 |
| Takeaways              |    1500 |     720 | 5 10 15 20 25 30 40 50 65 80     |      320 |
| Blocked Shots          |     400 |     250 | 1 2 3 4 7 10 15 20 25 30         |      110 |
| Fights Won             |     100 |      30 | 1 2 3 4 5 6 7 8 9 10             |       20 |
| Goalie Games Completed |     100 |      30 | 1 2 3 4 5 6 7 8 9 10             |       20 |
| Goalie Wins            |      50 |      30 | 1 2 3 4 5 6 7 8 9 10             |       20 |
| Saves                  |     650 |     300 | 1 2 3 5 8 12 15 20 25 35         |      130 |
| Desperation Saves      |     100 |      30 | 1 2 3 4 5 6 7 8 9 10             |       20 |
| Goalie Poke-Checks     |      50 |      30 | 1 2 3 4 5 6 7 8 9 10             |       20 |
| Shutouts               |      30 |      30 | 1 2 3 4 5 6 7 8 9 10             |       20 |

AI goalies (Matteo Lehmann, Jonas Wagner):

| Badge | Old L30 | New L30 | Levels 1–10                     | Level 20 |
| ----- | ------: | ------: | ------------------------------- | -------: |
| gg    |     300 |     130 | 1 2 3 4 5 6 7 9 12 15           |       65 |
| gw    |     150 |      50 | 1 2 3 4 5 6 7 8 9 10            |       22 |
| gsv   |    3500 |    1600 | 5 10 15 30 45 65 85 110 140 180 |      710 |
| gso   |      30 |      30 | 1 2 3 4 5 6 7 8 9 10            |       20 |

Simulated pace (values grow evenly over 48 weeks; the week each tier is reached):

| Player              | Club games so far | Projected games |  T2 |  T3 |  T4 |  T5 |
| ------------------- | ----------------: | --------------: | --: | --: | --: | --: |
| Stick Menace        |                85 |             277 |   2 |   8 |  21 |  45 |
| silkyjoker85        |                80 |             261 |   2 |   9 |  22 |  45 |
| HenryTheBobJr       |                64 |             209 |   2 |  11 |  29 |   – |
| camrazz             |                64 |             209 |   2 |  11 |  22 |  44 |
| JoeyFlopfish        |                52 |             170 |   3 |  14 |  36 |   – |
| Jonas Wagner (AI)   |                39 |             127 |  19 |  45 |   – |   – |
| MrHomiecide         |                37 |             121 |   5 |  22 |   – |   – |
| Matteo Lehmann (AI) |                36 |             117 |  19 |  45 |   – |   – |
| Ordinary_Samich     |                33 |             108 |   5 |  29 |   – |   – |

Results:

- The three busiest regulars (Stick Menace, silkyjoker85, camrazz) reach Franchise in weeks 44–45.
- HenryTheBobJr and JoeyFlopfish finish at Elite. MrHomiecide and Ordinary_Samich finish at Stud. The 10-08 projection had the same pattern.
- A lower ceiling (scale 0.8) brings HenryTheBobJr to Franchise in week 48. The top three then reach it in weeks 36–38, which is too early for the pace goal.
- The AI goalies stop at Stud. Shutouts cap them: their projected season is about 13 shutouts, and the shutout ladder cannot have a ceiling below 30. The 10-08 ladders let them reach Franchise.
- Switch-over: nobody loses a tier. HenryTheBobJr, silkyjoker85 and JoeyFlopfish go from Rookie to Stud. The switch-over writes no events, so Discord posts nothing about it.

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
