# Handoff

## Current Status

**Phase:** Product polish — home page has full EA data integration. Opponent club logos, official club record, and competitive season rank / division standing all live. All surfaces use local aggregates or match-level data. Mode filtering (`All / 6s / 3s`) works everywhere.

**Last updated:** 2026-04-17

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

## DB/Stats Rework — Phase 1 ✓ complete (2026-04-13)

**Commit:** `1e7ce5f` — Phase 1: per-match field expansion + gameMode + reprocess --all

**What was done:**

**Schema changes (migration `0002_purple_rage.sql`):**

- `matches`: added `ea_game_type_code` (raw `cNhlOnlineGameType` int), `game_mode` (derived '3s'/'6s'), `pass_attempts`, `pass_completions`, `pp_goals`, `pp_opportunities`
- `player_match_stats`: added 16 new columns:
  - Skater advanced (NOT NULL DEFAULT 0): `shot_attempts`, `blocked_shots`, `pp_goals`, `sh_goals`, `interceptions`, `penalties_drawn`, `possession`, `deflections`, `saucer_passes`
  - Context: `client_platform` (text nullable), `player_dnf` (bool NOT NULL DEFAULT false)
  - Goalie advanced (nullable): `breakaway_saves`, `breakaway_shots`, `desp_saves`, `pen_saves`, `pen_shots`, `pokechecks`
- `packages/db/src/schema/matches.ts`: exported `GAME_MODE`, `GameMode`, and `deriveGameMode()` helper

**Worker changes:**

- `apps/worker/src/transform.ts`: extracts all new fields from fixtures; derives `gameMode` from `cNhlOnlineGameType` (5/10→'6s', 200→'3s'); extracts `passa`/`passc`/`ppg`/`ppo` from `clubs[id]` (not aggregate)
- `apps/worker/src/ingest.ts`: `persistTransform` upsert `.set` extended for all new match and player_match_stats columns
- `apps/worker/src/reprocess.ts`: added `--all` flag to reprocess every raw payload (not just errors); recomputes aggregates for affected game titles after a successful batch

**EA client types (`packages/ea-client/src/types.ts`):**

- `EaPlayerMatchStats`: added all new confirmed skater and goalie advanced fields
- `EaMatchClubData`: added `cNhlOnlineGameType`, `passa`, `passc`, `ppg`, `ppo`

**Verified:** `pnpm typecheck`, `pnpm lint` — all pass; format check clean on all changed source files

**What's next:**

Commit outstanding work (stats query functions + stats UI components + stats page polish), then proceed to:

- **Phase 3 — game mode dimension**: add `gameMode` to aggregate unique keys; loop aggregate over [null, '3s', '6s']
- Or continue Phase 5 UI work (home page, roster improvements, etc.)

**Operational state (2026-04-13):** Migrations 0002 + 0003 applied to live DB. `reprocess --all` ran successfully (15/15 payloads, 0 errors). Aggregates recomputed. Local worker dist rebuilt (`pnpm --filter @eanhl/worker build`).

---

## DB/Stats Rework — Query Layer + Stats Page Integration ✓ complete (2026-04-13)

**What was done:**

New query functions in `packages/db/src/queries/stats.ts` (new file):

- `getSkaterStats(gameTitleId)` — joins `playerGameTitleStats` + `players`, filters out goalies (`position != 'goalie' OR position IS NULL`), returns all skater aggregate columns + `shotAttempts` + `toiSeconds`
- `getGoalieStats(gameTitleId)` — filters `position = 'goalie'`, returns all goalie aggregate columns including new `otl` / `totalSaves` / `totalShotsAgainst` / `totalGoalsAgainst`
- Exported `SkaterStatsRow` and `GoalieStatsRow` type aliases

New Client Components:

- `apps/web/src/components/stats/skater-stats-table.tsx` — Basic (GP/G/A/PTS/+/-/PIM/SOG/P/GP) + Advanced (GP/SHT%/TOI/GP/Hits/TA/GV/FO%/Pass%) tabs; client sort with directional indicator; null-to-bottom sort; accent inset on rank-1 row
- `apps/web/src/components/stats/goalie-stats-table.tsx` — Basic (GP/W/L/OTL/SV%/GAA/SO) + Advanced (GP/SV/SA/GA/SV/GP/SA/GP/TOI) tabs; same sort pattern

Updated `apps/web/src/app/stats/page.tsx`:

- Fetches `getSkaterStats` + `getGoalieStats` in the existing `Promise.all`
- Renders "Skaters" section + "Goalies" section below Recent Games (shown when rows exist)

**Verified:** `pnpm --filter @eanhl/web typecheck`, `pnpm --filter @eanhl/web lint`, `pnpm prettier --check` — all pass

**Important:** `@eanhl/db` must be rebuilt (`pnpm --filter @eanhl/db build`) before the web typecheck can resolve `getSkaterStats`/`getGoalieStats` exports. Already done.

**Live data status (2026-04-13):** Migrations 0002 + 0003 applied. `reprocess --all` completed (15/15 payloads). Aggregates recomputed with Phase 2 columns. Stats page fully operational with real data.

---

## DB/Stats Rework — Final State Checkpoint (2026-04-17)

**What is done:**

- All web-facing stats surfaces now use local aggregates or match-level data. Web no longer reads `ea_member_season_stats`.
- `/games` supports match-level `All / 6s / 3s` filtering.
- `/stats`, `/roster`, home, and player profile surfaces are now aligned to local source-of-truth semantics.
- Aggregate tables include `game_mode`, and aggregate queries accept optional `gameMode`.
- Player profile page handles member-only/no-local-data players with an explicit notice banner instead of silent empty sections.
- Home page mode continuity is complete (`home -> /stats` preserves `?mode=`).

**Intentional architecture boundary (UPDATED 2026-04-17):**

- `ea_member_season_stats` is worker-written every cycle and serves two purposes:
  1. **Player resolution** — creates `players` + `player_profiles` rows for members not yet seen in any locally ingested match, so `/roster/[id]` links work immediately.
  2. **EA Season Totals surface** — the player profile page (`/roster/[id]`) shows a clearly labeled "EA Season Totals" supplementary section drawn from this table. It is rendered SEPARATELY from local Career Stats. Mode filter does NOT apply to it.
- All other web surfaces (home, /roster table, /stats, career stats on profile) use `player_game_title_stats` (local aggregates). This split is intentional.
- **Do not re-blend sources.** `ea_member_season_stats` should never be silently substituted for local aggregates, and local counts should never be labeled as EA totals. The profile page shows both labeled independently.

**Deferred:**

- Historical/manual import model — no UI designed yet.
- Provenance/sourceType system — deferred until manual import is in scope.

**Immediate next step:**

- Do not reopen source-of-truth migration or game-mode architecture work by default.
- Start a new product-facing slice only when there is a clear user pain point.

---

## DB/Stats Rework — Phase 2 ✓ complete (2026-04-13)

**Commit:** `bb8cf38` — Phase 2: aggregate expansion

**What was done:**

Added 6 new columns to `player_game_title_stats` (migration `0003_naive_whistler.sql`):

| Column                | Type                       | Formula                                                              |
| --------------------- | -------------------------- | -------------------------------------------------------------------- |
| `shot_attempts`       | integer NOT NULL DEFAULT 0 | `SUM(pms.shot_attempts)`                                             |
| `toi_seconds`         | integer nullable           | `SUM(pms.toi_seconds)` (NULL if all source rows are NULL)            |
| `otl`                 | integer nullable           | `SUM(CASE WHEN is_goalie AND result='OTL' THEN 1 ELSE 0 END)`        |
| `total_saves`         | integer nullable           | `SUM(CASE WHEN is_goalie THEN COALESCE(saves,0) ELSE 0 END)`         |
| `total_shots_against` | integer nullable           | `SUM(CASE WHEN is_goalie THEN COALESCE(shots_against,0) ELSE 0 END)` |
| `total_goals_against` | integer nullable           | `SUM(CASE WHEN is_goalie THEN COALESCE(goals_against,0) ELSE 0 END)` |

All 6 added to the INSERT column list, SELECT, and ON CONFLICT DO UPDATE SET in `aggregate.ts`. Existing column behavior unchanged.

**Re-aggregation required after migration** — run `pnpm --filter worker reprocess --all` to populate new columns for existing data.

**Verified:** `pnpm typecheck`, `pnpm lint` — all pass; format clean on all changed source files

---

## Phase 5.3 — Player Pages ✓ complete

**What was built:**

- `packages/db/src/queries/players.ts` — three new queries:
  - `getPlayerById(playerId)` — single player row or null
  - `getPlayerCareerStats(playerId)` — all `player_game_title_stats` rows joined with `game_titles` (name + slug), ordered newest first
  - `getPlayerGamertagHistory(playerId)` — gamertag history rows ordered by `seenFrom desc`
- `apps/web/src/app/roster/[id]/page.tsx` — Server Component:
  - Accent-border header card with gamertag, position badge, last-seen date
  - Career stats table: GP / G / A / PTS / +/- / SOG / Hits / PIM / TA / GV; goalie columns (W / L / SV% / GAA) appear when any row has `wins IS NOT NULL`
  - Gamertag history section (shown only when there are closed past entries)
  - `notFound()` for invalid or missing player IDs; honest error state if DB unavailable
  - `revalidate = 3600`
- `apps/web/src/app/roster/[id]/loading.tsx` — pulse skeleton for the header + stats card
- `apps/web/src/components/roster/roster-table.tsx` — player names are now `<Link href="/roster/[id]">` with accent hover; previously plain text

**Verified:**

- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` — all pass

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

## Phase 5.6 — Mobile Responsive Pass ✓ complete

**What was changed:**

- `apps/web/src/components/nav/top-nav.tsx` — Added `sm:hidden` mobile nav row below the main header bar. Shows Home / Games / Roster / Stats as equal-width flex links with `divide-x` separators. Previously the nav was `hidden sm:flex` only — mobile users had no way to navigate between pages.
- `apps/web/src/components/roster/roster-table.tsx` — Added `overflow-x-auto` to the tab bar div. 4 tabs at `px-4` could overflow on 360px phones.
- `apps/web/src/components/matches/player-stats-table.tsx` — Reduced `min-w-[640px]` to `min-w-[520px]`. TA/GV are already `hidden sm:table-cell`; 520px is sufficient for the 11 remaining visible columns.
- `apps/web/src/app/games/[id]/page.tsx` — Score in hero scaled to `text-5xl sm:text-6xl` (separator `text-2xl sm:text-3xl`). Reduces visual crowding on narrow screens without changing the desktop layout.
- `apps/web/src/app/page.tsx` — `RecordStat` numbers scaled to `text-4xl sm:text-5xl`; `LastGameCard` scores to `text-4xl sm:text-5xl`.
- `apps/web/src/app/stats/page.tsx` — Same `RecordStat` scaling as home page.
- `apps/web/src/app/roster/[id]/page.tsx` — `ml-auto` on "Last seen" changed to `sm:ml-auto` so it flows naturally on mobile instead of wrapping to the start of a new flex line.

**What was not changed (intentionally):**

- `/games` match list — `MatchRow` already hides SOG on mobile; no change needed
- `ComparisonStrip` in game detail — `w-20` fixed columns work at all widths
- Stat cards grid — already `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`
- No structural redesign — tables still scroll horizontally; no "stack into cards" rewrite

**Verified:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` — all pass

---

## Phase 5.5 — Player Game Log ✓ complete

**What was built:**

- `packages/db/src/queries/players.ts` — `getPlayerGameLog(playerId, limit=15)`:
  - Joins `player_match_stats` ↔ `matches` on `matchId`
  - Filters by `playerId`; spans all game titles (no title filter — game log is cross-title)
  - Orders by `desc(matches.playedAt)`; default limit 15
  - Selects: `matchId`, `playedAt`, `opponentName`, `result`, `scoreFor`, `scoreAgainst`, `isGoalie`, `goals`, `assists`, `plusMinus`, `saves`, `goalsAgainst`
- `apps/web/src/app/roster/[id]/page.tsx`:
  - `getPlayerGameLog` added to the parallel `Promise.all` fetch
  - New "Recent Games" section between career stats and gamertag history
  - `GameLog` table: Date | Opponent (links to `/games/[id]`) | Result badge | Score | G | A | PTS | +/- | SV
  - Skater rows: G/A/PTS/+/- shown; SV = `—`
  - Goalie rows: G/A/PTS/+/- = `—`; SV shows save count
  - +/- colored emerald/rose/zinc like elsewhere in the site
  - Honest empty state when no games recorded

**Verified:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` — all pass

---

## Phase 5.4 — `/games` Pagination ✓ complete

**What was built:**

- `packages/db/src/queries/matches.ts`:
  - `getRecentMatches` now accepts optional `offset` param (default 0); `limit` default unchanged at 50 — callers that pass explicit limits are unaffected
  - `countMatches({ gameTitleId })` added — uses Drizzle's `count()` aggregate, returns `number`
- `apps/web/src/app/games/page.tsx`:
  - `PAGE_SIZE = 20`
  - Parses `?page=` from search params (`parsePage` helper — defaults to 1, rejects non-finite or < 1)
  - `getRecentMatches` and `countMatches` run in parallel via `Promise.all`
  - Header shows total match count (not current page slice)
  - `isMostRecent` on `MatchRow` is now `clampedPage === 1 && i === 0` — accent bar only on the globally newest match
  - `PaginationNav` component renders prev/next links with page indicator; shown only when `totalPages > 1`
  - Stale page bookmarks are safe: `clampedPage = Math.min(page, totalPages)`
  - URL scheme: `?title=nhl26&page=2` — game title param preserved across pages

**Verified:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` — all pass

**Behaviour note:** With the current 15-match dataset, `totalPages = 1` so the nav is hidden. It will appear automatically once > 20 matches are ingested.

---

## Home Page Redesign ✓ complete

**What was built:**

- **New home page layout** (`apps/web/src/app/page.tsx` — full rewrite) with stronger visual hierarchy:
  1. Compact record strip (W/L/OTL + win% + GP + GF/GA) — team context preserved but compact
  2. Latest Result hero — scoreboard-style panel with large score, opponent, result badge, stats strip (Shots/Hits/FO%/TOA), team logo watermark
  3. Featured Players carousel — curated selection of 3–6 player cards
  4. Leaders section — two-column grid (Points Leaders + Goals Leaders, top 5 each)
  5. Recent Games — unchanged (last 5 MatchRow entries)

- **New components** (all in `apps/web/src/components/home/`):
  - `player-card.tsx` — vertical card with accent top bar, position badge, gamertag hero text, 4-stat primary row (skaters: G/A/PTS/+/-, goalies: W/L/SV%/GAA), secondary stats strip
  - `player-carousel.tsx` — Client Component; CSS scroll-snap track with chevron scroll buttons (desktop only); data fetched server-side
  - `latest-result.tsx` — Server Component; scoreboard hero with `next/image` team logo watermark at `opacity-[0.04]`; links to game detail
  - `leaders-section.tsx` — Server Component; two-column `sm:grid-cols-2` layout; top-ranked row gets accent left border; player names link to `/roster/[id]`

- **Query change:** `getRoster` now selects `position: players.position` (backward-compatible addition)

- **Shared utility:** `formatPosition` extracted from `apps/web/src/app/roster/[id]/page.tsx` to `apps/web/src/lib/format.ts`; player page updated to import from shared location

- **Asset:** Team logo copied to `apps/web/public/images/bgm-logo.png` (from `docs/Branding/spd_logo_final_3.png`, transparent bg)

- **CSS:** Added `.scrollbar-hide` utility to `globals.css` for carousel track

- **Featured player selection rule** (deterministic, curated — not "all active players"):
  1. Top 3 by points
  2. Top goals scorer (if not already selected)
  3. Top hitter (if not already selected)
  4. Best goalie by wins (if any, not already selected)
     → Yields 3–6 cards depending on overlap

- **Data flow change:** Home page now fetches `getRoster` instead of `getTopPerformers`. Leaders are derived server-side by sorting the roster by points/goals and slicing to top 5. `getClubStats` retained for the record strip.

- **Removed components:** `RecordHero`, `RecordStat`, `LastGameCard`, `TopPerformersTable`, `TopPerformerRow` — all replaced by the new components

**Verified:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` (source files) — all pass

---

## Player Card + Carousel Polish ✓ complete

**What was changed:**

- **`apps/web/src/components/home/player-card.tsx`** — full redesign:
  - Visual hierarchy: position badge (top-left) + dominant hero stat number (top-right, `text-5xl font-black`) anchors the card instead of the gamertag
  - Hero stat = PTS for skaters, W (wins) for goalies — acts as a jersey-number-style visual anchor
  - Stats row now uses G / A / **PPG** / +/- (spec-compliant; previously showed +/- instead of PPG)
  - PPG computed as `points / gamesPlayed` — shown as `"1.4"` for skaters, `"—"` when 0 GP
  - SV% now displayed with `%` suffix (was showing raw DB string like `"92.75"` before)
  - Added `isActive` prop: active card gets accent border, red shadow glow, and red hero stat text
  - Goalies show L / SV% / GAA / GP in stats row; footer adjusted (no Hits for goalies)
  - Card width fixed at `w-56` (224px) for carousel compatibility

- **`apps/web/src/components/home/player-carousel.tsx`** — full rewrite (was plain horizontal scroll):
  - Now implements **stacked 3D depth carousel** with index-based positioning
  - 5 visible slots: back (±2), side (±1), center (0) — each has distinct scale, opacity, z-index
  - Slot config: ±2 = scale 0.72 / opacity 0.25; ±1 = scale 0.87 / opacity 0.62; 0 = scale 1.0 / opacity 1.0
  - 350ms ease-in-out CSS transitions on transform and opacity
  - Clicking a non-active card advances the carousel to that card; clicking active card navigates to player page
  - `pointer-events: none` on non-active card interiors (prevents Link navigation); outer div catches click
  - Side vignette masks (background gradient from `--color-background`) create the depth fade effect
  - Navigation: arrow buttons + pill dot indicators (active dot = red pill, inactive = small circle)
  - Keyboard accessible: arrow keys on the container element
  - Mobile: single card + arrows (below `sm:` breakpoint) — no stacked layout on small screens

- **`apps/web/src/app/page.tsx`** — `selectFeaturedPlayers` updated:
  - Now pads to 5 skaters (step 5 of selection) ensuring the 5-slot carousel fills symmetrically
  - Selection order: top-3 by points → top goals → top hitter → best goalie → fill to 5 skaters
  - `pick` function now accepts `RosterRow | undefined` (clean safety without non-null assertions)

**Stats fixes summary:**

- PPG was missing (showing +/- instead) → now computed and shown correctly
- SV% lacked `%` suffix → now formatted as `"92.75%"`
- GAA was already a formatted string from DB, shown correctly
- `isGoalie = wins !== null` detection was already correct — no change needed

**Remaining for future passes:**

- Latest result card: the `LatestResult` component is functional but could be enhanced with the three-panel "Team A | Score | Team B" layout from the Final Score Card spec (blocked by missing opponent logo/abbreviation/record data)
- Leaders section: the `LeadersSection` component works but the spec calls for a "featured player spotlight" per category (highlighted leader + ranked list) with more visual weight — enhancement opportunity

**Verified:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` (source files) — all pass

---

## Player Card Micro-Pass ✓ complete

**What was changed:**

- **`apps/web/src/components/home/player-card.tsx`** — targeted refinement pass:
  - **Critical bug fix:** `isGoalie` was `player.wins !== null` — incorrect because non-goalies have `wins = 0` (not NULL) after aggregation, causing every skater to render goalie stats (W / SV% / GAA). Fixed to `player.position === 'goalie'`, matching the authoritative position string established in Phase 5.2.
  - **A block rebalanced:** Removed `secondaryLine`/`secondaryDesc` (SV%/PPG labels that were overflowing outside A's border — the "rogue SV%" visible in the screenshot). Removed `recordDesc` label. Reduced hero font to `text-[22px]`. A is now `absolute` at `left-2 top-2`, self-sized to content (~75px). A/card ratio ≈ 1/4; A/B height ratio ≈ 47%, within the 40–50% target.
  - **Top section expanded:** `h-[130px]` → `h-[160px]` — gives the silhouette (zone B) more breathing room below A.
  - **Identity row centred:** Added `justify-center` to C+D flex row — platform icon and gamertag are now centred across the card width.
  - **Meta row taller:** I/J cells `h-[26px]` → `h-[40px]`; gap `gap-1` → `gap-2` — less cramped, more intentional.
  - **K slot removed:** Was showing "SO" (shutouts) spare stat. Now an empty `<div />` that reserves the grid space without rendering anything — explicitly marked "reserved for future content".

- **`apps/web/src/components/home/player-carousel.tsx`** — container height only:
  - Stage height `h-[270px]` → `h-[315px]` — direct consequence of taller card (~300px). No behavior changes.

**Verified:** `pnpm typecheck`, `pnpm lint`, `pnpm prettier --check` (source TS/TSX) — all pass

---

## Player Card Content + H Emphasis Pass ✓ complete

**What was changed:**

- **`apps/web/src/components/home/player-card.tsx`**:
  - **Zone A redesigned**: hero number zone now shows `#` (large, `text-zinc-700`) as a jersey-number placeholder; W-L-OTL and +/- removed; last line is now `win%` (goalies: personal `wins/(wins+losses)`, skaters: team club win% from new `winPct` prop, falls back to `'—'`)
  - **Zone H always featured**: `StatBox` split into `StatBox` (E/F/G) and `StatBoxFeatured` (H). Featured tile has `bg-accent/10 border-accent/30`, accent-tinted label, and `text-[15px]` value (vs `text-[13px]` for standard cells) — permanently visually distinct, not just when `isActive`
  - **Goalie H slot reordered**: GP | SV% | GAA | **W** (W moved to position H, the featured slot)
  - `winPct?: string | undefined` prop added to `PlayerCardProps`

- **`apps/web/src/components/home/player-carousel.tsx`**:
  - `winPct?: string | undefined` added to `PlayerCarouselProps`; forwarded to each `PlayerCard` in both desktop and mobile renders

- **`apps/web/src/app/page.tsx`**:
  - `clubWinPct` computed from `clubStats` (using the existing `winPct()` helper); passed to `<PlayerCarousel winPct={clubWinPct} />`

**Stats source investigation finding:**
The card IS using the correct data source — `getRoster` queries `playerGameTitleStats`, which is the full cumulative aggregate (not a recent-games slice). The stats discrepancy (card shows GP:11/PTS:33 vs ChelHead's GP:436/PTS:989 for Stick Menace) is because our DB only contains the ~15 matches ingested since worker launch. Backfilling historical data requires either the EA members-stats API or waiting for more matches to be ingested. This is a data volume gap, not a bug.

**Blocked by missing data:**

- Jersey numbers: not in EA match payloads or DB → `#` placeholder in A
- Nationality/flag: not in DB → flag outline placeholder in zone I
- Platform: not in `getRoster` → controller icon placeholder in zone C
- Full career stats: EA lifetime history not backfilled → stats reflect ingested matches only

**Verified:** `pnpm typecheck`, `pnpm lint`, `pnpm prettier --check` (source TS/TSX) — all pass

---

## Player Card Panel Construction Pass ✓ complete

**What was changed:**

- **`apps/web/src/components/home/player-card.tsx`** — structural refactor of panel layout:
  - **Zone A — no visible box:** `absolute left-0 top-0 z-20 bg-zinc-950 rounded-br-2xl`. `bg-zinc-950` matches the outer card shell exactly, making A invisible as a box — it reads as a cutout. `rounded-br-2xl` (16px) aligns with the top panel's `rounded-2xl` (16px), creating a clean concave joint.
  - **Top panel — one unified grey container:** Portrait (B, `h-130px`) and identity row (C+D) are now enclosed in a single `mx-2 mt-2 overflow-hidden rounded-2xl bg-zinc-900` block. Previously, the identity row floated between panels as a separate element. The C+D identity row is separated from the portrait by `border-t border-zinc-800/60` inside the panel.
  - **Z-layering:** Accent bar `z-30` → A `z-20` → panels in normal flow. This ensures A overlaps the panel correctly without obscuring the accent bar.
  - Card size (`w-56`) and carousel stage height (`h-315px`) unchanged.

**Verified:** `pnpm typecheck`, `pnpm lint`, `pnpm prettier --check` — all pass

---

## Player Card Finishing-Touches Pass ✓ complete

**What was changed** (`apps/web/src/components/home/player-card.tsx` only):

- **Zone A — W-L record restored:** Added `{wins}–{losses}` line for goalies (between the position pill and win%). Uses `player.wins` and `player.losses` from the aggregate; only renders when both are non-null (goalie path). Skaters have no individual record, so the line is omitted for them. Styled `text-zinc-500 text-[10px] font-semibold` — readable but secondary to the win% figure.
- **Zone A — WIN% label removed:** The redundant `text-[7px] WIN%` label below the percentage value was removed. The percentage reads clearly without it.
- **Position pill:** Converted from plain text to a proper badge — `inline-flex items-center rounded-sm bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-400`. Has background fill, padding, and rounded corners; reads as a real badge rather than plain label text.
- **Corner geometry — concave filler:** Added `relative` to the top panel div. Added a `absolute left-16 top-0 h-4 w-4 rounded-bl-2xl bg-zinc-950` filler element as the first child of the panel. This element is 16×16 at x=64px inside the panel (= 72px from the card edge = exactly A's right edge). Its `rounded-bl-2xl` carves a concave quarter-circle at its bottom-left, creating a smooth joint at the TOP of A's right edge — matching the `rounded-br-2xl` on A that handles the bottom joint. Both notch corners are now consistently rounded.
- **Hover effect:** Added `hover:-translate-y-0.5` (2px lift) and bumped hover shadow to `hover:shadow-[0_0_24px_rgba(225,29,72,0.15)]` (up from 0.10 opacity, 18px spread). Combined with the existing `hover:border-zinc-600`, the card lifts slightly and develops a subtle red glow on hover. `transition-all duration-200` animates the transform.

**Verified:** `pnpm typecheck`, `pnpm lint`, `pnpm prettier --check` — all pass

---

## Latest Result Scoreboard Redesign ✓ complete

**What was changed:**

- **`apps/web/src/lib/format.ts`** — Added `formatRecord(wins, losses, otl): string` (formats as "8–3–1") and `abbreviateTeamName(name): string` (single-word: first 4 chars; multi-word: initials capped at 4). Fixed single-word branch to slice from `words[0]` not raw `name`.

- **`apps/web/src/app/page.tsx`** — `<LatestResult>` now receives `clubRecord={{ wins, losses, otl }}` (or `null`) from the already-fetched `clubStats`. No new queries.

- **`apps/web/src/components/home/latest-result.tsx`** — Full rewrite as a symmetric 3-column scoreboard:
  - Three-column grid `grid-cols-[1fr_auto_1fr]`: our team | score + result pill | opponent
  - Left: `/images/bgm-logo.png` (next/image), `BGM` hardcoded abbreviation, W-L-OTL record
  - Center: `text-6xl sm:text-7xl` score, accent color on WIN, `ResultPill` (green=WIN / red=LOSS / orange=OT LOSS / gray=DNF)
  - Right: opponent logo from EA CDN (`https://media.contentapi.ea.com/content/dam/eacom/nhl/pro-clubs/crests/t{clubId}.png`) via plain `<img>` with `ShieldPlaceholder` SVG fallback, derived abbreviation
  - Header row: "LATEST RESULT" + date with `border-b`; stats strip footer (SOG/Hits/FO%/TOA) with `border-t`
  - `border-t-2 border-t-accent` top bar (replaces old asymmetric `border-l-4`)

- **`apps/web/src/app/layout.tsx`** — Added font weight `'900'` to `Barlow_Semi_Condensed` so `font-black` renders from the actual font file (was being synthesized from 700).

- **`apps/web/src/app/loading.tsx`** — Updated home page skeleton for the last-game section from `h-24` to `h-56` to match new card height.

**Intentionally omitted:** opponent record (not tracked), GWG (not derivable from per-game totals), OT vs SO distinction (both stored as `OTL`).

**EA logo CDN confirmed:** `https://media.contentapi.ea.com/content/dam/eacom/nhl/pro-clubs/crests/t{clubId}.png` — clubs without custom crests serve the default NHL shield; never 404s. No `next.config.ts` change needed.

**Verified:** `pnpm typecheck`, `pnpm lint`, `pnpm prettier --check "apps/web/src/**"` — all pass.

### Latest Result Scoreboard Refinement Pass ✓ complete

**What was changed:**

- **`apps/web/src/components/home/latest-result.tsx`** — tightened the featured card into a cleaner scoreboard-style hero without widening scope beyond the latest-result section:
  - kept the symmetric 3-column structure
  - strengthened the top accent treatment with a full-width red gradient bar
  - upgraded the side panels into mirrored logo + abbreviation blocks with more deliberate spacing and symmetry
  - kept the centered score as the focal point, with the result pill directly below it
  - kept the stats strip visually secondary as a demoted "Match Snapshot" grid
  - continued to omit opponent record and GWG honestly because the data is not available
  - shows opponent full name as secondary text while still using a derived abbreviation
- **`apps/web/src/lib/format.ts`** — made `abbreviateTeamName()` more conservative by cleaning punctuation and ignoring filler words like `the`, `of`, `la`, and `de` when deriving initials.
- **`apps/web/src/app/page.tsx`** — extracted `latestClubRecord` before rendering and passed it directly into `<LatestResult />`; no new DB queries or homepage redesign work.

**Verified:**

- `pnpm typecheck` — passes
- `pnpm lint` — passes
- `pnpm format:check` — still fails due pre-existing formatting drift in markdown docs and `HANDOFF.md`; the updated TS/TSX files for this pass were formatted successfully

**Real data used:**

- our logo: `/images/bgm-logo.png`
- our abbreviation: hardcoded `BGM`
- our record: `clubStats.wins`, `clubStats.losses`, `clubStats.otl`
- score: `match.scoreFor`, `match.scoreAgainst`
- result pill: `match.result`
- opponent logo: EA crest CDN using `match.opponentClubId`
- opponent abbreviation: conservative derivation from `match.opponentName`
- demoted stats strip: `shotsFor/shotsAgainst`, `hitsFor/hitsAgainst`, `faceoffPct`, `timeOnAttack`

**Intentionally omitted:**

- opponent record — not available in current data model
- GWG scorer — not derivable from current stored match data

---

## DB Roadmap Phase 1 — Implementation ✓ complete (2026-04-17)

### Area 1: Local dual-role aggregate fix ✓

Added `skater_gp`, `goalie_gp`, `skater_toi_seconds`, `goalie_toi_seconds` to `player_game_title_stats` (migration `0007_flaky_ultimo.sql`). Worker aggregate updated with CASE COUNT/SUM expressions. `reprocess --all` ran to backfill.

Role-specific GP is now used everywhere:

- Roster page tabs (Scoring/Possession/Physical → `skaterGp`; Goalie → `goalieGp`)
- Home page player carousel (`skaterGp` for skaters, `goalieGp` for goalies)
- Player career stats table (`skaterGp` in skater GP column; `goalieGp` as G-GP goalie column)
- `getRoster` query exposes both fields

### Area 2: Official EA club record ✓ complete (2026-04-17)

**Source confirmed:** `clubs/seasonalStats?platform=common-gen5&clubIds=19224` — returns an array; club data is the array element with `clubId = "19224"`. Confirmed fields: `wins`, `losses`, `otl`, `record`, `rankingPoints`, `goals`, `goalsAgainst`.

**What was built:**

- `packages/ea-client/src/types.ts`: `EaClubSeasonalStats` (array element type), `EaClubSeasonalStatsResponse = EaClubSeasonalStats[]`
- `packages/ea-client/src/endpoints.ts`: `fetchSeasonalStats({ platform, clubId, baseUrl? })` — GET `clubs/seasonalStats`; finds club by `clubId` field
- `packages/db/src/schema/club-seasonal-stats.ts`: new table `club_seasonal_stats` — one upsert row per game title (`wins`, `losses`, `otl`, `gamesPlayed=wins+losses+otl`, `record`, `rankingPoints`, `goals`, `goalsAgainst`, `fetchedAt`). Unique on `game_title_id`.
- Migration `0009_little_skullbuster.sql` applied.
- `packages/db/src/queries/club.ts`: `getOfficialClubRecord(gameTitleId)` — returns the row or null (never falls back to local count).
- `apps/worker/src/ingest-members.ts`: `fetchAndStoreSeasonalStats(title)` — called after member stats in each ingestion cycle; upserts into `club_seasonal_stats`; non-fatal on failure.
- `apps/web/src/app/page.tsx`: `RecordStrip` uses official record for W/L/OTL/GP when available; falls back to local when null. Ranking points shown if present. GF/GA remain from local match data. Mode-filtered views (`?mode=6s/3s`) still use local mode-specific aggregate (EA endpoint is all-modes only).

**First snapshot captured:** `283-188-20` (1658 pts). Ingestion log confirms `[seasonal] nhl26: 283-188-20 (1658 pts)`.

**Home page effect:** Club Record strip now shows the real EA official record instead of the ingested-match-only count (was 8-6-0; now 283-188-20).

### Area 3: Positional lineup filtering ✓

- CHECK constraint on `player_match_stats.position` (confirmed 5 EA values)
- Composite index `player_match_stats_lineup_idx` on `(match_id, position, player_id)`
- `getMatchesWithLineup(gameTitleId, conditions[])` query in `packages/db/src/queries/matches.ts` — self-join per condition, parameterized via `sql` template

Both in migration `0007_flaky_ultimo.sql`.

---

## Local Aggregate Migration ✓ complete (2026-04-17)

All web surfaces migrated from `ea_member_season_stats` (EA baseline) to `player_game_title_stats` (local aggregates). `ea_member_season_stats` is now worker-written only — retained for debug/baseline comparison and player resolution (creates player rows for members not yet in any ingested match).

**Commits:** efb06eb (home + /roster), 0c85364 (/stats), d8b91da (dead-code cleanup), bca16d8 (docs/retention decision), a534280 (member-only profile fix)

**What changed:**

- Home page carousel and `/roster` use `getRoster` with `skaterGp`/`goalieGp` denominators
- `/stats` uses `getSkaterStats`/`getGoalieStats` — filter `skaterGp > 0` / `goalieGp > 0` (replaces `favoritePosition` EA approach; correctly handles dual-role players)
- All surfaces support `?mode=` URL param (`All / 6s / 3s`)
- `getEAMemberRoster` removed (dead code)
- `/roster/[id]` shows an informational notice when a player has no local match history yet (e.g. `joseph4577` who exists only from member ingest). `hasNoLocalData = careerStats.length === 0 && gameLog.length === 0` triggers the banner.

---

## Game Mode Aggregate Dimension ✓ complete (2026-04-17)

Migration `0008_lowly_vindicator.sql`. All checks pass. `reprocess --all` ran (15/15 succeeded).

**What was done:**

- Added `game_mode text` (nullable) to both `player_game_title_stats` and `club_game_title_stats`
- Replaced column-level `.unique()` on `club_game_title_stats.game_title_id` with table-level functional unique indexes using `COALESCE(game_mode, '')` to handle NULL (all-modes row) safely
  - `player_game_title_stats_uniq`: `UNIQUE (player_id, game_title_id, COALESCE(game_mode, ''))`
  - `club_game_title_stats_uniq`: `UNIQUE (game_title_id, COALESCE(game_mode, ''))`
- `recomputeAggregates` now loops over `[null, '6s', '3s']` — each pass writes its own row set; empty-mode queries emit 0 rows (no fabricated rows)
- `ON CONFLICT` in both player and club aggregate SQL updated to reference the functional index expression
- All local aggregate query functions gain an optional `gameMode?: GameMode | null` parameter (default `null` = all-modes row):
  - `getRoster`, `getPlayerCareerStats`, `getTopPerformers` in `players.ts`
  - `getClubStats` in `club.ts`
  - **Required fix**: without the gameMode filter, these queries would now return 3× rows (null + 6s + 3s). Default `null` preserves existing caller behavior unchanged.

**Verified row distribution after reprocess:**

```
player_game_title_stats:
  game_mode=NULL: 12 rows (all-modes combined)
  game_mode=6s:   12 rows
  game_mode=3s:    3 rows (only players who appeared in the 2 three-on-three matches)

club_game_title_stats:
  game_mode=NULL: 15 GP, 8W-6L (all-modes)
  game_mode=6s:   13 GP, 7W-5L
  game_mode=3s:    2 GP, 1W-1L
```

Cross-check: 7W+1W=8W ✓, 5L+1L=6L ✓, 11+2=13(6s)+2(3s) GP but all-modes=15 because 0 matches are club_private with a game_mode. Wait — club_private matches have `game_mode=NULL`. The all-modes combined row includes those too. ✓

**What is not yet mode-aware:**

- All web surfaces (`/stats`, `/roster`, home, player profile) now use local aggregates (`player_game_title_stats`) — `ea_member_season_stats` is worker-written only (debug/baseline + player resolution)
- All major surfaces support `All / 6s / 3s` mode filtering via `?mode=` URL param
- `ea_member_season_stats` write path is intentionally kept: provides structured EA season totals for baseline comparison and creates player rows for members not yet in any ingested match

---

## Home Page Polish — 2026-04-17 ✓

### Task 2: Club Record Honesty Fix ✓

Removed the silent fallback in the Club Record strip that presented local W/L/OTL as if it were the official EA record.

- `apps/web/src/app/page.tsx`: Three-branch rendering: `RecordStrip` (official EA, no fallback) / `OfficialRecordUnavailable` (honest unavailable state + local GF/GA) / `LocalModeRecordStrip` (mode-filtered local only, labeled "local · {mode} only").
- Mode-filtered (`?mode=6s/3s`) views now show local aggregate clearly labeled and never substitute EA official data.

### Task 3: Opponent Club Logo Pipeline ✓

Full opponent crest pipeline from EA `clubs/info` endpoint.

**What was built:**

- `packages/ea-client/src/types.ts`: `EaClubInfoEntry`, `EaClubInfoResponse`
- `packages/ea-client/src/endpoints.ts`: `fetchClubInfo({ platform, clubIds[] })`
- `packages/db/src/schema/opponent-clubs.ts`: `opponent_clubs` table — one upsert row per unique opponent EA club ID; `crest_asset_id` nullable
- Migration `0010_glamorous_harpoon.sql` applied
- `packages/db/src/queries/club.ts`: `getOpponentClub(eaClubId)` — returns null when not yet fetched
- `apps/worker/src/ingest-opponents.ts`: fetches only NEW opponents per cycle (compares against existing rows); skips our own club ID
- `apps/worker/src/ingest.ts`: wired after seasonal stats, non-fatal
- `apps/web/src/lib/format.ts`: `opponentCrestUrl(crestAssetId)` helper
- `apps/web/next.config.ts`: remote image pattern for `media.contentapi.ea.com`
- `apps/web/src/components/home/latest-result.tsx`: 96×96 opponent crest with initial-badge fallback; removed club record from opponent side (not available)
- `apps/web/src/app/games/[id]/page.tsx`: 40×40 crest inline with opponent name in HeroSection

**Design principle:** Boogeymen always use `/images/bgm-logo.png`. Opponent crests come from EA CDN only. The EA crest URL pattern is `https://media.contentapi.ea.com/content/dam/eacom/nhl/pro-clubs/custom-crests/{crestAssetId}.png`.

### Task 4: Season Rank / Division Widget ✓

Home page widget showing competitive division standing from EA `clubs/seasonRank` + `settings`.

**What was built:**

- `packages/ea-client/src/types.ts`: `EaClubSeasonRankEntry`, `EaClubSeasonRankResponse`, `EaSettingsDivisionEntry`, `EaSettingsResponse` (all UNVERIFIED — sourced from HAR analysis)
- `packages/ea-client/src/endpoints.ts`: `fetchSeasonRank({ platform, clubId })`, `fetchSettings({ platform })`
- `packages/db/src/schema/club-season-rank.ts`: `club_season_rank` — one upsert per game title. Stores season W/L/OTL (NOT all-time), points, projectedPoints, currentDivision, divisionName, pointsForPromotion, pointsToHoldDivision, pointsToTitle, fetchedAt.
- Migration `0011_flashy_lyja.sql` applied.
- `packages/db/src/queries/club.ts`: `getClubSeasonRank(gameTitleId)` — returns null when no row yet.
- `apps/worker/src/ingest-season-rank.ts`: fetches `seasonRank`, joins `settings` by division number for thresholds, upserts combined row. Non-fatal.
- `apps/worker/src/ingest.ts`: wired as last step in cycle.
- `apps/web/src/components/home/season-rank-widget.tsx`: Server Component. Shows division name, current points + projected, season W/L/OTL row (labeled "Season" — not confused with all-time record), threshold rows (Title / Promotion / Hold division) with checkmarks when met and +delta when not.
- `apps/web/src/app/page.tsx`: fetches `getClubSeasonRank`, renders `SeasonRankWidget` between Club Record and Latest Result. Widget hidden when no row exists (first ingest populates it).

**Critical design note:** `club_season_rank.wins/losses/otl` are SEASON-SPECIFIC — the current ranking period only. The all-time official record lives in `club_seasonal_stats` (from `clubs/seasonalStats`). These must never be conflated.

**UNVERIFIED:** All field names from `clubs/seasonRank` and `settings` responses. Defensive `parseIntOrNull` throughout; all EA fields treated as optional. The widget degrades gracefully to partial display when any field is absent.

---

## What's Next

- **EA Season Totals on profile** — done. `/roster/[id]` now has a clearly labeled "EA Season Totals" section sourced from `ea_member_season_stats`. Separate from local Career Stats. Not mode-filtered. `getPlayerEASeasonStats(playerId)` added to `packages/db/src/queries/players.ts`.
- **Game log pagination** — done. `?logPage=` URL param, 20 per page, preserves `?mode=`, prev/next nav, "X–Y of Z" count, out-of-bounds page state. Will activate visually once any player exceeds 20 ingested games.
- **Discord alerting** — cron checks `localhost:3001/health`, notifies when stale > 30 min
- **`pg_dump` backup cron** — daily dump to external drive
- **Content season filtering** — schema supports it, no UI yet
- **Expose mode filter in UI** — `getClubStats('6s')` and `getRoster('6s')` are now available; a UI mode toggle on the stats/roster pages can now wire to these queries
- **Verify `clubs/seasonRank` + `settings` response shapes** — once the worker runs with the new endpoints, inspect the DB row and worker logs to confirm field names and values match what the widget expects. UNVERIFIED fields in `EaClubSeasonRankEntry` and `EaSettingsDivisionEntry` need a fixture capture pass.

### Post-launch / later work

- Charts / trends (Recharts)
- Streak tracking, head-to-head records
- Historical season import (manual entry model not yet designed)

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
