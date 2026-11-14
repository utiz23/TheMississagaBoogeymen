# Task: CF2 — Club Finals in Discord: game post line, news desk and press weighting

- **State:** Ready (operator 2026-11-14 15:07: "approve all 4 items"); starts after CF1 is merged
- **Lane:** Discord (`apps/discord/src/`), Queries (read CF1's derived states)
- **Risk:** medium (what the channel reads on finals nights)
- **Slug:** club-finals-cf2
- **Operator gate before merge:** yes (dry-run samples of a post, a recap and a scrum opener)
- **Needs a deploy:** `discord`, `news`, `press`
- **Helper model:** Opus

## Goal and visible result

From CF1's per-game Club Finals state:

1. **Game post** (Discord poster): one line, e.g. "Club Finals · Round 3 · Game 5 · series 3-1", plus
   "ROUND WON", "ELIMINATED" or "THE FINAL" when true.
2. **News desk:** finals games weigh more: a round won, an elimination and every final game are always
   covered; the final gets the bigger piece (a feature-length recap). Writers get the round, game number
   and series score as facts (from CF1, never guessed).
3. **Press bots:** elimination, round won, any final game and a series decided in its last game are
   **big moments** (the E5 list: operator's "adjust later"): they open the scrum; tone follows the moment
   (the hard lines, Go easy and no crude quotes rules unchanged).

## Paths

- **May edit:** `apps/discord/src/` (poster line, news desk input and weighting, press big moments + tests),
  `packages/db/src/queries/club-finals.ts` (reads only, + tests), this task file.

## Checks

discord typecheck and tests (zero real model calls); db tests by name; prettier. Dry-run samples for
the operator (fakes or the test channel only).

## Done when (written before the work starts)

- **Done when:** checks pass and the operator OKs the samples. Reason: finals nights are the ones the
  team cares about most.
- **Not done if:** a round or series number in a post is not CF1's stored value.

## Stop conditions

Stop and write "Blocked" in the Log when: a path outside "May edit" is needed; the "done when" rule
is unclear; an operator decision is needed; a live write, deploy or anything irreversible comes next.

## Log

- 2026-11-14 15:08 Lead2: written (Ready; after CF1).

Resume: start after CF1 is merged.

## Report (task agent fills when state = Verify)

- **What changed (visible effect):**
- **How it was checked (commands, numbers):**
- **Not done:**
- **Git state:** branch, last commit, rebased on `main` at <hash>, checks pass/fail
