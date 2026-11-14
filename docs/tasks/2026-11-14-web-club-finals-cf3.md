# Task: CF3 — Club Finals look on the site (games page, game page, home "playoff mode", nav)

- **State:** Ready (operator 2026-11-14 15:27: "Lets go with your advice"); starts after CF1 is merged
- **Lane:** Web (`apps/web/src/`)
- **Risk:** low-medium (visible design on the main pages; numbers come from CF1, never computed here)
- **Slug:** club-finals-cf3
- **Operator gate before merge:** yes (screenshots: desktop and phone)
- **Needs a deploy:** `web`
- **Helper model:** Opus (design on the main pages)

## Goal and visible result

Operator: "make the game panels distinct on the games page and maybe some changes during the playoffs
on the homepage so we can tell it's important." All numbers come from CF1's stored Club Finals state
per game (run, round, game number, series score, round won, eliminated, final). Never computed on read,
never guessed ("unknown" where CF1 has none). Design direction: always dark, red accents,
sharp/aggressive esports look, scoreboard cards, high contrast. Keep every existing feature; add to it
(operator rule).

**Games page (`/games`)**

1. Game rows (`components/matches/match-row.tsx`): Club Finals games look distinct: an accent edge, an
   "R4 · G5" chip and the series score after the game; a stronger mark for an eliminating loss and for a
   round-winning win.
2. Filter (`components/matches/games-filter.tsx`): a "Club Finals" tile beside the mode tiles and a round
   filter (R1–R4).
3. Grouping: Club Finals games show a divider/header where a round starts ("Run 4 · Round 2").

**Game page (`/games/[id]`)**

5. Top bar / hero (`game-top-bar.tsx`, `hero-card.tsx`): a "CLUB FINALS · ROUND 4 · GAME 5" banner;
   "THE FINAL" is the strongest version.
6. Series panel (new, beside the score card): the round's 7 boxes (W / L / –) with this game marked;
   series score before and after.
7. Context footer (`context-footer.tsx`): "Won the round" / "Eliminated, run ends 13-5" / "Next: Game 6".

**Home page**

8. "Playoff mode" while a Club Finals run is alive: a Club Finals strip at the top (run, round, the W/L
   boxes, run record, RP if CF1 stores it, "one win from the final"), linking to CF1's Club Finals page.
   When no run is alive the home page is as today.
9. Latest result (`components/home/latest-result.tsx`): the finals context line.
10. Recent games strip (`components/home/recent-games-strip.tsx`): finals games marked as in item 1.
11. Record strip (`components/home/record-strip.tsx`): a Club Finals line next to the division chip (best
    record, best round reached, current run).

**Navigation**

14. Top nav: a "Club Finals" link (where CF1 put the page), with a small live dot while a run is alive.
    Every Link to a data page gets `prefetch` (repo convention).

Not in this task (CF4, Proposed): finals stats (season records row, finals leaders, player-page finals
stats, a stats-page filter, news pinning).

## Paths

- **May edit:** `apps/web/src/app/page.tsx`, `apps/web/src/app/games/`, `apps/web/src/components/home/`,
  `apps/web/src/components/matches/`, `apps/web/src/components/nav/`, a new
  `apps/web/src/components/club-finals/`, `apps/web/src/lib/` (format helpers only), web tests, this task
  file. Reads CF1's queries (no edit to `packages/db/`).

## Checks

web typecheck; web unit (new tests for each new piece's states: alive run, eliminated, final, no run,
unknown); prettier; screenshots from the read-only preview at 1440 and 393 px wide: games page, a
finals game, the final, the home page with a run alive and with none. Any login bypass or temporary data
patch never committed.

## Done when (written before the work starts)

- **Done when:** checks pass and the operator OKs the screenshots. Reason: on a finals night the site
  must make it obvious that these games matter.
- **Not done if:** a round or series number is computed in the web app, or an existing feature is
  removed.

## Stop conditions

Stop and write "Blocked" in the Log when: a path outside "May edit" is needed; the "done when" rule
is unclear; an operator decision is needed; a live write, deploy or anything irreversible comes next.

## Log

- 2026-11-14 15:27 Lead2: written from the operator's "Lets go with your advice" (must + next items:
  1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 14). Ready; starts after CF1 is merged.

Resume: start after CF1 is merged.

## Report (task agent fills when state = Verify)

- **What changed (visible effect):**
- **How it was checked (commands, numbers):**
- **Not done:**
- **Git state:** branch, last commit, rebased on `main` at <hash>, checks pass/fail
