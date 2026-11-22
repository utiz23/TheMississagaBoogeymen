# Task: A GM interview topic is question 1

- **State:** Deployed 2026-11-22 00:00 (`press` at `7de70488`; rollback `:rollback-he-2026-11-22-pre-topic-first`)
- **Lane:** Discord
- **Risk:** low-medium (prompt text of a public bot; no data change)
- **Slug:** interview-topic-first (branch `work/interview-topic-first`, worktree `.claude/worktrees/interview-topic-first`)
- **Operator approval:** 2026-11-21 23:55 ("End #3, fix, then offer"). Lead does the task itself.
- **Operator gate before merge:** no (approved as a plan: end #3, fix, deploy `press`, offer)
- **Needs a deploy:** yes: `press` (open scrums are kept on a restart)

## Goal and visible result

Interview #3 (11-21 23:48, Halberd → Stick Menace, topic "Recent game with 52 pim") asked question 1 about
21 hits vs DA NUBZz: the writer's rule 2 puts the topic last ("latest night, then the season, then the
bigger picture and the topic"). After this task, when the GM (or the Press Box) sets a topic, question 1
is about the topic; then the night, the season and the bigger picture. No topic: as before.

## Paths

- **May edit:** `apps/discord/src/press/interview-asker.ts`, `apps/discord/src/press/interview-asker.test.ts`,
  this task file.
- **Must not touch:** everything else.

## Checks

- prettier (changed files); discord typecheck; discord tests (`interview-asker`, and the full discord test
  script); eslint on changed files.

## Done when (written before the work starts)

- **Done when:** with a topic, the question-1 request tells the writer to ask the topic now and a later request
  tells it not to ask the topic again; without a topic the requests are as before (tests); the checks pass.

## Log

- 2026-11-21 23:55 Lead3: #3 ended by the operator's order (status stopped, the bot's own end step: `ended_at`,
  `current_question` cleared; 0 answers, so no article). Task written.
- 2026-11-21 23:57 Lead3: rule 2 now puts a desk topic first; the question request carries `topicOrderLine` (question 1:
  ask the topic now; later: not again). 1 new test.
- 2026-11-22 00:00 Lead3: merged (`7de70488`, ff); only this change in `apps/discord` since the last deploy.
  Rollback tag, build, `up -d --no-deps press`: started live, 9 bots (2 thread joins hit Discord 429 at start).
- 2026-11-22 00:01 Lead3: Press Box request 2 (as the page writes it; no audit row) → interview 5: Lyle Bergstrom offered
  Stick Menace an interview on the 52 PIM game (topic names 52 PIM, 21:42, the tracked-games record, enforcer).
- Resume: check that question 1 of interview 5 is about the topic.

## Report

- **What changed:** with a GM/Press Box topic, interview question 1 is about the topic; later questions leave it
  alone. No topic: as before.
- **How checked:** discord tests 1001/1001 (1 new: question 1 / question 3 / no topic); discord typecheck pass;
  prettier pass; eslint: no new problems (asker 8 = main, test 9 = main).
- **Not done:** check of question 1 of interview 5 (when Mike accepts).

## Verifier result

- Not needed: no number is claimed.
