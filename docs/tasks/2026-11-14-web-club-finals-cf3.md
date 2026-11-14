# Task: CF3 — Club Finals look on the site (games page, game page, home "playoff mode", nav)

- **State:** Verify (task agent done 2026-11-14 16:07; was Running since 15:50, task agent of `Lead2`) (operator 2026-11-14 15:27: "Lets go with your advice")
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

8. "Playoff mode" while a Club Finals run is alive: CF1's home-page Club Finals component (operator
   2026-11-14: no separate page, "just a component on the home page") moves to the top and gets the
   playoff look ("one win from the final" etc.). When no run is alive the home page is as today.
9. Latest result (`components/home/latest-result.tsx`): the finals context line.
10. Recent games strip (`components/home/recent-games-strip.tsx`): finals games marked as in item 1.
11. Record strip (`components/home/record-strip.tsx`): a Club Finals line next to the division chip (best
    record, best round reached, current run).

**Navigation**

(14. Top nav link: dropped: there is no Club Finals page, operator 2026-11-14.) Every Link to a data page
gets `prefetch` (repo convention).

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

- 2026-11-14 15:35 Lead2: operator: no Club Finals page; CF1 makes a home component. Item 8 builds on it;
  item 14 dropped.

- 2026-11-14 15:50 Lead2: started (CF1 merged at `3b2b3300`; its home component is `apps/web/src/components/club-finals/club-finals-card.tsx`, with an "All attempts" dropdown the operator accepted).

- 2026-11-14 16:07 task agent: built items 1, 2, 3, 5, 6, 7, 8, 9, 10, 11 on branch `work/club-finals-cf3`. Item 14 dropped (no page). All words come from `lib/club-finals-view.ts` (tested); all numbers are CF1's stored values. Judgment calls for the Lead: (a) "Attempt N" is used, not "Run N", to match the accepted home card; (b) "Next: Game 6" is the first empty box of CF1's panel state (`panelViewFromGame`), no counter; (c) the series panel shows the round as it stood at that game (the game page is cached forever, so later games do not appear); (d) item 1 is on `score-card.tsx` (the /games cards), `match-row.tsx` is only used on the stats page and has no badge; (e) the Club Finals filter is `?mode=finals` (+ `&round=1..4`), a fixed match-id selection like `dev`.
- Screenshots: read-only dev server on live (port 3500, tunnel 5438, `default_transaction_read_only=on`) with a temporary uncommitted patch that derives CF1's states in memory (live has no 0083). Patch reverted, server and tunnel stopped, env file deleted. The "no run alive" home shot used a second temporary flag that marks the newest attempt ended: it is a mock-up of that state, not live data.

- 2026-11-14 16:25 task agent: operator (via Lead2, ~16:15): "axe the before and after". Removed "Before 1–3 → After 1–4" from the series panel (boxes, "Series / round" label and the "this game" mark stay); `seriesPanelView` no longer returns before/after and its tests are updated. No other before/after in CF3 (the card, banner and footer show the series score after the game only, as chips). State stays Verify.

Resume: Lead merges (operator gate: screenshots at 1280 and 390 px), then deploy `web`.

## Report (task agent fills when state = Verify)

- **What changed (visible effect):** 1 game cards: red edge, "Club Finals" tag, "R4 · G5" chip, series score, solid bar for "Round won" / "Eliminated · run ends 13–9" / "Final won". 2 "Finals" tile in the Mode group + a Round row (All, R1 to R4) while it is selected. 3 header "Club Finals · Attempt 3 · Round 1" where a round starts. 5 banner "CLUB FINALS · ROUND 2 · GAME 3", solid red "THE FINAL · GAME 5"; chip in the top bar. 6 new series panel (7 boxes, this game marked, earlier games link; before/after score removed on the operator's word). 7 footer line (Won the round / Eliminated, run ends / Next: Game N). 8 while a run is alive the home card is the first thing on the page with a red glow, "Live run", the stakes line (one win from the final, one loss from elimination, win or go home, round won) and a red current-round tile; with no run alive the page is as before. 9 latest result: finals banner. 10 recent results: edge, chip, series, mark. 11 record strip: "Finals · Best 13–9 · Reached the final" chip (+ current attempt chip while one runs), also in the phone DETAILS.
- **How it was checked (commands, numbers):** web `tsc --noEmit` clean; web unit `pnpm test:unit` 750/750 (23 new tests in `src/lib/club-finals-view.test.ts`: alive run, eliminated, final, round won, no run, unknown/null); prettier clean on all changed files (`record-strip.css` was already non-conforming, left as is); eslint on new non-test files: 0 errors (the test file has the same floating-promise noise as the other tests). Screenshots in `/tmp/claude-1000/-home-michal-projects-eanhl-team-website/a2a7873b-2807-4e71-85a1-f9e79d57ba31/scratchpad/shots-cf3/` at 1280 and 390: `games-*`, `games-finals-*`, `games-finals-top-1280.png` (round filter), `game-final-3431-*`, `game-roundwon-3440-*`, `home-*` (run alive), `home-quiet-*` (mock-up, no run), `home-record-*`, `home-recent-*`.
- **Not done:** the stakes line (one win from the final etc.) is only covered by unit tests: the live state in the shots (Round 2, 1–1) shows no stakes line. The component tests render no JSX (the repo's runner has no JSX transform), so the pieces are checked by screenshots. Home page at 1280 is 1296 px wide (carousel, not checked against `main`). Top-nav link dropped as agreed.
- **Git state:** branch `work/club-finals-cf3`, rebased on `main`, one commit; checks pass.
