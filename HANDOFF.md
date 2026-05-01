# Handoff

## Current Status

**Phase:** Stable. Chemistry analytics shipped, QA pass complete. No known blockers.

**Last updated:** 2026-04-30

---

## Session Summary — 2026-04-30

### Chemistry Analytics (`/stats`)

- `packages/db/src/queries/chemistry.ts` (new) — two CTE-based queries:
  - `getPlayerWithWithoutSplits(gameTitleId, gameMode?)` — per-player team record with/without each player
  - `getPlayerPairs(gameTitleId, gameMode?)` — top player pairs by co-appearance (≥5 shared games)
- `apps/web/src/components/stats/chemistry-tables.tsx` (new):
  - `WithWithoutTable` — GP, Record (W-L-OTL-DNF), Win%, Δ; amber/green sample-size badges
  - `BestPairsTable` — Pair, GP, Record, Win%, GF/GP, GA/GP, Diff/GP
- `/stats` page: Chemistry section added below Goalies, wired to the existing game-mode filter
- DNF coherence: gp = W+L+OTL+DNF throughout so record and Win% denominators are consistent
- Column labeled "Diff/GP" (not "+/-/GP") to avoid confusion with individual plus/minus

### QA Pass

Bug fixes applied today:

- **DTW gauge arc inversion** (`possession-edge.tsx`) — BGM (red) arc was filling the OPP share. Swapped stroke assignments so red fills proportionally to BGM's actual share.
- **FormStrip "Last N" label** (`/games/page.tsx`) — `n = matches.length` included DNF, making "Last 10: 5-2-1" incoherent. Now `n = wins+losses+otl` so the label matches the tally.
- **Event Map placeholder removed** (`/games/[id]/page.tsx`) — 22-line dead-weight placeholder on every game detail page.

No issues found on: home leaders, `/roster`, `/roster/[id]`, `/games` list, `/games/[id]` structure.

---

## What's Next

### Immediate (no blockers)

1. **Verify season-rank field shapes** — `club_season_rank` fields were sourced from HAR analysis (UNVERIFIED). Inspect the DB row after the next worker cycle to confirm all widget values are correct.
2. **Nav cleanup** — remove `EASHL · #19224` subtitle from the navbar (small, current roadmap item).
3. **Top Performers position-pill contrast** — labels are hard to read against star-card gradient backgrounds.
4. **"Show all player scores" opponent completeness** — verify all opponent players appear, not a partial subset.

### Near-Term Features

- Match-card pills for result/mode/quality stat on `/games` list
- Player profile: EA season TOI display in long-duration format (`17d 22h 47m`)
- Roster page mode filter (query layer works; needs UI toggle)
- Discord alerting cron (`localhost:3001/health`, notify when stale >30 min)
- `pg_dump` backup cron (daily to external drive)

### Deferred

- Chemistry heatmap — revisit at ~80–100+ match depth
- Hot-zone / rink shot maps — blocked by missing spatial data
- Historical season import — no manual import model designed yet
- Content season filtering — schema supports it; no UI built

---

## Standing Architectural Decisions

### Data sources

- `gameMode === null` → EA queries (`getEASkaterStats`, `getEAGoalieStats`, `getEARoster`) → labeled "EA season totals"
- `gameMode !== null` → local queries → labeled "local tracked 6s / 3s"
- `ea_member_season_stats` is worker-written only; serves three purposes:
  1. Player resolution (creates `players` + `player_profiles` for members not yet in any ingested match)
  2. EA Season Totals section on `/roster/[id]` (clearly labeled, not mode-filtered)
  3. `All` mode primary source on `/stats` and home player widgets
- **Do not blend sources.** EA totals ≠ local aggregates. Never substitute silently.

### Player identity

- `blazeId` is absent from EA match payloads in production — gamertag fallback is the real production path, not the exception.
- `players.ea_id` must remain nullable permanently.
- Player identity in match ingestion is gamertag-based; member endpoint writes `player_profiles`.

### Stats semantics

- `wins/losses/otl` on `player_game_title_stats` = team record during player appearances (not goalie-only).
- Goalie-only sections gated by `goalieGp > 0`, not by declared position.
- `club_season_rank.wins/losses/otl` = SEASON-SPECIFIC. Never conflate with all-time `club_seasonal_stats`.

### Roster / depth chart

- 1 game at a position is enough to count (no minimum threshold).
- Depth chart prefers a fuller inferred board over sparse honesty.
- Manual/member-only players may appear marked "provisional."

### Chemistry queries

- `CHEMISTRY_MIN_GP_WITH = 5`, `CHEMISTRY_MIN_GP_WITHOUT = 3`, `CHEMISTRY_PAIR_MIN_GP = 5`
- DNF matches are included in the pool; DNF is tracked as a 4th record column.
- Win% denominator = gp (includes DNF) so all columns are coherent.

---

## Locked Schema Decisions

| Decision | Implementation |
|---|---|
| Match uniqueness is composite | `UNIQUE(game_title_id, ea_match_id)` on both `matches` and `raw_match_payloads`; surrogate `bigserial` PK |
| `content_seasons` is a proper table | FK from `matches.content_season_id` (nullable) |
| `players.ea_id` is nullable | Permanently — blazeId absent in all real match payloads |
| Goalie stats in same table | Nullable goalie columns in `player_match_stats` |
| Aggregates precomputed per game title + game mode | `player_game_title_stats` and `club_game_title_stats` with `COALESCE(game_mode, '')` functional unique index |
| `transform_status` strict enum | `('pending', 'success', 'error')` |
| `result` strict enum | `('WIN', 'LOSS', 'OTL', 'DNF')` |
| Aggregate unique index handles NULL game_mode | `UNIQUE(player_id, game_title_id, COALESCE(game_mode, ''))` — standard UNIQUE fails on NULL |

---

## What's Built (Summary)

All foundation phases complete. System live and ingesting. Key surfaces:

| Surface | Status |
|---|---|
| `/` Home | Live — club record, latest result, roster spotlight carousel, leaders section, recent results strip |
| `/games` | Live — paginated match list, game-mode filter, form strip + trend bullets |
| `/games/[id]` | Live — hero, top performers, DTW gauge, team stats, goalie spotlight, scoresheet |
| `/stats` | Live — club stats, skater/goalie tables, chemistry W/W-out + pairs; game-mode filter throughout |
| `/roster` | Live — depth chart + roster stats table |
| `/roster/[id]` | Live — hero, career stats, EA season totals, contribution radar, recent form, game log, gamertag history |

Worker ingests every 5 minutes. Official EA club record, opponent crests, season rank all wired. Aggregates precomputed per game title × game mode.

---

## Key Files

| File | Purpose |
|---|---|
| `docs/ARCHITECTURE.md` | System architecture and schema reference |
| `docs/ROADMAP.md` | Product direction and near-term build order |
| `packages/db/src/schema/` | Drizzle table definitions (canonical schema) |
| `packages/db/src/queries/` | All query functions (chemistry.ts, players.ts, club.ts, etc.) |
| `packages/db/src/client.ts` | Drizzle + postgres.js client (globalThis singleton) |
| `packages/ea-client/src/endpoints.ts` | Typed EA API endpoint wrappers |
| `apps/worker/src/transform.ts` | Raw EA payload → structured DB types |
| `apps/worker/src/aggregate.ts` | Precompute player/club aggregate stats |
| `apps/worker/src/ingest.ts` | Ingestion cycle; `persistTransform`; `upsertPlayer` |
| `apps/worker/src/ingest-members.ts` | Member stats + seasonal stats + opponent crests |
| `apps/worker/src/ingest-season-rank.ts` | Season rank + division thresholds |
| `apps/web/src/lib/match-recap.ts` | View-model builders for `/games/[id]` |
| `apps/web/src/components/stats/chemistry-tables.tsx` | Chemistry W/W-out and Best Pairs tables |
| `.env.example` | Environment variable reference |
| `docker-compose.yml` | Service definitions (web + worker + postgres) |
| `DEPLOY.md` | Cold-start deployment checklist |
