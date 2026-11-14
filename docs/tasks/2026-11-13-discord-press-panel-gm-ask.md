# Task: T2 — panel scrums (3 reporters) and `/gm ask` (GM shapes questions)

- **State:** Merged (Lead review 2026-11-13); deploy waits for the operator's OK
- **Lane:** Discord (`apps/discord/src/press/`), Database (one hand-written migration), Queries
- **Risk:** medium (live bots; a migration on live, additive only)
- **Slug:** press-panel (branch `work/press-panel`, worktree `.claude/worktrees/press-panel`)
- **Operator approval:** 2026-11-13 ("start"; design in
  `2026-11-13-discord-press-panel-scrums-interviews.md` items 1, 3)
- **Operator gate before merge:** no; the migration and deploy are the operator's OK (Lead runs them)
- **Needs a deploy:** migration 0073 (after a fresh backup), then `press`, `news`, `web` if shared code
  changes

## Goal and visible result

1. **Panel scrum.** Each picked or GM-requested player is asked by **3 different reporters**, one
   question each, each posted by that reporter's own bot in the same thread. Follow-ups (at most 1 per
   reporter, by the same reporter, right after the answer) bring the player's total to a **target drawn
   per player: 3 (10%), 4 (25%), 5 (50%), 6 (15%)**. Follow-ups go to the answers with the most to chase;
   never after an unusable answer; if the answers do not allow the target, the round is shorter.
   Volunteers ("Talk to the press", `/scrum`): **2 reporters, no follow-up**.
2. **`/gm ask`** (GM only): `player` (user, required), `question` (text, required), `reporter` (choice of
   the 8 scrum reporters, optional; default: the panel's first), `exact` (boolean, default true),
   `game` (tonight's game number, optional, like `/gm note`). The player joins that game's scrum as a GM
   request (pinged after the usual 60 s; if the scrum is not open yet, when it opens). The chosen
   reporter asks that question as the player's **first** question: word for word when `exact`, else
   written from it as a topic in the reporter's voice. That reporter is part of the player's panel.
   Private reply to the GM: "Got it: <Reporter> will ask <Player>: <question>". Refused (private reply,
   nothing stored as active) for a "Leave me out" player; for a "Go easy" player when the question is
   critical (use the existing criticality check; fail closed) or the AI check is unavailable.

3. **Variety (operator's thread, 2026-11-13):** in one scrum, the questions to different players do
   not repeat the same angle (game 3439: every player got the "23 to 5 hits" question). Pass the
   angles already used in the scrum to the question writer and forbid repeats.
4. **No silent answers:** an unusable answer is still never echoed or quoted, but the next line
   acknowledges it briefly in the reporter's voice (no repeat of its words), so the player knows it
   arrived (game 3439: Erb's and Silky's first answers seemed to vanish).

## Rules that stay

Heat, rotation, takes and disabled-reporter rules pick the panel (no Father Rink); the 80% budget stop;
ping limits; trial vs live; quotes only from usable/joke answers; the night recap waits for open scrums
(at most 30 minutes); every quote attribution names the reporter who asked ("told Dex Mercer").

## Data

Hand-written idempotent migration `packages/db/migrations/0073_press_panel.sql` (same form and header
as 0072: how to apply, rollback). Lead suggestion, the agent may refine: `news_scrum_people` gains
`panel text[]` (reporter ids in order) and `target_total integer`; `news_scrum_answers` gains `reporter`
text; a GM ask is stored as a `news_gm_notes` row with new nullable columns `question_text`,
`question_exact boolean`, `question_reporter text` (or a small new table: agent's choice, say why).
Existing rows keep working (one-reporter scrums stay readable). Schema in
`packages/db/src/schema/news-press.ts`, queries in `packages/db/src/queries/news-press.ts`.

## Paths

- **May edit:** `apps/discord/src/press/`, `apps/discord/src/news/` (quote attribution, recap material),
  `packages/db/src/schema/news-press.ts`, `packages/db/src/queries/news-press.ts` + tests,
  `packages/db/migrations/0073_press_panel.sql`, `packages/db/src/news/` (rules version, shared types),
  `apps/web/src/` only if a shared type forces it, the press runbook, this task file.

## Checks

db build; typecheck db, web, discord, worker; discord tests; db query tests by name; prettier. Tests for:
the target distribution (seeded), 3 distinct reporters, follow-up allocation, volunteer round, `/gm ask`
exact and topic paths, refusals, the first question of a GM-asked player, the migration SQL shape
(pinned builder or a read of the file). Migration not applied anywhere by the agent.

## Done when

All checks pass; tests pin the rules above; the Report lists the schema change and the rollback.

## Log

- 2026-11-13: Work done on `work/press-panel`, rebased on `main` (a72bf0be). All source edits are inside
  "May edit", plus two files the Lead named in the added items: the rulings file
  `docs/superpowers/plans/2026-10-26-news-desk-bots-rulings.md` (rulings 51-55) and `packages/db/src/news/`
  (rules version). `apps/web` and the worker are not changed (typecheck only).
- **Added by the Lead 2026-11-13** (live diagnosis of game 3440): (1) `ASK_MAX_WRITES` 2 -> 4; (2) a failed
  question or judgement write logs its reason (code-check problems or error; the player's word runs are
  redacted, `safeWhy`); (3) the judge KEEPS a parsed verdict when only the reply line fails (reverses
  ruling 10's sub-case, noted as ruling 51), posts a neutral pool line, asks no follow-up; (4) fallback
  line pools, 4 per reporter and kind (question, closing, acknowledgement), never the same line twice in
  one thread; (5) every pop-up answer is echoed at once, before the judgement, except one the code refuses.
- Not applied anywhere: migration 0073. No Docker, no ssh, no deploy, no push.

## Report

**What changed**

1. Panel scrum. A person's panel is made at their first question (`ensurePanel`, question.ts): 3 different
   reporters for a picked player (and a GM request), 2 for a volunteer. The first is the GM's chosen reporter,
   else the scrum's own reporter (rotation, heat and takes already picked it); the rest are drawn without
   replacement with the heat x3 and take x2 weights; never Father Rink, never a disabled reporter. The target
   total is drawn per player (3 10%, 4 25%, 5 50%, 6 15%; volunteer = 2). Each question and follow-up is posted by
   its own reporter's bot in the shared thread; the answer row stores `reporter`.
2. Follow-ups (`followUpPlan`, rules.ts): one per reporter, by the same reporter, right after the answer; never
   after a follow-up or an unusable answer. When the follow-ups still needed equal the answers still to come the
   plan is `must` (written even with little to chase), else `chased` (kept only when the judge says
   `chase: "strong"`, new field in the judgement). If the answers do not allow the target the round is shorter.
   Old one-reporter people (a question asked, no panel) keep the old limits.
3. `/gm ask player question [reporter] [exact=true] [game]` (gm.ts `onGmAsk`, gateway command and router). The
   player joins the game's scrum as a GM request (pinged after the usual 60 s); with no scrum yet the ask waits
   and `createScrum` adds every active ask player when it opens. The chosen reporter is first on the panel and
   asks the question as question 1: word for word when exact (no model call), else the writer gets it as a topic
   (fenced data) and writes it in the reporter's voice. Private reply: "Got it: <Reporter> will ask <Player>:
   <question>". Refused (row stored `refused`, nothing active): GM only, "Leave me out" player, question that names
   such a player or a forbidden name (guest), "Go easy" + critical (existing note check, fails closed) or no AI,
   reporter off or Father Rink, player not linked / not in the game, closed scrum, player already being asked,
   budget spent. A player already in the scrum but not asked yet keeps one person and gets the GM question.
4. Variety. `listScrumQuestions` passes the questions put to other players (answered and open) to the question
   writer with a ban on the same moment, stat, number or angle; a code check rejects a number of 10 or more that an
   earlier scrum question used; the review gets the list as a rule.
5. No silent answers. After an unusable answer, when the round goes on, the asking reporter posts an
   acknowledgement (the judge's `closing`, which may not repeat the answer; a pool line when the code or a failed
   judgement decided) before the next reporter asks. Quotes name the asking reporter: `PressQuote.reporter`
   (`coalesce(answer.reporter, scrum.reporter)`), "asked ... by <Reporter>" in the press room and the review,
   with the "told Dex Mercer" rule in the press room text; the review flags a quote given to another reporter.
6. Lead items: see the Log (ASK_MAX_WRITES 4, logged reasons, verdict kept, `fallbacks.ts` pools, echo first).
   Also the expiry line and the code-closed lines use the pools.
7. `NEWS_RULES_VERSION` 2026-11-13.3 (rules 13 and 14, press room text, review rule 1).

**Schema change (migration 0073, hand-written, idempotent, additive; NOT applied)**
`news_scrum_people` + `panel text[] NOT NULL DEFAULT '{}'` (check: only reporter ids) and `target_total integer`
(check null or 2-6); `news_scrum_answers` + `reporter text` (check null or reporter id; null = the scrum's
reporter); new table `news_gm_asks` (id, match_id, night, player_id, question, exact, reporter, status, refusal,
requested_by_user_id, is_test, created_at; status and reporter checks; 2 indexes). Why a new table and not
`news_gm_notes`: a note reaches the night recap and the writers as a true event, and a question is not an event;
`nightPressNotes`, `gmAskForMatch` and the asker contexts would all need a filter. Apply: header of the file
(same form as 0072), after a fresh backup, before the new code. Rollback (code first, then SQL): drop
`news_gm_asks`, drop the three columns and the checks; the exact statements are in the file header.

**Checks (in the worktree, after the rebase on main a72bf0be)**

- `pnpm --filter @eanhl/db build` ok. Typecheck db, discord, web, worker: all clean.
- `pnpm --filter @eanhl/discord test`: 650 tests, 650 pass, 0 fail (was 583 before T2).
- `node --test packages/db/dist/queries/__tests__/news-press.test.js`: 48 pass; `news.test.js` with it: 105 pass;
  `pnpm --filter @eanhl/db test`: 233 pass.
- Prettier `--check` on all changed .ts and .md files: clean (the .sql has no parser).
- New tests pin: target distribution (20,000 seeds within 1 point of 10/25/50/15, seeded), 3 distinct reporters
  (no Rink, no disabled, first honoured, heat and take weights, short panel), the follow-up plan table, targets 3-6
  reached with follow-ups by the same reporter, chase gating, unusable gets none and the round is shorter, one
  follow-up per reporter, volunteer round (2, no follow-up), old round limits, acknowledgements (model line, fixed
  line, failed ack post), typed answers for every reporter of a panel, variety (prompt, number check, review rule),
  `/gm ask` exact and topic, first question only, refusals, trial/live scoping, ask players joining when the scrum
  opens, command definition and router, quote attribution text, SQL builders, migration file shape.
- Not run: anything needing Docker, a live Discord login, the live database or the real model.

**Choices I made**

- Panel made lazily at the first question (one code path for every way to join a scrum).
- `chase` is a new required judgement field but the parser accepts a reply without it (counts as "some"), so an
  old-style reply still works.
- The variety number check uses 10 or more, so small repeated numbers (shots, goals) do not block a question.
- Fallback "used line" memory is per process (not stored): a restart can repeat a line in an old thread.
- `/gm ask` default reporter with no scrum yet cannot be named in the reply ("the first reporter on their panel").
- A disabled reporter chosen by the GM is refused (not silently swapped).

**Not done / open risks**

- Each reporter bot must be allowed to post in threads of the game channel; the first live panel scrum is the test.
  The expiry-pass line is posted by the scrum's own reporter, not the one who asked.
- The real model is untested on the new judgement field and on the topic path.
- `/gm ask` registers a new subcommand: the command definitions are re-registered when the `press` service starts.
- Deploy: migration 0073, then `press` and `news` (shared `news/prompts.ts` and `cycle.ts` changed); `web` only
  if the Lead wants the image rebuilt for the db package.
- Git: branch `work/press-panel`, rebased on `main` (a72bf0be); commit a5dbac74 plus this task-file commit. Not pushed.
- 2026-11-13 Lead review: migration 0073 read (additive, one transaction, rollback in header; new
  table `news_gm_asks` instead of note columns, reason accepted). Re-ran: typecheck db/discord/web/worker
  clean; discord 650/650; news + news-press db tests 105/105; web unit 672/672. Rulings file edited
  (51-55) at the Lead's request. Deploy order: backup → 0073 → `press` + `news`.
