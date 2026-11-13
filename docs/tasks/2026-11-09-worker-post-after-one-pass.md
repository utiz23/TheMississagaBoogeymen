# Task: Game posts after one worker pass

- **State:** Deployed 2026-11-09 (`worker`, then `discord`, at `ce88ac63`; rollback tags `:rollback-he-2026-11-09-pre-one-pass`)
- **Lane:** Worker, with one Queries file
- **Risk:** medium (ingestion bookkeeping + Discord timing)
- **Slug:** post-after-one-pass
- **Operator approval:** 2026-11-09
- **Needs a deploy:** yes: `worker` first, then `discord` (the other order posts before the cards update)

## Goal and visible result

The game post (and so the news wires, which wait for it) goes out right after the worker pass that
found the game, not after the next pass (~5 minutes later).

## Why there was a wait

Not for EA: EA stats do not change. The worker saves a game, then in the same pass adds AI-goalie lines
(they change the stars), updates the stats and the cards (the post shows cards). The poster could not
see the end of a pass, so it waited for the next one.

## Paths

- **May edit:** `apps/worker/src/ingest.ts`, `packages/db/src/queries/discord-posts.ts`,
  `packages/db/src/queries/__tests__/discord-posts.test.ts`, this task file.

## Log

- 2026-11-09 Lead: the worker stamps `ingestion_log.finished_at` on the pass's rows at the end of the
  whole pass (`markCycleFinished`, in a `finally`); the poster counts a stamped row as settled; the old
  "later row of the same type" rule stays as the fallback for a pass that died. Only `health.ts`
  reads `finished_at` (latest finished success): still correct, now a few seconds later.
- Checks: db + worker + discord typecheck; db discord-posts + news tests 60/60; the new candidate SQL
  run read-only on live (valid, 0 rows: all posted); prettier. Not run: worker integration tests
  (need the Docker test database; none on the main PC).
- 2026-11-09 Lead: deployed. Live: the next pass stamped its 3 rows together at 02:49:11.529 (after the card update); worker health 200 ok on the new stamp; `discord` started live. First timing check: the next game night.
