# Task: Fix the goalie game score for the 3 stars

- **State:** Proposed (plan only; the operator picks the formula)
- **Lane:** Web (`apps/web/src/lib/match-recap.ts` holds the score for the match page, the Discord
  post and the news sheet)
- **Risk:** medium (a number teammates see on every game)
- **Slug:** three-stars-score
- **Operator approval:** pending
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

- **Done when:** in the side-by-side, no goalie with < N shots or SV% < .850 is a star, and the
  operator OKs the stars on the recent games.

## Log

- 2026-11-09 Lead: cause found (above). Recent AI-goalie lines on live: 7/8, 6/7, 3/5, 4/8, 0/3.
