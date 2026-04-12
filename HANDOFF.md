# Handoff

## Current Status

**Phase:** 2 complete — all verification checks pass.

**Last updated:** 2026-04-11

---

## Stable Baseline

### Phase 0

- Phase 0 is green.
- Docker scaffold exists and the monorepo layout is in place.

### Phase 1

- `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` all pass.
- `packages/db`: Drizzle schema, client, drizzle.config, migration, queries stub — all complete.
- `packages/ea-client`: HTTP client (retry/throttle), endpoint wrappers, types, fixture README, contract-test scaffold — all complete.
- `pnpm --filter @eanhl/ea-client test` runs cleanly (2 `todo` stubs waiting for real fixtures).

### Phase 2

- `apps/worker` ingestion worker complete.
- `src/transform.ts`: pure transform function, conservative field access, all `TODO(fixture)` markers in place.
- `src/aggregate.ts`: raw-SQL `INSERT … ON CONFLICT DO UPDATE` for `player_game_title_stats` and `club_game_title_stats`.
- `src/ingest.ts`: raw-first ingestion cycle, idempotent upserts, gamertag history tracking, `persistTransform` + `upsertPlayer` exported for reuse.
- `src/index.ts`: non-overlapping `for(;;)` polling loop, configurable via `POLL_INTERVAL_MS`.
- `src/health.ts`: HTTP health endpoint on `HEALTH_PORT` (default 3001), stale detection via `HEALTH_STALE_MS`.
- `src/ingest-now.ts`: one-shot CLI trigger (`pnpm --filter worker ingest-now`).
- `src/reprocess.ts`: reprocess failed transforms CLI (`pnpm --filter worker reprocess [--dry-run]`).
- All checks pass: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`.

### Architecture

- Canonical plan is `docs/ARCHITECTURE.md`.
- Blueprint (`EASHL Team Stats Website – Full Blueprint.md`) is reference-only.
- Core decisions remain:
  - Next.js app + worker, no separate API service
  - game titles are the primary stats grouping
  - raw-first ingestion
  - self-hosted Docker Compose deployment

### Claude Project Setup

- Project-level Claude optimizations are now present in `.claude/`.
- Added project skills:
  - `resume-phase`
  - `phase-review`
  - `verify-phase`
  - `handoff-update`
- Added project subagents:
  - `repo-explorer`
  - `db-reviewer`
  - `worker-debugger`
- Added project hooks in `.claude/settings.json`:
  - `PreToolUse` for noisy Bash command prevention
  - `PostToolUse` for targeted auto-formatting after edits
- Added compact-summary guidance to `CLAUDE.md`.
- User-level plugins in `~/.claude` were left unchanged; optimization work was kept project-scoped.

---

## Locked Schema Decisions

| Decision                                   | Implementation                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Match uniqueness is composite              | `UNIQUE(game_title_id, ea_match_id)` on both `matches` and `raw_match_payloads`; surrogate `bigserial` PK on both tables |
| `content_seasons` is a proper table        | FK from `matches.content_season_id` (nullable) — not a bare integer field                                                |
| `players.ea_id` is nullable                | Will be made `NOT NULL` once fixtures confirm blazeId is always present                                                  |
| Goalie stats in same table as skater stats | Nullable goalie columns in `player_match_stats` (`saves`, `goals_against`, `shots_against`)                              |
| Aggregates precomputed per game title      | `player_game_title_stats` and `club_game_title_stats` — never computed on read                                           |
| `transform_status` is a strict enum        | DB `CHECK` constraint on `('pending', 'success', 'error')`                                                               |
| `result` is a strict enum                  | DB `CHECK` constraint on `('WIN', 'LOSS', 'OTL', 'DNF')`                                                                 |

---

## Deferred Pending Real Fixtures

- Whether `blazeId` is always present in match responses (determines nullable → not null migration)
- Whether `blazeId` is consistent across match and member endpoints
- Whether match IDs are globally unique or only unique per game title (composite key is safe default)
- Whether in-game season is explicitly present in match payloads or must be assigned from date ranges
- Exact goalie stat field names in EA responses (`glsaves`, `glga`, `glshots` — unverified)
- Exact position field values and how goalies are distinguished
- Top-level match payload shape (`matchId` field name, timestamp format, club/player nesting)

---

## Divergences from `docs/ARCHITECTURE.md`

| Architecture doc                                    | Actual implementation                                                                                             | Reason                                                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `matches.id (text PK)` — EA matchId as PK           | `matches.id` is `bigserial`; EA match ID stored as `ea_match_id (text)` with `UNIQUE(game_title_id, ea_match_id)` | Match IDs may not be globally unique across game titles; surrogate PK simplifies FK chain     |
| `raw_match_payloads.match_id (PK, text)`            | Same pattern — surrogate `bigserial` PK with `ea_match_id` + unique constraint                                    | Same reason as above                                                                          |
| `matches.in_game_season (int, null)` — bare integer | `matches.content_season_id (int, null FK)` referencing `content_seasons` table                                    | Promoted to FK table so we can store display labels, date boundaries, and a `is_current` flag |

---

## What's Next (Phase 3)

Phase 3 is the Next.js frontend. Do not start until real EA API fixtures are captured and the worker has ingested real data.

**Before Phase 3:**

1. Run the curl commands in `packages/ea-client/__fixtures__/README.md` to capture real responses
2. Run `pnpm --filter @eanhl/ea-client test` — the fixture tests will now execute instead of being `todo`
3. Resolve the fixture-gated deferred questions listed above
4. Update `packages/ea-client/src/types.ts` to match the real response shapes
5. Make `players.ea_id NOT NULL` if fixtures confirm blazeId is always present
6. Start worker (`docker compose up`) and let it run through at least one real ingestion cycle

**Phase 3 scope** (from `docs/ARCHITECTURE.md`):

- Game title switcher / nav
- Club stats dashboard (wins/losses, shots, faceoffs)
- Player leaderboards (goals, assists, +/-, etc.)
- Player career page (cross-game stats aggregation)
- Match history list and match detail view

---

## Key Files

| File                                                | Purpose                                              |
| --------------------------------------------------- | ---------------------------------------------------- |
| `docs/ARCHITECTURE.md`                              | Canonical architecture and implementation plan       |
| `HANDOFF.md`                                        | Session continuity and current status                |
| `packages/db/src/schema/`                           | Drizzle table definitions (one file per domain area) |
| `packages/db/migrations/0000_big_forgotten_one.sql` | First migration — all tables                         |
| `packages/db/src/client.ts`                         | Drizzle + postgres.js database client                |
| `packages/ea-client/src/client.ts`                  | HTTP client with retry/backoff/throttle              |
| `packages/ea-client/src/endpoints.ts`               | Typed endpoint wrappers                              |
| `packages/ea-client/src/types.ts`                   | Provisional EA API response types (UNVERIFIED)       |
| `packages/ea-client/__fixtures__/README.md`         | Fixture capture instructions                         |
| `packages/ea-client/__tests__/contract.test.ts`     | Contract tests (run after fixtures are captured)     |
| `apps/worker/src/transform.ts`                      | Pure transform: raw EA payload → structured DB types |
| `apps/worker/src/aggregate.ts`                      | Precompute player/club aggregate stats               |
| `apps/worker/src/ingest.ts`                         | Ingestion cycle + persistTransform + upsertPlayer    |
| `apps/worker/src/index.ts`                          | Polling loop entry point                             |
| `apps/worker/src/health.ts`                         | HTTP health endpoint                                 |
| `apps/worker/src/ingest-now.ts`                     | One-shot ingestion CLI trigger                       |
| `apps/worker/src/reprocess.ts`                      | Reprocess failed-transform payloads CLI              |
| `.env.example`                                      | Environment variable reference                       |
| `docker-compose.yml`                                | Service definitions                                  |
