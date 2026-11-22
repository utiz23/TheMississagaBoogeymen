# Task: A GM interview topic is question 1

- **State:** Running
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
- Resume: worktree; edit `interview-asker.ts`; tests.

## Report

## Verifier result

- Not needed: no number is claimed.
