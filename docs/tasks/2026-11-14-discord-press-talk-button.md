# Task: T10 — "Talk to the press" for someone already in the scrum

- **State:** Merged (Lead review 2026-11-14); deploy `press` waits for the operator's OK
- **Lane:** Discord (`apps/discord/src/press/`)
- **Risk:** low
- **Slug:** press-talk-button
- **Operator approval:** 2026-11-14
- **Needs a deploy:** `press`

## Why

A person who is already in a scrum (pinged, answering, or done) presses "Talk to the press" on the recap
and gets only "You're already in this scrum." with nothing to do next. The Accept button works.

## Goal and visible result

"Talk to the press" from someone already in that scrum:

- **pinged, not accepted yet** (within the accept window): counts as **Accept** — same path as the
  Accept button (`onAccept`): their own thread starts with the first question;
- **pinged, accept window over:** private "The press has moved on." (as today's late Accept);
- **answering** (`asking`): private reply with a link to their own thread: "Your questions are in your
  thread → <#threadId>" (no thread yet: "The question is on its way.");
- **done or expired after answering:** private "You've already talked to the press about this game.";
- test scrums (T8) and bench people (T7) behave the same.

## Paths

- **May edit:** `apps/discord/src/press/` (interactions and its tests; test-scrum only if needed), the
  rulings file, this task file.

## Checks

typecheck discord (db build first); `pnpm --filter @eanhl/discord test`; prettier. Tests for each case
above, including that Talk-as-Accept takes the same claim as Accept (no double start when both are
pressed).

## Done when

All checks pass and the tests pin the four cases.

## Log

- 2026-11-14 Lead: written from the operator's report.
- 2026-11-14 Agent: `onTalk` now calls `talkAgain` when the insert says the person exists. It reads the
  person with `findScrumPerson` and answers by state. Pinged and inside the window calls `onAccept`
  (same claim). Tests in new `talk-again.test.ts`; one old assertion in `interactions.test.ts` changed
  (Talk by a pinged person is now an Accept, so the "already" case uses a done person). Ruling 84 added.
- 2026-11-14 Agent: May edit widened by the Lead 2026-11-14: also `packages/db/src/queries/news-press.ts`
  and `packages/db/src/queries/__tests__/news-press.test.ts`. Added `findScrumPersonByUser` (query, SQL-shape
  pin, store port, fake) and used it in `talkAgain` for people with no player row. `bench.test.ts`: the
  "twice" assertion now checks both bench people (with and without a player row) by state. Ruling 84 updated.

- 2026-11-14 Lead review: rebased on main; paths inside "May edit" (widened for the bench query) plus Ruling 84. Re-ran: typecheck db/discord/web clean; discord 830/830; news-press 54/54; prettier clean. No migration.

## Report

Changed: `apps/discord/src/press/interactions.ts` (`talkAgain`, two new `TEXT` lines),
`talk-again.test.ts` (7 tests), `interactions.test.ts` (1 assertion), rulings file (84).
Cases pinned: pinged in window = Accept (and Talk/Accept in either order start one question, one
thread); pinged late or expired = "The press has moved on."; asking = link to own thread, or "on its
way"; done = "You've already talked to the press about this game."; volunteers; test scrum (free, no
model). Checks: db build ok; discord typecheck clean; discord tests 830 pass, 0 fail; prettier clean.

Gap closed (Lead widened the lane): `findScrumPersonByUser(scrumId, discordUserId)` in
`packages/db/src/queries/news-press.ts` (`player_id IS NULL`), pinned by a SQL-shape test; `talkAgain`
uses it for bench guests and the coach. Final checks: db build ok; discord typecheck clean; discord
tests 830 pass, 0 fail; news-press db test 54 pass, 0 fail; prettier clean.
