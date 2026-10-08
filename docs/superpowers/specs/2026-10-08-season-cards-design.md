# Season cards: progression resets each NHL title (design)

Status: approved by the operator 2026-10-08. Amends Part 1 of
[the player cards and badges spec](2026-10-07-player-cards-badges-design.md):
inputs, ladders, tier bars and storage. Level pips, themes, mythics and the
never-downgrade rule are unchanged, except that they now apply per title.

## Decisions (operator, 2026-10-08)

| #   | Decision                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | **One card per NHL title.** Badges, tier and level count only that title's games. NHL 28 starts everyone at zero again.                                                                          |
| S2  | **Past cards are kept.** A finished title's card stays stored as a record. It stops changing because its inputs stop changing.                                                                   |
| S3  | **Starts with NHL 27.** Titles with `release_order >= 27` get cards. NHL 22–26 get none, and their history no longer feeds any card.                                                             |
| S4  | **Season = one NHL title** (about September to August), not a content season.                                                                                                                    |
| S5  | **Pace: regulars max out at season end.** A regular on NHL 26's pace reaches Franchise (T5) in the last month or two, and level 30 in their best stats. Part-timers finish around Stud or Elite. |

This supersedes the brief's "do not reset yearly" (career card plus season
subcards). A browsable record of past titles' cards is future UI work; today
NHL 27 is the only title with a card.

## Inputs, per (player, title)

Same families and columns as Part 1, but every total is for one title:

- EA `ea_member_season_stats` row for that title.
- Site-recorded 3v3 and 6v6 games (`player_game_title_stats`) for that title.
- Site-recorded 6s-with-a-BGM-goalie games (`matches.game_title_id`) for that title.
- The reviewed NHL 22–25 history is no longer an input (S3).

## Ladders

- **Level 30 = the operator's ceiling per badge** (2026-10-08, replacing the first draft's "about the second-best one-season value"). Wins and Shutouts kept the draft values; the operator listed no ceiling for them.
- Each level aims at `top × (L/30)²` and takes the closest **nice number**, strictly increasing:
  - multiples of 5 under 100, of 10 under 1,000, and of 50 from 1,000;
  - rare stats (ceiling under 450) count 1, 2, 3 … up to 12 first, then step in 5s;
  - a 50 ceiling (Goalie Wins, Poke-Checks) counts 1–25 then steps in 5s; Shutouts (30) is 1–30. Thirty levels don't fit in fewer steps.
- The fit is a small least-squares search on a log scale, so crowded stretches bend the curve a little (e.g. Goals 30 → 45).
- Rare goalie stats (Shutouts, Poke-Checks, Goalie Wins) stay mostly out of reach in one season. That's accepted, as Part 1 accepted it for poke-checks.

| Badge             | Level 30 | Levels 1–10                        | Level 20 |
| ----------------- | -------: | ---------------------------------- | -------: |
| 3v3 Games         |      100 | 1 2 3 4 5 6 7 8 9 10               |       50 |
| 6v6 Games         |      500 | 5 10 15 20 25 30 35 40 45 55       |      220 |
| 6's with Goalie   |      100 | 1 2 3 4 5 6 7 8 9 10               |       50 |
| Wins              |      320 | 1 2 3 6 9 12 20 25 30 35           |      140 |
| Goals             |      800 | 5 10 15 20 25 30 45 55 70 90       |      360 |
| Assists           |      800 | 5 10 15 20 25 30 45 55 70 90       |      360 |
| Shots             |    2,500 | 5 10 25 45 70 100 140 180 230 280  |    1,100 |
| Dekes             |      800 | 5 10 15 20 25 30 45 55 70 90       |      360 |
| Hat-Tricks        |      100 | 1 2 3 4 5 6 7 8 9 10               |       50 |
| Breakaways        |      200 | 1 2 3 4 6 8 11 15 20 25            |       90 |
| Hits              |    2,000 | 5 10 20 35 55 80 110 140 180 220   |      890 |
| Faceoffs Won      |    4,000 | 5 20 40 70 110 160 220 280 360 440 |    1,800 |
| Takeaways         |    1,500 | 5 10 15 25 40 60 80 110 140 170    |      670 |
| Blocked Shots     |      400 | 1 2 4 7 11 15 20 30 35 45          |      180 |
| Fights Won        |      100 | 1 2 3 4 5 6 7 8 9 10               |       50 |
| Goalie Games      |      100 | 1 2 3 4 5 6 7 8 9 10               |       50 |
| Goalie Wins       |       50 | 1 2 3 4 5 6 7 8 9 10               |       20 |
| Saves             |      650 | 5 10 15 20 25 30 35 45 60 70       |      290 |
| Desperation Saves |      100 | 1 2 3 4 5 6 7 8 9 10               |       50 |
| Poke-Checks       |       50 | 1 2 3 4 5 6 7 8 9 10               |       20 |
| Shutouts          |       30 | 1 2 3 4 5 6 7 8 9 10               |       20 |

The 30-step ladders live only in `BADGE_LADDERS` (`packages/db/src/cards/badge-catalog.ts`).

## Tier bars

Franchise now means four badges near the top. The bar is the badge level that 4 families in a pool must reach:

| Tier         | Old bar | New bar |
| ------------ | ------: | ------: |
| T2 Rookie    |       6 |       5 |
| T3 Stud      |      11 |      12 |
| T4 Elite     |      16 |      20 |
| T5 Franchise |      21 |      29 |

The old bars had regulars at Franchise by week 20–31 of 48 under any ladder curve. Their four strongest stats pass level 21 early.

## Simulated pace (linear accumulation over a 48-week season)

Week each tier is reached, for NHL 26's real season totals and NHL 27's pace projected to 48 weeks:

| Player                      | Games |  T2 |  T3 |  T4 |  T5 |
| --------------------------- | ----: | --: | --: | --: | --: |
| NHL 26 silkyjoker85         |   665 |   2 |   7 |  21 |  43 |
| NHL 26 HenryTheBobJr        |   581 |   2 |   8 |  21 |  45 |
| NHL 26 Stick Menace         |   577 |   2 |   7 |  21 |  45 |
| NHL 26 JoeyFlopfish         |   553 |   2 |   8 |  22 |  47 |
| NHL 26 camrazz              |   320 |   3 |  12 |  37 |   – |
| NHL 26 Ordinary_Samich      |   228 |   5 |  22 |   – |   – |
| NHL 26 SCOOT BOY 42         |   165 |   7 |  26 |   – |   – |
| NHL 26 MrHomiecide          |   165 |   6 |  27 |   – |   – |
| NHL 26 Pratt2016 (goalie)   |   105 |  13 |  31 |   – |   – |
| NHL 27 pace Stick Menace    |   705 |   2 |   7 |  18 |  39 |
| NHL 27 pace silkyjoker85    |   637 |   2 |   7 |  21 |  43 |
| NHL 27 pace camrazz         |   519 |   2 |   8 |  25 |   – |
| NHL 27 pace HenryTheBobJr   |   539 |   3 |   9 |  28 |   – |
| NHL 27 pace JoeyFlopfish    |   470 |   3 |  11 |  32 |   – |
| NHL 27 pace MrHomiecide     |   333 |   3 |  14 |  44 |   – |
| NHL 27 pace Ordinary_Samich |   225 |   5 |  24 |   – |   – |

The mode splits for 3v3, 6v6 and 6's-with-goalie are estimated (12% / 88% / 16% of games played). A real season is lumpier than this. Re-check the pace at mid-season, and re-tune before NHL 28 if it drifts.

## Storage — migration 0060 amended (it was never applied on live)

- `player_badge_levels`: add `game_title_id` (FK `game_titles`), PK `(player_id, game_title_id, family_id)`.
- `player_card_progress`: add `game_title_id`, PK `(player_id, game_title_id)`. `created_at` dates that title's card history.
- `player_card_events`: add `game_title_id`; index `(player_id, game_title_id, occurred_at DESC)`.
- `eanhl_preview` (the local test database) drops and re-creates the three tables. They hold only derived data.

## Behaviour

- `card-recompute` computes every card title (S3), each with its own stored standing, so never-downgrade and events are per title.
- `card-mythic` takes `--title <slug>` (default: the default title). A mythic belongs to one season's card.
- **Player page:** shows the player's newest card title. A player with no card yet shows T1 for the default title.
- **Home carousel:** each player's newest card.
- **Roster depth chart:** the viewed title's cards. For a title before NHL 27, each player's newest card.
- The badges section and the locker name the season, for example "NHL 27".
