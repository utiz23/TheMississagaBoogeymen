# Task: Club Finals off the home page (the finals are over)

- **State:** Deployed 2026-11-21 22:02 (`web` at `f3a6f7fd`; rollback `:rollback-he-2026-11-21-pre-finals-off`)
- **Lane:** Web
- **Risk:** low (removes home-page parts; no data change)
- **Slug:** home-club-finals-off (branch `work/home-club-finals-off`, worktree `.claude/worktrees/home-club-finals-off`)
- **Operator approval:** 2026-11-21 21:22 ("Club finals is over. Remove the live playoff progress from the main page and do
  any other clean up you deem necessary."). Lead does the task itself (small task, one lane).
- **Operator gate before merge:** yes (screenshot)
- **Needs a deploy:** yes: `web` (the operator's OK)

## Goal and visible result

The home page shows no Club Finals parts: no finals card (top "playoff mode" card or the quiet line), no
finals chip in the record strip, no round/series line on the latest-game card or the recent-games strip.

**Stays (history, Lead's call):** finals badges and the series panel on game pages and in the games list
(and its filter); the worker's derivation (`club_finals_games`, 37 games, 3 attempts); the Discord, news and
press finals code (it acts only on a game with a finals row, so it is quiet without new finals games); the
Press Box note. No finals storyline is stored (checked read-only 11-21).

**Coming back:** if EA runs Club Finals again, revert this task's commit to bring the home parts back.

## Paths

- **May edit:** `apps/web/src/app/page.tsx`, `apps/web/src/components/home/`,
  `apps/web/src/components/club-finals/club-finals-card.tsx` (delete), `apps/web/src/lib/club-finals-view.ts`
  and its test (remove what only the home page used), this task file.
- **Must not touch:** game pages, the games list, worker, Discord, database.

## Checks

- **Checks (guide section 6):** prettier (changed files), web typecheck, web `test:unit`, eslint on changed files
- **Evidence:** screenshot of `/` (desktop + phone) from the dev server (live DB, read-only tunnel); a game page
  of a finals game still shows its badge

## Done when (written before the work starts)

- **Done when:** the home page HTML has no "Club Finals" text, a finals game page still shows its finals
  badge, and the checks pass.
- **Not done if:** a game page or the games list loses its finals badge.

## Log

- 2026-11-21 21:22 Lead3: task written. Live (read only): 3 attempts, last finals game 2026-11-14 19:32.
- 2026-11-21 21:28 Lead3: removed the home card (both places), the record-strip finals chips (+ their CSS), the finals line
  on the latest-game card and the recent strip; deleted `club-finals-card.tsx` and the home-only helpers
  (`clubFinalsSituation`, `clubFinalsReached`, `clubFinalsRunAlive`, `clubFinalsRecordLine`) and their tests.
- 2026-11-21 22:02 Lead3: operator "deploy, drop CF4". Merged (`f3a6f7fd`, ff), rollback tag, build, `up -d --no-deps web`.
  Checks: `/`, `/games`, `/games/3405`, `/game-score` 200 (HE + public); home 0 finals text; 3405 keeps its badge.
  CF4 Dropped; finished finals rows left the board.
- Resume: none (done). To bring the home parts back: revert `f3a6f7fd`.

## Report

- **What changed (visible effect):** the home page has no Club Finals parts (top card, quiet line, record
  chips, finals tags on the latest and recent games). Game pages and the games list keep their badges.
- **How it was checked:** web typecheck pass; web `test:unit` 777/777 (9 removed with the deleted helpers);
  prettier pass; eslint: no new problems (home page 6 → 0, record strip 8 → 1 old, test 70 → 22 old style).
  Dev server (live DB, read only): home page text has 0 "finals" (live today: 3); game 3405 still shows
  "Club Finals Round 1 · Game 1" and its series; `/games` 200. Desktop 16 px sideways scroll and the 404 of
  EA crest t126 are the same on live (not this change).
- **Not done:** nothing. CF4 dropped by the operator.
- **Git state:** `work/home-club-finals-off`, on `main` at the task commit.

## Verifier result

- Not needed: no number is claimed.
