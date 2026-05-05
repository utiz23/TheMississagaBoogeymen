# EASHL Team Stats Website — Architecture Reference (v3)

> **Status:** Core live system complete. Legacy historical ingest complete across NHL 22–25 for player-card totals and club-member totals. Club/team totals screenshot pipeline now has schema + importer + extractor + generated review queue; cross-title reviewed import is still pending.
> Schema in this doc reflects actual implementation. For the definitive source, see `packages/db/src/schema/`.

---

## Context

Stats/analytics website for EASHL club **#19224** (platform: common-gen5). EA's Pro Clubs API is **undocumented, unstable, and only exposes ~5 recent matches**. The system must continuously poll and archive — miss a match window and that data is gone forever.

**Audience:** Handful of team members. Self-hosted on a spare home PC running 24/7.

**Primary data axis:** Game title (NHL 25, NHL 26, NHL 27...). Cross-game career stats are the core feature. In-game seasons (~5/year) are secondary metadata.

---

## 1. System Architecture

### Components

| Component | Role | Technology |
|---|---|---|
| **Web App** (`apps/web`) | Frontend + API routes | Next.js 15 (App Router) |
| **Worker** (`apps/worker`) | Polling, ingestion, aggregation | Standalone Node.js process |
| **Database** | System of record | PostgreSQL 16 (local Docker) |
| **Shared DB** (`packages/db`) | Schema, migrations, queries | Drizzle ORM |
| **EA Client** (`packages/ea-client`) | EA API wrapper + retry/throttle | Standalone TypeScript package |

No separate API service — Next.js Server Components query `packages/db` directly. API routes exist only for client-side interactivity.

### Data Flow

```
EA Pro Clubs API
       │
       ▼
   ┌─────────┐     ┌────────────────────┐
   │  Worker  │────▶│  raw_match_payloads │  (store first, parse second)
   │ (polling)│     │  (JSONB)            │
   └─────────┘     └──────────┬──────────┘
                              │ transform
                              ▼
                   ┌──────────────────────┐
                   │  matches              │
                   │  player_match_stats   │
                   │  players              │
                   └──────────┬───────────┘
                              │ aggregate
                              ▼
                   ┌───────────────────────────┐
                   │  player_game_title_stats   │
                   │  club_game_title_stats     │
                   └──────────┬────────────────┘
                              │
                              ▼
                   ┌──────────────────────┐
                   │  Next.js Web App      │
                   └──────────────────────┘

Supplementary (parallel ingest paths):
  EA seasonalStats  → club_seasonal_stats   (official all-time record)
  EA members        → ea_member_season_stats (EA season totals per player)
  EA seasonRank     → club_season_rank       (current division standing)
  EA clubs/info     → opponent_clubs         (opponent crests)
```

### Deployment

Docker Compose on a single home machine:

- `web` — Next.js app (port 80)
- `worker` — ingestion process (health on port 3001)
- `db` — PostgreSQL with named volume (host port **5433**, not 5432 — conflict with another local project)

No cloud dependencies. Backups via `pg_dump` cron.

---

## 2. Repository Structure

```
eanhl-team-website/
├── apps/
│   ├── web/                        # Next.js 15
│   │   ├── src/
│   │   │   ├── app/                # App Router pages
│   │   │   │   ├── page.tsx        # Home
│   │   │   │   ├── games/          # /games and /games/[id]
│   │   │   │   ├── roster/         # /roster and /roster/[id]
│   │   │   │   └── stats/          # /stats
│   │   │   ├── components/
│   │   │   │   ├── home/           # Latest result, leaders, carousel, player card
│   │   │   │   ├── matches/        # Score card, scoresheet, top performers, DTW gauge
│   │   │   │   ├── nav/            # Top nav, game title switcher
│   │   │   │   ├── roster/         # Depth chart, roster table
│   │   │   │   ├── stats/          # Skater/goalie tables, chemistry tables
│   │   │   │   └── title-selector.tsx # TitleSelector + ModeFilter + statsSourceLabel (shared)
│   │   │   └── lib/
│   │   │       ├── format.ts        # Shared formatters
│   │   │       ├── match-recap.ts   # View-model builders for game detail
│   │   │       └── title-resolver.ts # Unified active+archive game-title slug resolver
│   │   ├── public/images/          # bgm-logo.png
│   │   └── next.config.ts
│   │
│   └── worker/
│       ├── src/
│       │   ├── index.ts            # Non-overlapping polling loop
│       │   ├── ingest.ts           # Core ingestion: matches + player stats
│       │   ├── ingest-members.ts   # Member stats + seasonal stats + opponent crests
│       │   ├── ingest-season-rank.ts # Season rank + division thresholds
│       │   ├── transform.ts        # Raw EA payload → structured DB types
│       │   ├── aggregate.ts        # Recompute aggregates (all modes × game title)
│       │   ├── reprocess.ts        # CLI: reprocess failed/all raw payloads
│       │   ├── ingest-now.ts       # CLI: one-shot ingest trigger
│       │   └── health.ts           # HTTP health endpoint
│       └── Dockerfile
│
├── packages/
│   ├── db/
│   │   ├── src/
│   │   │   ├── schema/             # Drizzle table definitions (one file per domain)
│   │   │   ├── migrations/         # SQL migrations
│   │   │   ├── queries/            # Reusable query functions
│   │   │   │   ├── chemistry.ts    # W/W-out splits + pair co-occurrence
│   │   │   │   ├── club.ts         # Club stats, season rank, opponent crests
│   │   │   │   ├── game-titles.ts  # Active vs legacy title resolution + slug lookup
│   │   │   │   ├── historical.ts   # Reviewed player-card legacy season aggregates
│   │   │   │   ├── historical-club-member.ts # Reviewed club-member legacy totals
│   │   │   │   ├── matches.ts      # Match queries, series context, adjacent
│   │   │   │   ├── players.ts      # Roster, career stats, game log, profile
│   │   │   │   └── stats.ts        # Skater/goalie stat tables (local + EA)
│   │   │   ├── tools/
│   │   │   │   ├── import-historical-reviewed.ts # CLI: import reviewed player-card OCR rows
│   │   │   │   └── import-club-member-reviewed.ts # CLI: import reviewed club-member screenshot rows
│   │   │   └── client.ts           # Drizzle + postgres.js (globalThis singleton)
│   │   └── drizzle.config.ts
│   │
│   └── ea-client/
│       ├── src/
│       │   ├── client.ts           # HTTP client + retry + backoff + throttle
│       │   ├── endpoints.ts        # Typed endpoint functions
│       │   └── types.ts            # EA API response types
│       └── __fixtures__/           # Real EA API response snapshots
│
├── tools/
│   └── historical_import/          # Legacy import tools
│       ├── extract_review_artifacts.py # Player-card video extractor; GPU via OCR_USE_CUDA=1
│       ├── club_members/           # Static screenshot extractor + merger for CLUBS→MEMBERS tables
│       ├── club_team_stats/        # CLUB STATS extractor, pilots, and review queue
│       ├── build_manifest.py
│       ├── rename_raw_videos.py
│       └── manifest.*.csv
│
├── docker-compose.yml
├── CLAUDE.md
├── HANDOFF.md
└── README.md
```

---

## 3. Database Schema

> **Canonical source:** `packages/db/src/schema/` — the Drizzle files are authoritative.
> Tables below reflect actual implementation.

### Core Tables

**`game_titles`** — NHL 25, NHL 26, NHL 27...
- `id` (serial PK), `slug` (unique), `name`, `ea_platform`, `ea_club_id`, `api_base_url`, `is_active`, `launched_at`

**`content_seasons`** — In-game battlepass seasons (secondary metadata)
- `id` (serial PK), `game_title_id` (FK), `season_number`, `name`, `started_at`, `ended_at`, `is_current`

**`raw_match_payloads`** — Immutable archive (store-first)
- `id` (bigserial PK), `ea_match_id` (text), `game_title_id` (FK), `match_type`, `source_endpoint`, `payload` (jsonb), `payload_hash`, `transform_status` (`pending|success|error`), `transform_error`, `ingested_at`
- UNIQUE(`game_title_id`, `ea_match_id`)

**`matches`** — One row per game played
- `id` (bigserial PK), `ea_match_id` (text), `game_title_id` (FK), `content_season_id` (FK nullable), `opponent_club_id`, `opponent_name`, `played_at`, `result` (`WIN|LOSS|OTL|DNF`), `game_mode` (`6s|3s`|null), `ea_game_type_code`
- Score/team stats: `score_for`, `score_against`, `shots_for`, `shots_against`, `hits_for`, `hits_against`, `faceoff_pct`, `time_on_attack`, `time_on_attack_against`, `penalty_minutes`
- PP stats: `pass_attempts`, `pass_completions`, `pp_goals`, `pp_opportunities`
- UNIQUE(`game_title_id`, `ea_match_id`)

**`players`** — Player identity anchor
- `id` (serial PK), `ea_id` (text, nullable — blazeId absent in prod payloads), `gamertag`, `position`, `first_seen_at`, `last_seen_at`

**`player_profiles`** — Extended player metadata
- `id` (serial PK), `player_id` (FK unique), `club_role_label` (text nullable — e.g. "Captain")

**`player_gamertag_history`** — Name change tracking
- `id` (serial PK), `player_id` (FK), `gamertag`, `seen_from`, `seen_until` (nullable)

**`player_match_stats`** — Per-game individual stats
- `id` (bigserial PK), `player_id` (FK), `match_id` (FK bigint), `position`, `is_goalie`, `player_dnf`
- Skater: `goals`, `assists`, `plus_minus`, `shots`, `hits`, `pim`, `takeaways`, `giveaways`, `faceoff_wins`, `faceoff_losses`, `pass_attempts`, `pass_completions`, `shot_attempts`, `blocked_shots`, `pp_goals`, `sh_goals`, `interceptions`, `penalties_drawn`, `possession`, `deflections`, `saucer_passes`
- Goalie (nullable): `saves`, `goals_against`, `shots_against`, `breakaway_saves`, `breakaway_shots`, `desp_saves`, `pen_saves`, `pen_shots`, `pokechecks`
- Context: `toi_seconds`, `client_platform`
- UNIQUE(`player_id`, `match_id`)

### Aggregate Tables

**`player_game_title_stats`** — Precomputed rollups per player × game title × game mode
- `id` (serial PK), `player_id` (FK), `game_title_id` (FK), `game_mode` (nullable)
- Skater aggs: `games_played`, `skater_gp`, `goals`, `assists`, `points`, `plus_minus`, `shots`, `hits`, `pim`, `takeaways`, `giveaways`, `faceoff_pct`, `pass_pct`, `shot_attempts`, `toi_seconds`, `skater_toi_seconds`
- Goalie aggs: `goalie_gp`, `goalie_toi_seconds`, `wins`, `losses`, `otl`, `save_pct`, `gaa`, `shutouts`, `total_saves`, `total_shots_against`, `total_goals_against`
- UNIQUE(`player_id`, `game_title_id`, COALESCE(`game_mode`, '')) — functional index handles NULL

**`club_game_title_stats`** — Club rollups per game title × game mode
- `id` (serial PK), `game_title_id` (FK), `game_mode` (nullable)
- `games_played`, `wins`, `losses`, `otl`, `goals_for`, `goals_against`, `shots_per_game`, `hits_per_game`, `faceoff_pct`, `pass_pct`
- UNIQUE(`game_title_id`, COALESCE(`game_mode`, ''))

**`historical_player_season_stats`** — Reviewed player-card legacy season aggregates (NHL 22–25)
- One row per (game title × player × game mode × position scope × role group). Populated from OCR-driven extraction of legacy stat-table videos; no match-level data exists for these titles.
- `id` (bigserial PK), `game_title_id` (FK to inactive `game_titles` row), `player_id` (FK), `game_mode` (`'6s'|'3s'`), `position_scope`, `role_group` (`'skater'|'goalie'`), `gamertag_snapshot`
- Typed skater + goalie columns (mirroring `player_game_title_stats` shape) plus `stats_json` jsonb for the raw OCR record.
- `review_status` (`'pending_review'|'reviewed'|'rejected'`), `confidence_score`, `import_batch`, source label fields.
- UNIQUE(`game_title_id`, `player_id`, `game_mode`, `position_scope`, `role_group`).
- Only `review_status='reviewed'` rows are surfaced by `getHistoricalSkaterStats` / `getHistoricalGoalieStats`.

**`historical_club_member_season_stats`** — Reviewed club-member legacy totals (NHL 22–25)
- One row per (game title × game mode × role group × player) from `CLUBS -> MEMBERS` screenshots.
- Club-scoped truth: what this player did for BGM in that title/mode.
- Includes club-member-only fields not present in the player-card source:
  - `blocked_shots`, `giveaways`, `takeaways`, `interceptions`, `shots`, `shooting_pct`, `shutout_periods`
- Matched unique index: `UNIQUE(game_title_id, game_mode, role_group, player_id)` where `player_id IS NOT NULL`
- Unmatched unique index: `UNIQUE(game_title_id, game_mode, role_group, lower(gamertag_snapshot))` where `player_id IS NULL`

**`historical_club_member_stat_sources`** — Append-only provenance log
- One row per imported reviewed club-member record per import pass.
- Source PNG lineage is preserved in the merged review artifacts on disk; DB source rows point at the reviewed merged artifact JSON.

**`historical_club_team_stats`** — Club/team historical totals from `STATS -> CLUB STATS` screenshots
- One row per `(game_title_id, playlist)` — e.g. `eashl_6v6`, `eashl_3v3`, `clubs_6v6`, `threes`, `6_player_full_team`
- Wide nullable club-total schema covering:
  - record / W-L (`games_played`, `wins`, `losses`, `otl`, `win_loss_streak`, `did_not_finish_pct`, `dnf_wins`, `division_titles`, `club_finals_gp`)
  - goals (`goals_for`, `goals_against`, `goal_difference`, `avg_goals_for`, `avg_goals_against`, `avg_win_margin`, `avg_loss_margin`)
  - shots / shooting / physical / penalties / PP / PK / faceoffs / passes / breakaways / one-timers / blocks
  - `avg_time_on_attack` stored as text (`MM:SS`)
- Provenance fields:
  - `source_asset_paths text[]`
  - `raw_extract_json jsonb`
  - `import_batch`, `review_status`, `confidence_score`, `notes`
- UNIQUE(`game_title_id`, `playlist`)
- Current status:
  - schema + importer applied
  - two NHL 25 pilot rows proven by hand
  - extractor-generated review queue exists for all titles/playlists
  - full reviewed import across titles is still pending

### Supplementary Tables (EA-sourced, worker-written)

**`ea_member_season_stats`** — EA's official season totals per player (all-modes combined)
- Written by `ingest-members.ts` each cycle. Used as the "All" mode source on `/stats` and home page.
- Also used for player resolution: creates `players` + `player_profiles` rows for members not yet in any locally ingested match.

**`club_seasonal_stats`** — EA official all-time club record
- One upsert row per game title. `wins`, `losses`, `otl`, `gamesPlayed`, `rankingPoints`, `goals`, `goalsAgainst`.

**`club_season_rank`** — Current season division standing
- One upsert row per game title. Season-specific W/L/OTL (NOT all-time), points, projected points, division info, promotion/hold thresholds. Field names UNVERIFIED (sourced from HAR).

**`opponent_clubs`** — Opponent crest metadata
- One row per unique EA club ID encountered. `crest_asset_id` (nullable), `use_base_asset`. "Fetched but no customKit" is a valid terminal state.

---

## 4. Player Identity

**Production reality:** `blazeId` is absent from EA match payloads. Gamertag is the primary identity for match ingestion. `players.ea_id` is nullable permanently.

**Gamertag changes:** On each ingest, if the gamertag differs from stored: update `players.gamertag`, close the previous `player_gamertag_history` entry, insert a new one.

**Member-only players:** Created via `ea_member_season_stats` write path. These players appear on `/roster/[id]` with a "no local match history" notice.

---

## 5. Data Source Split

| Context | Source | Label |
|---|---|---|
| Active title, `gameMode === null` | `ea_member_season_stats` | "EA season totals" |
| Active title, `gameMode === '6s'` or `'3s'` | `player_game_title_stats` | "local tracked 6s/3s" |
| Legacy title, `/roster` | `historical_club_member_season_stats` | "Club-scoped totals" |
| Legacy title, `/stats` club section | `historical_club_member_season_stats` | "Club-scoped totals" |
| Legacy title, `/stats` player-card section | `historical_player_season_stats` (reviewed) | "Player-card season totals" |
| Legacy title, `gameMode === null` on player-card section | `historical_player_season_stats` (reviewed, summed across 6s+3s; rate fields recomputed from underlying counts) | "Player-card season totals" |
| Player profile — Career Stats | `player_game_title_stats` | (per game title) |
| Player profile — EA Season Totals | `ea_member_season_stats` | "EA Season Totals" |
| Club record (all modes) | `club_seasonal_stats` | "EA official" |
| Club record (mode-filtered) | `club_game_title_stats` | "local · {mode} only" |

**Rule:** Never blend sources silently. EA totals ≠ local aggregates ≠ player-card legacy aggregates ≠ club-member legacy aggregates.

Active vs archive titles are resolved together via `apps/web/src/lib/title-resolver.ts`. Both `/stats` and `/roster` accept `?title=<slug>` for any active or archive title; archive-title views hide match-derived sections (chemistry, recent matches, depth chart, team averages) because no match-level data is captured for legacy titles. `/`, `/games`, and `/games/[id]` are NHL-26-only by design.

---

## 6. Ingestion Strategy

### Non-Overlapping Polling Loop

```typescript
for (;;) {
  const start = Date.now()
  await runIngestionCycle()
  const elapsed = Date.now() - start
  await sleep(Math.max(0, POLL_INTERVAL_MS - elapsed))
}
```

Prevents concurrent runs. Default interval: 5 minutes.

### Ingestion Cycle

```
for each matchType in ['gameType5', 'gameType10', 'club_private']:
  1. Fetch matches from EA API (1s throttle between endpoint calls)
  2. For each match: INSERT raw_match_payloads ON CONFLICT DO NOTHING
  3. If new: transform → upsert matches + player_match_stats (single transaction)
     On transform error: set transform_status = 'error', store error message
  4. Recompute aggregates for current game title (all modes: null, '6s', '3s')

After match ingest:
  5. Fetch member stats → upsert ea_member_season_stats + resolve players
  6. Fetch seasonal stats → upsert club_seasonal_stats
  7. Fetch opponent crests (new opponents only) → upsert opponent_clubs
  8. Fetch season rank → upsert club_season_rank
```

### Reprocessing

```bash
pnpm --filter worker reprocess           # retry transform_status='error' rows
pnpm --filter worker reprocess --all     # reprocess ALL raw payloads (after schema/transform change)
pnpm --filter worker reprocess --dry-run # preview without writing
```

---

## 7. Failure Modes

| Failure | Response |
|---|---|
| EA 429 / 5xx | Per-endpoint exponential backoff (3 retries, 2^n * 500ms + jitter) |
| EA schema change | Raw payload saved; transform_status='error'; fix code, reprocess |
| EA API permanently offline | System becomes read-only archive; all historical data preserved |
| Worker crash | Docker `restart: always` auto-restarts; manual `ingest-now` for recovery |
| Data gap (worker down during active play, >5 games passed) | Permanent loss; no EA replay; gap logged in ingestion_log |

---

## 8. Caching Strategy

No Redis. No CDN.

| Data | Strategy | TTL |
|---|---|---|
| Club/player aggregates | `revalidate` | 300s |
| Match list | `revalidate` | 300s |
| Match detail | `revalidate = false` | Indefinite (immutable once written) |
| Player/roster | `revalidate` | 3600s |

Worker-side: 1s inter-request delay, exponential backoff on 429/5xx, no concurrent requests within a cycle.

---

## 9. Known Assumptions

1. **Single club** (#19224). No multi-club support.
2. **Handful of users.** No scaling concerns.
3. **Home PC reliable.** Machine on 24/7, stable internet. Power outages cause temporary gaps (acceptable).
4. **PostgreSQL runs locally.** No managed DB costs.
5. **blazeId absent in match payloads.** Gamertag is the match-level identity anchor.
6. **Match IDs not globally unique across game titles.** Composite key `(game_title_id, ea_match_id)` is safe default.
7. **OT vs SO not distinguishable.** Both stored as `OTL`. No overtime indicator found in match payloads.

---

## 10. Key Design Tradeoffs

| Topic | Decision | Reasoning |
|---|---|---|
| Services | 2 (web + worker), no separate API | API extracted only if second consumer appears |
| Primary grouping | Game titles, not in-game seasons | Cross-game career stats are the core requirement |
| Deployment | Docker Compose on home PC | Self-hosted, no cloud costs |
| Worker scheduler | Non-overlapping async loop | Prevents concurrent ingestion runs |
| Aggregate unique index | Functional index on COALESCE(game_mode, '') | Standard UNIQUE fails on NULL; this handles NULL=all-modes correctly |
| EA record source | `club_seasonal_stats` (not local count) | Local match count ≠ real record; EA official record fetched separately |
| Match PK | Surrogate bigserial (not EA match ID) | Match IDs may not be globally unique across game titles |
| Goalie stats | Nullable columns in `player_match_stats` | Simpler than table inheritance for a small-roster system |
