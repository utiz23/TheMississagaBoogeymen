# Task: Temporary "Game Score" explainer page on the site

- **State:** Verify (waits for the operator: screenshot, then merge + deploy `web`)
- **Lane:** Web
- **Risk:** low (a new static page; no data change; the score formula is not changed)
- **Slug:** game-score-page (branch `work/game-score-page`, worktree `.claude/worktrees/game-score-page`)
- **Operator approval:** 2026-11-21 ("make it live so i can link it"; picked "On boogeymen.app"). Lead does
  the task itself (small task, one lane).
- **Operator gate before merge:** yes (screenshot)
- **Needs a deploy:** yes: `web` (the operator's OK)

## Goal and visible result

Teammates asked how the game score (the three stars number) works. A page at
`boogeymen.app/game-score` explains it in plain words: weights, goalie rules, the win bonus, a real
worked example (11-06, 4-0 vs 814s Finest), and a calculator. Temporary: no nav link; removed later.
First draft was a claude.ai page (https://claude.ai/artifact/WGKDTVrNp9Ho6yupuuTZQx).

## Paths

- **May edit:** `apps/web/src/app/game-score/`, `apps/web/src/components/game-score/`,
  `apps/web/src/lib/game-score-explainer.ts`, `apps/web/src/lib/game-score-explainer.test.ts`,
  `apps/web/src/lib/match-recap.ts` (add `export` to `skaterBreakdown` and `goalieBreakdown` only),
  this task file.
- **Shared paths needed (Lead OK required):** none
- **Must not touch:** the score formula (weights, rules), everything else

## Checks

- **Checks (guide section 6):** `pnpm format:check` (new files), web typecheck, web `test:unit`
- **Evidence:** screenshot of `/game-score` (desktop + phone width) from the dev server

## Done when (written before the work starts)

- **Done when:** every number on the page comes from the site's own score functions (so the page can't
  disagree with the game page), and the example shows camrazz 17.53, Lehmann 13.00, Henry 11.50, the
  same three stars as the live game page for match 3405.
- **Not done if:** the formula or any existing page changes behaviour.

## Stop conditions

Stop and write "Blocked" in the Log when: a path outside "May edit" is needed; the "done when" rule
is unclear; an operator decision is needed; a live write, deploy or anything irreversible comes next.

## Log

- 2026-11-21 21:00 Lead3: task written; stat lines for the example read (read only) from live: match 3405
  (camrazz, HenryTheBobJr, Matteo Lehmann), 3426 (silkyjoker85), 3390 (HenryTheBobJr).
- 2026-11-21 21:06 Lead3: built `/game-score` (page, calculator, `lib/game-score-explainer.ts` + 6 tests); `skaterBreakdown`,
  `goalieBreakdown` and their input types exported (no formula change). Checks pass; screenshots taken on
  the dev server (live DB, read-only tunnel).
- Resume: operator looks at the screenshots; on OK, merge, push, deploy `web` (docker-redeploy skill).

## Report (task agent fills when state = Verify)

- **What changed (visible effect):** new page `/game-score` (no nav link): plain-words weights, goalie
  rules, win bonus, the 11-06 example with stat-by-stat math, a scale, a calculator, where the score
  shows, limits, questions. All numbers come from `skaterBreakdown` / `goalieBreakdown`.
- **How it was checked (commands, numbers):** web typecheck pass; web `test:unit` 786/786 (6 new: the
  example gives camrazz 17.53, Lehmann 13.00, Henry 11.50, and `buildAllTeamScores` ranks them in that
  order; anchors silky 8.60, Henry 21.99); prettier pass; eslint on the new files clean. Dev server:
  HTTP 200, no console errors, no sideways scroll at 1280 and 390; calculator 3 saves on 4 shots =
  3.80 with the "can't be a star" note (hand math: 0.60 + 3.00 − 0.80 + 1.00).
- **Tried, no gain:** Playwright MCP (needs sudo for its Chrome path); used the local Playwright package.
- **Not done:** merge and deploy (operator's OK). Removal later (operator says when).
- **Git state:** `work/game-score-page`, rebased on `main` at `b57e4966`.

## Verifier result (Verifier fills)

- Not needed: the page shows the existing formula; no new number is claimed.
