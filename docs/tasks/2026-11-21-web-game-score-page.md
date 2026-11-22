# Task: Temporary "Game Score" explainer page on the site

- **State:** Running
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
- Resume: make the worktree; build the page.

## Report (task agent fills when state = Verify)

- **What changed (visible effect):**
- **How it was checked (commands, numbers):**
- **Tried, no gain:**
- **Not done:**
- **Git state:**

## Verifier result (Verifier fills)

- Not needed: the page shows the existing formula; no new number is claimed.
