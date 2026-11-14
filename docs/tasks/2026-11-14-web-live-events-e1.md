# Task: E1 — live events endpoint (Tailscale only) and fast EA polling at the horn

- **State:** Running (since 2026-11-14 ~03:09; task agent inside the old Lead chat `Lead` 08efa5) (operator 2026-11-14: plan approved, E1–E3 now; route left to the Lead: Tailscale only)
- **Lane:** Web (endpoint), Worker (fast poll), Database (one migration), Ops (compose port)
- **Risk:** high (a new listening port on Hotel-Echo; a new writer into the database) — the port and
  the deploy are the operator's OK
- **Slug:** live-events-e1
- **Operator gate before merge:** no; migration, compose port and deploy with the operator's OK
- **Needs a deploy:** migration, `web`, `worker`; compose change (a port bound to Hotel-Echo's Tailscale
  address only); a new secret `LIVE_EVENTS_TOKEN` + HMAC key in Hotel-Echo's `.env`

## Goal and visible result

Design: `docs/superpowers/specs/2026-11-14-live-events-interface.md` (approved; §3 event shape v1, §4 E1,
§5 decisions). Build:

1. **Endpoint** `POST /api/internal/live-events` in `apps/web`: bearer token + HMAC-SHA256 of the raw
   body with a timestamp header (replay window 2 minutes; constant-time compare); JSON validated against
   v1 (required `v`, `id`, `type`, `source`, `at`; known types only; size limit 4 KB); idempotent by `id`;
   answers `202` fast; rate limit (e.g. 60/min). Never logs the token, the HMAC or full bodies.
2. **Reachability** (the sender may run on the main PC or, later, on Hotel-Echo itself): reachable only through Hotel-Echo's Tailscale address — a compose port bound to the
   Tailscale IP (`100.98.29.119`) for `web`, and the route refuses requests that came through the
   public tunnel (check the `cf-connecting-ip`/`cf-ray` headers or the Host: refuse when present).
   A sender on Hotel-Echo reaches `web` over the local Docker network (no port needed). The Lead
   applies the compose change; the agent writes it and explains both paths in the runbook.
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

Resume: task agent finishes, writes the Report, rebases, sets Verify; Lead2 reviews and merges.

## Report
