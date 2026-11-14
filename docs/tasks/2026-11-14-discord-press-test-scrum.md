# Task: T8 — `/gm testscrum`: a free test scrum in `#bot-test` (no AI calls)

- **State:** Ready (operator 2026-11-14: "build t8")
- **Lane:** Discord (`apps/discord/src/press/`)
- **Risk:** low (GM-only command; posts only in the test channel; no AI; test data only)
- **Slug:** press-test-scrum (branch `work/press-test-scrum`, worktree `.claude/worktrees/press-test-scrum`)
- **Operator approval:** 2026-11-14
- **Operator gate before merge:** no; deploy (`press`) with the operator's OK
- **Needs a deploy:** `press`; no migration (use existing tables with `is_test = true`)

## Why

The operator wants to test the scrum mechanics (T6 own threads, no Answer button, reporter replies, other
users ignored, volunteers, T7 bench people) without waiting for a game and without spending API credits.

## Goal and visible result

- **`/gm testscrum`** (GM only; options: `game` = a match id, default the latest game; `players` = up to
  4 Discord users to ping, default the GM; optional `bench` = a Discord user to treat as watching from
  the call). Works in **live and trial mode**; posts **only in the test channel** (`PRESS_TEST_CHANNEL_ID`).
- It posts a short **fictional recap** line for that game by a reporter in the test channel, marked
  "(test scrum)", with the **Talk to the press** button, and creates a **test scrum** (`is_test = true`)
  on that message, open for 60 minutes regardless of the game's age.
- It pings each named person exactly like a GM request (T6: each gets their own thread from their ping;
  no Answer button while typed answers are on; reporters reply to the person's latest message; panel of
  3 reporters; the usual counts). A bench person (T7 rules) gets the bench path.
- **No AI at all** in a test scrum: questions, follow-ups, acknowledgements and closings come from canned
  per-reporter pools (reuse/extend `fallbacks.ts`, several varied lines per reporter, no numbers except
  from the game sheet if trivially safe, else none); the hard-line screen uses **only the code layer**
  (slur list) and never fails closed to silence in a test scrum; the judge is replaced by a fixed rule
  (non-empty and not off-limits by code → `usable`); no feud points; no articles. Answers are stored as
  test and never reach any story or quote material.
- The GM's private reply says what was created and where; a private refusal outside the guild or for a
  non-GM.

## Paths

- **May edit:** `apps/discord/src/press/`, `packages/db/src/queries/news-press.ts` and its tests (only if a
  query is needed), the press runbook, this task file. (Rulings file for new rulings.)

## Checks

db build; typecheck db, discord, web, worker; `pnpm --filter @eanhl/discord test`; changed db tests by
name; prettier. Tests: GM-only; test channel only (also in live mode); scrum is test and open 60 min on an
old game; pings → own threads; no model call anywhere in a test scrum (a fake model that throws must
never be called); canned lines vary and never repeat in a thread; code-only screen; no feud points; no
story material.

## Done when

All checks pass and a test drives `/gm testscrum` end to end with zero model calls.

## Log

- 2026-11-14 Lead: written from the operator's request.

## Report
