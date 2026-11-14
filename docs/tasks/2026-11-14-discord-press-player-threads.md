# Task: T6 — one thread per player, reporters reply to the player, no Answer button

- **State:** Ready (operator 2026-11-14)
- **Lane:** Discord (`apps/discord/src/press/`)
- **Risk:** medium (live scrum and interview flow)
- **Slug:** press-player-threads (branch `work/press-player-threads`, worktree
  `.claude/worktrees/press-player-threads`)
- **Operator approval:** 2026-11-14 ("Should we separate them into one scrum per player? … bots reply
  to the player's message … lets axe the answer button to encourage users to reply in chat")
- **Operator gate before merge:** no; deploy (`press`) with the operator's OK
- **Needs a deploy:** `press` (and `news` only if shared code changes); no migration unless a column is
  truly needed (prefer existing columns; if one is needed, hand-written idempotent `0077_*.sql`)

## Why

Live scrums got messy: several players answer in one thread under the recap, and it is not clear who a
reporter is talking to. Players should not have to use Discord's Reply; they should just type.

## Goal and visible result

1. **One thread per player.** Discord allows one thread per message, so each player's scrum thread
   starts from a message of its own:
   - a pinged player (auto, GM note, `/gm ask`, `/scrum @player`, `/scrum random`): the thread starts
     from **that player's ping message** (named "<Player> — press scrum" or similar);
   - a volunteer ("Talk to the press" button, `/scrum`): the asking reporter posts a short line under
     the recap ("<Player> steps up to the mic", in voice) and the thread starts from it.
   - The recap post keeps its "Talk to the press" button; it gets no shared thread for new scrums.
   - In a player's thread, **only that player's messages** count (answers, typed text, Discord
     Replies); anyone else's message there is ignored entirely (no answer, no echo, no feud points; T5
     hard lines still apply to the player's own messages).
   - The panel (T2), follow-ups, variety across players of the same scrum, GM asks, the 15-minute
     accept window and all T5 rules stay as they are; only where the lines go changes.
2. **Reporters reply to the player.** Every reporter line in a player's thread after the player's
   first message (next question, follow-up, acknowledgement, closing) is a Discord reply
   (`message_reference`) to that player's **latest** message in the thread, and mentions only that
   player. Interviews (one thread per player already) get this too.
3. **No Answer button.** While `PRESS_TYPED_ANSWERS=1`, scrum and interview questions are posted
   **without** the Answer button; the player just types in their thread. If typed answers are off,
   the button is posted as before (answering must never be impossible). An Answer button on an older
   message still works or replies privately "Just type your answer in the thread." (agent's choice,
   say which). The Accept button on pings and interview offers stays.

## Context

Code: `apps/discord/src/press/` (pass.ts, question.ts, interactions.ts, gateway.ts, interview*.ts,
replies*.ts, fallbacks.ts, hard-lines.ts, feuds.ts). Old scrums (one shared thread under the recap) must
keep working until they close. T4 explains thread caching: Barlow reads raw `MESSAGE_CREATE` and joins
threads (`withBarlowJoin`); new per-player threads must be joined the same way.

## Paths

- **May edit:** `apps/discord/src/press/`, `packages/db/src/queries/news-press.ts` and its tests,
  `packages/db/src/schema/news-press.ts` and `packages/db/migrations/0077_*.sql` only if a column is
  needed, the press runbook, this task file.

## Checks

db build; typecheck db, discord, web, worker; `pnpm --filter @eanhl/discord test`; changed db tests by
name; prettier. Tests: each ping kind and a volunteer get their own thread from the right message;
another user's message in a player's thread is ignored; reporter lines carry `message_reference` to the
player's latest message; no Answer button with typed answers on, button with it off; old shared-thread
scrums still finish; interviews reply to the player.

## Done when

All checks pass and the tests above pin the behaviour.

## Log

- 2026-11-14 Lead: written from the operator's three requests.

## Report
