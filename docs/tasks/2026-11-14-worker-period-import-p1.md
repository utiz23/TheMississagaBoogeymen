# Task: P1 — NHL 27 goals and shots by period from the engine's video readings (import + box)

- **State:** Running (since 2026-11-14 18:47; task agent of `Lead2`; Opus: live data + numbers teammates see)
- **Lane:** Worker (import CLI), Queries, Web (the period box), Database (only if a column is needed: 0086)
- **Risk:** medium-high (writes to the live database; numbers teammates see) — a Verifier checks the import
- **Slug:** period-import (branch `work/period-import`, worktree `.claude/worktrees/period-import`)
- **Operator approval:** 2026-11-14 18:44 ("go on all 3": engine export Ready; the 10-09 hold on video data →
  Hotel-Echo DB lifted for goals + shots per period, labelled "read from video", backup before each import;
  this task)
- **Operator gate before merge:** yes (screenshots + a dry-run report on the real files)
- **Needs a deploy:** `worker` image (for the CLI), `web`; each import run = the operator's OK + a backup

## Goal and visible result

Operator: "the goals by period box score on the main page game panel and games page panels is missing.
How soon can we have the in game menu data (at least for the games after nov 6) ingested?" EA has no per-period
data. The engine (`eanhl-live-engine`, engine Lead `[LEAD4]`) reads goals and shots per period from the
recordings and writes **one JSON file per match on the main PC** (engine rule: local files only; the website
does the database write). Agreed shape (engine Lead 2026-11-14): `schema_version` 1, `game_title`,
`ea_match_id`, our side / opponent abbr, final score (+ END OF GAME check), per period (1..6; 4–6 = OT, OT2,
OT3; no shootout) goals BM/opp and shots BM/opp, the goal list (period, clock, team, scorer/assists, strength,
`sure`), engine source commit, `complete` flag. Step 1 uses **goal counts and shots only**; names come later.

1. **Import CLI** in the worker (`import-engine-periods`): reads a folder of these files; `--dry-run` (default)
   prints a per-match table (match found? EA final score vs the sum of period goals; periods; shots; action)
   and writes nothing; `--apply` writes. Rules: only `complete` files; the match must exist (by game title +
   EA match id); **the period goal sums must equal EA's final score, else the match is refused** (reported, not
   written); idempotent (re-running replaces the same match's engine rows, never duplicates); never touches
   EA data or other sources' rows. Rows go to `match_period_summaries` with a new `source` value (e.g.
   `engine_video`); set the goals/shots review columns so the site shows them only when the score check
   passed; faceoffs stay empty. Validate every field; refuse unknown `schema_version`.
2. **The period box** ("goals by period"): on the game page (the box already exists for NHL 26 data: make it
   show the engine rows), on the **home page latest-game panel** and on the **/games cards** (operator: missing
   there). Label it **"read from video"** (small, honest). Keep every existing feature; equal card heights
   (CF3b) must stay equal (if the box would change a card's height, show it compactly or say what you chose).
3. **Runbook** `docs/operations/runbooks/engine-period-import.md`: copy the files to Hotel-Echo, fresh backup,
   dry-run, read the table, apply (operator's OK), check, undo (delete the `engine_video` rows of a match).

## Paths

- **May edit:** `apps/worker/src/` (new CLI + tests; a package.json script line in `apps/worker/package.json`),
  `packages/db/src/queries/` (+ tests), `packages/db/src/schema/` and `packages/db/migrations/0086_*.sql` only
  if needed, `apps/web/src/app/`, `apps/web/src/components/` (period box pieces), `apps/web/src/lib/`,
  `docs/operations/runbooks/engine-period-import.md` (new), a test fixture folder in the worker, this task file.

## Checks

db build; typecheck db, worker, web, discord; worker tests (no database: compile then node --test the new files);
web unit; prettier. Tests: score-sum refusal, incomplete refused, unknown schema refused, idempotent replace,
OT periods, other sources untouched, dry-run writes nothing. A dry run against the real engine files (read-only;
the Lead copies them; never `--apply` on live). Screenshots (read-only preview) of the game page, the home
panel and a /games card with SAMPLE engine rows in memory (temporary patch, never committed).

## Done when (written before the work starts)

- **Done when:** checks pass; the dry-run table on the real files is in the Report; screenshots show the box
  with the label. Reason: a period box shown to teammates must add up to EA's final score.
- **Not done if:** any row could be written for a match whose period sum differs from EA's score.
- **Tolerance for the Verifier:** 0 written matches with a period-sum mismatch.

## Stop conditions

Stop and write "Blocked" in the Log when: a path outside "May edit" is needed; the "done when" rule
is unclear; an operator decision is needed; a live write, deploy or anything irreversible comes next.

## Log

- 2026-11-14 18:47 Lead2: written and started (operator "go on all 3"). Engine export card Ready on the engine side;
  the engine Lead sends the folder, the file pattern and a sample file.

Resume: task agent makes the branch and worktree, reads match_period_summaries and how the site reads it
(0056 publication columns), builds the CLI with tests against a hand-made fixture of the agreed shape.

## Report (task agent fills when state = Verify)

- **What changed (visible effect):**
- **How it was checked (commands, numbers):**
- **Dry-run table (real files):**
- **Not done:**
- **Git state:** branch, last commit, rebased on `main` at <hash>, checks pass/fail

## Verifier result (Verifier fills)

- **Ran:**
- **Got:**
- **Compared with claim:**
- **Verdict:** pass | fail | pass with notes
