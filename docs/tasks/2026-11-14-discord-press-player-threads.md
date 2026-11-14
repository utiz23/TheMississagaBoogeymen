# Task: T6 — one thread per player, reporters reply to the player, no Answer button

- **State:** Merged (Lead review 2026-11-14); deploy `press` waits for the operator's explicit OK
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
- 2026-11-14 agent: Running on `work/press-player-threads` (base 7bea5386). Decided: no migration (see Report).
- 2026-11-14 agent: checks green; rebased on main; State = Verify.

- 2026-11-14 Lead review: rebased on f356aafa (docs only); paths inside "May edit" plus rulings 65-69;
  no migration. Re-ran: typecheck db/discord/web/worker clean; discord 782/782; news-press 49/49;
  prettier clean. Deploy `press` only.

## Report

Branch `work/press-player-threads`. Not merged, not pushed, not deployed. **No migration.**

**What changed**

- One thread per player (`question.ts`, `startScrumQuestion`). A pinged player (auto, GM note, `/gm ask`,
  `/scrum @player`, `/scrum random`) gets a thread from their own ping message, named
  `<Player> — press scrum`. A volunteer (or a ping that was never stored) gets a step-up line from the
  first reporter under the recap (a reply to it, mentions only the player; fixed pool of 2 per reporter,
  `fallbacks.ts` `stepUpLine`) and the thread starts from it. The recap keeps its button and gets no
  shared thread: new scrums never get `news_scrums.thread_id`. A scrum that already has one (made before
  this release) keeps it for everyone in it, so old scrums finish as before. Joining: the thread comes from
  `discord.thread(...)`, which `withBarlowJoin` already wraps, so Barlow joins new threads like T4.
- Only the owner's messages count in a player's thread (`replies.ts`, new store method
  `scrumThreadOwner`): another user's message gets one log line and nothing else (no screen call, no
  echo, no feud points). The owner's own insult still counts for feuds there.
- Reporter lines reply to the player's latest message: the next question now does too (it did not
  before); follow-up, acknowledgement and closing already did. The "no answer in 15 minutes" closing
  (scrums and interviews) replies to the latest message remembered in memory (`player-latest.ts`).
  Interviews: next question and expiry closing reply as well.
- No Answer button while `PRESS_TYPED_ANSWERS=1` (scrum and interview questions and follow-ups,
  `answerComponents`); with it off the button is posted as before. An Answer button on an older message
  still opens the pop-up (agent's choice: it works, nothing is lost).
- A Discord Reply to a button-less question counts when its text is the current question line
  (`replyTargetProblem`); another person's Answer button is still "another message".
- DB (`news-press.ts`): `openQuestionInThreadSql` matches the shared thread or the person's own thread
  (`ping_message_id`); expired-question rows carry the person's thread; new `scrumThreadOwner`.
- Runbook section "One thread per player"; rulings 65-69.

**Choices and why**

- No column: the thread id is the id of its start message, so `ping_message_id` is reused for volunteers
  (ruling 65). Cost: the column name is a little loose.
- Latest player message is kept in memory, not stored (ruling 67): only the expiry closing needs it, and it
  is cosmetic. After a restart that one line is a plain post.
- Interview threads keep accepting other users' messages (not asked; they are one-player threads already).
- No prompt changed: `NEWS_RULES_VERSION` unchanged.

**Checks** (all in the worktree, on top of 7bea5386, then rebased on main)

- `pnpm --filter @eanhl/db build`: ok. Typecheck db, discord, web, worker: clean.
- `pnpm --filter @eanhl/discord test`: 782/782 (was 767; 15 new in `player-threads.test.ts`; 4 old tests
  updated for the step-up line and no shared thread).
- `node --test packages/db/dist/queries/__tests__/news-press.test.js`: 49/49 (1 new, 2 updated).
- Prettier: clean on every changed file. Mutation check: with the owner check off, the "another user's
  message" test fails.
- Not run: anything needing Docker or Discord (no live check of the thread, the step-up line, the join, or
  the missing button; first live scrum after the deploy shows it).

**Not done / open risks**

- Not checked live: Discord must allow a bot to start a thread from another bot's ping message (it does
  for any message the bot can see; same call as before, on a different message).
- After a restart the expiry closing is a plain post (ruling 67).
- Players in a typed-answers scrum see no button: the Accept line and question are the only cue.
  The deploy keeps `PRESS_TYPED_ANSWERS=1` as live now.

**Git state:** branch `work/press-player-threads`; see the last commit hash in the hand-off.
