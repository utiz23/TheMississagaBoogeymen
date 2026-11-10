# Task: No more badge announcements

- **State:** Merged (`5f3dcdc7`, 2026-11-09); deploy waits for the operator's OK (D1)
- **Lane:** Discord, with one Queries file and one Web file (named below)
- **Risk:** low (stops a message type; no data change)
- **Slug:** no-badge-posts (branch `work/no-badge-posts`, worktree `.claude/worktrees/no-badge-posts`)
- **Operator approval:** 2026-11-09
- **Operator gate before merge:** no
- **Needs a deploy:** yes: `web`, then `discord` (operator's OK; `docker-redeploy` skill)

## Goal and visible result

Operator request 2026-11-09 (1). Discord stops posting "X has unlocked **Shots 10**!" messages, and the
news desk stops getting badge unlocks as facts. Badges stay on the site and on the cards. New-card
(tier) posts, mythic posts and game posts stay.

## Paths

- **May edit:** `packages/db/src/queries/discord-unlock-posts.ts`, its test(s) under
  `packages/db/src/queries/`, `apps/web/src/lib/news/load-facts.ts` and its test, this task file.
  Optional cleanup only with the operator's OK: `apps/discord/src/cycle-unlocks.ts`,
  `apps/discord/src/render.ts`, `apps/discord/src/message.ts`, `packages/db/src/discord/unlocks.ts`
  and their tests (the badge branch becomes dead code).
- **Shared paths needed:** none
- **Must not touch:** badge progression (`apps/worker/src/card-progression.ts`), badge display
  (`apps/web/src/components/badges/`), `player_card_events` rows, the database schema.

## Checks

- `pnpm --filter @eanhl/db build`, then typecheck `@eanhl/db`, `web`, `@eanhl/discord`; db query test
  files by name; `web` `test:unit`; discord `test`; `pnpm format:check`.
- Evidence: the candidate SQL test shows only `tier_up` and `mythic_awarded`; a news fact-sheet test
  shows no badge line.

## Done when

- **Done when:** the unlock candidate query selects no `badge_level_up` event, and the news fact
  sheet holds no badge unlock, with tests for both. New card and mythic posts still pass their tests.
- **Not done if:** any badge row disappears from the player page or the card locker.

## Stop conditions

Stop and write "Blocked" in the Log when a path outside "May edit" is needed, or when the deploy is
next (the operator's OK).

## Log

- 2026-11-09 Lead: scope found. Live: 105 badge posts sent so far, 3 card posts (2 tier, 1 mythic).
  Badge unlocks also feed the news fact sheet (`load-facts.ts` line ~428); 1 test article mentions a
  badge, no public one.
- 2026-11-09 Lead: worktree `work/no-badge-posts`. `describeUnlock` returns null for
  `badge_level_up`, so the Discord loader (web) answers `{ skip }` and the news sheet drops badges;
  the candidate query no longer selects badge events; the badge graphic path is removed.
- 2026-11-09 Lead: paths added to the cleanup beyond "May edit" (Lead OK, same cleanup):
  `packages/db/src/discord/contract.ts` + test (no `badge` kind/graphic),
  `apps/web/src/lib/discord/load-unlock.ts`, `apps/web/src/app/internal/discord/unlock/[eventId]/page.tsx`,
  a comment in `apps/discord/src/news/prompts.ts`.

## Report

- **What changed (visible effect):** no more "X has unlocked **Shots 10**!" posts in Discord; the
  news writer no longer gets badge unlocks. New-card and mythic posts (with ping), game posts and every
  badge on the site stay. Effect starts with the `web` deploy (the old poster then gets `{ skip }` for
  badge events); the `discord` deploy removes the query clause.
- **How it was checked:** `@eanhl/db` build + typecheck; `web` and `@eanhl/discord` typecheck;
  db tests `unlocks`, `contract`, `discord-unlock-posts` (12/12); `@eanhl/discord test` (307/307);
  web `build-facts` + `lib/discord` tests (70/70); prettier on the changed files.
- **Tried, no gain:** none.
- **Not done:** deploy (operator's OK). Old badge messages stay in the channel. The `card_level` kind
  is also dead for Discord since 2026-10-26 but still feeds the news sheet; left as it is.
- **Git state:** see the commit on `work/no-badge-posts`.
