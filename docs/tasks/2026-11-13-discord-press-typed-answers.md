# Task: T1 — typed scrum answers, 15-minute accept, softer answer judge

- **State:** Deployed 2026-11-13 (`PRESS_TYPED_ANSWERS=1`; rollback `:rollback-he-2026-11-13-pre-typed`)
- **Lane:** Discord (`apps/discord/src/press/`)
- **Risk:** medium (live bots in the team channel; reads messages in scrum threads)
- **Slug:** press-typed-answers (branch `work/press-typed-answers`, worktree
  `.claude/worktrees/press-typed-answers`)
- **Operator approval:** 2026-11-13
- **Operator gate before merge:** no (the Lead reviews; the operator sees it on the next game night)
- **Needs a deploy:** yes: `press` (and `news` only if shared code changes); the Lead does it with the
  operator's OK. `PRESS_TYPED_ANSWERS=1` is set in `.env` only after the operator confirms the Message
  Content intent is on for Wade Barlow.

## Goal and visible result

1. **Typed answers:** a player who has an open scrum question can type the answer as a normal message
   in the scrum thread. It counts exactly like the pop-up answer (same claim, same judge, same storage,
   same next step). The Answer button stays as a backup. Messages from anyone else, or from the player
   when no question is open, are ignored (not stored, not answered).
2. **Accept window 15 minutes** (was 5).
3. **Softer judge:** fair hockey answers and in-character banter at a reporter are not "unusable".

## Context

- First live scrum 2026-11-13 (game 3439, scrum id 3). Answers marked unusable that should not be:
  Silky "This is the norm Gord. I got 3 points playing D. Im not even on forward." (fair answer);
  Erb "Look listen here pett-a-bone i dont like your tone, this will end here ask the question in a
  polite manner, be…" and Ordinary_Samich "Hey Gord, do me a favor and keep your nose out of our
  gameplan" (banter at the reporter: joke or usable, quotable as such). Still unusable: real life,
  abuse of a real person other than the fictional reporter, slurs, a "Leave me out" teammate, empty.
  First check whether those verdicts came from the model or from the fail-closed fallback
  (`judgeAnswer` returns unusable on any failure): look at the code paths and say which in the Report.
- The rule text is in `apps/discord/src/press/asker.ts` (rule 11 and around). Bump
  `NEWS_RULES_VERSION` (`packages/db/src/news/rules-version.ts`) when a prompt changes.
- Constants: `apps/discord/src/press/rules.ts` (`PRESS_ACCEPT_MS`). Check every place that assumes 5
  minutes (e.g. a hard-coded 5 in `packages/db/src/queries/news-press.ts` `nightHasActiveScrumSql`,
  a deferred finding) and any user-facing text that says 5 minutes.
- Gateway: `apps/discord/src/press/gateway.ts` (`startClients`, Barlow's intents ~line 600). Reading a
  thread message's text needs `GatewayIntentBits.GuildMessages` + `GatewayIntentBits.MessageContent`
  on ONE client (Barlow). If the portal switch is off, Discord refuses the login (close code 4014). So:
  request these intents only when `PRESS_TYPED_ANSWERS=1` (config in `apps/discord/src/press/config.ts`,
  fail-closed default off), and log one clear line if the login is refused for intents.
- The answer path: `onAnswerSubmit` in `apps/discord/src/press/interactions.ts` (claim by counters,
  judge, echo, next step). Reuse it: the typed path finds the person whose `current_question` is open in
  that thread for that Discord user, passes the current counters as `seen`, and replies in the thread
  instead of an ephemeral. The public echo of the answer is not needed for a typed answer (it is already
  in the thread). Cut to `ANSWER_MAX_CHARS`. Ignore bots, edits, and messages outside scrum threads.

## Paths

- **May edit:** `apps/discord/src/press/`, `apps/discord/src/news/` only if a shared helper must change,
  `packages/db/src/queries/news-press.ts` and its tests, `packages/db/src/news/rules-version.ts`,
  `.env.example`, `docs/operations/runbooks/news-desk-bots-setup.md`, this task file.
- **Must not touch:** schema/migrations, `apps/web`, the worker.

## Checks

- `pnpm --filter @eanhl/db build`; typecheck db, discord, web; `pnpm --filter @eanhl/discord test`;
  the changed db query test files by name; prettier on changed files.
- New tests: typed answer accepted for the asked player only; ignored for others / no open question /
  outside a thread; counters claim prevents a double answer (typed + pop-up); intents only with the
  flag; accept window 15 min; judge prompt contains the banter rule.

## Done when

- **Done when:** all checks pass; the Report names the cause of the 11-13 unusable verdicts; a typed
  reply in a scrum thread follows the same path as the pop-up in tests.

## Stop conditions

Stop and write "Blocked" in the Log when a schema change is needed, or anything outside "May edit".

## Log

- 2026-11-13: Work done on `work/press-typed-answers`. All edits are inside "May edit".
- NEEDS THE LEAD (outside "May edit", not done): `docker-compose.yml` lists every env var of the
  `press` service by name. Add `PRESS_TYPED_ANSWERS: ${PRESS_TYPED_ANSWERS:-}` to the `press`
  service, or the flag in `.env` never reaches the container and typed answers stay off.
- Deliberately NOT changed: `judgeAnswer` still fails closed to unusable when the reporter's reply
  line fails the code check or the review (an earlier ruling, pinned by a test). See the cause below.

## Report

**What changed**

1. Typed answers. New `onTypedAnswer` (interactions.ts) finds the person whose question is open for
   that Discord user in that thread (new db query `findOpenQuestionInThread`) and calls
   `onAnswerSubmit` with the current counters as `seen`, so the claim, the judge, the storage and the
   next step are the pop-up path. A typed answer is not echoed (it is already in the thread).
   Refusals (answered first, window over, empty) are logged, never shown. Gateway: `createMessageRouter`
   (ignores bots, webhooks, other servers, non-plain messages, outside threads, empty text) and
   `attachMessages` (new messages only, so edits are never read), on Barlow only.
2. Intents. `PRESS_TYPED_ANSWERS=1` (exactly `1`; default off) -> `config.typedAnswers`.
   `clientIntents()` adds `GuildMessages` + `MessageContent` to Barlow only with the flag. If Discord
   refuses the login for intents (4014 / DisallowedIntents) the log says: turn on Message Content
   Intent for Wade Barlow or set `PRESS_TYPED_ANSWERS=0`. Barlow keeps retrying (30 s, doubling).
   Until the switch is on, Barlow (commands and reactions too) is off: set the flag only after the
   portal switch is on.
3. Accept window 15 minutes: `PRESS_ACCEPT_MS` and db `PRESS_ACCEPT_WINDOW_MS` = 15 min; the hard-coded
   `interval '5 minutes'` in `nightHasActiveScrumSql` is now 15 minutes; the test fake used 300_000
   (now the constant); comments and tests updated. No user-facing text said "5 minutes".
4. Softer judge: rule 11 and 12 in `JUDGE_RULES` (asker.ts). Fair, blunt or sour hockey answers are
   usable; banter at the fictional reporter is a joke, never unusable; unusable only for real life,
   abuse of a real person, slurs, a teammate's private matters, no content; when close, not unusable.
   `NEWS_RULES_VERSION` -> `2026-11-13.2`.
5. Logging: every code path that stores an answer unusable without the model's verdict now logs one
   line (no answer text): no game, budget spent, off the sheet, forbidden name, or judgement failed
   closed with its reason. Before, the fail-closed path logged nothing.
6. `.env.example` and the setup runbook (Message Content Intent on for Barlow only, when typed
   answers are used).

**Cause of the 11-13 unusable verdicts (honest: not provable from this machine)**

The stored value `unusable` is the same on every path, and the old code logged nothing on the
fail-closed paths. I had no live access (no ssh). There are four ways an answer ends `unusable`:
(a) the model said unusable (rule 11 was narrow but vague: "abuse", no word on banter);
(b) `judgeAnswer` failed closed: the model's verdict was fine, but its reply line (closing or
follow-up) failed the code check or the review twice, or the call threw/refused, and the fallback
discards the verdict; (c) the answer names a forbidden person (a guest, a "Leave me out" player)
-> unusable with no model call; (d) budget spent or off the sheet.
(d) is unlikely (the scrum went on). For Silky's fair answer, (a) is unlikely; (b) or (c) fits better.
Erb and Ordinary_Samich fit (a) (banter read as "abuse") and (b) (an in-character reply to
"keep your nose out" is the kind of line a review rejects). Common word in two of the three answers
is "Gord"; if a forbidden name (gamertag or profile name of a guest) equals a word in them, (c) is the
cause. To settle it: on the next scrum read the press log. The new lines name the path.
Suggested decision for the operator/Lead (not done, it reverses the "Fix round 1" ruling): when the
model gave a valid usable/joke verdict and only the reply text failed, keep the verdict and use
`FALLBACK_CLOSING`.

**Checks (all in the worktree)**

- `pnpm --filter @eanhl/db build`: ok. Typecheck db, discord, web: all clean.
- `pnpm --filter @eanhl/discord test`: 583 tests, 583 pass, 0 fail.
- `node --test packages/db/dist/queries/__tests__/news-press.test.js`: 39 tests, 39 pass.
- Prettier `--check` on all changed .ts/.md files: clean (`.env.example` has no parser).
- New tests: typed answer = pop-up result (same rows), no echo; next question after a typed answer;
  ignored for another user / other thread / no open question / not asking / window over / empty;
  600 chars cut to 500; typed + pop-up at once store one answer; stale pop-up refused after a typed
  answer; unusable never echoed; intents only with the flag and only on Barlow; 4014 detection;
  message router filters; accept window 15 min (10-minute-old ping accepted, 15-minute refused,
  expiry pass); db SQL for the new query; judge prompt contains the banter rule; fail-closed log.
- Not run: anything needing Docker, a live Discord login, or the live database.

**Not done / risks**

- `docker-compose.yml` env pass-through (see Log): needed before the flag can work.
- Barlow's login fails while the flag is on and the portal switch is off. Set the flag only after
  the operator confirms the switch.
- No live check of the new prompt on real answers; the rule text is tested, the model's verdicts are not.
- Deploy: `press` only (shared code under `apps/discord/src/news/` not changed; `packages/db` changed, so
  the image must be rebuilt anyway).
- 2026-11-13 Lead review: diff read (typed path reuses `onAnswerSubmit`; ignores bots, edits, non-thread
  and non-asked users; intents only with the flag). Added `PRESS_TYPED_ANSWERS` to the `press` service
  in `docker-compose.yml` (outside the agent's paths). Re-ran: typecheck db/discord/web pass; discord
  583/583; news-press 39/39. Known: two quick messages → only the first counts. Not changed: a fine
  verdict is still lost when the reporter's reply line fails review (ruling 10); the new log lines will
  show how often. MCI confirmed ON for Wade Barlow (application flags).
