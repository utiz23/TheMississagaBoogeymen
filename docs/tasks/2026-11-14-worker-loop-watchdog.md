# Task: Worker watchdog and time limits (game collection must never stop)

- **State:** Running (since 2026-11-14 13:58; task agent of `Lead2`; Opus: game collection safety)
- **Lane:** Worker (`apps/worker/`, `packages/ea-client/`)
- **Risk:** medium (the ingestion loop; a fault here can lose games)
- **Slug:** worker-loop-watchdog (branch `work/worker-loop-watchdog`, worktree
  `.claude/worktrees/worker-loop-watchdog`)
- **Operator approval:** 2026-11-14 13:58 ("D4 yes")
- **Operator gate before merge:** no (the Lead reviews line by line)
- **Needs a deploy:** yes: `worker` (with the E1 deploy, D2; operator's OK)
- **Helper model:** Opus

## Goal and visible result

From the Codex adversarial review of E1 (2026-11-14, [high]; quoted in
`docs/tasks/2026-11-14-web-live-events-e1.md` Log): the worker's one loop (`apps/worker/src/index.ts`
→ `LiveCheckLoop` in `live-checks.ts`) awaits normal passes, quick checks and the 5-second event read
with no deadline. A hung EA or database connection stops all game collection and the heartbeat, and
nothing restarts the worker (`restart: unless-stopped` restarts only a process that exits). EA keeps
about 5 recent games, so games can be lost. The weakness is older than E1: `INGEST_CYCLE_TIMEOUT_MS` is
documented in `CLAUDE.md` and `.env.example` but no code uses it; `eaFetch` gets no signal; the database
client has no query timeout.

Build:

1. **Watchdog (the backstop, must have).** A timer outside the loop (for example `setInterval`, `unref`
   not needed) that knows when the loop last made progress (the loop marks progress at the start and
   end of each step: normal pass, quick check, event read, sleep). If there is no progress for
   `WORKER_WATCHDOG_MS` (default 15 minutes), it logs one clear line (`[watchdog] no loop progress for
N min; exiting so Docker restarts the worker`) and calls `process.exit(1)`. Docker's
   `restart: unless-stopped` then starts a fresh worker. The timer must not stop a long but healthy pass:
   a normal pass marks progress between its steps, or the limit is well above the longest real pass
   (check the live log: passes take about 14 s; say what you found).
2. **EA request time limit (must have).** Every EA request gets a per-request time limit (for example
   `AbortSignal.timeout(EA_REQUEST_TIMEOUT_MS)`, default 30 s), combined with any signal the caller
   passes. A timed-out request counts as a failed request for that match list (logged, the pass goes
   on), not a crash. Keep the retry/backoff rules; a timeout is not retried endlessly.
3. **Wire `INGEST_CYCLE_TIMEOUT_MS`** (default 120000) or remove it from the docs it appears in within
   your paths and say so: either the normal pass and each quick check stop waiting after that long, or
   the watchdog alone is the rule. Choose the simpler safe one and explain it in the Report.
4. **Database:** do not change the shared database client (`packages/db/`, used by web too). The
   watchdog covers a hung database socket. If you think a worker-only query timeout is needed, write it
   in the Report as a proposal; do not build it.

## Paths

- **May edit:** `apps/worker/src/` (loop, new `watchdog.ts` + tests), `packages/ea-client/src/` (request
  time limit + tests), `.env.example` (the new settings, worker section only), this task file.
- **Shared paths needed (Lead OK required):** none
- **Must not touch:** `packages/db/`, `docker-compose.yml`, everything else.

## Checks

- `pnpm --filter @eanhl/ea-client build` and test; `pnpm --filter @eanhl/worker typecheck`; worker
  tests that run without a database (`live-checks`, `quick-check`, the new watchdog tests,
  `test:safety`); prettier on changed files.
- **Tests (new):** a loop step that never resolves (a never-resolving quick check, event read and normal
  pass, each in turn) → the watchdog fires after the limit (fake clock / injected exit, no real exit in
  tests); a healthy loop with steps just under the limit → no exit; an EA request that never answers →
  aborted after the time limit and reported as a failure, the pass goes on; a caller's own abort still
  works.

## Done when (written before the work starts)

- **Done when:** all checks pass and the tests above pass; reason: a hung connection must end in a
  restart within about 15 minutes, never in a silent stop of game collection.
- **Not done if:** the normal 5-minute pass behaves differently when nothing hangs; or a test calls
  the real `process.exit`.

## Stop conditions

Stop and write "Blocked" in the Log when: a path outside "May edit" is needed; the "done when" rule
is unclear; an operator decision is needed; a live write, deploy or anything irreversible comes next.

## Log

- 2026-11-14 13:58 Lead2: written from the Codex [high] finding on E1; operator "D4 yes".

Resume: task agent makes the branch and worktree, writes the hanging-dependency tests first.

## Report (task agent fills when state = Verify)

- **What changed (visible effect):**
- **How it was checked (commands, numbers):**
- **Tried, no gain:**
- **Not done:**
- **Git state:** branch, last commit, rebased on `main` at <hash>, checks pass/fail

## Verifier result (Verifier fills)

- **Ran:**
- **Got:**
- **Compared with claim:**
- **Verdict:** pass | fail | pass with notes
