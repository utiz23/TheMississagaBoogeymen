# Task: Argument mode: an aggressive reporter rebuts a player who pushes back

- **State:** Proposed
- **Lane:** Discord (`apps/discord/src/press/`)
- **Risk:** medium (public bot text, a sharper tone; more model calls)
- **Slug:** press-argument-mode
- **Operator approval:** pending (D3, D4, D5 on the decisions page)
- **Operator gate before merge:** yes (dry-run sample exchanges)
- **Needs a deploy:** `press`

## Why (player feedback, 2026-11-22)

Stick Menace after interview 5 (Lyle Bergstrom): "lyle didnt go back and forth with me, he just asked questions
and he answered, then onto the next one." He wants the aggressive reporters to rebut: reporter "quiet night, 1
shot, 0 points", player "you arent looking at everything, we won, we played as a team", reporter answers that.
"He wants to see an argument."

Today: an interview has at most 1 follow-up (`INTERVIEW_MAX_FOLLOWUPS = 1`) and never two in a row; a scrum
follows up once on a "strong" opening and closes. So no reporter can argue past one exchange.

## Goal and visible result

When the player **pushes back** on a question from an arguing reporter (the judge already sees "a real answer
that pushes back"), the reporter may **rebut**: answer the player's point in voice, with the sheet's numbers or
the player's own words, and end on a question or a challenge. The player may answer again. After the round
limit the reporter closes in voice. Scrums and interviews both. Every rule stays: hockey only, numbers only
from the sheet / notes / answers, no profanity past the reporter's rule, never real life, "Go easy" players
never get it, hard lines never acknowledged, a player who says it is over ends it.

## Decisions (operator)

- **D3 Who argues:** a) Dex Mercer and Gord Pettibone only (Lead's advice: the two written as combative);
  b) also any reporter on the feud side with the player; c) every reporter.
- **D4 Who gets it:** a) every player at press level "full" (Lead's advice: no database change; "Go easy"
  stays out); b) only players who opt in (a new press level: a migration, high risk, slower).
- **D5 How long:** a) up to 2 rebuttals per answer, then the reporter closes (Lead's advice); interviews may
  then have up to 2 follow-ups in all; b) 1 rebuttal; c) 3 rebuttals.

## Paths (draft)

- **May edit:** `apps/discord/src/press/asker.ts`, `interview-rules.ts`, `interview.ts`, `interview-asker.ts`,
  `question.ts`, `interactions.ts`, `panel.ts`, their tests, this task file.
- **Must not touch:** schema/migrations (unless D4 b, as its own task), the news writer, other services.

## Checks

discord typecheck; discord tests; prettier; eslint on changed files. Evidence: dry-run exchanges (no posting)
for 3 cases: a pushback (rebuttal comes, then a close at the limit), an agreeing answer (no rebuttal), a "Go
easy" player (never a rebuttal).

## Done when (written before the work starts)

- **Done when:** in the dry runs, a pushback to an arguing reporter gets a rebuttal that answers the player's point
  (not a new topic), the exchange stops at the D5 limit with a closing line, a non-arguing reporter and a "Go
  easy" player get no rebuttal, and the checks pass. Reason: the player asked for an argument, not a longer list
  of questions.

## Log

- 2026-11-22 00:21 Lead3: written from Stick Menace's feedback (relayed by the operator). Read only: interview 5.
