# Task: Fix the goalie game score for the 3 stars

- **State:** Deployed 2026-11-09 (`web` at `820bf96a`; rollback `:rollback-he-2026-11-09-pre-goalie-stars`)
- **Lane:** Web (`apps/web/src/lib/match-recap.ts` holds the score for the match page, the Discord
  post and the news sheet)
- **Risk:** medium (a number teammates see on every game)
- **Slug:** three-stars-score
- **Operator approval:** 2026-11-09 (formula, then the side-by-side: "D1. yes")
- **Operator gate before merge:** yes (the operator picks from a side-by-side)
- **Needs a deploy:** yes: `web` (the Discord poster and news read the score from `web`)

## Goal and visible result

Operator request 2026-11-09 (2): "the goalies' game scores are broken". A goalie with few shots
faced or a poor save % must not earn a star. Example: Lehmann (AI goalie) got a star with 2 saves and
.500.

## Cause (Lead, 2026-11-09)

`goalieBreakdown` gives `SV% × 15` whatever the number of shots. 2 saves on 4 shots:
0.4 (saves) + 7.5 (SV%) − 1.6 (2 GA) = 6.3, plus 1.0 win bonus = 7.3. A skater with 1 assist is
about 3–5. So a goalie who faced almost nothing beats most skaters. The same score feeds the season
average delta, the Discord star line and the news sheet.

## Paths

- **May edit:** `apps/web/src/lib/match-recap.ts`, its tests, a one-off comparison script in the
  scratchpad (not committed), this task file.
- **Must not touch:** skater weights (not asked), stored data.

## Plan

1. Build a side-by-side report on the last ~40 club games: old stars vs each option below.
2. Options to compare:
   - **A. Volume-weighted SV%:** SV% counts in full only from N shots (for example 15); below that it
     is scaled down (`shots / N`). Keeps the formula, removes the small-sample bonus.
   - **B. Saves above expected:** score = saves − (league-average SV% × shots faced), × a weight, plus
     the special saves. Rewards work and quality together. A .500 on 4 shots is negative.
   - **C. Minimum for a star only:** keep the score, but a goalie needs at least N shots faced and
     SV% ≥ .850 to be a star. Simplest; the score itself stays odd.
   - **AI goalies:** separate question: may Lehmann/Wagner (computer-controlled) be stars at all?
3. The operator picks. Then: tests with the example game, typecheck, deploy `web`.

## Done when

- **Done when:** in the side-by-side, no goalie under .900 is a star and low-shot goalies score less (operator's pick), and the
  operator OKs the stars on the recent games.

## Log

- 2026-11-09 Lead: cause found (above). Recent AI-goalie lines on live: 7/8, 6/7, 3/5, 4/8, 0/3.
- 2026-11-09 operator: fix A + a goalie needs SV% ≥ .900 to be a star. AI goalies not ruled out.
- 2026-11-09 Lead: built on `work/three-stars-score`. SV% weight = 15 × min(1, shots / 15); a goalie
  is star-eligible only with shots faced and SV% ≥ .900. `buildAllTeamScores` puts the 3 eligible
  stars first, then everyone else by score, so the match page's ranks 1-3, the Discord post and the
  news sheet stay the same three. Season-average deltas use the new goalie score too.

## Report

- **What changed (visible effect):** goalies with few shots score less; a goalie under .900 is never
  a star. Last 40 games: stars change in 17; goalie stars 31 → 16.
- **How it was checked:** web typecheck pass; web `test:unit` 664/664 (4 new tests: weight × 4 on
  4 shots and × 15 from 15; under .900 never a star; a busy .966 goalie can be first star; 0 shots
  never a star); side-by-side below: old and new code on the same live rows (read-only export of the
  last 40 games; loadout overrides not applied, they change positions only, not scores).
- **Not done:** deploy (operator's OK). Skater weights unchanged.
- **Deployed:** live check on the Discord game route: #3422 stars Henry, Silky, Nxtluvv; #3405
  camrazz, Lehmann (10/10), Henry. Same as the side-by-side.
- **Side-by-side (only the 17 games that change; score in brackets):**

| Game                                                  | Old stars                                                                                                  | New stars                                                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| #3428 2026-11-10 6s LOSS 2-4 vs Mosinee PaperMakers   | (opp) Zynnebago 3G 1A +1 [18.3]<br>Matteo Lehmann G 12/16 [10.4]<br>silkyjoker85 2G 0A -1 [10.3]           | (opp) Zynnebago 3G 1A +1 [18.3]<br>silkyjoker85 2G 0A -1 [10.3]<br>(opp) HumblePie4u 0G 3A +1 [10.2]                |
| #3426 2026-11-10 6s WIN 4-3 vs Chieftains             | Stick Menace 2G 2A -1 [16.2]<br>Jonas Wagner G 11/14 [12.6]<br>silkyjoker85 1G 1A -1 [8.6]                 | Stick Menace 2G 2A -1 [16.2]<br>silkyjoker85 1G 1A -1 [8.6]<br>Ordinary_Samich 1G 1A -1 [8.0]                       |
| #3425 2026-11-10 3s LOSS 1-3 vs The Hip Czechs        | (opp) KooTz XXV 2G 1A +2 [15.2]<br>Jonas Wagner G 13/16 [12.4]<br>(opp) dante 2ohp 1G 2A +2 [10.8]         | (opp) KooTz XXV 2G 1A +2 [15.2]<br>(opp) dante 2ohp 1G 2A +2 [10.8]<br>(opp) SuGarKaNe6564 0G 2A +2 [10.4]          |
| #3423 2026-11-09 6s WIN 3-1 vs Boston Grape Smugglers | Jonas Wagner G 7/8 [14.7]<br>silkyjoker85 2G 1A +1 [14.3]<br>Stick Menace 1G 1A +1 [12.3]                  | silkyjoker85 2G 1A +1 [14.3]<br>Stick Menace 1G 1A +1 [12.3]<br>HenryTheBobJr 0G 2A +1 [9.9]                        |
| #3422 2026-11-09 6s WIN 2-1 vs UNAMEN 1               | Matteo Lehmann G 6/7 [14.3]<br>HenryTheBobJr 1G 0A +1 [7.6]<br>silkyjoker85 0G 2A +1 [7.4]                 | HenryTheBobJr 1G 0A +1 [7.6]<br>silkyjoker85 0G 2A +1 [7.4]<br>(opp) Nxtluvv 1G 0A -1 [7.1]                         |
| #3421 2026-11-09 6s WIN 2-1 vs CHELCHUMPS             | Jonas Wagner G 7/8 [14.7]<br>silkyjoker85 1G 0A +1 [9.2]<br>HenryTheBobJr 0G 2A +1 [8.6]                   | silkyjoker85 1G 0A +1 [9.2]<br>HenryTheBobJr 0G 2A +1 [8.6]<br>(opp) SlyWily 1G 0A -1 [6.2]                         |
| #3415 2026-11-08 6s LOSS 1-4 vs Ol Guysers            | (opp) brownraisin 3G 1A +2 [9.2]<br>(opp) Bieser25 0G 2A +2 [8.0]<br>Jonas Wagner G 6/10 [7.0]             | (opp) brownraisin 3G 1A +2 [9.2]<br>(opp) Bieser25 0G 2A +2 [8.0]<br>pathfindercdn74 1G 0A -2 [6.6]                 |
| #3414 2026-11-08 6s WIN 3-2 vs Nair                   | Matteo Lehmann G 8/10 [13.0]<br>Ordinary_Samich 1G 2A +2 [11.1]<br>Stick Menace 1G 2A +2 [10.7]            | Ordinary_Samich 1G 2A +2 [11.1]<br>Stick Menace 1G 2A +2 [10.7]<br>JoeyFlopfish 1G 2A +2 [10.5]                     |
| #3411 2026-11-08 6s DNF 0-3 vs P E A C H E S          | Matteo Lehmann G 7/10 [9.5]<br>(opp) FlyingReindeer19 2G 0A +1 [8.8]<br>(opp) Snizzbone88\_ 0G 2A +1 [6.4] | (opp) FlyingReindeer19 2G 0A +1 [8.8]<br>(opp) Snizzbone88\_ 0G 2A +1 [6.4]<br>(opp) S-weetPeaches69 0G 0A +1 [2.7] |
| #3406 2026-11-07 6s LOSS 1-4 vs Okanagan Bears        | (opp) Jallerson 4G 0A +3 [11.4]<br>(opp) zixk 0G 2A +3 [7.2]<br>Matteo Lehmann G 4/8 [5.1]                 | (opp) Jallerson 4G 0A +3 [11.4]<br>(opp) zixk 0G 2A +3 [7.2]<br>Ordinary_Samich 0G 0A -3 [1.2]                      |
| #3405 2026-11-07 6s WIN 4-0 vs 814s Finest            | Matteo Lehmann G 10/10 [18.0]<br>camrazz 2G 2A +4 [17.5]<br>HenryTheBobJr 1G 1A +4 [11.5]                  | camrazz 2G 2A +4 [17.5]<br>Matteo Lehmann G 10/10 [13.0]<br>HenryTheBobJr 1G 1A +4 [11.5]                           |
| #3404 2026-11-06 3s WIN 4-1 vs Union des Artistes Qc  | Matteo Lehmann G 11/12 [16.1]<br>silkyjoker85 4G 0A +2 [15.6]<br>Stick Menace 0G 3A +2 [14.6]              | silkyjoker85 4G 0A +2 [15.6]<br>Stick Menace 0G 3A +2 [14.6]<br>Matteo Lehmann G 11/12 [13.4]                       |
| #3403 2026-11-06 3s LOSS 2-4 vs LES ELEPHANTES        | Jonas Wagner G 20/24 [13.3]<br>(opp) stratsCA9662 2G 1A +1 [13.1]<br>(opp) Bartonian\_ 1G 1A +1 [10.5]     | (opp) stratsCA9662 2G 1A +1 [13.1]<br>(opp) Bartonian\_ 1G 1A +1 [10.5]<br>(opp) XxRedwings18xX 1G 2A +1 [10.1]     |
| #3400 2026-10-12 6s LOSS 2-6 vs Shake N Bake          | (opp) xGanjiii 3G 1A +2 [17.8]<br>(opp) CompaniionCarter 2G 1A +3 [14.2]<br>Jonas Wagner G 23/29 [11.7]    | (opp) xGanjiii 3G 1A +2 [17.8]<br>(opp) CompaniionCarter 2G 1A +3 [14.2]<br>(opp) Fitzyy83 1G 0A +3 [7.4]           |
| #3399 2026-10-11 6s LOSS 1-3 vs Sewer Skunks          | Matteo Lehmann G 23/26 [15.5]<br>(opp) DeWantaWanga 0G 2A +1 [10.5]<br>(opp) dustin433 2G 1A +1 [9.7]      | (opp) DeWantaWanga 0G 2A +1 [10.5]<br>(opp) dustin433 2G 1A +1 [9.7]<br>(opp) Tooballz28 0G 1A +1 [6.8]             |
| #3395 2026-10-11 6s WIN 3-0 vs Arizona Renegades      | Matteo Lehmann G 3/3 [16.6]<br>silkyjoker85 0G 3A +3 [13.0]<br>Stick Menace 1G 2A +3 [13.0]                | silkyjoker85 0G 3A +3 [13.0]<br>Stick Menace 1G 2A +3 [13.0]<br>camrazz 2G 0A +3 [5.7]                              |
| #3390 2026-10-09 6s WIN 6-0 vs Pucks and Bucks        | HenryTheBobJr 2G 3A +6 [22.0]<br>silkyjoker85 1G 3A +6 [18.1]<br>Jonas Wagner G 10/10 [18.0]               | HenryTheBobJr 2G 3A +6 [22.0]<br>silkyjoker85 1G 3A +6 [18.1]<br>JoeyFlopfish 0G 3A +6 [14.7]                       |
