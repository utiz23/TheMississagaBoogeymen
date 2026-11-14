# Task: Worker watchdog and time limits (game collection must never stop)

- **State:** Deployed 2026-11-14 14:12 with E1
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
- 2026-11-14 14:01 task agent: worktree and branch made, installed, db and ea-client built. Live log read (24 h, 288 passes): longest pass 19.2 s, median 14.9 s, none over interval.

- 2026-11-14 14:06 task agent: tests first (red: ea-client 5 of 7 failed; worker tests did not compile), then built: `ea-client` time limit, `watchdog.ts`, `onProgress` hook in the loop, wiring in `index.ts`, `.env.example`. Mutation check: with the progress hook turned off, 4 watchdog tests fail. Rebased on `main` 5b9b2846; all checks pass.

- 2026-11-14 14:08 Lead2: reviewed line by line (watchdog timer outside the loop; per-attempt EA limit
  with `AbortSignal.any`, Node 22 live). Rebased; checks again: ea-client 25/25, worker watchdog +
  live-checks + quick-check 28/28, test:safety 73/73, typecheck clean, prettier clean. Merged
  `--ff-only`. `CLAUDE.md` env list updated; `docker-compose.yml` still passes the unused
  `INGEST_CYCLE_TIMEOUT_MS` (harmless; remove with the next Ops change).

- 2026-11-14 14:13 Lead2: deployed with E1 (rollback `:rollback-he-2026-11-14-pre-e1`); worker log
  "Starting polling loop. Interval: 300000ms. Watchdog: 900000ms"; first pass 16 s.

Resume: none (watch for a `[watchdog]` line in the worker log; one means a hang was caught).

## Report (task agent fills when state = Verify)

- **What changed (visible effect):**
  - New `apps/worker/src/watchdog.ts`. A timer outside the loop checks every 30 s. No loop progress for
    `WORKER_WATCHDOG_MS` (default 900000 = 15 min) gives one log line (`[watchdog] no loop progress for
N min; exiting so Docker restarts the worker (last step: ...)`) and `process.exit(1)`. Exits once.
  - `live-checks.ts`: optional `onProgress(step)` hook, called at the start and end of every step
    (normal pass, after-pass heartbeat, quick check, event read, game-in check, latest-game read,
    cleanup, sleep) and at each loop turn. No other change to the loop; without the hook it behaves as
    before. `index.ts` makes the watchdog and passes the hook.
  - `packages/ea-client/src/client.ts`: every EA attempt has a time limit, `AbortSignal.timeout`
    (default 30 s, `EA_REQUEST_TIMEOUT_MS`), combined with the caller's signal (`AbortSignal.any`). It
    covers headers and body. A timeout throws the new `EaTimeoutError` (exported) and is not retried;
    the pass already catches request errors, so it logs and goes on. A caller abort still throws
    `AbortError`. 429/5xx retry rules are unchanged.
  - `INGEST_CYCLE_TIMEOUT_MS`: **not wired. The watchdog alone is the rule.** Reason: a pass that "stops
    waiting" after 2 min would keep running in the background and overlap the next pass (the loop must
    never overlap), and the watchdog already ends a real hang. Removed the variable from `.env.example`
    and added `EA_REQUEST_TIMEOUT_MS` and `WORKER_WATCHDOG_MS` there.
  - Longest real pass: live worker log, last 24 h, 288 passes: min 11.2 s, median 14.9 s, p95 17.9 s,
    **max 19.2 s**; none overran the 5-minute interval. The 15-minute limit is about 47 times the longest.
    (The live worker runs the old loop without quick checks; quick checks take a few seconds each.)
- **How it was checked (commands, numbers):**
  - Tests written first and seen to fail: ea-client 5 of 7 red; the worker test did not compile.
  - ea-client: `vitest run` 25 pass (18 in the package; the build output `dist/client.test.js` is run
    a second time, 7 more: harmless). 7 are new: never-answering request fails once after 50 ms, no
    retry; body that never arrives; default 30 s and env; caller abort; already-aborted signal; normal
    answer; 404 not retried.
  - worker (`tsc -p .` then `node --test`): `watchdog` 11 pass (hang in normal pass, heartbeat,
    database read, event read, quick check: exit after the limit and not before; healthy loop with every
    step 14 min 59 s: no exit; once only; timer start/stop; settings); `live-checks` 12 pass,
    `quick-check` 5 pass, `heartbeat` 4 pass (unchanged); `test:safety` 73 pass.
  - Mutation check: hook turned off in the compiled loop, 4 watchdog tests fail; restored, 11 pass.
  - `pnpm --filter @eanhl/ea-client typecheck`, `pnpm --filter @eanhl/worker typecheck`: clean.
    Prettier: clean on all changed files. No test calls the real `process.exit` (it is injected).
  - Not run (need a database or Docker): worker integration tests, `health-endpoint.test.js` (needs
    `DATABASE_URL`).
- **Tried, no gain:** nothing dropped.
- **Not done:**
  - `docker-compose.yml` (not my path) still passes `INGEST_CYCLE_TIMEOUT_MS` (now unused) and does not
    pass `EA_REQUEST_TIMEOUT_MS` or `WORKER_WATCHDOG_MS`; the defaults apply, so no change is needed to
    deploy. `CLAUDE.md` (Shared path) still lists `INGEST_CYCLE_TIMEOUT_MS`: Lead to fix.
  - Known trade-off: the watchdog sees progress per step, not per EA call. A pass longer than 15 min
    (for example EA down with every request hanging to its 30 s limit) restarts the worker. No game is
    lost by that; a restart also starts a fresh pass at once. A finer mark per EA request is possible if
    the Lead wants it.
  - Proposal only (not built): a worker-only database query timeout (`statement_timeout` or
    `query_timeout` on a worker-side pool). The watchdog already covers a hung database socket within
    15 minutes; a query timeout would only shorten that.
  - Heartbeat: a restart sends no ping for a few seconds only.
- **Git state:** branch `work/worker-loop-watchdog`, code commit `f2366f04`, rebased on `main` at
  `5b9b2846`, checks pass (see above). Changed paths are all inside "May edit".

## Verifier result (Verifier fills)

- **Ran:**
- **Got:**
- **Compared with claim:**
- **Verdict:** pass | fail | pass with notes
