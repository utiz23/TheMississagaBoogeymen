# Task: P1 — NHL 27 goals and shots by period from the engine's video readings (import + box)

- **State:** Verify (since 2026-11-14 19:20; task agent of `Lead2`; Opus: live data + numbers teammates see)
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

- 2026-11-14 18:55 task agent: branch and worktree made; built the CLI, the db rules, the period strip and the box label against a hand-made fixture.
- 2026-11-14 19:05 task agent: screenshots (sample rows in memory, patch reverted) and card heights measured.
- 2026-11-14 19:12 task agent: Lead2 sent the real engine shape (flat period keys, shots may be null, goal list key `goals`, `end_of_game_check` is text) and two engine Verifier rules. Parser aligned; both rules have tests. Dry run on the real 32-file snapshot (read-only live connection, never `--apply`).
- 2026-11-14 19:20 task agent: rebased on main, checks pass, State = Verify. Not merged, pushed or deployed.

- 2026-11-14 19:32 task agent: operator decision D27 (via Lead2, 2026-11-14): (a) /games cards show ONE compact goals line ("1st 2–1 · 2nd 1–1 · 3rd 2–1 · OT 1–0") with the small "read from video" label, no blank spacer, a card without data keeps today's height; the full period table stays on the game page and the home panel; (b) goals only for now: no shots per period shown anywhere; shots are still imported and stored with shots review = pending_review. Done: card line, goals-only home table, shots review always pending_review (constant `ENGINE_SHOTS_REVIEW_STATUS`), read side returns no shots to the cards, new screenshots, heights measured. The importer's decision logic (checks, score rule) is unchanged.
- 2026-11-14 19:44 task agent: operator (via Lead2, ~19:45-19:47): "axe the box score from the game cards as they are too crowded and makes them too tall." and "I remember there just being a box placeholder. It was simple. What we have now is a bit too much." Done: the goals line is gone from the /games cards (cards are back to today's 277 px everywhere; `ScoreCard` and the games page are identical to `main` again); the home latest-game panel now shows the simple classic box (BGM row and EA's opponent abbreviation row, one column per period, TOT, goals only, one small "Read from video" note top right, no heading); the game page Box Score is unchanged. `getEnginePeriodStrips` stays (the home page uses it). The importer is untouched.

Resume: the Lead reviews the report and screenshots, a Verifier re-runs the checks, the Lead merges after the operator gate; a deploy of `worker` + `web` and each import run need the operator's OK and a backup (runbook).

## Report (task agent fills when state = Verify)

- **What changed (visible effect):**
  - Worker CLI `import-engine-periods --dir <folder>` (dry run by default, `--apply` writes; nothing was ever applied). Rules in
    `apps/worker/src/lib/engine-periods.ts`; wire field names in one table (`FIELDS`). Only `complete: true`; schema_version 1 only; every
    field strict (extra keys allowed); the period goals must equal OUR database's EA final on both sides; the file's own `final` must agree; one
    file per match, file name = EA match id. `end_of_game_check` is never trusted alone: a not-complete file whose goals differ from EA is shown
    REFUSED. The opponent abbreviation in the file is never read, shown or stored. A null shot count is stored as null (shots are not shown anywhere, D27).
  - **Source value:** `engine_video` (type added to `EnrichmentSource`; no migration, the column has no CHECK). **Review rule:** goals review =
    `reviewed` only because the checks passed (a match that fails gets no rows at all); shots review = always `pending_review` (D27, goals
    only: shots are stored but hidden); faceoffs empty and `pending_review`; legacy `review_status` = `reviewed` (transitional). The site never reads
    the legacy column. Idempotent: delete + insert of that match's `engine_video` rows in one transaction; unchanged numbers write nothing.
  - Read side (`getMatchPeriodSummaries`): engine rows show only if their goals add up to EA's final (second check) and only when no other source
    has a visible row (OCR/EA/manual win, so nothing that shows today changes). New `getEnginePeriodStrips(matchIds)` (goals only) for the home panel.
  - Web (after D27 and the operator's "too crowded" change, goals only): game page Box Score shows the small label "Read from video" (everyone; the admin chip
    says "Engine · video") and drops the empty FO and Shots tabs for engine rows (shots are masked by their pending review); home latest-game panel: the
    same simple classic box (BGM row + EA's opponent abbreviation row x period columns + TOT, goals only, one "Read from video" note top right); the
    /games cards show nothing (unchanged from main).
  - **D27 shots rule:** shots are still imported and stored (`ENGINE_SHOTS_REVIEW_STATUS = 'pending_review'`), so `getMatchPeriodSummaries` masks them and no page
    shows them; `getEnginePeriodStrips` returns goals only. Flip the constant and re-run the import to show them later.
  - Runbook: `docs/operations/runbooks/engine-period-import.md`.
  - **Effect on other readers:** news desk and Discord use `getMatchPeriodSummaries` only to detect overtime (`wentToOvertime`); engine OT rows now count
    there too (correct, and only for imported games).
- **Card heights (CF3b), after the operator removed the card line:** one /games page measured with Playwright getBoundingClientRect at 1280 and 390: all 9
  cards are 277 px (finals and normal), exactly today's height. The /games code is identical to `main`. (The earlier D27 card line made data cards 305 px:
  superseded and removed.)
- **How it was checked (commands, numbers):** `pnpm --filter @eanhl/db build`; typecheck db, worker, web, discord: 0 errors; new tests: worker
  `node --test apps/worker/dist/__tests__/engine-periods.test.js` 30 pass (score-sum refusal, incomplete, unknown schema, idempotent replace, OT,
  other sources untouched, dry run writes nothing, null shots, real sample file, cut recording, opponent abbreviation); db
  `packages/db/dist/queries/__tests__/period-rows.test.js` 6 pass; web `test:unit` 780 pass; prettier clean on all changed files. Not run: worker
  integration tests (they need the verification database; no Docker on the main PC) and the real SQL of `replaceEngineRows` (the tests use an
  in-memory store with the same rules; the read queries ran against live read-only in the dry run). `pnpm lint` not used (red repo-wide).
- **Dry-run table (real files; engine snapshot 1, 32 files; read-only live connection with `default_transaction_read_only=on`; `--apply` never run).**
  22 would be written, 0 replaced, 6 skipped (not complete), 4 refused (not complete and the goals differ from EA's final: 3554411060318,
  3596775060454, 3850226150424 and 3604287510034). 0 written matches with a period-sum mismatch. No NHL 27 match has rows from another source yet.
  Shots (info only): the engine's period shots are usually equal to or a little above EA's whole-game shots; the biggest gap is 3852785320026
  (16-20 vs EA 12-18). No other warnings.

| file (ea match id) | match | EA final | period sum | periods | shots, period vs EA (info) | action                                       |
| ------------------ | ----- | -------- | ---------- | ------- | -------------------------- | -------------------------------------------- |
| 3492792920262      | 3405  | 4-0      | 4-0        | 3       | 12-12 vs EA 12-10          | INSERT                                       |
| 3498363310454      | 3407  | 4-7      | 4-7        | 3       | 24-23 vs EA 23-21          | INSERT                                       |
| 3498685780072      | 3408  | 2-1      | 2-1        | 4       | 16-16 vs EA 15-14          | INSERT                                       |
| 3500006670236      | -     | -        | -          | -       | -                          | SKIPPED                                      |
| 3552140390158      | 3409  | 3-2      | 3-2        | 4       | 32-8 vs EA 30-5            | INSERT                                       |
| 3554189990028      | 3410  | 2-0      | 2-0        | 3       | 24-8 vs EA 21-8            | INSERT                                       |
| 3554411060318      | 3411  | 0-3      | 0-2        | 3       | -                          | REFUSED (not complete; goals differ from EA) |
| 3554581060482      | 3413  | 6-0      | 6-0        | 3       | 18-15 vs EA 17-15          | INSERT                                       |
| 3554816600479      | -     | -        | -          | -       | -                          | SKIPPED                                      |
| 3558160170038      | -     | -        | -          | -       | -                          | SKIPPED                                      |
| 3558333060492      | -     | -        | -          | -       | -                          | SKIPPED                                      |
| 3596319670132      | 3417  | 5-2      | 5-2        | 3       | 20-11 vs EA 17-11          | INSERT                                       |
| 3596487640036      | 3418  | 6-5      | 6-5        | 4       | 33-19 vs EA 33-18          | INSERT                                       |
| 3596775060454      | 3419  | 0-3      | 0-2        | 3       | -                          | REFUSED (not complete; goals differ from EA) |
| 3596922560179      | 3420  | 3-2      | 3-2        | 4       | 19-22 vs EA 16-21          | INSERT                                       |
| 3604065240262      | 3421  | 2-1      | 2-1        | 3       | 21-8 vs EA 21-8            | INSERT                                       |
| 3604287510034      | 3422  | 2-1      | 1-1        | 4       | -                          | REFUSED (not complete; goals differ from EA) |
| 3604556180147      | -     | -        | -          | -       | -                          | SKIPPED                                      |
| 3644138390015      | 3424  | 5-4      | 5-4        | 3       | 18-17 vs EA 17-16          | INSERT                                       |
| 3648829380332      | 3427  | 5-0      | 5-0        | 3       | 19-14 vs EA 16-13          | INSERT                                       |
| 3650544500475      | -     | -        | -          | -       | -                          | SKIPPED                                      |
| 3652099250174      | 3428  | 2-4      | 2-4        | 3       | 29-16 vs EA 29-16          | INSERT                                       |
| 3792882800443      | 3430  | 0-2      | 0-2        | 3       | 10-20 vs EA 10-18          | INSERT                                       |
| 3796060490477      | 3431  | 2-3      | 2-3        | 4       | 20-19 vs EA 19-18          | INSERT                                       |
| 3796370390149      | 3432  | 1-4      | 1-4        | 3       | 20-12 vs EA 18-12          | INSERT                                       |
| 3844560090192      | 3433  | 0-2      | 0-2        | 3       | 12-11 vs EA 12-9           | INSERT                                       |
| 3846709990491      | 3434  | 2-3      | 2-3        | 3       | 11-19 vs EA 9-18           | INSERT                                       |
| 3850226150424      | 3435  | 0-3      | 1-2        | 3       | -                          | REFUSED (not complete; goals differ from EA) |
| 3850696310094      | 3438  | 2-3      | 2-3        | 3       | 12-11 vs EA 12-11          | INSERT                                       |
| 3852264700442      | 3437  | 4-2      | 4-2        | 3       | 22-10 vs EA 20-8           | INSERT                                       |
| 3852785320026      | 3439  | 5-4      | 5-4        | 4       | 16-20 vs EA 12-18          | INSERT                                       |
| 3854340900368      | 3440  | 5-3      | 5-3        | 3       | 19-14 vs EA 16-14          | INSERT                                       |

- **Screenshots (sample goals in memory only; the temporary patch was in the git-ignored `packages/db/dist` and is reverted by a rebuild; nothing committed;
  dev server on port 3800 and tunnel 5441 stopped):** `/tmp/claude-1000/-home-michal-projects-eanhl-team-website/a2a7873b-2807-4e71-85a1-f9e79d57ba31/scratchpad/shots-p1/`
  `games-cards-v3-1280.png`, `home-latest-v3-1280.png`, `home-latest-v3-390.png`, `game-3446-boxscore-v2-1280.png` (game page box, unchanged),
  `dryrun-real-snapshot-1.txt`. The v1 and v2 pictures show superseded card designs.
- **Not done:** merge, push, deploy, any `--apply`. Faceoffs and player names (later steps). Screenshots with a null-shot period. The importer
  trusts `our_side` only as a warning. Open choice for the Lead: engine rows yield to OCR rows when both exist.
- **Paths outside "May edit":** none. (`packages/db/src/schema/match-enrichments.ts` is inside it: one type line, no migration.)
- **Deploy order:** (1) `worker` image (CLI) and `web` image together (the web needs the new db package; no migration); (2) operator OK + fresh
  backup; (3) copy the folder, dry run, read the table; (4) operator OK, `--apply`; (5) check. Nothing is shown until step 4.
- **Git state:** branch `work/period-import`, rebased on `main` (see the last commit), checks pass. Not pushed.

## Verifier result (Verifier fills)

- **Ran (2026-11-14, own worktree `.claude/worktrees/verify-p1`, detached at `c7f4f958`, then branch `verify/period-import`):**
  1. A Python script, written without the branch code, read all 32 files in the engine snapshot and looked up each match on live
     (read-only `psql` over SSH). Rule: write only if complete = true AND the match exists AND period goals sum = EA score on both sides.
     (The query in the brief had an ambiguous `id`; I used `m.id`.)
  2. The branch CLI in dry run on the same folder. The real database connection FAILED: the password in the main checkout's `.env`
     is refused by Hotel-Echo (`password authentication failed`, tunnel 5443 worked, `default_transaction_read_only=on` was set).
     I did not look for another password. Instead I ran the branch's compiled planner (`dist/lib/engine-periods.js` `importFolder`,
     the same code the CLI calls) with a stub store: `findMatch` read live read-only over SSH, `replaceEngineRows` threw if called
     (never called). The real SQL of the CLI's `dbStore` was not exercised by me.
  3. Checks: db build; typecheck db, worker, web, discord; worker `node --test dist/__tests__/engine-periods.test.js`; db
     `dist/queries/__tests__/period-rows.test.js`; web `test:unit`; prettier on the changed files (fixtures excluded).
  4. `git diff --name-only main...work/period-import` against "May edit".
- **Got:**
  - My decisions: 22 write, 10 skip (not complete), 0 refuse (no complete file lacks a match or has a sum mismatch).
  - Branch planner: 22 INSERT, 6 SKIPPED, 4 REFUSED. The 22 written matches are identical to mine (same 22 EA match ids).
  - The 4 differences are label only, none written: 3554411060318, 3596775060454, 3604287510034, 3850226150424 are not complete AND their
    period sums differ from EA (0-2 vs 0-3, 0-2 vs 0-3, 1-1 vs 2-1, 1-2 vs 0-3). The branch calls them REFUSED, my rule called them skip.
  - Written matches with a period-sum mismatch: 0. Every other match with a mismatch is an incomplete file and is not written.
  - Live holds 259 `ocr` rows and no `engine_video` rows in `match_period_summaries` (no replace case in this folder).
  - Checks: all four typechecks 0 errors; worker tests 29/29; db period-rows tests 6/6; web unit 768/768; prettier clean.
  - Paths: all 25 changed files are inside "May edit" (worker fixtures folder, `EnrichmentSource` type line in the db schema, no migration, no
    out-of-lane file).
- **Compared with claim:** the Report's table (22 INSERT / 6 SKIPPED / 4 REFUSED, same match ids and sums) agrees with the planner run row by
  row. Report claims about checks agree with my runs. The Report says the dry run used a read-only live connection; mine could not (password
  refused), so I confirm the decision logic only, not the CLI's own SQL.
- **Verdict:** pass with notes. Notes: (a) CLI SQL (`dbStore`) not verified by me, and `replaceEngineRows` real SQL has no test anywhere;
  the Lead should check it on the first real run with a fresh backup; (b) the `.env` password on the main PC does not work on Hotel-Echo.
