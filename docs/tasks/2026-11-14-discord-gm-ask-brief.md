# Task: /gm ask — the GM's text is a private brief by default, never posted

- **State:** Deployed 2026-11-14 19:27 (operator: "All approved")
- **Lane:** Discord (`apps/discord/src/press/`)
- **Risk:** medium (what reporters post to players)
- **Slug:** gm-ask-brief (branch `work/gm-ask-brief`)
- **Operator approval:** 2026-11-14 19:12 ("the gm interview prompt did not work as intended")
- **Operator gate before merge:** yes (dry-run samples)
- **Needs a deploy:** `press`
- **Helper model:** Opus

## What happened (live, 2026-11-14 19:07, game 3448, `news_gm_asks` id 1)

The operator used `/gm ask` for yoma with the text "Ask him about his disaterous game on defense, and ask why
he would go for a push faceoff in the offensive zone when he is lined up on the blue line. Put the heat on
him." `exact` defaults to **true** (T2, `apps/discord/src/press/gm.ts` ~line 573), so Dex Mercer posted that
text word for word to the player. The operator meant a private brief for the reporter.

## Goal and visible result

1. **Default = brief:** `exact` defaults to **false**. The GM's text is a private brief: the reporter writes
   ONE question in his own voice from it (keeping the GM's angle and tone; "put the heat on" = a tough, fair
   hockey question inside the hard lines), addressed to the player in the second person.
2. **The brief is never posted:** a code check refuses a written question that repeats the brief (for example
   5+ words in a row from it), or that contains reporter-instruction phrasing ("Ask him", "ask her", "put the
   heat on", "Ask why", third person about the player being asked). On refusal: rewrite (as the writer's
   existing retry), then fall back to an ordinary game question; never post the brief.
3. **Word for word** stays only when the GM sets `exact: true` explicitly. The option text says so clearly
   (e.g. "exact: post my text word for word (off = a private brief the reporter rewrites)").
4. **Private reply to the GM** says what will happen: "Got it: Dex Mercer will ask yoma, in his own words,
   about: <brief>" or, with exact, "…will ask yoma word for word: <text>".
5. Unchanged: Leave me out refused; a critical brief for a Go easy player refused (existing criticality
   check, fail closed); hard lines, no crude quotes, typos in the brief never copied ("disaterous").
6. Also check `/gm interview` topics: a topic typed by the GM is a brief, never posted word for word (add
   the same repeat check if it is not there; say what you found).

## Paths

- **May edit:** `apps/discord/src/press/` (gm.ts, question writing, the checks, tests), this task file.

## Checks

discord typecheck and tests (zero real model calls); prettier. Tests: default is brief; the live case above
never posts the brief (fake writer that echoes the brief → refused → fallback); exact: true posts as typed;
Go easy + critical brief refused; reply text. Dry-run samples (fake model, wording by hand where needed) in
`/tmp/claude-1000/-home-michal-projects-eanhl-team-website/a2a7873b-2807-4e71-85a1-f9e79d57ba31/scratchpad/samples-gm-ask/samples.md`.

## Done when (written before the work starts)

- **Done when:** checks pass and the operator OKs the samples. Reason: a GM brief must never reach the player.
- **Not done if:** any path can post a non-exact brief's text to a player.

## Stop conditions

Stop and write "Blocked" in the Log when: a path outside "May edit" is needed; the "done when" rule
is unclear; an operator decision is needed; a live write, deploy or anything irreversible comes next.

## Log

- 2026-11-14 19:12 Lead2: written from the operator's report (Discord paste, 19:07). Cause found: `exact` default true.

- 2026-11-14 19:20 task agent: branch `work/gm-ask-brief` in `.claude/worktrees/gm-ask-brief`. Failing tests written first (default is brief; live case never posts; reply text); then the fix. Done: `exact` default false (gm.ts); new `press/brief.ts` check (5+ words in a row from the brief, instruction phrasing, third person about the player); wired into `askQuestion` (writer prompt now says "private brief", review rule added) and into the `/gm interview` question writer; the interview article may not repeat the topic either. Samples written. Finding: the only path that posts the GM's text is `question.ts` (the exact branch); every other path goes through the writer and its checks, then the fallback pool.

- 2026-11-14 19:30 Lead2: merged (`4e975605`); `press` deployed (rollback `:rollback-he-2026-11-14-pre-gmask`; rejoined
  4 of 4 open threads; commands re-registered). Live row `news_gm_asks` id 1 (yoma, game 3448, exact) set to
  `cancelled` (operator OK; undo: `status = 'active'` on id 1).

Resume: none (watch the next /gm ask).

## Report (task agent fills when state = Verify)

- **What changed (visible effect):**
  1. `/gm ask`: `exact` now defaults to **false**. The GM's text is a private brief. Option text: "exact: post my text word for word (off = a private brief the reporter rewrites)". Private reply: "Got it: Dex Mercer will ask yoma, in their own words, about: <brief>"; with `exact: true`: "...will ask yoma word for word: <text>". ("their", not "his": reporters are not all male.)
  2. New `apps/discord/src/press/brief.ts`: `briefProblems(question, brief, playerName)` refuses a written question that (a) has 5+ words in a row from the brief (a brief of under 5 words: the whole brief as the whole question), (b) reads as a reporter instruction ("ask him/her/them/why/about...", a sentence that starts with "Ask", "put the heat/pressure on", "press/grill/push him", "tell him"), or (c) talks about the player in the third person (he/him/his/she/her, or the player's name used as a non-address, e.g. "Why did yoma ..." or "yoma's game"). Used by `askQuestion` (only when a brief is present): a refusal goes back to the writer as a problem (its existing rewrite, up to `ASK_MAX_WRITES` = 4), and when all fail the person's own fallback pool question is posted. The writer prompt calls the text a "private brief" (ONE question, second person, keep angle and tone, "put the heat on" = tough but fair hockey question inside the hard lines, never copy wording or typos); the review gets the same rule.
  3. A brief that names a forbidden person (guest, Leave me out) is now neither posted nor given to the writer (before: a non-exact one went to the writer).
  4. `/gm interview topic` (finding): the topic was fenced nowhere and had no repeat check, so a writer could echo it. Now the topic is fenced data in the prompt, the question writer uses the same `briefProblems` (null after 4 writes, so the existing fixed interview question is used), and `articleProblems` refuses a headline, dek or intro that repeats the topic (5+ words). Machine-made topics ("player asked for one") go through the same check; a copy only costs a rewrite.
  5. Unchanged and still pinned by tests: Leave me out refused; a critical brief for a Go easy player refused (same note check, fails closed); hard lines and the other writer checks.
- **How it was checked (commands, numbers):** `pnpm --filter @eanhl/discord typecheck` clean. `pnpm --filter @eanhl/discord test`: 986 tests, 986 pass, 0 fail (zero real model calls: all fakes). `npx prettier --check apps/discord/src/press docs/tasks/2026-11-14-discord-gm-ask-brief.md` clean. New tests: `brief.test.ts` (6), `gm.test.ts` (3: default is brief, exact true, critical brief for Go easy refused), `panel.test.ts` (6: the live text with a writer that echoes it on all 4 tries -> pool question posted, instruction/third-person refusals, rewrite accepted, writer prompt, forbidden name in a brief, exact true word for word), `interview-asker.test.ts` (3). Older tests changed only because they assumed the old default (`exact` true): 5 in gm.test.ts; in bench.test.ts the `ask` helper now passes `exact: true` and 4 reply patterns say "word for word".
- **Samples:** `/tmp/claude-1000/-home-michal-projects-eanhl-team-website/a2a7873b-2807-4e71-85a1-f9e79d57ba31/scratchpad/samples-gm-ask/samples.md` (fake model; the reporter's wording in samples 1 and 4 is hand-written).
- **Not done / open:**
  - A typo in the brief (e.g. "disaterous") is kept out by the prompt, the review rule and the 5-word check only; there is no code dictionary check (a copied single typo word in an otherwise new sentence is not caught by code).
  - A write that is not an echo but still says something wrong is the review's job as before.
  - The background-question path (`bg.plan`) can still replace question 1 of a GM-asked player and then the brief is silently unused (nothing is posted from it). Pre-existing, not touched.
  - Deploy: `press` only (shared code unchanged outside `apps/discord/src/press/`). `/gm ask` command definition changed (option descriptions): re-registered when `press` starts. Any `news_gm_asks` row still `active` with `exact = true` and not yet asked will still be posted word for word (the GM chose it under the old default): the Lead may check live (read-only) before the deploy.
  - Not run: anything needing the real model or a live Discord login.
- **Git state:** branch `work/gm-ask-brief`, rebased on `main` at e3e456e7, checks pass.
