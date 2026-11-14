# Task: T8 — `/gm testscrum`: a free test scrum in `#bot-test` (no AI calls)

- **State:** Verify (built 2026-11-14; not merged, not deployed)
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
- 2026-11-14 Task agent: built in `work/press-test-scrum` (one feature commit, then this Log/Report commit),
  rebased on `main` 7746aeac. All edits are inside "May edit" (press folder, `news-press.ts` and its test,
  the runbook, the rulings file, this file). Rulings 78-83 added. No Blocked state.

## Report

### What changed

- **`/gm testscrum`** (`test-scrum.ts`, wired in `gateway.ts`): GM only, only in the press guild
  (private refusal otherwise), options `game` (match id; default the latest game of any age),
  `player`, `player2`, `player3`, `player4` (default: the GM), `bench`. A reporter posts a made-up
  recap marked "(test scrum)" with the Talk to the press button in `PRESS_TEST_CHANNEL_ID` (also in
  live mode; `config.ts` gained optional `testChannelId`). The scrum is `is_test` with
  `buzz_level = 'testscrum'` (the marker; no migration) and open 60 minutes from now. People are
  inserted like a GM request, made ready at once, and the normal pass pings them in the test channel
  ("(test scrum) ..."), each in their own T6 thread. A named person who did not play, and the `bench`
  person, take the bench path (T7 questions) without the voice check.
- **No AI**: `question.ts` skips the writer for a test scrum (fixed pool question); `interactions.ts`
  screens with the code layer only (`CODE_ONLY_SCREEN`, slur list), judges with a fixed rule
  (`testVerdict`: usable; a forbidden name is unusable), takes no feud points, and the extras budget does
  not stop it; `fallbacks.ts` has a new `followup` pool (4 lines per reporter) used only when the round
  needs a follow-up; `replies.ts` leaves a test thread out of the feud check.
- **No story material** (`news-press.ts`): `nightPressMaterial`, `nightHasActiveScrum` and
  `latestScrumItem` skip the marker. New queries: the hidden recap item (test, not a recap,
  soft-deleted, no message id: keeps it out of the trial mirror, reactions, wire replies and feeds),
  its delete, and `isTestScrumThread`.
- Docs: runbook section "/gm testscrum"; rulings 78-83.

### How to use it

`/gm testscrum` (defaults: latest game, ping yourself). Add `player:` ... `player4:` for up to four
people, `bench:` for a person to treat as watching from the call, `game:` for a match id. The private
reply says what was made and where. The scrum lives for 60 minutes in the test channel. Deploy: `press`
only; `PRESS_TEST_CHANNEL_ID` must be set in live (the compose file already passes it).

### Checks (after `git rebase main`, db rebuilt)

- Typecheck: db, discord, web, worker: all clean.
- `pnpm --filter @eanhl/discord test`: 823 of 823 (807 before; 16 new: 13 in `test-scrum.test.ts`,
  2 in `gateway.test.ts`, 1 in `config.test.ts`; `fallbacks.test.ts` now also covers the `followup` pool).
- db: `news-press.test.js` by name: 53 of 53 (3 new: the marker in three queries, the thread check, the
  hidden item insert/delete).
- Prettier on all changed files: clean.
- The key promise: `test-scrum.test.ts` runs the full path with a model that throws and a model screen
  that throws, in live mode with the extras budget spent: GM refusals, old game (six weeks), recap and
  scrum rows, pings, own threads, Accept, typed answers to the end, follow-ups, slur, volunteer through
  the button, bench, failed post. Model calls 0, model screen calls 0, usage rows 0, feud rows 0, every
  post in the test channel (never `chel`), every line a fixed pool line, no line twice in a thread.
- Not run: the real SQL on a database (no Docker; the SQL shape is pinned), a real Discord command
  registration or button press, `pnpm --filter web build`.

### Not done / open risks

- The command and the hidden item were never run against the real database or Discord. First real run
  is on the host: check that `/gm testscrum` appears (command registration happens at press start) and
  that the hidden item insert works (soft-deleted `news_items` row with `discord_status 'skipped'`).
- The hidden item is a soft-deleted test row; an admin list that shows deleted rows shows one per test
  scrum (ruling 79). `deleteTestNewsItems` clears them.
- A test round may be shorter than its target (follow-ups only when `must`, ruling 81). Fan reactions and
  wire replies on the test recap do nothing (by design). The voice call is not checked in a test.
- `lastScrumReporter` (rotation of real scrums) can see a test scrum's reporter; `countGmPingsTonight`
  counts test pings in trial. Both small, not changed.

### Git state

Branch `work/press-test-scrum`, worktree `.claude/worktrees/press-test-scrum`, rebased on `main`
7746aeac. Commits: the feature commit de87f023 and this Log/Report commit. Nothing pushed, merged or
deployed.
