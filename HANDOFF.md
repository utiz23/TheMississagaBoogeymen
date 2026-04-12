# Handoff

## Current Status

**Phase:** 3 complete — All milestones 3.0–3.6 done and verified green.

**Last updated:** 2026-04-12

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

### Phase 3 (in progress)

**Milestones 3.0–3.6 complete. `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all pass.**

**Design direction:** Broadcast Strip (dark, red-accented, stats-first). "Arena Board" scoreboard boldness borrowed for result badges, score emphasis, top performer highlights.

**What's built:**

- `tailwindcss` 4 + `@tailwindcss/postcss` installed in `apps/web`
- `postcss.config.mjs` and `globals.css` with CSS theme vars (`--color-background`, `--color-surface`, `--color-surface-raised`, `--color-border`, `--color-accent`, result badge fills)
- `next.config.ts` — `serverExternalPackages: ['@eanhl/db', 'postgres']` prevents bundling errors during `next build` without `DATABASE_URL`
- `apps/web/src/app/layout.tsx` — Barlow + Barlow Semi Condensed fonts via `next/font/google`, dark base, `TopNav`
- `apps/web/src/components/nav/top-nav.tsx` — Server Component; fetches game titles, gracefully degrades if DB unavailable
- `apps/web/src/components/nav/game-title-switcher.tsx` — Client Component; `useSearchParams()` + `usePathname()`, wrapped in Suspense in `TopNav`
- `apps/web/src/components/ui/result-badge.tsx` — WIN/LOSS/OTL/DNF with Arena Board bold treatment
- `apps/web/src/lib/format.ts` — `formatMatchDate`, `formatScore`, `formatTOA`
- `apps/web/src/components/matches/match-row.tsx` — flex-bar layout with accent left-bar for most-recent row; links to `/games/[id]`
- `apps/web/src/app/games/page.tsx` — Server Component; resolves game title by `?title=` param or falls back to first title; shows match list with column header or honest empty state; `revalidate: 300`
- `apps/web/src/app/games/loading.tsx` — Suspense fallback for `/games`
- `packages/db/src/queries/game-titles.ts` — `listGameTitles`, `getGameTitleBySlug`
- `packages/db/src/queries/matches.ts` — `getRecentMatches`, `getMatchById`
- `packages/db/src/queries/players.ts` — `getPlayerMatchStats(matchId)` (join with `players` for gamertag)
- `packages/db/src/queries/index.ts` — re-exports all query files
- `apps/web/src/lib/format.ts` — `formatMatchDate`, `formatScore`, `formatTOA`, `formatPct`, `opponentFaceoffPct`
- `apps/web/src/components/matches/player-stats-table.tsx` — unified skater+goalie table; goalie section divider; `—` for non-applicable cells; +/- colored green/red
- `apps/web/src/app/games/[id]/page.tsx` — Game Detail; `revalidate = false` (immutable data); hero with Arena Board bold score (`text-6xl font-condensed`, accent on WIN scoreFor); Broadcast Strip card (`border-l-accent`); team comparison strip (SOG, Hits, FO% with derived opponent %, TOA, PIM); player stats table or empty state; `notFound()` on missing match
- `apps/web/src/app/games/[id]/loading.tsx` — Suspense fallback for game detail
- `packages/db/src/queries/players.ts` — `getRoster(gameTitleId)` added (joins `playerGameTitleStats` + `players`, all aggregate fields, default sort `points desc`)
- `apps/web/src/components/roster/roster-table.tsx` — Client Component; four tabs (Scoring/Possession/Physical/Goalie); client-side column sort with directional indicator; top-ranked row gets `inset 2px 0 0 var(--color-accent)` box-shadow; Goalie tab filters `wins IS NOT NULL`; +/- colored green/red/grey
- `apps/web/src/app/roster/page.tsx` — Server Component; resolves game title by `?title=` param; `revalidate: 3600`; honest empty state
- `apps/web/src/app/roster/loading.tsx` — Suspense fallback for roster
- `packages/db/src/queries/club.ts` — `getClubStats(gameTitleId)`
- `packages/db/src/queries/index.ts` — exports club, game-titles, matches, players
- `apps/web/src/components/ui/stat-card.tsx` — reusable stat card (label, value, sublabel?, featured?); used by `/stats` and `/`
- `apps/web/src/app/stats/page.tsx` — record hero (W/L/OTL + win%), 6-card stat grid (GF, GA, Shots/GP, Hits/GP, FO%, Pass%), last-5 recent games strip; `revalidate: 300`
- `apps/web/src/app/stats/loading.tsx` — Suspense fallback for stats
- `packages/db/src/queries/players.ts` — `getTopPerformers(gameTitleId, limit?)` slim query (playerId, gamertag, goals, assists, points, hits); ordered by points desc
- `apps/web/src/app/page.tsx` — Home: record hero (W/L/OTL + win% + GF/GA inline), last game card (score hero + opponent + result badge + link), top performers table (compact 5-row, accent on rank-1), recent form strip (last 5 MatchRows); `revalidate: 300`
- `apps/web/src/app/loading.tsx` — Suspense fallback for home

**Phase 3 is complete.** All pages are implemented and verified. The next work is fixture capture (real EA API responses) to unblock the deferred decisions, followed by any Phase 4 work (individual player pages, career stats).

**Data dependency note:** All pages render honest empty states. No DB seeding was needed or done. The first `/games` render with real data requires the worker to have run at least one successful ingestion cycle.

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

## What's Next (Phase 3 continuation)

**Phase 3 is fully complete.** All milestones 3.0–3.6 are implemented and verified green.

**What comes next (Phase 4):**

- Fixture capture: curl real EA API endpoints, capture fixture JSON, run contract tests
- `players.ea_id NOT NULL` migration (once blazeId presence confirmed via fixtures)
- Individual player pages (`/roster/[id]`) — career stats across game titles
- Content season management UI (optional)
- Docker Compose production deployment verification

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
