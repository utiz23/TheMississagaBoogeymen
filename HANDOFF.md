# Handoff

## Current Status

**Phase:** 1 in progress — database and EA client foundations were partially implemented before progress was cut off.

**Last updated:** 2026-04-11

---

## Stable Baseline

### Phase 0

- Phase 0 is green.
- `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` were previously verified passing.
- Docker scaffold exists and the monorepo layout is in place.

### Architecture

- Canonical plan is `docs/ARCHITECTURE.md`.
- Blueprint (`EASHL Team Stats Website – Full Blueprint.md`) is reference-only.
- Core decisions remain:
  - Next.js app + worker, no separate API service
  - game titles are the primary stats grouping
  - raw-first ingestion
  - self-hosted Docker Compose deployment

---

## Phase 1 Scope

The intended Phase 1 brief at cutoff was:

1. Implement the initial `packages/db` foundation:
   - Drizzle setup
   - schema folder structure
   - database client entrypoint
   - initial migrations scaffold
2. Implement the initial `packages/ea-client` foundation:
   - HTTP client shell
   - endpoint module structure
   - shared types module
   - retry / throttle scaffolding
3. Keep the implementation aligned with `docs/ARCHITECTURE.md`.
4. Be conservative about unresolved architecture questions:
   - do not assume `match_id` is globally unique across game titles
   - do not assume `blazeId` is always present until fixtures confirm it
   - do not assume in-game season is in payloads until fixtures confirm it
5. Add contract-test scaffolding for fixture-driven validation, even if real fixtures cannot yet be captured in this environment.

Important constraints:

- Do not start Phase 2 worker orchestration.
- Do not build the frontend beyond what already exists.
- Prefer small, clean, reviewable commits of structure over speculative implementation.
- If live EA API access is unavailable, scaffold the fixture capture path and clearly separate implemented work from fixture-blocked work.

Required verification before handoff:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`

Also report:

- what schema decisions were locked in
- what decisions were intentionally deferred pending real fixtures
- any mismatch between the architecture doc and what the code required

---

## What Was In Progress At Cutoff

The previous implementation session had started Phase 1 and appears to have completed a substantial amount of local file work, but the session transcript cuts off before final verification.

### Dependencies Installed

- `packages/db`:
  - `drizzle-orm`
  - `postgres`
  - `drizzle-kit` as a dev dependency
- `packages/ea-client`:
  - `vitest` as a dev dependency
- Root `package.json` was reportedly updated to allow `esbuild` in `pnpm.onlyBuiltDependencies`, followed by `pnpm install`

### `packages/db` Work Started

Files present or modified in the worktree:

- `packages/db/package.json`
- `packages/db/drizzle.config.ts`
- `packages/db/src/index.ts`
- `packages/db/src/client.ts`
- `packages/db/src/queries/`
- `packages/db/src/schema/`
- `packages/db/migrations/`

Reported implementation details from the interrupted session:

- Drizzle schema split across multiple files
- database client created
- `drizzle-kit generate` reportedly succeeded
- generated migration file: `packages/db/migrations/0000_big_forgotten_one.sql`

Reported schema decisions taken during implementation:

- `matches` and `raw_match_payloads` used surrogate `bigserial` primary keys plus unique constraints on `(game_title_id, ea_match_id)`
- `content_seasons` was promoted to its own table and `matches.content_season_id` used as a nullable FK
- `players.ea_id` was kept nullable pending fixture confirmation

### `packages/ea-client` Work Started

Files present or modified in the worktree:

- `packages/ea-client/package.json`
- `packages/ea-client/src/index.ts`
- `packages/ea-client/src/client.ts`
- `packages/ea-client/src/endpoints.ts`
- `packages/ea-client/src/types.ts`
- `packages/ea-client/__fixtures__/`
- `packages/ea-client/__tests__/`

Reported implementation details from the interrupted session:

- HTTP client shell with retry and throttle
- typed endpoint wrappers
- provisional EA response types marked as unverified until fixtures exist
- fixture README / contract-test scaffolding was being added

### Worktree State At Time Of This Handoff

Current local changes detected when this handoff was updated:

- modified:
  - `.claude/settings.json`
  - `package.json`
  - `packages/db/package.json`
  - `packages/db/src/index.ts`
  - `packages/ea-client/package.json`
  - `packages/ea-client/src/index.ts`
  - `pnpm-lock.yaml`
- untracked:
  - `packages/db/drizzle.config.ts`
  - `packages/db/migrations/`
  - `packages/db/src/client.ts`
  - `packages/db/src/queries/`
  - `packages/db/src/schema/`
  - `packages/ea-client/__fixtures__/`
  - `packages/ea-client/__tests__/`
  - `packages/ea-client/src/client.ts`
  - `packages/ea-client/src/endpoints.ts`
  - `packages/ea-client/src/types.ts`

The interrupted session also referenced a `contract.test.ts`, but the transcript cuts off before confirming whether that file was fully written.

---

## Locked Decisions

- Stay aligned to `docs/ARCHITECTURE.md` unless a concrete implementation mismatch forces an explicit deviation.
- Treat match IDs as potentially non-global across game titles.
- Treat `blazeId` presence/stability as unconfirmed until real fixtures prove it.
- Treat in-game season presence in payloads as unconfirmed until real fixtures prove it.
- Do not move into worker orchestration or frontend implementation in Phase 1.

---

## Deferred Pending Real Fixtures

- Whether `blazeId` is always present in match responses
- Whether `blazeId` is consistent across match and member endpoints
- Whether match IDs are globally unique or only unique per game title
- Whether in-game season is explicitly present in match payloads
- Exact goalie field names and position field values
- Exact top-level match payload shape

---

## Next Recommended Action

Resume Phase 1 from the current worktree, but do not assume it is complete just because many files exist.

Recommended restart checklist:

1. Inspect the new `packages/db` and `packages/ea-client` files.
2. Verify whether `contract.test.ts` and fixture README were completed.
3. Run:
   - `pnpm typecheck`
   - `pnpm lint`
   - `pnpm format:check`
4. If those pass, summarize:
   - locked schema decisions
   - fixture-blocked decisions
   - any divergence from `docs/ARCHITECTURE.md`
5. If they fail, finish Phase 1 cleanup before proceeding.

Do not begin Phase 2 until the above is green.

---

## Key Files

| File | Purpose |
| --- | --- |
| `docs/ARCHITECTURE.md` | Canonical architecture and implementation plan |
| `HANDOFF.md` | Session continuity and current cutoff status |
| `packages/db/` | Drizzle schema, client, migrations, future queries |
| `packages/ea-client/` | EA API client, endpoint wrappers, fixtures, contract tests |
| `.env.example` | Local and container environment variable guidance |
| `docker-compose.yml` | Service definitions |
