# Task: E1 — live events endpoint (Tailscale only) and fast EA polling at the horn

- **State:** Verify (since 2026-11-14 03:31; was Running since ~03:09; task agent inside the old Lead chat `Lead` 08efa5) (operator 2026-11-14: plan approved, E1–E3 now; route left to the Lead: Tailscale only)
- **Lane:** Web (endpoint), Worker (fast poll), Database (one migration), Ops (`tailscale serve` step)
- **Risk:** high (a new listening port on Hotel-Echo; a new writer into the database) — the port and
  the deploy are the operator's OK
- **Slug:** live-events-e1
- **Operator gate before merge:** no; migration, `tailscale serve` step and deploy with the operator's OK
- **Needs a deploy:** migration, `web`, `worker`; operator step `tailscale serve` on Hotel-Echo (tailnet
  port 3100 to loopback 3000; no new Docker port); a new secret `LIVE_EVENTS_TOKEN` + HMAC key in Hotel-Echo's `.env`

## Goal and visible result

Design: `docs/superpowers/specs/2026-11-14-live-events-interface.md` (approved; §3 event shape v1, §4 E1,
§5 decisions). Build:

1. **Endpoint** `POST /api/internal/live-events` in `apps/web`: bearer token + HMAC-SHA256 of the raw
   body with a timestamp header (replay window 2 minutes; constant-time compare); JSON validated against
   v1 (required `v`, `id`, `type`, `source`, `at`; known types only; size limit 4 KB); idempotent by `id`;
   answers `202` fast; rate limit (e.g. 60/min). Never logs the token, the HMAC or full bodies.
2. **Reachability** (the sender may run on the main PC or, later, on Hotel-Echo itself): reachable only through Hotel-Echo's Tailscale address — `tailscale serve` on the host
   forwards tailnet port 3100 (`100.98.29.119:3100`) to `web` on loopback port 3000 (Docker publishes no
   extra port), and the route refuses requests that came through the
   public tunnel (check the `cf-connecting-ip`/`cf-ray` headers or the Host: refuse when present).
   A sender on Hotel-Echo reaches `web` over the local Docker network (no port needed). The Lead
   applies the `tailscale serve` step; the agent explains both paths in the runbook.
3. **Storage:** `live_events` table (id text primary key, type, source, at, received_at, payload jsonb;
   30-day retention by a small cleanup in the worker). Hand-written migration with rollback.
4. **Worker quick checks at the horn** (changed by the operator 2026-11-14 03:18, "lets go with your
   advice": do not load the EA API): on a stored `period_end` with `period >= 3` (or `game_end`), the
   worker runs a **match-list-only** check at once, then at +1, +2, +4 and +8 minutes (5 checks at most),
   and stops early when a new club game for the active title appears. A quick check calls only the EA
   match-list endpoints (at most the 3 match types; only 1 when the event says which mode was played),
   then transforms and stores any new game exactly as a normal pass does. It does **not** call member
   stats, club record, season rank, settings or opponent club info: those stay in the normal pass. The
   normal 5-minute loop is unchanged. Never overlaps the normal loop (one ingestion at a time); a second
   horn event while checks are scheduled does not start a second series. Same throttle (1 s between EA
   calls). EA stays the truth; events never write match data. Log each quick check in one line (calls
   made, new games).
5. **Docs:** a runbook section for the sender side (how to sign a request; an example `curl` with
   placeholder secrets) for the engine's E2 card.

## Paths

- **May edit:** `apps/web/src/app/api/internal/live-events/` (new), `apps/web/src/lib/live-events/` (new),
  `apps/worker/src/` (fast poll + cleanup, small), `packages/db/src/schema/`, `packages/db/src/queries/`
  (new `live-events.ts` + tests), `packages/db/migrations/<next>_live_events.sql`, `docker-compose.yml`
  (the `web` Tailscale-bound port only), `.env.example`, `docs/operations/runbooks/live-events.md` (new),
  this task file.

## Checks

db build; typecheck db, web, worker, discord; web unit + worker unit tests where they run; changed db tests
by name; prettier. Tests: auth (missing/wrong token, bad HMAC, old timestamp, replay), validation, size
limit, idempotency, rate limit, public-tunnel refusal, the quick-check schedule (starts on the horn in
period ≥ 3 or `game_end`; checks at 0, +1, +2, +4, +8 min; stops early on a new game; no overlap with the
normal pass; a repeat horn does not start a second series; only match-list endpoints are called). No real secret in tests or docs.

## Done when

All checks pass and the tests pin the rules above; the runbook shows how a sender signs a request.

## Log

- 2026-11-14 Lead: written from the approved plan.
- 2026-11-14 Lead: the sender may run on the main PC or on Hotel-Echo (engine Lead); both paths in.
- 2026-11-14 03:16 Lead2: State was still "Ready" here and on the board after the 03:09 "E1 running"
  commit (that commit changed only the dashboard). Set to Running. Branch `work/live-events-e1` has
  `bc7eef72` (migration 0079 + queries) and web work not yet committed. New Lead is `Lead2`.

- 2026-11-14 03:18 Lead2: operator decision: replace "every 30 s for 15 minutes" (worst case ~210 EA
  calls per game) with match-list-only checks at 0/+1/+2/+4/+8 min (worst case ~15 calls per game).
  Goal item 4 and Checks changed. Sent to the task agent through the old Lead chat.
- 2026-11-14 03:14 agent: database step done: migration 0079_live_events.sql (table, checks, index;
  rollback in the header), schema `live-events.ts`, queries `live-events.ts`, SQL-shape test (6 pass).

- 2026-11-14 03:18 agent: web endpoint done: `POST /api/internal/live-events` (route) + `lib/live-events/`
  (auth, v1 validation, rate limit, handler); 15 tests pass; web typecheck clean.

- 2026-11-14 03:26 agent: rebased on main (`ca2c4216`, item 4 changed); the 30 s / 15 min fast poll was
  never committed and is replaced. Worker done: `live-checks.ts` (loop: normal pass every 5 min
  unchanged; quick checks at 0/+1/+2/+4/+8 min; one series at a time; 30-day cleanup hourly),
  `quick-check.ts` (match lists only + DB follow-ups + stamp), `ingest.ts` (`runQuickMatchCheck`;
  `ingestMatchType` returns `matchesNew`), `index.ts` wiring. Added optional v1 field `match_type`
  (so a check calls 1 match list, not 3) to the endpoint validation and the trigger query.
  17 new worker tests pass.

- 2026-11-14 03:31 agent: compose port + web env, `.env.example`, runbook (`ab306a02`). Report
  written; State = Verify.

- 2026-11-14 03:40 agent: Lead2 sent back: boot-order defect; fixed with tailscale serve. The second
  `web` port is gone from compose and `.env.example` (all Docker ports stay on loopback); the runbook
  now has `tailscale serve --bg --tcp=3100 tcp://127.0.0.1:3000` as an operator step. State = Verify.

Resume: Lead2 re-reviews the boot-order fix, repeats the checks, merges; deploy only with the
operator's OK (migration 0079, `.env` secrets, `tailscale serve` step on Hotel-Echo, `web` + `worker`).

## Report

**What changed** (branch `work/live-events-e1`, rebased on `ca2c4216`):

- **Database:** migration `packages/db/migrations/0079_live_events.sql` (new table `live_events`:
  `id` text PK, `type`, `source`, `at`, `received_at` default now(), `payload` jsonb; checks on
  type/source/id length; index on `received_at`). Schema `packages/db/src/schema/live-events.ts`;
  queries `packages/db/src/queries/live-events.ts` (insert on conflict do nothing, trigger read by
  `(received_at, id)` cursor, latest active club game, game-ended check, 30-day delete). Touches no
  other table.
- **Web:** `POST /api/internal/live-events` (`apps/web/src/app/api/internal/live-events/route.ts`)
  and `apps/web/src/lib/live-events/` (`auth.ts`, `event.ts`, `rate-limit.ts`, `handler.ts`).
  Order: public tunnel → 404; secrets unset/short (< 32) → 503; rate limit 60/min → 429 +
  Retry-After; not JSON → 415; over 4096 bytes (declared or streamed) → 413; bearer, timestamp
  (±120 s), HMAC → 401 (one answer); v1 invalid → 400 naming the field; stored → 202
  `{ok, id, duplicate}`; store error → 503. Token compare: SHA-256 of both sides, then
  `timingSafeEqual`; HMAC compare: `timingSafeEqual` on the decoded digest. Logs: outcome, type and
  id only.
- **Worker:** `apps/worker/src/live-checks.ts` (the loop), `quick-check.ts` (one check),
  `ingest.ts` (`runQuickMatchCheck`; `ingestMatchType` now returns `matchesNew`), `index.ts`
  (wiring). Normal pass every `POLL_INTERVAL_MS`, unchanged. Events read every 5 s between passes. A
  `period_end` with period ≥ 3 or a `game_end` starts one series: checks at 0, +1, +2, +4, +8 min;
  stops early on a new club game (from a check or a normal pass). A check = EA match lists only (3
  per active title, 1 when the event has `match_type`), 1 s throttle after each call, then (only
  for a new game) AI goalies + aggregates + card progression, then the `finished_at` stamp (so the
  Discord poster posts at once). No member stats, club record, season rank, settings or opponent
  info. A repeat horn/`game_end` during a series starts nothing. Skipped: game already in (a club
  game ended ≤ 10 min before the event, or a new game seen ≤ 15 min before), stale (> 15 min).
  Hourly cleanup of events older than 30 days. Without the table: normal passes as before, one log
  line per 10 min. Worst case per game: 5 checks × 3 calls = 15 EA calls.
- **v1 addition:** optional `match_type` (`gameType5` | `gameType10` | `club_private`). The task asks
  for 1 call "when the event says which mode"; §3 had no such field. The spec (not in my paths)
  should list it.

**How a sender signs a request:** headers `Authorization: Bearer <LIVE_EVENTS_TOKEN>`,
`X-Live-Events-Timestamp: <unix seconds>`, `X-Live-Events-Signature: sha256=<hex HMAC-SHA256 with
LIVE_EVENTS_HMAC_KEY of "<timestamp>.<raw body>">`. Runbook `docs/operations/runbooks/live-events.md`
has the bash/curl and Python examples (placeholders; the bash, Node and Python signatures were
checked to match).

**Migration + rollback:** `0079_live_events.sql`, hand-applied (command in its header), idempotent.
Apply before the `web`/`worker` deploy. Rollback after the code rollback:
`DROP TABLE IF EXISTS "live_events";`. Not applied anywhere.

**Reachability (why Tailscale only):** compose has no new port. `web` stays on loopback port 3000
(Docker never binds the Tailscale address, so there is no boot-order dependency; the first version
bound `100.98.29.119` and Lead2 sent it back for that). On Hotel-Echo the operator runs
`sudo tailscale serve --bg --tcp=3100 tcp://127.0.0.1:3000` (check: `tailscale serve status`; undo:
`sudo tailscale serve --tcp=3100 off`). `tailscaled` keeps it across reboots; it is tailnet only, not
Funnel. The tunnel reaches `web` over the compose network, and the route refuses any request with
Cloudflare headers or the `boogeymen.app` host. A sender on Hotel-Echo uses `http://web:3000`
(container) or `http://127.0.0.1:3000` (host). Compose also gets `LIVE_EVENTS_TOKEN` and
`LIVE_EVENTS_HMAC_KEY` in the `web` environment; `.env.example` documents both.

**Checks (2026-11-14):**

- `pnpm --filter @eanhl/db build`: OK. Typecheck db, web, worker, discord: all clean.
- web `pnpm test:unit`: 687 pass, 0 fail (15 new in `lib/live-events/`: auth, timestamp/replay,
  idempotency, size, validation, rate limit, tunnel refusal, unset secrets, logs).
- worker, no database: `live-checks.test.js` + `quick-check.test.js` 17 pass (schedule 0/+1/+2/+4/+8,
  early stop by check and by normal pass, no overlap, no second series, triggers, game already in,
  stale, title/type, missing table, cleanup, only match-list deps); `heartbeat`, `transform`,
  `derive-team-faceoff-pct`, `extract-shot-locations` 25 pass (the last two need a placeholder
  `DATABASE_URL`, as before); `test:safety` 73 pass.
- db `node --test packages/db/dist/queries/__tests__/live-events.test.js`: 6 pass.
- prettier: every changed file clean (`pnpm format:check` fails only on 8 old files I did not touch).
- Not run: `docker compose config` (no Docker here; YAML parsed with Python, OK), worker integration
  tests and the endpoint against a real database (need Docker), lint.

**Not done / open risks:**

- **Operator step at deploy:** `tailscale serve` (runbook §6, step 4) is not in git. Without it the
  main PC cannot reach the route. Not tested here (no Tailscale/Docker in this worktree).
- The Tailscale port (3100) exposes the whole website (not only this route) to tailnet devices.
- A quick check that finds the game skips opponent club info, so a new opponent's crest can be
  missing from the Discord post until the next normal pass fetches it.
- Rate limit is one in-memory bucket per `web` process, shared by all callers (also unauthenticated
  ones on the tailnet).
- Spec §3 should list the new optional `match_type`.

**Git state:** branch `work/live-events-e1`, 5 commits on `main` `ca2c4216` (db `33c57946`, web
`c4dc4e8c`, worker `74c5b48f`, ops `ab306a02`, this report). Not pushed, not merged, nothing deployed.
