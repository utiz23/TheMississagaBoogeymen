# Handoff

## Current Status

**Phase:** 5.1 / 5.2 complete — payload audit done, GAA supported, goalie detection fixed, opponent names corrected, live data reprocessed.

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
- `src/transform.ts`: pure transform function. All `TODO(fixture)` markers resolved or explicitly deferred. See Phase 5.1 findings below.
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

### Phase 4 ✓ complete

**All checks pass. System live. First ingest completed. All pages serving real data.**

**What was built:**

- `.dockerignore` — excludes `.git`, `node_modules`, `.next`, `.env` from build context
- `apps/worker/Dockerfile` — pnpm monorepo build; builds `@eanhl/db` → `@eanhl/ea-client` → `@eanhl/worker`; `CMD ["node", "dist/index.js"]`
- `apps/web/Dockerfile` — same pattern; placeholder `DATABASE_URL` build ARG lets `next build` run without a live DB; `CMD ["node_modules/.bin/next", "start"]`
- `docker-compose.yml` — worker exposes port 3001; `HEALTH_PORT` + `HEALTH_STALE_MS` wired; DB host port is `5433:5432` on this machine (see port note below)
- `.env.example` — added `HEALTH_PORT`, `HEALTH_STALE_MS`
- `packages/db/seed/game_titles.sql` — idempotent NHL 26 seed (`is_active=true`)
- `DEPLOY.md` — cold-start checklist with port conflict note

**Key design decision (web Dockerfile):** `next build` pre-renders pages that import `@eanhl/db`. The module-level `DATABASE_URL` guard in `client.ts` would throw without a real URL. A syntactically valid placeholder satisfies the guard; `postgres.js` connects lazily so no connection is attempted at init. Pages catch the runtime connection error and render empty states. Zero application code changes required.

**Runtime verification (first launch):**

- `docker compose build` — both images build clean; `next build` completes with 7 pages all `ƒ dynamic`
- `docker compose up -d` — all 3 services started; `db` healthy, `worker` and `web` running
- First ingest: `gameType5=5 new, gameType10=5 new, club_private=5 new` — 15 matches, 12 players, 63 player_match_stats, 0 transform errors, aggregates computed
- Second ingest (idempotency check): all `new=0`, match count stays at 15 ✓
- `curl localhost:3001/health` → `{"status":"ok","lastSuccessfulIngest":"...","secondsSinceLastIngest":12}` ✓
- All four pages (`/`, `/games`, `/roster`, `/stats`) confirmed serving live data ✓

**Port note (this machine):** Port 5432 is occupied by `situationroom-db` (another project). The DB host port is mapped to `5433:5432` in `docker-compose.yml` and `DATABASE_URL` in `.env` uses `localhost:5433`. The containers themselves use `db:5432` on the internal network — no change there. `DEPLOY.md` documents this as a known conflict pattern.

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

- **`blazeId` confirmed absent in production match payloads** — observed across all 15 matches in first live ingest (all players used gamertag fallback). `players.ea_id` must stay nullable. The `NOT NULL` migration is permanently deferred unless EA changes the API. The gamertag-fallback path is the real production path, not the exception.
- Whether `blazeId` is consistent across match and member endpoints (moot for match ingestion; relevant only if member stats are ever used)
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

## Fixture Findings (2026-04-12)

Captured fixtures for:

- `matches-gameType5.json`
- `matches-gameType10.json`
- `members-stats.json`

Findings:

- `matchId` and `timestamp` fields are present in match payloads.
- `timeAgo` object is present in match payloads.
- `blazeId` is **not** present for all players in match payloads → `players.ea_id` must remain nullable; gamertag fallback logic is required.
- Member stats payloads do **not** include `blazeId` or `memberId` in many rows; `name` is the only reliable identifier in that response.
- No season-like field was found in match payloads → `content_season_id` must be assigned from date ranges for now.

Follow-up changes applied:

- Worker transform now treats `timestamp` as epoch seconds (number) and avoids using `playerKey` as a surrogate ID when `blazeId` is missing.
- Phase 2.1 cleanup applied:
  - `persistTransform` now runs inside a DB transaction (match + player upserts + match stats).
  - Result derivation uses club `result` codes when present and marks DNF when opponent `winnerByDnf` flags are set.
  - `player_match_stats.match_id` now uses `bigint` with migration `0001_fix_player_match_stats_match_id.sql`.

Notes:

- OTL still cannot be distinguished from LOSS with current fixture fields. Deferred — requires a real OT match payload to confirm the result code.

---

## Phase 5.1 / 5.2 — Payload Audit and Data Correctness ✓ complete

**What was audited and confirmed from real payloads:**

| Field                        | Finding                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `matchId`                    | Top-level string, confirmed                                                          |
| `timestamp`                  | Epoch seconds (number), confirmed                                                    |
| `position`                   | String values: `goalie`, `center`, `defenseMen`, `leftWing`, `rightWing` — confirmed |
| `glsaves`, `glga`, `glshots` | Present for **all** players, not goalie-only. Non-goalies carry `"0"`.               |
| `toiseconds`                 | Player-level TOI in seconds as string (e.g. `"3600"`). Present for all players.      |
| `score`                      | String in `clubs[id]`, confirmed                                                     |
| `clubs[id].details.name`     | Real club display name — NOT at top-level `clubs[id].name`                           |
| `skpasspct`                  | 0–100 range, confirmed                                                               |
| OTL indicator                | **Not found.** No overtime matches in current fixtures. Deferred.                    |

**Critical bug fixed (goalie detection):**

- Old logic: `hasGoalieFields = raw.glsaves !== undefined` — always `true` because every player row has `gl*` fields. All players were stored as `is_goalie = true`.
- Fix: `isGoalie = position === 'goalie'` — the position string is the sole reliable indicator.

**What was changed:**

- `packages/ea-client/src/types.ts` — confirmed fields marked, `toiseconds` added, `EaMatchClubData.details` typed
- `apps/worker/src/transform.ts` — goalie detection fixed, opponent name from `details.name`, `toiseconds` parsed into `stats.toiSeconds`, TODO markers resolved or deferred
- `packages/db/src/schema/player-match-stats.ts` — added `toiSeconds: integer('toi_seconds')` (nullable)
- `packages/db/migrations/0001_tiny_morph.sql` — migration adds `toi_seconds` column (also bumps `match_id` to bigint idempotently; that change was already applied manually)
- `apps/worker/src/aggregate.ts` — GAA now computed as `(goals_against / toi_seconds) * 3600`; rows with `NULL toi_seconds` produce NULL GAA (safe default for pre-5.2 rows)
- `apps/worker/src/ingest.ts` — `player_match_stats` insert changed from `onConflictDoNothing` to `onConflictDoUpdate` so reprocess correctly updates existing rows; `opponentName` added to match upsert set

**Live data corrected (all 15 existing matches reprocessed):**

- `is_goalie` now correct for all 63 `player_match_stats` rows (1 goalie, 62 skaters)
- `toi_seconds` populated for all 63 rows
- Opponent names are real club names (e.g. "Le Duo Plus Mario") not numeric IDs
- Aggregates recomputed — non-goalies show `wins/losses/save_pct/gaa = NULL/0` as expected
- I-amCaKee (the one goalie): `save_pct = 50.00`, `gaa = 5.26`

**Verified:**

- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all pass
- 15/15 reprocess succeeded, 0 failed

**Still deferred:**

- OTL result code — no OT match fixture available; the schema and aggregate already support `OTL`; just need the correct result code from EA
- Goalie wins/losses for OTL (same dependency)

---

## What's Next

### Phase 5.3 — Player pages (`/roster/[id]`)

Ready to start. Data correctness is resolved. The immediate next slice:

1. `packages/db/src/queries/players.ts` — add `getPlayerCareerStats(playerId)` query (per-game-title stat rows + gamertag history)
2. `apps/web/src/app/roster/[id]/page.tsx` — basic profile: career stats table (one row per game title), gamertag history list
3. Link player rows in the roster table to `/roster/[id]`

### Post-launch / later work

- Pagination on `/games` — currently returns all matches unbounded; add offset to `getRecentMatches` and prev/next UI
- Alerting script — cron checks `localhost:3001/health`, notifies (Discord) when stale > 30 min
- `pg_dump` backup cron — daily dump to external drive
- Mobile responsive pass — pages untested on small screens
- Content season filtering — schema supports it, no UI yet
- Charts / trends (Recharts)
- Streak tracking, head-to-head records

---

## Key Files

| File                                                              | Purpose                                              |
| ----------------------------------------------------------------- | ---------------------------------------------------- |
| `docs/ARCHITECTURE.md`                                            | Canonical architecture and implementation plan       |
| `HANDOFF.md`                                                      | Session continuity and current status                |
| `packages/db/src/schema/`                                         | Drizzle table definitions (one file per domain area) |
| `packages/db/migrations/0000_big_forgotten_one.sql`               | First migration — all tables                         |
| `packages/db/src/client.ts`                                       | Drizzle + postgres.js database client                |
| `packages/ea-client/src/client.ts`                                | HTTP client with retry/backoff/throttle              |
| `packages/ea-client/src/endpoints.ts`                             | Typed endpoint wrappers                              |
| `packages/ea-client/src/types.ts`                                 | Provisional EA API response types (UNVERIFIED)       |
| `packages/ea-client/__fixtures__/README.md`                       | Fixture capture instructions                         |
| `packages/ea-client/__tests__/contract.test.ts`                   | Contract tests (run after fixtures are captured)     |
| `apps/worker/src/transform.ts`                                    | Pure transform: raw EA payload → structured DB types |
| `apps/worker/src/aggregate.ts`                                    | Precompute player/club aggregate stats               |
| `apps/worker/src/ingest.ts`                                       | Ingestion cycle + persistTransform + upsertPlayer    |
| `apps/worker/src/index.ts`                                        | Polling loop entry point                             |
| `apps/worker/src/health.ts`                                       | HTTP health endpoint                                 |
| `apps/worker/src/ingest-now.ts`                                   | One-shot ingestion CLI trigger                       |
| `apps/worker/src/reprocess.ts`                                    | Reprocess failed-transform payloads CLI              |
| `.env.example`                                                    | Environment variable reference                       |
| `docker-compose.yml`                                              | Service definitions                                  |
| `apps/worker/Dockerfile`                                          | Worker production image (pnpm monorepo build)        |
| `apps/web/Dockerfile`                                             | Web production image (next build + next start)       |
| `packages/db/migrations/0001_fix_player_match_stats_match_id.sql` | Fixes match_id to bigint — must run after 0000       |
| `packages/db/seed/game_titles.sql`                                | NHL 26 seed — must apply before first compose up     |
| `DEPLOY.md`                                                       | Cold-start deployment checklist                      |
