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

- Level 30 is set at about the **second-best one-season value** among the regulars. The reference is the higher of NHL 26's full-season EA totals and NHL 27's pace so far, projected to 48 weeks.
- Level L = `round(top × (L/30)²)`, rounded to 5 above 100 and to 10 above 1,000. Each step is at least +1, so a top under 30 becomes a one-per-level ladder.
- Rare stats keep a floor top of 30 (Shutouts, Poke-Checks, Goalie Wins), so some badges stay out of reach in one season. That's accepted, as Part 1 accepted it for poke-checks.

| Badge             | Level 30 | Basis                                   |
| ----------------- | -------: | --------------------------------------- |
| 3v3 Games         |      100 | ~10–30% of a regular's games are 3s     |
| 6v6 Games         |      480 | ~88% of a ~550-game regular season      |
| 6's with Goalie   |      100 | NHL 27 pace: ~12 of 72 games            |
| Wins              |      320 | NHL 26: 359 / 324 / 323 / 315           |
| Goals             |      550 | NHL 26 2nd 551, NHL 27 pace 2nd 539     |
| Assists           |      680 | NHL 26 2nd 695, NHL 27 pace 2nd 647     |
| Shots             |    2,600 | NHL 26 2nd 2,339, NHL 27 pace 2nd 2,958 |
| Dekes             |      800 | NHL 26 2nd 578, NHL 27 pace 2nd 921     |
| Hat-Tricks        |       65 | NHL 26 2nd 61, NHL 27 pace 2nd 69       |
| Breakaways        |      110 | NHL 26 2nd 110 (best 275 is an outlier) |
| Hits              |    2,000 | NHL 26 2nd 2,480, NHL 27 pace 2nd 1,528 |
| Faceoffs Won      |    3,500 | NHL 27 pace 2nd 3,517 (centres only)    |
| Takeaways         |    1,650 | NHL 26 2nd 1,574, NHL 27 pace 2nd 1,744 |
| Blocked Shots     |      420 | NHL 26 2nd 418, NHL 27 pace 2nd 372     |
| Fights Won        |       40 | NHL 27 pace 2nd 29 (best is an outlier) |
| Goalie Games      |       60 | a committed part-time goalie            |
| Goalie Wins       |       30 | floor                                   |
| Saves             |      650 | ~11 saves per start × 60                |
| Desperation Saves |       40 | NHL 27 pace best 39                     |
| Poke-Checks       |       30 | floor (NHL 26 best 4)                   |
| Shutouts          |       30 | floor (NHL 26 best 3)                   |

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
| NHL 26 silkyjoker85         |   665 |   2 |   7 |  18 |  38 |
| NHL 26 HenryTheBobJr        |   581 |   2 |   8 |  22 |  45 |
| NHL 26 Stick Menace         |   577 |   2 |   6 |  14 |  29 |
| NHL 26 JoeyFlopfish         |   553 |   2 |   8 |  22 |  46 |
| NHL 26 camrazz              |   320 |   3 |  11 |  30 |   – |
| NHL 26 Ordinary_Samich      |   228 |   5 |  22 |   – |   – |
| NHL 26 SCOOT BOY 42         |   165 |   5 |  26 |   – |   – |
| NHL 26 MrHomiecide          |   165 |   6 |  28 |   – |   – |
| NHL 26 Pratt2016 (goalie)   |   105 |  13 |  31 |   – |   – |
| NHL 27 pace Stick Menace    |   705 |   2 |   7 |  18 |  38 |
| NHL 27 pace silkyjoker85    |   637 |   2 |   8 |  21 |  44 |
| NHL 27 pace camrazz         |   519 |   2 |   8 |  22 |  46 |
| NHL 27 pace HenryTheBobJr   |   539 |   2 |  10 |  26 |   – |
| NHL 27 pace JoeyFlopfish    |   470 |   3 |  11 |  30 |   – |
| NHL 27 pace MrHomiecide     |   333 |   3 |  15 |  37 |   – |
| NHL 27 pace Ordinary_Samich |   225 |   5 |  25 |   – |   – |

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
