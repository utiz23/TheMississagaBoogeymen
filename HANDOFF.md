# Handoff

## Current Status

**Phase:** Player profile Phase 1 revamp complete and verified. No active workstream.

**Last updated:** 2026-05-03

---

## Session Summary — 2026-05-03 (player profile revamp)

### Player profile Phase 1 — significant redesign landed

Full rewrite of `apps/web/src/app/roster/[id]/page.tsx` (~1250 lines) plus targeted changes to `packages/db/src/queries/players.ts`.

**Hero upgrades:**
- Jersey number (#10 for silkyjoker85), nationality (CANADA), archetype pill (PLAYMAKER / SNIPER / etc.), bio text — all pulled from `player_profiles` table
- Position usage donut (SVG, `hidden lg:flex`) replaces the old generic silhouette. Segments per position (center/LW/RW/D/goalie) sized by game count, color-coded.
- "Also plays Goalie" inline stat strip when dual-role GP > 0
- Role selector pills (SKATER / GOALIE) using URL param `?role=`. Defaults to `primaryRole`, clamped to roles with actual data.

**New stat strip:** GP · PTS (featured, accent color) · PTS/GP · G · A · +/- · Hits · APP.RECORD — role-aware (goalie shows W-L-OTL, SV%, GAA instead)

**Anchor nav updated to:** SEASON / FORM / PROFILE / CAREER / EA TOTALS / GAME LOG

**Current season stat grid** (role-aware):
- Skater: GP, PTS, PTS/GP, G, G/GP, A, A/GP, +/-, Hits, Hits/GP, SHT%, SOG/GP
- Goalie: GP, W-L-OTL, SV%, GAA, SO, Saves, Saves/GP

**Trend chart (RECENT FORM section):** SVG bar chart of points-per-game (or SV% for goalie) over last 15 role-filtered games, bars colored by result (emerald=W, amber=OT, rose=L/DNF), dashed average reference line. Sidebar shows LAST 5 form dots, record, G/A (or GA), +/-, BEST RECENT game.

**Contribution section renamed SEASON PROFILE:** ContributionDonut (6-segment multicolor SVG donut, same stroke-dasharray technique as position donut) replaces old ContributionWheelSection radar polygon. Metric bars now have per-metric colors matching donut segments.

**DB changes:** `PlayerProfileOverview` interface split `contributionSummary`/`recentForm` into dual-role fields (`skaterContribution`, `goalieContribution`, `skaterRecentForm`, `goalieRecentForm`, `trendGames`). `getPlayerProfileOverview` builds both role paths independently.

**Silkyjoker85 profile seeded:**
```sql
UPDATE player_profiles SET jersey_number=10, nationality='Canada', preferred_position='center',
bio='Started as a goalie with the Speds, transitioned into a scoring winger, and now plays as a playmaking center.'
WHERE player_id=2;
```

**Verification:** lint clean (13 errors fixed — unused imports, template literal numbers, optional chain), build 4/4 tasks passed. Playwright smoke check at `/roster/2` (desktop 1440px) confirmed: position donut in hero with C/D/LW breakdown, role selector pills, stats grid with per-game rates, trend bar chart with result colors + dashed avg line, contribution donut with 6 color segments, metric bars with matching colors.

**What's next (Phase 2 candidates):**
- Seed `player_profiles` enrichment for remaining players (currently only player_id=2 has data)
- Per-game rate columns in career/EA tables
- Goalie role view smoke check (I-amCaKee, player_id=7)
- Previous season section design polish (currently shows raw EA data)

---

## Session Summary — 2026-05-04 (latest)

### Homepage Title Records — pill mode selector redesign + section reorder

Replaced the multi-column-mode table from the prior session with the correct design: one stat row per title, mode pill controls which mode's data is shown.

- **Mode pills:** All / 6s / 6s+G / 3s — client-side `useState` in `TitleRecordsTable` client component (`apps/web/src/components/home/title-records-table.tsx`). Pill switches the stat set for all title rows instantly.
- **Stat columns:** GP, W, L, OTL, W%, GF/G, GA/G, TOA, PP%, PK% — same schema for all pills; individual cells show "—" where data is unavailable for that mode.
- **Playlist-to-pill mapping** (explicit, in `page.tsx` comments):
  - 6s → `eashl_6v6` / `clubs_6v6` (primary EASHL 6v6)
  - 6s+G → `6_player_full_team` / `clubs_6_players` (full-squad mode)
  - 3s → `eashl_3v3` / `clubs_3v3` (primary EASHL 3v3; Threes excluded)
  - All → GP/W/L/OTL summed; GF/G and GA/G weighted by GP; TOA/PP%/PK% → "—" (can't cross-mode average)
- **Live NHL 26:** All, 6s, 3s pills use local `club_game_title_stats` aggregates. GF/G and GA/G computed from goals totals. 6s+G → "—" (live pipeline doesn't split sub-modes). TOA/PP%/PK% → "—" (not tracked live).
- **Batch query updated:** `getHistoricalClubTeamStatsBatch` now returns `avgGoalsFor`, `avgGoalsAgainst`, `avgTimeOnAttack`, `powerPlayPct`, `powerPlayKillPct` alongside the existing GP/W/L/OTL fields.
- **Section reorder:** Latest Result → Roster Spotlight → Scoring Leaders → Title Records → Recent Results → Division Standing.
- **Verification:** lint clean, build 4/4, smoke check confirmed all 4 pills, 10 stat columns, 5 title rows (correct GP totals: NHL 26=59, NHL 25=250, NHL 24=866, NHL 23=507, NHL 22=372). Section order confirmed correct in rendered HTML.

---

## Session Summary — 2026-05-04 (earlier)

### Homepage cross-title records table

Replaced the old "Club Record" strip (single-title, mode-filtered) with a compact cross-title comparison table.

- **New query:** `getHistoricalClubTeamStatsBatch(gameTitleIds[])` in `packages/db/src/queries/historical-club-team.ts`. Fetches reviewed, `games_played > 0` rows for multiple title IDs in one DB call. Callers group by `gameTitleId` and map playlist slugs to logical columns.
- **Column mapping** (explicit, documented in page.tsx):
  - **6v6** → `eashl_6v6` / `clubs_6v6` (primary competitive matchmaking mode per era)
  - **Full Team** → `6_player_full_team` / `clubs_6_players` (full 6-player squad required incl. goalie)
  - **3v3** → `eashl_3v3` / `clubs_3v3` (primary competitive 3v3; excludes Threes casual mode)
  - NHL 26 (live): 6v6 and 3v3 sourced from local `club_game_title_stats` mode aggregates. Full Team column shows "—" — live data does not split sub-modes.
- **Table structure:** 5 rows (NHL 26 → NHL 22), 10 columns (Title + GP/W-L-OT/W% × 3 modes). Footer note clarifies data sources and live row limitation.
- **Visual:** NHL 26 row highlighted with accent background + "LIVE" badge. Mode filter (All/6s/3s) moved from record header to Roster Spotlight section where it actually applies.
- **Removed:** `RecordStrip`, `OfficialRecordUnavailable`, `LocalModeRecordStrip` components (all replaced by the table). `ClubSeasonalStats` no longer imported in page.tsx.
- **Verification:** lint clean, build 4/4, homepage smoke check confirmed all 5 title rows, all 3 mode columns, "LIVE" badge, mode filter in Roster Spotlight.

---

## Session Summary — 2026-05-03 (latest)

### Historical club-team totals wired into /stats

- **New query:** `getHistoricalClubTeamStats(gameTitleId, gameMode)` in `packages/db/src/queries/historical-club-team.ts`. Filters `review_status = 'reviewed'` and `games_played > 0`. Maps `GameMode | null` to playlist slugs via explicit constant arrays (no `game_mode` column on the table).
- **Exported** from `packages/db/src/queries/index.ts` as `export * from './historical-club-team.js'`.
- **UI:** New `ArchiveClubTeamSection` component in `apps/web/src/app/stats/page.tsx`. Renders a scrollable table with Playlist, GP, W, L, OTL, W%, GF/G, GA/G, TOA, PP%, PK% columns. Appears only for archive title views (guarded by `teamRows.length > 0` inside `ArchiveStats`). Live `/stats` route (no title param) unaffected.
- **Playlist labels:** `PLAYLIST_LABEL` constant maps raw DB slugs to display labels (e.g., `eashl_6v6` → `EASHL 6v6`). Falls back to raw slug if unknown.
- **Verification:** `pnpm --filter web lint` clean. `pnpm build` passes (4/4 tasks). Smoke checks confirm:
  - `/stats?title=nhl25` renders "Club team records" section with EASHL 6v6 / EASHL 3v3 / Threes rows, GF/G, PP%, TOA columns present.
  - `/stats` (live) has no "Club team records" section, existing stats render normally.

---

## Session Summary — 2026-05-03 (third)

### Historical club-team stats — reviewed JSON imported and verified

- **Source:** `tools/historical_import/club_team_stats/reviewed-club-team-stats.json` (17 records, NHL 22–25, hand-checked against `research/Previous_NHL_Stats/EXTRACT_TABLES_Hand_Checked.md`)
- **Import command:** `pnpm --filter @eanhl/db import:club-team <abs-path>/reviewed-club-team-stats.json`
- **Run 1:** `imported: 15, updated: 2, skipped: 0`
  - The 2 "updated" rows (`nhl24/eashl_3v3` and `nhl24/eashl_6v6`) existed from a prior hand-keyed pilot batch and were re-stamped to `importBatch = handchecked-2026-05-03`. Prior batch label is lost — if audit lineage matters, it was the original pilot import.
- **Run 2 (idempotency check):** `imported: 0, updated: 17, skipped: 0` — row count unchanged at 17. Fully idempotent.
- **DB state after import:**
  - `historical_club_team_stats` total rows: **17**
  - All 17 rows: `import_batch = handchecked-2026-05-03`, `review_status = reviewed`
  - Coverage verified: nhl22 (clubs_3v3, clubs_6_players, clubs_6v6, threes) · nhl23 (same) · nhl24 (6_player_full_team, eashl_3v3, eashl_6v6, quickplay_3v3, threes) · nhl25 (6_player_full_team, eashl_3v3, eashl_6v6, threes)
  - Representative spot-checks: `nhl22/clubs_6v6` (gp=29, pp_pct=20.90, toa=07:05) and `nhl25/eashl_6v6` (gp=89, pk_pct=80.10, toa=07:06) both match source exactly.
  - `raw_extract_json` confirmed to preserve `win_differential`, `faceoffs_lost`, `shutouts`, `penalty_shot_goals`, `penalty_shots`, `power_play_goals_against`, and threes-specific elim/round fields.
- **No code changes required.** Importer was already correct after the fix in the prior session.

---

## Session Summary — 2026-05-03 (later)

### Remediation pass — historical importer + query layer

Targeted fixes against issues surfaced in the project review.

- **Club-team importer fix.** `packages/db/src/tools/import-club-team-reviewed.ts` previously did a two-query/intersection lookup with a title-wide `LIMIT 1` and a playlist filter that was not scoped to the title. Re-importing an existing reviewed row could fall through to INSERT and trip the `(game_title_id, playlist)` unique index. Replaced with a single `WHERE game_title_id = X AND playlist = Y` lookup. Re-imports are now idempotent.
- **Historical club-member queries — semantics changed.** All four exported functions in `packages/db/src/queries/historical-club-member.ts` (`getClubMemberSkaterStats`, `getClubMemberGoalieStats`, `getClubMemberSkaterStatsAllModes`, `getClubMemberGoalieStatsAllModes`) now:
  - filter `review_status = 'reviewed'` explicitly (matches the player-card path; `pending_review` / `needs_identity_match` rows never reach the UI),
  - use `LEFT JOIN players` with `COALESCE(players.gamertag, gamertag_snapshot)` so unmatched rows (`player_id IS NULL`) survive and are visibly listed instead of silently dropped,
  - in the all-modes variants, group on a synthetic identity key (`'p:' || player_id` or `'g:' || lower(gamertag_snapshot)`) so unmatched rows aggregate independently of any existing matched rows.
- **`HistoricalSkaterStatsRow.playerId` / `HistoricalGoalieStatsRow.playerId` widened to `number | null`.** `apps/web/src/components/stats/skater-stats-table.tsx` and `goalie-stats-table.tsx` updated to render unmatched rows as a non-link span (`title="Unmatched gamertag — no current player profile"`) instead of a `/roster/<id>` link. Sort key falls back to `g${gamertag}` when `playerId` is null.
- **Combined-mode goalie GAA fix.** `getClubMemberGoalieStatsAllModes` previously computed a GA-weighted average of per-row GAAs (mathematically wrong). Replaced with the canonical season-level definition: `combined_gaa = SUM(total_goals_against) / SUM(goalie_gp where GA non-null)`, treating each `goalie_gp` as a 60-minute game, which is how the in-game leaderboard reports it. (No TOI is captured for the club-member source, so this is the most defensible aggregation available.)
- **Web hygiene.** Removed ~145 lines of dead code in `apps/web/src/app/roster/[id]/page.tsx` (`MODE_LABELS`, `gameModeHref`, `gameLogPageHref`, `GameModeFilter`, `GameLogPaginationNav`, `GameLog`, `GameLogDataRow`, unused `GameLogRow` alias) — all superseded by `<PlayerGameLogSection>`. Removed four unused historical-query imports in `apps/web/src/app/roster/page.tsx`. Cleared remaining `apps/web` lint failures (inline `import()` types in `stats/page.tsx`, `type` vs `interface` in `title-resolver.ts`, unused `goalieScore` in `match-recap.ts`, and surgical fixes to redundant null checks / non-null assertions in the touched roster files).

Standing rules to keep in mind for any future club-member work:

- The query layer no longer guarantees that returned rows have a non-null `playerId`. Components that need to link to a profile must guard on `playerId !== null`.
- Reviewed-only filtering is now explicit. Importing rows with `reviewStatus: 'pending_review'` or `'needs_identity_match'` will keep them out of the UI until the review pass flips them to `'reviewed'`.
- The combined-mode goalie GAA assumes `goalie_gp` corresponds to standard 60-minute games. If a future title exposes partial-period records, this assumption needs to be revisited.

---

## Session Summary — 2026-05-03

### Club/team stats — third historical source landed end-to-end (review-pending)

Added a third intentionally-separate legacy source for club-level totals from the in-game `STATS → CLUB STATS` screen.

- **Schema:** `historical_club_team_stats` (one row per `(game_title_id, playlist)`). Wide nullable column set covering ~40 metrics — record/W-L, goals, shots, hits, PIM/PP, faceoffs/breakaways/one-timers/blocks, plus `avg_time_on_attack` text. Provenance fields: `source_asset_paths text[]`, `raw_extract_json jsonb`, `import_batch`, `review_status`, `confidence_score`, `notes`. Migration `0019_dashing_the_hood.sql`.
- **Importer:** `packages/db/src/tools/import-club-team-reviewed.ts` (`pnpm --filter @eanhl/db import:club-team`). Transactional UPSERT keyed on `(game_title_id, playlist)`. Rejects unknown metric keys.
- **Hand-keyed pilots imported (DB):** `nhl25 / eashl_6v6` and `nhl25 / eashl_3v3`. 2 canonical rows live in `historical_club_team_stats`.
- **Dedicated extractor:** `tools/historical_import/club_team_stats/extract_club_team_stats.py`. RapidOCR full-image, row clustering by y-centre, label/value pairing per row, greedy known-label-prefix split for cross-column glued labels. Outputs the exact reviewed-pilot JSON shape with `reviewStatus='pending_review'`. No reuse of the player-card video extractor or the club-member member-table extractor.
- **Review queue across NHL 22–25:** `tools/historical_import/club_team_stats/run_review_queue.py` ran the extractor over all 17 logical playlist pairs (4 NHL 22 + 4 NHL 23 + 5 NHL 24 + 4 NHL 25). 17 reviewable JSONs written, 0 failures. Aggregate index at `_review_index.json` with per-playlist confidence, label-glue null counts, arithmetic-sanity flags, and pilot-comparison data where a hand-keyed pilot exists.
- **Validation against hand-keyed pilots (NHL 25):** `eashl_6v6` extractor → 36/39 matches, **0 mismatches**. `eashl_3v3` extractor → 18/26 matches; 4 of the 6 mismatches are pilot-data errors the extractor caught (e.g. `hits_per_game 7.5` confirmed by `836/111`; pilot had `1.5`).
- **No DB import for the queue.** Per the brief, the queue is a review surface, not blind ingestion. The user is the final reviewer.

Tooling under `tools/historical_import/club_team_stats/`:

- `extract_club_team_stats.py` — extractor
- `run_review_queue.py` — driver across all titles/playlists
- `compare_to_pilot.py` — diff extractor output vs hand-keyed pilot
- `augment_review_index.py` — post-process index with pilot comparison
- `_review_index.json` — aggregate review summary
- `nhl25_eashl_6v6_pilot.json`, `nhl25_eashl_3v3_pilot.json` — hand-keyed truth (preserved, not overwritten)
- `<title>__<playlist>.extract.json` × 17 — extractor outputs, distinct filename pattern from hand-keyed pilots

### Identity reconciliation pass

- `Stick Menace` (`players.id=3`, active) ↔ `StickMenace` (`players.id=22`, inactive) collapsed. 18 `historical_player_season_stats` rows reassigned to `id=3`. `player_gamertag_history` for `id=3` now has `StickMenace` as a closed historical era (2021-09 → 2023-08) and `Stick Menace` as the open current entry. `id=22` deleted.
- No collision risk: `id=3` had zero `historical_player_season_stats` rows; the merge was free.
- All other historical-source identity mismatches (`HenryTheBobJ`, `AwesomeLion50`, etc.) are by-design `gamertag_snapshot` preservation — `player_id` was already correct in those cases.
- Final scan: zero same-simplified-name duplicates remaining across the 23 `players` rows; zero unmatched `historical_club_member_season_stats` rows.

### Cleanup at end of session

- Removed two duplicate extractor outputs that lived under `research/Previous_NHL_Stats/NHL_25/nhl25_eashl_*.extract.json` (validation-pass leftovers). Canonical home for extractor outputs is `tools/historical_import/club_team_stats/<title>__<playlist>.extract.json`.

### What's next (no active workstream — all of these are optional)

1. **Reviewer pass on the 17 club-team-stats extract JSONs.** Per-playlist burden: 0–5 label-glue nulls to fill from the screenshot, plus one arithmetic anomaly to verify (`nhl24/eashl_6v6 pim=144420` looks doubled-up). Once reviewed, flip `reviewStatus` to `reviewed` and run `import:club-team` to land them in the DB.
2. **Schema expansion** for currently-unmodelled labels in club/team stats: `Win Differential`, `Faceoffs Lost`, `Power Play Goals Against`, `Breakaway Goals`, `Avg Pass Attempts`, `Penalty Shot Goals`, `Penalty Shots`, `Shutouts`. Each is preserved verbatim in `rawExtract` so re-extraction is unnecessary.
3. **UI surfacing of club/team stats.** Currently nothing on `/stats` or `/roster` reads `historical_club_team_stats`. Out of scope until the review pass lands DB rows.
4. **Cross-title playlist normalisation.** NHL 22/23 use `clubs_*` playlist labels; NHL 24/25 use `eashl_*`. Stored as raw labels today. Decide later whether to add a `playlist_normalised` column or a lookup.

---

## Session Summary — 2026-05-02

### Historical Stats Import (NHL 22–25) — Complete

Two distinct legacy historical sources are now live and intentionally separate:

1. `historical_player_season_stats`
- player-card season totals
- broader player totals
- may include games for other clubs

2. `historical_club_member_season_stats`
- club-scoped member totals from `CLUBS -> MEMBERS` screenshots
- authoritative for "what this player did for the BGM in that title"

Third historical source (built, not yet fully reviewed/imported across titles):

3. `historical_club_team_stats`
- club/team totals from `STATS -> CLUB STATS` screenshots
- one row per `(game_title_id, playlist)`
- intended to become the authoritative legacy club-total source once the review queue is promoted and imported

Player-card pipeline counts below are reviewed rows in `historical_player_season_stats`.

| Title | Reviewed rows |
|---|---:|
| nhl22 | 43 |
| nhl23 | 39 |
| nhl24 | 46 |
| nhl25 | 31 |
| **total** | **159** |

Club-member pipeline counts below are canonical rows in `historical_club_member_season_stats`.

| Title | Skater | Goalie |
|---|---:|---:|
| nhl22 | 7 | 3 |
| nhl23 | 6 | 3 |
| nhl24 | 8 | 4 |
| nhl25 | 10 | 1 |
| **total** | **31** | **11** |

Pipeline status:

- Extractor (`tools/historical_import/extract_review_artifacts.py`) validated across NHL 22–25.
- Importer (`packages/db/src/tools/import-historical-reviewed.ts`) stable; pool teardown closes via `await sql.end({ timeout: 5 })` in try/finally.
- GPU OCR working on RTX 3060 with explicit CUDA env (`OCR_USE_CUDA=1`, `OCR_INTRA_THREADS=1`, `OCR_INTER_THREADS=1`) and `LD_LIBRARY_PATH` pointing at the pip-bundled CUDA libs in the venv.
- Performance optimization is **not** the active workstream anymore. The kept improvements are: video-static-context cache (filters/footer_gamertag/highlight_rank only — `footer_summary` deliberately excluded), `cv2.grab/retrieve` skip-frame pattern, env-driven CUDA. The dHash-based header cache was rejected (0% hit rate against continuously scrolling tables) and reverted.

### Club/Team Stats Screenshot Pipeline — Review Queue Generated

The third historical source is no longer hypothetical.

Built:

- Schema: `historical_club_team_stats`
- Migration: `0019_dashing_the_hood.sql`
- Importer: `packages/db/src/tools/import-club-team-reviewed.ts`
- Extractor: `tools/historical_import/club_team_stats/extract_club_team_stats.py`
- Queue driver: `tools/historical_import/club_team_stats/run_review_queue.py`
- Review index: `tools/historical_import/club_team_stats/_review_index.json`

Current state:

- 17 logical playlist pairs discovered across NHL 22–25 (`4 + 4 + 5 + 4`)
- all 34 `club_stats__*.png` files extracted successfully
- one reviewable `*.extract.json` file generated per playlist
- OCR confidence per playlist is consistently high (`0.97–0.99`)
- dominant review burden is still top-row label glue creating 0–5 nulls per playlist
- one obvious arithmetic/OCR anomaly remains flagged for manual review:
  - `nhl24 / eashl_6v6` `pim = 144420`

Hand-keyed/imported pilot state:

- `nhl25 / eashl_6v6` pilot proven
- `nhl25 / eashl_3v3` pilot proven
- those two pilots validated the `(game_title_id, playlist)` grain and the wide-nullable schema design

Important rule:

- extractor outputs are review-assisted only
- do **not** blind-import the generated queue
- reviewer must fill label-glue nulls and correct obvious OCR shape errors first

Operational rules for any future OCR run:

- Use the GPU env. Don't run two OCR batches in parallel on one GPU.
- One title batch at a time.
- First inference on a fresh process is slow (model/runtime warmup).
- Salvage strategy on bad OCR fields: leave the typed column null rather than store a clipped value. Raw OCR remains in `stats_json` regardless.

### Website — Legacy Integration

Legacy seasons live inside the main routes (Hockey-Reference style). The dedicated `/archive/*` routes are deleted.

- `/stats` and `/roster` accept `?title=nhlXX` for any active or legacy title and render the appropriate view.
- Title selector pill bar shows all five titles (NHL 26 | 25 | 24 | 23 | 22). Active titles get a green dot. Selector + mode filter sit inline above the stats tables.
- For legacy titles:
  - `/roster` is club-scoped only and renders from `historical_club_member_season_stats`.
  - `/stats` renders two clearly-labeled sections:
    - `Club-scoped totals` from `historical_club_member_season_stats`
    - `Player-card season totals` from `historical_player_season_stats`
  - Chemistry, recent matches, depth chart, and team averages are hidden with explanatory copy.
- Player profile (`/roster/[id]`) — career-row Season cells link to `/stats?title=<slug>`. No per-title view on the profile itself.
- `/`, `/games`, `/games/[id]` remain NHL-26-only (live data) by design.
- `/archive/stats` and `/archive/roster` return 404.

Sanity-check verified end-to-end: every title × mode combination renders correctly; legacy views correctly hide live-only sections; the salvaged silky NHL 25 6s goalie row renders without crashing.

### Identity Reconciliation

- HenryTheBobJ (typo split) collapsed into HenryTheBobJr. 14 historical player-card rows reassigned via `BEGIN; UPDATE historical_player_season_stats SET player_id=1 WHERE player_id=19; DELETE FROM player_gamertag_history WHERE player_id=19; DELETE FROM players WHERE id=19; COMMIT;`.
- StickMenace (OCR/no-space) collapsed into Stick Menace. 18 player-card rows reassigned to `players.id=3`.
- Flopfish8015 and Utiz23 are represented as historical alt identities through `player_gamertag_history`; club-member rows were reconciled onto JoeyFlopfish and silkyjoker85 respectively.
- AwesomeLion50 resolves to AwesomeLion through `player_gamertag_history`.
- `adolph151` remains a separate retired member (`players.is_active=false`) and is intentionally preserved.
- `player_gamertag_history` and `gamertag_snapshot` fields still preserve legacy/typo strings for audit purposes — that's intentional, not a bug.

### Known Caveats (current truth, no fixes planned)

- `/stats?title=nhl99` (and any unknown slug) renders the NHL 26 default content correctly, but Next caches the redirect destination at the requested URL, so the address bar stays cosmetically `?title=nhl99`. Functionally correct, cosmetically stale. Not worth fixing.
- One salvaged historical row — `silkyjoker85` NHL 25 6s goalie — has `save_pct`, `total_saves`, and `total_shots_against` set to NULL by design (OCR clipped `save_pct` to "4675.000%"). Other typed fields (GP/W/L/OTL/GAA/GA) are valid. Renders as `—` in null cells.
- Club-member provenance is append-only by design. Re-imports grow `historical_club_member_stat_sources`; they do not rewrite prior provenance rows.
- Some club-member metrics are honestly null because the screenshots never exposed them for that title/view combination.

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

Current most likely follow-ups:

- **`historical_club_team_stats` UI surfacing** — 17 rows are now imported and reviewed. Nothing on `/stats` or `/roster` reads this table yet. Next step is to decide what to surface and build the query + component.
- **Legacy table enrichment** — surface club-member-only fields already in DB (`blocked_shots`, `giveaways`, `takeaways`, `interceptions`, `shots`, `shooting_pct`, `shutout_periods`) if/when useful.
- **Discord alerting cron** — `localhost:3001/health`, notify when stale >30 min.
- **`pg_dump` backup cron** — daily dump to external drive.
- **Player profile: EA season TOI** — long-duration format (`17d 22h 47m`); reference ratio ≈ 78% of platform total game time (silkyjoker85 NHL 26 reference); use as backfill estimate only, not claimed stat.

### Deferred

- Chemistry heatmap — revisit at ~80–100+ match depth.
- Hot-zone / rink shot maps — blocked by missing spatial data in EA payload.
- Content season filtering — schema supports it; no UI.

---

## Standing Architectural Decisions

### Data sources

- `gameMode === null` (active title) → `ea_member_season_stats` → labeled "EA season totals".
- `gameMode !== null` (active title) → `player_game_title_stats` → labeled "local tracked 6s / 3s".
- Legacy `/roster` → `historical_club_member_season_stats` → labeled "Club-scoped totals".
- Legacy `/stats` → two separate sections:
  - `historical_club_member_season_stats` → "Club-scoped totals"
  - `historical_player_season_stats` → "Player-card season totals" with explicit warning that they may include other clubs.
- Legacy club/team totals → `historical_club_team_stats` (17 rows imported, reviewed). UI not yet built — no surface reads this table.
- **Do not blend sources.** EA totals ≠ local aggregates ≠ player-card legacy totals ≠ club-member legacy totals ≠ club/team screenshot totals. Never substitute silently.

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
- Depth chart uses `ea_member_season_stats`; live stats tables use `player_game_title_stats`.
- Legacy roster is intentionally club-scoped and uses `historical_club_member_season_stats` only.
- Depth chart is intentionally hidden on legacy views — match-level data is not captured for those titles.

---

## Locked Schema Decisions

| Decision | Implementation |
|---|---|
| Match uniqueness composite | `UNIQUE(game_title_id, ea_match_id)` on `matches` + `raw_match_payloads`; surrogate bigserial PK |
| `players.ea_id` nullable | Permanently — blazeId absent in all real match payloads |
| Goalie stats same table | Nullable goalie columns in `player_match_stats` |
| Aggregate unique index | `UNIQUE(player_id, game_title_id, COALESCE(game_mode, ''))` — handles NULL game_mode |
| Historical aggregate unique index | `UNIQUE(game_title_id, player_id, game_mode, position_scope, role_group)` |
| Club-member unique indexes | matched: `UNIQUE(game_title_id, game_mode, role_group, player_id)` where `player_id IS NOT NULL`; unmatched: `UNIQUE(game_title_id, game_mode, role_group, lower(gamertag_snapshot))` where `player_id IS NULL` |
| `transform_status` | `('pending', 'success', 'error')` |
| `result` | `('WIN', 'LOSS', 'OTL', 'DNF')` |

---

## What's Built

| Surface | Status |
|---|---|
| `/` Home | Live — club record, latest result, player carousel, leaders, recent results (NHL 26 only by design) |
| `/games`, `/games/[id]` | Live — paginated list, mode filter, form strip, trend bullets, quality badges (NHL 26 only) |
| `/stats` | Live + legacy — title selector across all 5 titles; live view has chemistry + recent + team averages; legacy view shows `Club-scoped totals` and `Player-card season totals` separately |
| `/roster` | Live + legacy — same selector; legacy view is club-scoped only and hides depth chart |
| `/roster/[id]` | Live — hero, radar, recent form, game log, career stats with per-season `?title=` links, EA totals, gamertag history |

---

## Key Files

| File | Purpose |
|---|---|
| `docs/ARCHITECTURE.md` | System architecture + schema reference |
| `docs/ROADMAP.md` | Product direction + near-term build order |
| `research/investigations/` | Bug logs, design decisions, API research |
| `packages/db/src/schema/` | Drizzle table definitions (canonical) |
| `packages/db/src/schema/historical-club-member-season-stats.ts` | Club-scoped historical member rows + provenance tables |
| `packages/db/src/schema/historical-club-team-stats.ts` | Club/team historical totals per `(game_title_id, playlist)` |
| `packages/db/src/queries/historical.ts` | Reviewed-only historical queries (mode-specific + all-modes aggregating) |
| `packages/db/src/queries/historical-club-member.ts` | Club-scoped historical member queries used by legacy `/stats` and `/roster` |
| `packages/db/src/queries/game-titles.ts` | `listGameTitles` (active), `listArchiveGameTitles` (inactive), slug resolvers |
| `packages/db/src/tools/import-historical-reviewed.ts` | Reviewed-row importer for `historical_player_season_stats` |
| `packages/db/src/tools/import-club-member-reviewed.ts` | Reviewed-row importer for `historical_club_member_season_stats` |
| `packages/db/src/tools/import-club-team-reviewed.ts` | Reviewed-row importer for `historical_club_team_stats` |
| `apps/web/src/lib/title-resolver.ts` | Unified active+archive slug resolver used by `/stats` and `/roster` |
| `apps/web/src/components/title-selector.tsx` | TitleSelector / ModeFilter / EmptyState / `statsSourceLabel` |
| `apps/worker/src/transform.ts` | Raw EA payload → structured DB types |
| `apps/worker/src/aggregate.ts` | Precompute player/club aggregates |
| `apps/web/src/lib/match-recap.ts` | View-model builders for `/games/[id]` |
| `tools/historical_import/extract_review_artifacts.py` | OCR-driven extractor for legacy stat-table videos |
| `tools/historical_import/club_team_stats/` | Club/team screenshot extractor, pilot JSONs, and generated review queue |
