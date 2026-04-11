# EASHL Team Stats Website — Architecture & Implementation Plan (v2)

## Context

Stats/analytics website for EASHL club **#19224** (platform: common-gen5). The core challenge: EA's Pro Clubs API is **undocumented, unstable, and only exposes ~5 recent matches**. The system must continuously poll and archive — miss a match window and that data is gone forever.

**Audience:** Handful of team members. Self-hosted on a spare home PC running 24/7.

**Key insight from feedback:** The primary data grouping is by **game title** (NHL 25, NHL 26, NHL 27...), NOT in-game seasons. Players want cross-game career stats. In-game seasons (battlepasses, ~5/year) are secondary metadata.

---

## 1. System Architecture

### Components

| Component                            | Role                            | Technology                    |
| ------------------------------------ | ------------------------------- | ----------------------------- |
| **Web App** (`apps/web`)             | Frontend + API routes           | Next.js 15 (App Router)       |
| **Worker** (`apps/worker`)           | Polling, ingestion, aggregation | Standalone Node.js process    |
| **Database**                         | System of record                | PostgreSQL 16 (local)         |
| **Shared DB** (`packages/db`)        | Schema, migrations, queries     | Drizzle ORM                   |
| **EA Client** (`packages/ea-client`) | EA API wrapper + retry          | Standalone TypeScript package |

### No Separate `apps/api`

Next.js handles the tiny API surface (~4 read endpoints) via API routes and Server Components. No separate service needed.

**Extraction trigger:** If a second consumer appears (Discord bot, mobile client, public API), extract a standalone API at that point. Until then, YAGNI.

### Deployment: Docker Compose (self-hosted)

Everything runs on one home machine via Docker Compose:

- `web` container: Next.js app
- `worker` container: ingestion process
- `db` container: PostgreSQL with a named volume for persistence

No cloud dependencies. Backups via `pg_dump` cron to a local or external drive.

### Data Flow

```
EA Pro Clubs API
       │
       ▼
   ┌─────────┐     ┌──────────────────┐
   │  Worker  │────▶│  raw_payloads    │  (store first, parse second)
   │ (polling)│     │  (JSONB)         │
   └─────────┘     └────────┬─────────┘
                            │ transform
                            ▼
                   ┌──────────────────┐
                   │  matches         │
                   │  player_stats    │
                   │  players         │
                   └────────┬─────────┘
                            │ aggregate
                            ▼
                   ┌──────────────────┐
                   │  player_game_agg │
                   │  club_game_agg   │
                   └────────┬─────────┘
                            │
                            ▼
                   ┌──────────────────┐
                   │  Next.js Web App │
                   └──────────────────┘
```

---

## 2. Repository Structure

```
eanhl-team-website/
├── apps/
│   ├── web/                        # Next.js 15
│   │   ├── src/
│   │   │   ├── app/                # App Router pages
│   │   │   │   ├── (main)/         # Route group: home, stats, roster, scores
│   │   │   │   ├── games/          # /games and /games/[id]
│   │   │   │   └── api/            # API routes (client fetches only)
│   │   │   ├── components/
│   │   │   ├── lib/
│   │   │   └── styles/
│   │   ├── public/
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── worker/                     # Ingestion worker
│       ├── src/
│       │   ├── index.ts            # Entry point + non-overlapping scheduler
│       │   ├── ingest.ts           # Core ingestion loop
│       │   ├── transform.ts        # Raw → structured transformation
│       │   ├── aggregate.ts        # Recompute aggregates
│       │   └── reprocess.ts        # Reprocess failed raw payloads
│       ├── tsconfig.json
│       └── package.json
│
├── packages/
│   ├── db/
│   │   ├── src/
│   │   │   ├── schema/             # Drizzle table definitions
│   │   │   ├── migrations/         # SQL migrations
│   │   │   ├── queries/            # Reusable query functions
│   │   │   ├── client.ts
│   │   │   └── index.ts
│   │   ├── drizzle.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── ea-client/
│       ├── src/
│       │   ├── client.ts           # HTTP client + retry + backoff + throttle
│       │   ├── endpoints.ts        # Typed endpoint functions
│       │   ├── types.ts            # EA API response types
│       │   └── index.ts
│       ├── __fixtures__/           # Real EA API response snapshots for tests
│       ├── tsconfig.json
│       └── package.json
│
├── docker-compose.yml              # web + worker + postgres
├── Dockerfile.web
├── Dockerfile.worker
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── .env.example
├── CLAUDE.md
└── README.md
```

### Monorepo Tooling

- **pnpm** workspaces
- **Turborepo** for build orchestration
- **TypeScript** project references with shared base config

---

## 3. Database Design

### 3.1 Design Principles

1. **Raw first, parse second.** Every EA response is stored verbatim before transformation.
2. **Game title is the top-level grouping.** NHL 25, NHL 26, etc. In-game seasons are secondary metadata on matches, not a core organizational axis.
3. **Model from our club's perspective.** Single-club system — matches stored as "we played X."
4. **Precomputed aggregates** per game title (and optionally per in-game season).
5. **Nullable goalie fields, not table inheritance.** Single `player_match_stats` table.
6. **EA ID is the player identity anchor.** Gamertags may change; ea_id is the stable key.

### 3.2 Schema

```
┌──────────────────────────────┐
│ game_titles                  │  NHL 25, NHL 26, NHL 27...
├──────────────────────────────┤
│ id (serial PK)               │
│ slug (text, unique)          │  'nhl25', 'nhl26'
│ name (text)                  │  'NHL 25'
│ ea_platform (text)           │  'common-gen5'
│ ea_club_id (text)            │  '19224' (can differ per game)
│ api_base_url (text)          │  EA API base (may change per title)
│ is_active (boolean)          │
│ launched_at (date)           │
└──────────────────────────────┘

┌──────────────────────────────┐
│ raw_match_payloads           │  Immutable archive
├──────────────────────────────┤
│ match_id (PK, text)          │
│ game_title_id (FK)           │
│ match_type (text)            │  'gameType5', 'gameType10', 'club_private'
│ source_endpoint (text)       │  Full URL that produced this payload
│ payload (jsonb)              │  Unmodified EA response
│ payload_hash (text)          │  SHA-256 of payload for dedup/change detection
│ schema_version (int)         │  Track format changes within a game title
│ transform_status (text)      │  'pending' / 'success' / 'error'
│ transform_error (text, null) │  Error message if transform failed
│ ingestion_log_id (FK, null)  │  Which ingestion run captured this
│ ingested_at (timestamptz)    │
└──────────────────────────────┘

┌──────────────────────────────┐
│ matches                      │  One row per game played
├──────────────────────────────┤
│ id (text PK)                 │  EA matchId
│ game_title_id (FK)           │
│ match_type (text)            │
│ in_game_season (int, null)   │  e.g. 4 for "Season 4" (secondary metadata)
│ opponent_club_id (text)      │
│ opponent_name (text)         │
│ played_at (timestamptz)      │
│ result (text)                │  WIN / LOSS / OTL / DNF
│ score_for (int)              │
│ score_against (int)          │
│ shots_for (int)              │
│ shots_against (int)          │
│ hits_for (int)               │
│ hits_against (int)           │
│ faceoff_pct (numeric)        │
│ time_on_attack (int)         │  seconds
│ penalty_minutes (int)        │
└──────────────────────────────┘

┌──────────────────────────────┐
│ players                      │
├──────────────────────────────┤
│ id (serial PK)               │
│ ea_id (text, unique)         │  blazeId — stable primary identity
│ gamertag (text)              │  Current display name (updated on ingest)
│ position (text)              │  Most recent position played
│ is_active (boolean)          │
│ first_seen_at (timestamptz)  │
│ last_seen_at (timestamptz)   │
└──────────────────────────────┘
  Note: If ea_id proves unstable or absent for some
  players, fall back to gamertag-based matching and
  log a warning. See §3.3 for identity strategy.

┌──────────────────────────────┐
│ player_gamertag_history      │  Track name changes
├──────────────────────────────┤
│ id (serial PK)               │
│ player_id (FK)               │
│ gamertag (text)              │
│ seen_from (timestamptz)      │
│ seen_until (timestamptz,null)│
└──────────────────────────────┘

┌──────────────────────────────┐
│ player_match_stats           │  Per-game individual stats
├──────────────────────────────┤
│ id (serial PK)               │
│ player_id (FK)               │
│ match_id (FK)                │
│ position (text)              │  Position played THIS game
│ is_goalie (boolean)          │
│ -- Skater fields --          │
│ goals (int)                  │
│ assists (int)                │
│ plus_minus (int)             │
│ shots (int)                  │
│ hits (int)                   │
│ pim (int)                    │
│ takeaways (int)              │
│ giveaways (int)              │
│ faceoff_wins (int)           │
│ faceoff_losses (int)         │
│ pass_attempts (int)          │
│ pass_completions (int)       │
│ -- Goalie fields (nullable)--│
│ saves (int)                  │
│ ga (int)                     │  goals against
│ sa (int)                     │  shots against
│ UNIQUE(player_id, match_id)  │
└──────────────────────────────┘

┌──────────────────────────────┐
│ player_game_title_stats      │  Aggregates per game title (PRIMARY)
├──────────────────────────────┤
│ id (serial PK)               │
│ player_id (FK)               │
│ game_title_id (FK)           │
│ games_played (int)           │
│ goals, assists, points (int) │
│ plus_minus, shots, hits (int)│
│ pim, takeaways, giveaways    │
│ faceoff_pct (numeric)        │
│ pass_pct (numeric)           │
│ -- Goalie (nullable) --      │
│ wins, losses (int)           │
│ save_pct (numeric)           │
│ gaa (numeric)                │
│ shutouts (int)               │
│ UNIQUE(player_id, game_title_id) │
└──────────────────────────────┘

┌──────────────────────────────┐
│ club_game_title_stats        │  Club aggregates per game title
├──────────────────────────────┤
│ id (serial PK)               │
│ game_title_id (FK)           │
│ games_played (int)           │
│ wins, losses, otl (int)      │
│ goals_for, goals_against     │
│ shots_per_game (numeric)     │
│ hits_per_game (numeric)      │
│ faceoff_pct (numeric)        │
│ pass_pct (numeric)           │
│ UNIQUE(game_title_id)        │
└──────────────────────────────┘

┌──────────────────────────────┐
│ ingestion_log                │  Observability
├──────────────────────────────┤
│ id (serial PK)               │
│ game_title_id (FK)           │
│ started_at (timestamptz)     │
│ finished_at (timestamptz)    │
│ match_type (text)            │
│ matches_found (int)          │
│ matches_new (int)            │
│ transforms_failed (int)      │
│ status (text)                │  success / partial / error
│ error_message (text, null)   │
└──────────────────────────────┘
```

### 3.3 Player Identity Strategy

**Primary key:** `ea_id` (blazeId from EA API). This is the most stable identifier available.

**Gamertag changes:** On each ingestion, compare the gamertag in the API response to the stored value. If different:

1. Update `players.gamertag` to the new name
2. Close the previous `player_gamertag_history` entry (`seen_until = now`)
3. Insert a new history row

**Fallback if `ea_id` is absent:** Some API responses may not include blazeId. In this case, fall back to gamertag matching and log a warning. This is a degraded path — duplicates are possible if a player changes their name while ea_id is unavailable.

**Phase 1 action:** During initial EA API exploration, verify that blazeId is present and consistent across match data and member stats endpoints. Document findings before implementing the player upsert.

### 3.4 Game Titles vs In-Game Seasons

The `game_titles` table is the top-level grouping (NHL 25, NHL 26...). Each contains:

- The EA platform and club ID for that game (in case they differ across titles)
- The API base URL (EA may change endpoints per release)

In-game seasons are stored as a simple integer on `matches.in_game_season`. This is secondary metadata — useful for filtering ("show me Season 4 games") but not the primary axis for stats. Aggregates are computed per game title, not per in-game season.

**If per-season aggregates become wanted later:** Add `player_season_stats` and `club_season_stats` tables with a `(game_title_id, in_game_season)` composite key. The raw data to compute them is always available.

### 3.5 Why Manual Season/Game Title Management

Seasons and game titles are configured manually via the database or an admin endpoint. There's no way to auto-detect them from the EA API. For MVP:

- Seed `game_titles` with the current game (NHL 26)
- Add past games (NHL 25) when historical data import is prioritized
- Set `in_game_season` on matches based on date ranges (configurable per game title)

---

## 4. Ingestion Strategy

### 4.1 Non-Overlapping Polling Loop

The worker uses a **non-overlapping scheduler** — not `setInterval`. If an ingestion cycle takes longer than the interval, the next cycle waits until the current one finishes.

```typescript
async function runLoop() {
  while (true) {
    const start = Date.now()
    await runIngestionCycle() // never runs concurrently with itself
    const elapsed = Date.now() - start
    const delay = Math.max(0, POLL_INTERVAL_MS - elapsed)
    await sleep(delay)
  }
}
```

**Poll interval:** 5 minutes (configurable via env var). Rationale unchanged — a 6v6 game takes ~20 minutes, 5 min catches everything without excessive API requests.

### 4.2 Ingestion Cycle

```
for each matchType in ['gameType5', 'gameType10', 'club_private']:
  1. Create ingestion_log entry (started_at = now)
  2. Fetch matches from EA API (with throttle: 1 req/sec between endpoints)
  3. For each match in response:
     a. Compute payload_hash (SHA-256)
     b. INSERT raw_match_payloads ON CONFLICT (match_id) DO NOTHING
     c. If new payload was inserted:
        - Attempt transform → upsert matches + player_match_stats
        - Set transform_status = 'success' or 'error'
        - If error: store error message, increment transforms_failed counter
  4. Recompute aggregates for current game title
  5. Update ingestion_log (finished_at, counts, status)
```

### 4.3 Worker-Side Request Throttling

Even without a separate cache layer:

- **Endpoint spacing:** 1 second delay between EA API calls within a cycle
- **Club lookup:** Cache the club search result in memory (refreshed once per worker restart, or every 24h). This avoids repeated lookups for our own club.
- **Per-endpoint backoff:** If an endpoint returns 429 or 5xx, apply exponential backoff (`2^attempt * 500ms + jitter`, max 3 retries) for THAT endpoint only. Don't halt the entire cycle.

### 4.4 Reprocessing Failed Transforms

If a raw payload is saved but its transform fails (due to a bug, unexpected format, etc.):

1. The `transform_status = 'error'` flag on `raw_match_payloads` marks it as needing reprocessing
2. After a code fix, run: `pnpm --filter worker reprocess`
3. This command queries all `transform_status = 'error'` rows and re-runs the transform pipeline
4. On success: updates status to `'success'`, inserts structured data
5. On failure: updates `transform_error` with the new error

This is a **CLI command** in the worker, not an automatic retry. Transform errors usually mean the code needs fixing, not that retrying will help.

### 4.5 Data Integrity

- **Idempotent:** Upserts everywhere. Running the same cycle twice is safe.
- **Raw-first:** Payload stored BEFORE any transform attempt. Data is never lost.
- **Transaction per match:** Transform + structured insert in a single transaction.
- **payload_hash:** Enables detecting if EA ever changes a payload for the same match_id (should never happen, but documents the assumption).

---

## 5. Data Modeling: Raw vs Transformed vs Aggregated

| Layer           | Table(s)                                           | Purpose                                 | Write                  | Read                       |
| --------------- | -------------------------------------------------- | --------------------------------------- | ---------------------- | -------------------------- |
| **Raw**         | `raw_match_payloads`                               | Immutable archive + reprocessing source | Append-only            | Debugging, reprocessing    |
| **Transformed** | `matches`, `player_match_stats`, `players`         | Structured per-game data                | Upsert on ingest       | Game pages, recent results |
| **Aggregated**  | `player_game_title_stats`, `club_game_title_stats` | Precomputed rollups                     | Recompute after ingest | Stats, roster, home page   |

**Recompute strategy:** After each ingestion cycle, recompute the current game title's aggregates via `INSERT ... ON CONFLICT UPDATE` from a `GROUP BY` query. Milliseconds at this data volume.

---

## 6. Backend API Design

Most pages use Server Components querying `packages/db` directly. API routes exist only for client-side interactivity.

### Endpoints

```
GET /api/games?gameTitle=nhl26&season=4  → Paginated match list
GET /api/games/[id]                      → Match detail + player stats
GET /api/players?gameTitle=nhl26         → Roster with aggregated stats
GET /api/players/[id]                    → Player detail + game log + career stats
GET /api/club?gameTitle=nhl26            → Club stats for a game title
GET /api/game-titles                     → List of game titles
GET /api/health                          → Worker status (last successful ingestion)
```

### Server Component Data Access

```typescript
// app/games/page.tsx
import { getRecentMatches } from '@eanhl/db/queries'
const matches = await getRecentMatches({ gameTitleId, limit: 20 })
```

---

## 7. Frontend Architecture

### Tech Stack

- **Next.js 15** — App Router, Server Components
- **Tailwind CSS 4** — Utility-first
- **shadcn/ui** — Component primitives, customized to brand
- **Recharts** — Charts (Phase 2)

### Page Structure

```
/ (home)
├── /stats              → Club stats for current game title
├── /roster             → Player stats table with tabs
├── /roster/[id]        → Individual player (Phase 2)
├── /games              → Chronological game list
└── /games/[id]         → Game detail / box score
```

All pages include a **game title selector** in the nav (NHL 26 / NHL 25 / etc.) as the top-level filter. This is the primary navigation axis.

### Brand Direction

Dark theme (always-on, no toggle), red accents, sharp/aggressive esports aesthetic. Scoreboard-style cards, high contrast, minimal decoration.

---

## 8. Caching Strategy

### No Redis. No CDN. Here's what we do instead:

**Frontend (Next.js):**

| Data                   | Strategy      | TTL                                   |
| ---------------------- | ------------- | ------------------------------------- |
| Club/player aggregates | `revalidate`  | 300s                                  |
| Match list             | `revalidate`  | 300s                                  |
| Match detail           | `force-cache` | Indefinite (match data never changes) |
| Player list            | `revalidate`  | 3600s                                 |

**Worker-side throttling (NOT caching, but reduces API risk):**

| Concern              | Strategy                                                  |
| -------------------- | --------------------------------------------------------- |
| Club lookup          | In-memory cache, refresh every 24h or on restart          |
| Inter-request delay  | 1 second between EA API calls                             |
| Per-endpoint backoff | Exponential backoff on 429/5xx, per-endpoint (not global) |
| Concurrent requests  | None — sequential within each ingestion cycle             |

No separate cache infrastructure is justified for a handful of users hitting a local PostgreSQL.

---

## 9. Failure Modes & Resilience

### EA API Failures

| Failure                     | Detection            | Response                                                              |
| --------------------------- | -------------------- | --------------------------------------------------------------------- |
| **429 rate limit**          | HTTP status          | Per-endpoint exponential backoff (3 retries)                          |
| **5xx server error**        | HTTP status          | Same backoff                                                          |
| **400 bad request**         | HTTP status          | Log, skip this match type this cycle                                  |
| **Schema change**           | Transform throws     | Raw payload saved. `transform_status = 'error'`. Fix code, reprocess. |
| **API offline permanently** | Consecutive failures | System becomes read-only archive. All historical data preserved.      |
| **URL/auth change**         | 403 / consistent 404 | Manual intervention. Biggest long-term risk.                          |

### Worker Down During Active Play Window (Recovery Plan)

This is the single biggest operational risk. If the worker is down while matches are being played and >5 games pass, data is lost.

**Detection:**

- `ingestion_log` query: `SELECT MAX(finished_at) FROM ingestion_log WHERE status = 'success'`
- Worker exposes a `/health` HTTP endpoint reporting last successful ingest time
- Simple cron script checks this endpoint every 15 minutes and sends a notification (email, Discord webhook, push notification) if no successful ingest in 30 minutes

**Recovery:**

- Docker Compose `restart: always` auto-restarts crashed workers
- Manual trigger: `pnpm --filter worker ingest-now` forces an immediate ingestion cycle outside the regular schedule
- If matches were truly missed: no automated recovery possible (EA API doesn't serve them anymore). Log the gap.

### Transform Failures

Raw payloads with `transform_status = 'error'` are queryable. After fixing the bug:

```bash
pnpm --filter worker reprocess   # retries all failed transforms
```

---

## 10. Tradeoffs vs Blueprint

| Topic                    | Blueprint              | This Plan                                                           | Reasoning                                        |
| ------------------------ | ---------------------- | ------------------------------------------------------------------- | ------------------------------------------------ |
| **Services**             | 3 (web + API + worker) | 2 (web + worker)                                                    | API extracted only if a second consumer appears  |
| **Primary grouping**     | In-game seasons        | Game titles (NHL 25/26/27)                                          | Cross-game career stats are the core requirement |
| **Deployment**           | Unspecified            | Docker Compose on home PC                                           | Self-hosted, no cloud costs, all-in-one          |
| **Worker scheduler**     | "cron / setInterval"   | Non-overlapping async loop                                          | Prevents concurrent ingestion runs               |
| **Raw payload tracking** | match_id + json_blob   | + source_endpoint, payload_hash, transform_status, ingestion_log_id | Enables reprocessing, dedup, debugging           |
| **Player identity**      | Basic fields           | ea_id as primary key + gamertag_history table                       | Handles name changes without losing identity     |
| **Monitoring**           | Vague "track failures" | ingestion_log table + health endpoint + alerting script             | Concrete, queryable, actionable                  |
| **Store/News/Video**     | Included               | Deferred                                                            | Not part of MVP. Build when content exists.      |

---

## 11. Risks, Unknowns & Assumptions

### Risks

1. **EA API disappears or changes auth** — System becomes read-only archive. Raw data preserved.
2. **Match window exceeded** — Worker down too long during active play = permanent data loss. Mitigated by auto-restart + alerting.
3. **Rate limiting** — Undocumented limits. 5-min polling with 1s inter-request delay should be conservative enough.
4. **API format changes per game title** — NHL 27 may have a different response shape than NHL 26. `schema_version` + `game_title_id` on raw payloads enables handling this.

### Unknowns (to resolve in Phase 1)

1. **EA API response shape** — Must capture real responses and type them before building transforms.
2. **`ea_id` (blazeId) stability** — Is it always present? Consistent across endpoints? Stable across game titles? Test in Phase 1.
3. **In-game season detection** — Is the season number present in match data, or must it be inferred from dates? Determine from real API responses.
4. **Match ID uniqueness across game titles** — Do NHL 25 and NHL 26 share a match ID namespace? If so, the composite key needs `(game_title_id, match_id)`.

### Assumptions

1. **Single club** (#19224). No multi-club support needed.
2. **Handful of users.** No scaling concerns.
3. **Home PC is reliable.** Machine stays on 24/7, has stable internet. Power/network outages cause temporary data gaps (acceptable).
4. **PostgreSQL runs locally.** No managed DB costs.

---

## 12. Step-by-Step Implementation Plan

### Phase 0: Foundation

- Initialize pnpm workspace + Turborepo
- TypeScript configs (base + per-package)
- ESLint + Prettier
- Docker Compose file (postgres + placeholder services)
- `.env.example`: `DATABASE_URL`, `EA_CLUB_ID=19224`, `EA_PLATFORM=common-gen5`
- Update CLAUDE.md with conventions

### Phase 1: Database + EA Client + API Exploration

- Set up `packages/db`: Drizzle, schema, migrations
- Create all tables
- Run migrations against local PostgreSQL
- Set up `packages/ea-client`: HTTP client, headers, retry, throttle
- **Manually call each EA endpoint** and capture real responses as JSON fixtures in `packages/ea-client/__fixtures__/`
- Verify: Is `blazeId` always present? Is match ID unique per game? Is in-game season in the response?
- Write TypeScript types matching real responses
- Write **contract tests**: parse fixture files through the transform logic, assert expected output. These fixtures are the regression safety net.

### Phase 2: Ingestion Worker

- Non-overlapping polling loop
- Raw payload storage (store-first, with hash + source_endpoint)
- Transform pipeline (string→number, opponent identification, result determination)
- Player upsert (ea_id primary, gamertag update + history tracking)
- player_match_stats insertion
- Aggregate recomputation (per game title)
- ingestion_log writing
- Reprocess CLI command for failed transforms
- Health HTTP endpoint
- **End-to-end test**: run worker against live API, verify complete data flow
- Verify idempotency: run twice, assert no duplicates

### Phase 3: Frontend MVP

- Next.js 15 + Tailwind + shadcn/ui setup
- Dark theme layout, nav with game title selector
- **Scores page** (`/games`): match list with results, filterable by game title
- **Game Detail page** (`/games/[id]`): box score, player stats, team comparison
- **Stats page** (`/stats`): club stats for selected game title
- **Roster page** (`/roster`): sortable table with tabs (scoring, possession, physical, goalie)
- **Home page** (`/`): record, last 5 games, top performers
- **Test in browser** with real data from the worker

### Phase 4: Production Readiness

- Dockerfiles for web + worker
- Docker Compose with restart policies
- Alerting script (cron checks health endpoint, notifies on gaps)
- `pg_dump` backup cron
- Mobile responsive pass
- Loading states + error boundaries
- Pagination on game list
- Manual ingest-now command for recovery

### Phase 5: Enhancements (Post-MVP)

- Individual player pages with career stats across game titles
- Charts / trends
- Streak tracking, head-to-head records
- Import historical NHL 25 data (if API still serves it or data was captured)

---

## Verification Strategy

### Phase 0

- `pnpm install` succeeds
- `pnpm build` across all workspaces
- `docker compose up db` starts PostgreSQL

### Phase 1

- Migrations run on fresh database
- EA client fetches real data from all endpoints
- Fixture files captured and committed
- Contract tests pass: fixtures → transform → expected structured output
- Identity questions (blazeId, match ID uniqueness) documented

### Phase 2

- Worker ingests real matches end-to-end
- `raw_match_payloads` has unmodified responses + correct hashes
- `matches` + `player_match_stats` correctly transformed
- Aggregates are accurate
- `ingestion_log` records every cycle
- Second run is idempotent
- `reprocess` command works on intentionally-failed transforms
- Health endpoint reports correct last-ingest time

### Phase 3

- All pages render with real data
- Game title selector switches context
- Tables sort correctly
- Mobile layout is usable
- No hydration errors

### Phase 4

- `docker compose up` starts everything
- Worker runs continuously, data flows
- Alerting fires when worker is manually stopped for 30 min
- Backup/restore cycle tested
