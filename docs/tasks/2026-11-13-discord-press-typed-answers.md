# Task: T1 — typed scrum answers, 15-minute accept, softer answer judge

- **State:** Ready (operator 2026-11-13: "start", after the first live scrum)
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

## Report
