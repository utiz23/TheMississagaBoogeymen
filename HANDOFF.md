# Handoff

## Current Status

**Phase:** Stable. All major surfaces polished. Roster mode filter live. No known visual bugs or data bugs.

**Last updated:** 2026-05-02

---

## Session Summary — 2026-05-02

### Legacy Stats Import Pipeline

- Historical archive schema is live:
  - `historical_player_season_stats`
  - inactive `game_titles` rows for `nhl23`, `nhl24`, `nhl25`
- Live-site title bug was caused by legacy titles sorting first; fixed by filtering `listGameTitles()` to `is_active = true`. Legacy titles remain available for archive import and are now hidden from the site.
- NHL 24 extraction baseline is validated for:
  - skaters: `6s` + `3s`, all scopes
  - goalies: `6s` + `3s`
- Real extractor fixes completed during validation:
  - dynamic highlighted-row detection (fixed wrong-row sampling outside `all_skaters`)
  - column-pairing threshold guard (fixed 1-column shift cascades in `3s/wing`)
  - goalie `losses` recovery from footer `RECORD`
  - goalie advanced stat header mappings
- NHL 24 import path is now operational:
  - migrations `0015` + `0016` applied
  - importer verified against reviewed artifact set
  - importer teardown bug fixed by closing the `postgres-js` pool with `await sql.end({ timeout: 5 })`
- NHL 24 `silkyjoker85` batch imported successfully:
  - `11` reviewed rows
  - both goalie rows verified
  - goalie raw artifacts stay in `stats_json` and are correctly suppressed from typed skater columns
- NHL 23 raw timestamped videos were renamed in `K:\NHL23\Stats` / `/mnt/k/NHL23/Stats` using an NHL 23-specific parser update:
  - split chips like `SEASONS`, `6'S GAME`, `3'S GAME`, `ALL GOALIES`
  - vetted rename map: `tools/historical_import/nhl23_raw_rename_dryrun.csv`

### NHL 24 Batch Triage Checklist

- Auto-mark `reviewed` only when:
  - player identity is clearly correct
  - mode / scope / role are correct
  - required typed fields are present
  - warnings are limited to OCR noise (`game_mode_chip_mismatch`, `position_chip_mismatch`, spacing-only identity conflicts, minor non-blocking value conflicts)
- Keep `pending_review` when:
  - important fields still need a frame check
  - warnings suggest clipped or inconsistent values on key stats
  - totals have not yet been reconciled
- Treat as blocker when:
  - wrong player row sampled
  - mode / scope misidentified
  - column-shift cascade symptoms appear
  - required imported fields are missing
  - obvious sanity checks fail

### NHL 24 DB Verification Queries

- Total rows for `nhl24`
- Counts by player
- Counts by `game_mode / position_scope / role_group`
- Duplicate check on `(game_title_id, player_id, game_mode, position_scope, role_group)`
- Skater spot-check query
- Goalie spot-check query
- Goalie artifact suppression check (`goals/assists/points/plus_minus/hits = 0` on goalie rows)

### Legacy Pipeline Next Step

- Finish NHL 24 before widening scope:
  - expanded NHL 24 extraction batch for remaining players is in progress / next
  - import only reviewed rows
  - verify counts in DB
- Do **not** touch the live website for legacy-title work
- After NHL 24 is fully complete:
  - start NHL 23 extraction validation from the renamed files
  - then NHL 25

### Season Rank Widget Verification

- Queried live `club_season_rank` row — all fields match schema and widget usage exactly.
- `projected_points = -1` is EA's projection output, not a bug.
- No schema or component changes needed. Widget is correct.

### Roster Mode Filter (`/roster`)

- Added "All / 6s / 3s" pill toggle (same style and pattern as `/stats`) — placed above the stat tables, below the depth chart.
- "All" sources from `getEASkaterStats`/`getEAGoalieStats` (EA season totals); "6s"/"3s" source from `getSkaterStats`/`getGoalieStats` (local tracked). Matches `/stats` behavior exactly.
- Table subtitles show "EA season totals" or "local tracked 6s/3s".
- Depth chart and Season Summary Strip are unaffected (always EA-sourced).
- `revalidate` changed from 3600 → 300 (matches worker poll cadence).
- Typecheck clean. Verified all three modes in browser.
- Follow-up verification found `localhost:3000` was initially serving a stale Docker image (`eanhl-team-website-web-1` created before the roster-mode change), so the live page did not match the workspace file.
- Runtime fix: `docker.exe compose build web` then `docker.exe compose up -d web`.
- Post-fix verification on `localhost:3000`:
  - `/roster` shows mode pills with `All` active and EA season totals
  - `/roster?mode=6s` shows `6s` active with `local tracked 6s`
  - `/roster?mode=3s` shows `3s` active with `local tracked 3s`
  - Depth chart and Season Summary Strip remain EA-sourced and unchanged across modes

---

## Session Summary — 2026-05-01

### Match Detail Page Polish (`/games/[id]`)

- **Scoring model V3** (`match-recap.ts`) — Anchored to Luszczyszyn Game Score + NWHL Game Score published models. G:A ratio = 1.23:1. Four-tier structure: core offense → strong positive defensive → strong negative → light context. Full calibration log at `research/investigations/player-scoring-model.md`.
- **DTW gauge** (`possession-edge.tsx`) — Fixed 3 independent bugs: needle direction inverted, arc fill hardcoded at 50%, arc colors swapped. Arc now proportional to actual share (clamped [1,99]). Opponent TOA wired (was always in DB, view-model never passed it through).
- **Box score restructured** — Offense / Possession / Defense / Goalie grouping. Removed redundant "Box Score" utility group.
- **Scoresheet** — Position shown under player name (not separate column); SOG promoted; BGM header accent.
- **Opponent score filter fixed** — BGM keeps `score > 0` guard (AI bench suppression); opponent entries now pass through unconditionally. Previously dropped real opponent players with negative scores.
- **Star ordering fixed** — rank 1 = ★★★, rank 3 = ★.
- **Position pill `onLight`** — `rgba(0,0,0,0.42)` → `rgba(8,8,10,0.84)` bg + solid color border. Now readable on any card brightness.

### Score Card Polish (`/games` list)

- WIN = emerald glow + green bar; LOSS = rose glow + rose bar; OTL = amber
- Mode pills: 6s = violet, 3s = sky (distinct from each other and from result colors)
- `SplitStat` component: our number bold, their number muted
- Stat order: SOG → TOA → Hits → DtW
- FO% removed (always null — confirmed by DB query). DtW replaces Pass% as fourth stat.
- "BGM" abbreviation replaces "Boogeymen" in score panel (prevented overflow)
- "Private" badge for `club_private`; "Dominated"/"Outshot" quality badge at 65/35% shot share
- Form strip denominator fixed: `n = wins + losses + otl` (not `matches.length`)

### Roster Page (`/roster`)

- `RosterTable` deleted — replaced by `SkaterStatsTable` + `GoalieStatsTable` from `/stats`
- Season Summary Strip added above depth chart
- Goalie block: dynamic slot count (no more 3 empty placeholder slots)
- Position pill in player identity cell

### Player Profile (`/roster/[id]`)

- Removed `CurrentSeasonSnapshotSection` (duplicate of hero strip)
- Removed "Source Notes" card
- `HeroStatStrip` expanded: 8 cells (skaters), 7 cells (goalies). Wrapped in `overflow-x-auto`.
- Game Log reordered before Career Stats
- Archetype badge (Sniper/Playmaker/Enforcer/Two-Way/Balanced) added to hero
- Position usage as `PositionPill` chips
- Section headings upgraded; radar fill boosted; hero bloom boosted

### Navigation

- `EASHL · #19224` subtitle removed from navbar
- Mobile wordmark overflow fixed (removed `sm:hidden` duplicate span)

### Docs & Research (2026-05-01)

- HANDOFF, CLAUDE.md, ROADMAP, ARCHITECTURE, README all rewritten/updated
- `research/investigations/` created with 6 investigation docs:
  - `player-scoring-model.md` — formula research + validation
  - `ea-api-data-gaps.md` — confirmed missing/available fields
  - `dtw-gauge-bugs.md` — 3-bug investigation + geometry proofs
  - `mcp-and-tooling-setup.md` — Playwright fix, postgres MCP config
  - `ui-bugs-and-fixes.md` — running bug log
  - `match-detail-page-design.md`, `player-profile-design.md`, `roster-page-design.md`

### MCP Tooling

- Playwright MCP working (Chrome symlink: `/opt/google/chrome/chrome` → Chromium binary)
- PostgreSQL MCP: replaced deprecated `@modelcontextprotocol/server-postgres` with `mcp-postgres` (env var config, port 5433). Tools appear **after session restart**.

---

## What's Next

### Immediate (no blockers)

- **Player profile: EA season TOI** — long-duration format (`17d 22h 47m`); reference ratio ≈ 78% of platform total game time (silkyjoker85 NHL 26 reference point); use as backfill estimate only, not claimed stat
- **Discord alerting cron** — `localhost:3001/health`, notify when stale >30 min
- **`pg_dump` backup cron** — daily dump to external drive

### Deferred

- Chemistry heatmap — revisit at ~80–100+ match depth
- Hot-zone / rink shot maps — blocked by missing spatial data in EA payload
- Historical season import — no import model designed
- Content season filtering — schema supports it; no UI

---

## Standing Architectural Decisions

### Data sources

- `gameMode === null` → `ea_member_season_stats` → labeled "EA season totals"
- `gameMode !== null` → `player_game_title_stats` → labeled "local tracked 6s / 3s"
- **Do not blend sources.** EA totals ≠ local aggregates. Never substitute silently.

### Player identity

- `blazeId` absent from EA match payloads — gamertag is the real production identity anchor.
- `players.ea_id` nullable permanently.

### Stats semantics

- `wins/losses/otl` on `player_game_title_stats` = team record during player appearances (not goalie-only).
- `club_season_rank.wins/losses/otl` = SEASON-SPECIFIC. Never conflate with `club_seasonal_stats`.
- Goalie sections gated by `goalieGp > 0`, not declared position.

### Scoring model

- V3 frozen. Do not redesign weights without evidence.
- BGM entries: `score > 0` filter (AI bench suppression). Opponent entries: no filter.
- EA Ratings fields (Off/Def/Team) are not extracted — cannot replicate Chelhead's primary signal.

### Chemistry

- `CHEMISTRY_MIN_GP_WITH = 5`, `CHEMISTRY_MIN_GP_WITHOUT = 3`, `CHEMISTRY_PAIR_MIN_GP = 5`
- DNF included in pool. Win% denominator = gp (includes DNF).

### Roster / depth chart

- 1 game at a position is enough to count.
- Depth chart uses `ea_member_season_stats`; stats tables use `player_game_title_stats`.

---

## Locked Schema Decisions

| Decision | Implementation |
|---|---|
| Match uniqueness composite | `UNIQUE(game_title_id, ea_match_id)` on `matches` + `raw_match_payloads`; surrogate bigserial PK |
| `players.ea_id` nullable | Permanently — blazeId absent in all real match payloads |
| Goalie stats same table | Nullable goalie columns in `player_match_stats` |
| Aggregate unique index | `UNIQUE(player_id, game_title_id, COALESCE(game_mode, ''))` — handles NULL game_mode |
| `transform_status` | `('pending', 'success', 'error')` |
| `result` | `('WIN', 'LOSS', 'OTL', 'DNF')` |

---

## What's Built

| Surface | Status |
|---|---|
| `/` Home | Live — club record, latest result, player carousel, leaders, recent results |
| `/games` | Live — paginated list, mode filter, form strip, trend bullets, quality badges |
| `/games/[id]` | Live — scoring, top performers, DTW gauge, team stats, goalie spotlight, scoresheet |
| `/stats` | Live — club stats, skater/goalie tables, chemistry W/W-out + pairs; mode filter throughout |
| `/roster` | Live — summary strip, depth chart, skater + goalie stat tables |
| `/roster/[id]` | Live — hero, radar, recent form, game log, career stats, EA totals, gamertag history |

---

## Key Files

| File | Purpose |
|---|---|
| `docs/ARCHITECTURE.md` | System architecture + schema reference |
| `docs/ROADMAP.md` | Product direction + near-term build order |
| `research/investigations/` | Bug logs, design decisions, API research |
| `packages/db/src/schema/` | Drizzle table definitions (canonical) |
| `packages/db/src/queries/` | All query functions |
| `apps/worker/src/transform.ts` | Raw EA payload → structured DB types |
| `apps/worker/src/aggregate.ts` | Precompute player/club aggregates |
| `apps/web/src/lib/match-recap.ts` | View-model builders for `/games/[id]` |
| `apps/web/src/components/stats/chemistry-tables.tsx` | Chemistry W/W-out + Best Pairs |
