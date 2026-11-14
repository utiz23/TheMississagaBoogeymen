# Badge Catalog

Compact version of the original `badges.md` (identical threshold ladders are
shared instead of repeated; every number is unchanged). Companion to
[`card-system-brief.md`](card-system-brief.md).

## Structure

Each family has a ladder: **6 tiers × 5 levels** for player/goalie badges
(30 steps), **4 tiers × 5 levels** for team badges (20 steps). Pipeline:
`stat total → family → tier → level → card display effect`. A badge's
**cumulative stat value** is compared to the ladder; the highest step reached
is the badge's tier and level.

Badges are evidence, not card tiers. See the brief for how they feed tier,
front-card budget and back-card display.

**Source status** — `available` computable from stored data · `derived`
computable but needs careful query logic · `manual` admin-awarded · `future`
keep the idea, don't automate or show as unlockable.

**Weight** (0–4 in the original; the research recommends collapsing to three
buckets): **core** = 4 (and 3 for the main skater signals) can move tier ·
**supporting** = 2–3 · **flavor** = 0–1 (identity/back only). Team badges are
weight 0 for individual cards (showcase and augmentations only).

Badge metadata for seeding:

```ts
type BadgeDefinition = {
  id: string
  scope: 'player' | 'team'
  role: 'skater' | 'goalie' | 'any'
  statKey: string
  displayName: string
  sourceStatus: 'available' | 'derived' | 'manual' | 'future'
  cardWeight: 0 | 1 | 2 | 3 | 4
}
```

## Families

### Player & goalie badges

| Family                 | Ladder | Source      | Weight |
| ---------------------- | :----: | ----------- | :----: |
| 3v3 Games Completed    |   P1   | `available` |   1    |
| 6v6 Games Completed    |   P1   | `available` |   1    |
| 6v6 Games With Goalie  |   P2   | `derived`   |   1    |
| Wins                   |   P3   | `available` |   2    |
| Goals                  |   P4   | `available` |   4    |
| Assists                |   P5   | `available` |   4    |
| Shots                  |   P6   | `available` |   2    |
| Dekes                  |   P6   | `future`    |   0    |
| Hat Tricks             |   P7   | `derived`   |   3    |
| Breakaways             |   P2   | `future`    |   0    |
| Hits                   |   P6   | `available` |   3    |
| Faceoffs Won           |   P8   | `available` |   3    |
| Takeaways              |   P6   | `available` |   3    |
| Blocked Shots          |   P9   | `available` |   2    |
| Fights Won             |   P2   | `future`    |   0    |
| Goalie Games Completed |  P10   | `available` |   2    |
| Goalie Wins            |   P3   | `available` |   3    |
| Saves                  |  P11   | `available` |   4    |
| Desperation Saves      |   P3   | `future`    |   0    |
| Goalie Poke Checks     |   P3   | `future`    |   0    |
| Shutouts               |  P12   | `available` |   4    |

### Team badges (showcase-only)

| Family                              | Ladder | Source      | Weight |
| ----------------------------------- | :----: | ----------- | :----: |
| 3v3 Games Completed                 |   T1   | `available` |   0    |
| 6v6 Games Completed                 |   T1   | `available` |   0    |
| Games Completed                     |   T1   | `available` |   0    |
| 6-Player Games Completed            |   T2   | `derived`   |   0    |
| 6v6 Games With Goalie               |   T2   | `derived`   |   0    |
| Wins                                |   T3   | `available` |   0    |
| Wins With Goalie                    |   T2   | `derived`   |   0    |
| Wins With 6 Players                 |   T2   | `derived`   |   0    |
| Blowout Wins                        |   T4   | `derived`   |   0    |
| Goals                               |   T5   | `available` |   0    |
| Power-Play Goals                    |   T6   | `future`    |   0    |
| Shutouts                            |   T4   | `available` |   0    |
| Games With 1 Goal Against Or Fewer  |   T4   | `derived`   |   0    |
| Games With 2 Goals Against Or Fewer |   T2   | `derived`   |   0    |
| Perfect PK                          |   T4   | `future`    |   0    |

Notes: Team "Blowout Wins" = win by 5+ goals.
Player "Blocked Shots" and "Goalie Wins" thresholds were flagged in the
original as needing validation against real totals before seeding.

## Threshold ladders

### P1 — 3v3 Games Completed, 6v6 Games Completed

| Tier |  L1 |  L2 |  L3 |  L4 |    L5 |
| ---: | --: | --: | --: | --: | ----: |
|    1 |   5 |  10 |  15 |  20 |    25 |
|    2 |  35 |  40 |  45 |  50 |    75 |
|    3 | 100 | 125 | 150 | 175 |   200 |
|    4 | 225 | 250 | 350 | 450 |   500 |
|    5 | 550 | 600 | 650 | 700 |   750 |
|    6 | 800 | 850 | 900 | 950 | 1,000 |

### P2 — 6v6 Games With Goalie, Breakaways, Fights Won

| Tier |  L1 |  L2 |  L3 |  L4 |  L5 |
| ---: | --: | --: | --: | --: | --: |
|    1 |   1 |   5 |  10 |  15 |  20 |
|    2 |  25 |  30 |  35 |  40 |  45 |
|    3 |  50 |  55 |  60 |  65 |  70 |
|    4 |  75 |  80 |  85 |  90 | 100 |
|    5 | 110 | 120 | 130 | 140 | 150 |
|    6 | 160 | 170 | 180 | 190 | 200 |

### P3 — Wins, Goalie Wins, Desperation Saves, Goalie Poke Checks

| Tier |  L1 |  L2 |  L3 |  L4 |  L5 |
| ---: | --: | --: | --: | --: | --: |
|    1 |   5 |  10 |  15 |  20 |  25 |
|    2 |  30 |  35 |  40 |  45 |  50 |
|    3 |  55 |  60 |  65 |  70 |  75 |
|    4 |  80 |  85 |  90 |  95 | 100 |
|    5 | 110 | 120 | 130 | 140 | 150 |
|    6 | 160 | 170 | 180 | 190 | 200 |

### P4 — Goals

| Tier |    L1 |    L2 |    L3 |    L4 |    L5 |
| ---: | ----: | ----: | ----: | ----: | ----: |
|    1 |     1 |     5 |    10 |    25 |    50 |
|    2 |   100 |   150 |   200 |   250 |   300 |
|    3 |   350 |   400 |   450 |   500 |   550 |
|    4 |   600 |   700 |   800 |   900 | 1,000 |
|    5 | 1,100 | 1,200 | 1,300 | 1,400 | 1,500 |
|    6 | 1,600 | 1,700 | 1,800 | 1,900 | 2,000 |

### P5 — Assists

| Tier |    L1 |    L2 |    L3 |    L4 |    L5 |
| ---: | ----: | ----: | ----: | ----: | ----: |
|    1 |     1 |     5 |    10 |    25 |    50 |
|    2 |    75 |   100 |   150 |   200 |   250 |
|    3 |   300 |   350 |   400 |   450 |   500 |
|    4 |   600 |   700 |   800 |   900 | 1,000 |
|    5 | 1,100 | 1,200 | 1,300 | 1,400 | 1,500 |
|    6 | 1,600 | 1,700 | 1,800 | 1,900 | 2,000 |

### P6 — Shots, Dekes, Hits, Takeaways

| Tier |    L1 |    L2 |    L3 |    L4 |    L5 |
| ---: | ----: | ----: | ----: | ----: | ----: |
|    1 |     5 |    10 |    25 |    50 |    75 |
|    2 |   100 |   125 |   150 |   200 |   250 |
|    3 |   300 |   350 |   400 |   450 |   500 |
|    4 |   600 |   700 |   800 |   900 | 1,000 |
|    5 | 1,100 | 1,200 | 1,300 | 1,400 | 1,500 |
|    6 | 1,600 | 1,700 | 1,800 | 1,900 | 2,000 |

### P7 — Hat Tricks

| Tier |  L1 |  L2 |  L3 |  L4 |  L5 |
| ---: | --: | --: | --: | --: | --: |
|    1 |   1 |   2 |   3 |   4 |   5 |
|    2 |   6 |   7 |   8 |   9 |  10 |
|    3 |  11 |  12 |  13 |  14 |  15 |
|    4 |  20 |  25 |  30 |  35 |  40 |
|    5 |  45 |  50 |  55 |  60 |  65 |
|    6 |  70 |  75 |  80 |  90 | 100 |

### P8 — Faceoffs Won

| Tier |    L1 |    L2 |    L3 |    L4 |    L5 |
| ---: | ----: | ----: | ----: | ----: | ----: |
|    1 |    25 |    50 |    75 |   100 |   150 |
|    2 |   200 |   300 |   400 |   500 |   600 |
|    3 |   700 |   800 |   900 | 1,000 | 1,250 |
|    4 | 1,500 | 1,750 | 2,000 | 2,250 | 2,500 |
|    5 | 2,750 | 3,000 | 3,250 | 3,500 | 3,750 |
|    6 | 4,000 | 4,250 | 4,500 | 4,750 | 5,000 |

### P9 — Blocked Shots

| Tier |  L1 |  L2 |  L3 |  L4 |  L5 |
| ---: | --: | --: | --: | --: | --: |
|    1 |   1 |   5 |  10 |  15 |  20 |
|    2 |  25 |  30 |  35 |  40 |  45 |
|    3 |  50 |  55 |  60 |  65 |  70 |
|    4 |  75 |  80 |  85 |  90 | 100 |
|    5 | 105 | 110 | 115 | 120 | 125 |
|    6 | 130 | 135 | 140 | 145 | 150 |

### P10 — Goalie Games Completed

| Tier |  L1 |  L2 |  L3 |  L4 |  L5 |
| ---: | --: | --: | --: | --: | --: |
|    1 |   1 |   3 |   5 |  10 |  15 |
|    2 |  20 |  25 |  30 |  35 |  40 |
|    3 |  45 |  50 |  55 |  60 |  65 |
|    4 |  70 |  75 |  80 |  85 | 100 |
|    5 | 125 | 150 | 175 | 200 | 225 |
|    6 | 250 | 275 | 300 | 400 | 500 |

### P11 — Saves

| Tier |    L1 |    L2 |    L3 |    L4 |    L5 |
| ---: | ----: | ----: | ----: | ----: | ----: |
|    1 |    15 |    25 |    50 |    75 |   100 |
|    2 |   150 |   200 |   250 |   300 |   400 |
|    3 |   500 |   600 |   800 | 1,000 | 1,250 |
|    4 | 1,500 | 1,750 | 2,000 | 2,250 | 2,500 |
|    5 | 2,750 | 3,000 | 3,250 | 3,500 | 3,750 |
|    6 | 4,000 | 4,250 | 4,500 | 4,750 | 5,000 |

### P12 — Shutouts

| Tier |  L1 |  L2 |  L3 |  L4 |  L5 |
| ---: | --: | --: | --: | --: | --: |
|    1 |   1 |   2 |   3 |   4 |   5 |
|    2 |   6 |   7 |   8 |   9 |  10 |
|    3 |  11 |  12 |  13 |  14 |  15 |
|    4 |  20 |  25 |  30 |  40 |  50 |
|    5 |  60 |  70 |  80 |  90 | 100 |
|    6 | 110 | 120 | 130 | 140 | 150 |

### T1 — 3v3 Games Completed, 6v6 Games Completed, Games Completed

| Tier |  L1 |  L2 |  L3 |  L4 |  L5 |
| ---: | --: | --: | --: | --: | --: |
|    1 |   5 |  10 |  15 |  20 |  25 |
|    2 |  35 |  40 |  45 |  50 |  75 |
|    3 | 100 | 125 | 150 | 175 | 200 |
|    4 | 225 | 250 | 325 | 400 | 500 |

### T2 — 6-Player Games Completed, 6v6 Games With Goalie, Wins With Goalie, Wins With 6 Players, Games With 2 Goals Against Or Fewer

| Tier |  L1 |  L2 |  L3 |  L4 |  L5 |
| ---: | --: | --: | --: | --: | --: |
|    1 |   1 |   5 |  10 |  15 |  25 |
|    2 |  30 |  35 |  40 |  45 |  50 |
|    3 |  55 |  60 |  65 |  70 |  75 |
|    4 |  80 |  90 | 100 | 150 | 200 |

### T3 — Wins

| Tier |  L1 |  L2 |  L3 |  L4 |  L5 |
| ---: | --: | --: | --: | --: | --: |
|    1 |   5 |  10 |  15 |  20 |  25 |
|    2 |  30 |  35 |  40 |  45 |  50 |
|    3 |  75 | 100 | 125 | 150 | 175 |
|    4 | 200 | 225 | 250 | 275 | 300 |

### T4 — Blowout Wins, Shutouts, Games With 1 Goal Against Or Fewer, Perfect PK

| Tier |  L1 |  L2 |  L3 |  L4 |  L5 |
| ---: | --: | --: | --: | --: | --: |
|    1 |   1 |   5 |  10 |  15 |  20 |
|    2 |  25 |  30 |  35 |  40 |  45 |
|    3 |  50 |  55 |  60 |  65 |  70 |
|    4 |  75 |  80 |  85 |  90 | 100 |

### T5 — Goals

| Tier |  L1 |  L2 |  L3 |  L4 |    L5 |
| ---: | --: | --: | --: | --: | ----: |
|    1 |   5 |  10 |  25 |  50 |    75 |
|    2 | 100 | 125 | 150 | 200 |   250 |
|    3 | 300 | 350 | 400 | 450 |   500 |
|    4 | 600 | 700 | 800 | 900 | 1,000 |

### T6 — Power-Play Goals

| Tier |  L1 |  L2 |  L3 |  L4 |  L5 |
| ---: | --: | --: | --: | --: | --: |
|    1 |   1 |   5 |  10 |  15 |  20 |
|    2 |  25 |  30 |  35 |  40 |  45 |
|    3 |  50 |  60 |  70 |  80 |  90 |
|    4 | 100 | 125 | 150 | 175 | 200 |

## Reality check (live DB, 2026-10-05, 449 matches)

Career totals for the busiest members versus the ladders above (naive
per-gamertag sums, for scale only):

| Member       |  GP | Goals | Assists | Hits | Takeaways | FO won | Shots |
| ------------ | --: | ----: | ------: | ---: | --------: | -----: | ----: |
| JoeyFlopfish | 228 |   139 |     283 |  358 |       613 |    405 |   601 |
| silkyjoker85 | 224 |   181 |     299 |  776 |       496 |  1,467 |   841 |
| Stick Menace | 211 |   269 |     206 |  850 |       458 |    659 | 1,013 |
| trollet06    | 151 |   216 |     176 |  434 |       329 |    589 |   982 |

Goalie sample is tiny (best: 15 goalie games, 66 saves).

Consequences:

- Goals: the top member (269) sits in **Tier 2**; Tier 3 starts at 350. Tier 6
  needs 1,600 — roughly 6× the best career on record. Assists are similar.
- Hits, takeaways, shots, faceoffs reach Tier 3–4 for the leaders, so these
  ladders are closer to the right scale than goals/assists.
- Goalie ladders (saves from 15; goalie games from 1) start fine but Tier 3+
  is unreachable at current goalie volume.
- Games-completed ladders are plausible (Tier 4 at 225–500 games).

So **ladders are placeholders, not tuned.** The research's top-priority
follow-up is to backtest tier distributions against real club data before
locking numbers (target: most active players at Tier 2–3, 0–1 at Tier 5).
Data availability note: the DB now has `desp_saves`, `pokechecks`,
`breakaway_saves/shots` columns, so "Desperation Saves", "Goalie Poke Checks"
and goalie-side breakaway data may be promotable from `future` — verify
population before changing status.

## V1 automation set (from the original catalog)

Player: 3v3 / 6v6 Games Completed, Wins, Goals, Assists, Shots, Hits, Faceoffs
Won, Takeaways, Blocked Shots (after validation), Goalie Games Completed,
Goalie Wins (after validation), Saves, Shutouts. Team: Games Completed, Wins,
Goals, Shutouts, Blowout Wins, Games With ≤1 / ≤2 Goals Against. Tier inputs —
skaters: Goals, Assists, Hits, Faceoffs Won, Takeaways, Wins, Games Completed
(plus Hat Tricks once derived cleanly); goalies: Saves, Shutouts, Goalie Wins,
Goalie Games Completed. The research recommends promoting only 8–12 player
and 4–6 team families to the _front-facing_ identity layer at launch.
