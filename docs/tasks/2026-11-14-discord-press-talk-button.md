# Task: T10 — "Talk to the press" for someone already in the scrum

- **State:** Ready (operator 2026-11-14: "There is always an already in a scrum message no matter what"
  … "only talk to the press"); starts after T9 is merged (same files)
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

## Report
