# Handoff

## Current Status

**Phase:** 1 complete — all verification checks pass.

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

### Architecture

- Canonical plan is `docs/ARCHITECTURE.md`.
- Blueprint (`EASHL Team Stats Website – Full Blueprint.md`) is reference-only.
- Core decisions remain:
  - Next.js app + worker, no separate API service
  - game titles are the primary stats grouping
  - raw-first ingestion
  - self-hosted Docker Compose deployment

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

## What's Next (Phase 2)

Phase 2 is the ingestion worker. Do not start until real EA API fixtures are captured.

**Before Phase 2:**

1. Run the curl commands in `packages/ea-client/__fixtures__/README.md` to capture real responses
2. Run `pnpm --filter @eanhl/ea-client test` — the fixture tests will now execute instead of being `todo`
3. Resolve the deferred questions listed above
4. Update `packages/ea-client/src/types.ts` to match the real response shapes
5. Make `players.ea_id NOT NULL` if fixtures confirm blazeId is always present

**Phase 2 scope** (from `docs/ARCHITECTURE.md` §12):

- Non-overlapping polling loop
- Raw payload storage (store-first, hash + source_endpoint)
- Transform pipeline (string→number, opponent identification, result determination)
- Player upsert (ea_id primary, gamertag update + history tracking)
- `player_match_stats` insertion
- Aggregate recomputation
- `ingestion_log` writing
- `reprocess` CLI command
- Health HTTP endpoint

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
| `.env.example`                                      | Environment variable reference                       |
| `docker-compose.yml`                                | Service definitions                                  |
