# Club-only Badges and Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Badge values and card levels count club games only (from the worker's per-game records), with EA totals used only for dekes, fights and breakaways; ladders resized for a ~300-game club season; one silent switch-over on live.

**Architecture:** The pure merge (`packages/db/src/cards/season-totals.ts`) takes per-game club totals plus three EA-only columns. The loader (`loadSeasonTotals` in `packages/db/src/queries/card-mythics.ts`) builds those totals in SQL from `player_match_stats` ⨝ `matches`. The recompute planner gets a `rebase` mode (no events, no never-downgrade, manual cards untouched) that the `card-recompute` CLI runs once, after it deletes the old NHL 27 card history.

**Tech Stack:** TypeScript (strict), Drizzle `sql` templates on postgres.js, `node:test`, Next.js 15 (badge UI), Docker Compose on Hotel-Echo.

**Spec:** `docs/superpowers/specs/2026-10-26-club-only-badges-design.md`

## Global Constraints

- Start the build only after the news desk release (operator, 2026-10-26).
- Work on branch `feat/club-only-badges` in a worktree; merge to `main` only after Task 4.
- "Club games" = all three match types (`gameType5`, `gameType10`, `club_private`); no match-type filter.
- Count rows like `player_game_title_stats` does: no `removed_reason` filter; DNF games count, except where a rule below names `player_dnf`.
- EA-sourced families are exactly `pdekes`, `pfight`, `pbrk`. All other 18 families are club-sourced.
- No schema change and no migration.
- Nothing writes to the live database before Task 5. Earlier live reads go through the read-only tunnel: `ssh -N -L 127.0.0.1:5434:127.0.0.1:5433 hotel-echo`, URL `postgresql://eanhl:<HE POSTGRES_PASSWORD>@127.0.0.1:5434/eanhl?default_transaction_read_only=on` in a mode-600 scratch file. Delete the file and stop the tunnel after use.
- Green gates: `pnpm --filter <pkg> typecheck`, the named `node --test` files, `pnpm exec prettier --check <files>`. `pnpm lint` is red repo-wide; do not chase it.
- After any change in `packages/db/src/`, run `pnpm --filter @eanhl/db build` before typechecking web or worker.
- Dates in output and docs: America/Edmonton.
- Operator-facing text (labels, docs, journal) in plain, short, active sentences.

## Review Focus

1. A NULL stat column in an older `player_match_stats` row must count as 0, not turn the whole sum NULL. → Task 1 spot check counts NULL rows and checks no value is NULL.
2. A player with skater and goalie games in one title (silkyjoker85, JoeyFlopfish): `pwins` counts each won game once; `gw`, `gsv`, `gdsv`, `gpoke`, `gso`, `gg` count only goalie rows. → Task 1 test `club totals map to families` and Task 1 spot check.
3. A goalie DNF game with 0 goals against is not a shutout and not a completed game. → Task 1 SQL rule and spot check.
4. A hand-awarded mythic card (Utiz23, pool `manual`) is unchanged by the rebase, and its `mythic_awarded` event survives the history delete. → Task 2 tests.
5. `--rebase --dry-run` deletes nothing and writes nothing. → Task 2 Step 6 and Task 5 Step 4.

---

### Task 1: Badge totals from per-game club records

**Files:**

- Modify: `packages/db/src/cards/badge-catalog.ts` (`BadgeFamily`, `BADGE_FAMILIES`)
- Modify: `packages/db/src/cards/season-totals.ts`
- Modify: `packages/db/src/queries/card-mythics.ts` (`loadSeasonTotals`)
- Test: `packages/db/src/cards/season-totals.test.ts`, `packages/db/src/cards/badge-catalog.test.ts`

**Interfaces:**

- Produces:
  - `BadgeFamily.source: 'club' | 'ea'` (new required field).
  - `export interface ClubTitleTotals { playerId: number; gameTitleId: number; wins: number; goals: number; assists: number; shots: number; hatTricks: number; hits: number; faceoffWins: number; takeaways: number; blockedShots: number; goalieGamesCompleted: number; goalieWins: number; goalieSaves: number; goalieDesperationSaves: number; goaliePokeChecks: number; goalieShutouts: number }`
  - `export interface EaOnlyTotals { playerId: number; gameTitleId: number; dekesMade: number; fightsWon: number; breakaways: number }`
  - `SeasonTotalsInput = { club: readonly ClubTitleTotals[]; eaOnly: readonly EaOnlyTotals[]; recordedModes: …; recordedSixesWithGoalie: … }` (the last two unchanged).
  - `EaTitleTotals` is removed. `mergeSeasonTotals(input: SeasonTotalsInput): SeasonTotals` keeps its name and return type.

- [ ] **Step 1: Write the failing tests**

In `badge-catalog.test.ts`, test `only dekes, fights and breakaways come from EA`:

```ts
const ea = BADGE_FAMILIES.filter((f) => f.source === 'ea')
  .map((f) => f.id)
  .sort()
assert.deepEqual(ea, ['pbrk', 'pdekes', 'pfight'])
assert.ok(BADGE_FAMILIES.every((f) => f.source === 'club' || f.source === 'ea'))
```

In `season-totals.test.ts`, replace the `ea(...)` helper with `club(...)` and `eaOnly(...)` helpers (all fields 0 by default). Replace the first test with `club totals map to families; EA-only fills dekes, fights, breakaways`: one `club(1, 7, {...})` row with distinct values 1..15 and one `eaOnly(1, 7, { dekesMade: 21, fightsWon: 22, breakaways: 23 })` row. Assert every family: `pwins=wins`, `pgoals`, `pasts`, `pshots`, `pht=hatTricks`, `phits`, `pfo`, `ptka`, `pblk`, `gg`, `gw`, `gsv`, `gdsv`, `gpoke`, `gso` from the club row; `pdekes=21`, `pfight=22`, `pbrk=23`. Add test `a player with only an EA-only row gets a card with zero club values` (all 18 club families 0). Keep the existing mode and 6s-with-goalie tests, updated to the new input shape.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @eanhl/db build`
Expected: FAIL (tsc errors: `source` missing, `club`/`eaOnly` not in `SeasonTotalsInput`).

- [ ] **Step 3: Implement**

Add `source` to every entry of `BADGE_FAMILIES`. In `season-totals.ts` replace the `ea` loop with a `club` loop and an `eaOnly` loop; `pwins` now takes `wins` alone (the old skater + goalie sum is gone). Update the file header comment to name the new sources and the spec. Fix every other importer of `EaTitleTotals` (`grep -rn EaTitleTotals packages apps --include=*.ts`); the loader change below is part of this task because the package does not build without it.

- [ ] **Step 4: Replace the EA query in `loadSeasonTotals` (`packages/db/src/queries/card-mythics.ts`) with two queries**

1. Club query over `player_match_stats p JOIN matches m ON m.id = p.match_id WHERE m.game_title_id IN (…)`, `GROUP BY p.player_id, m.game_title_id`. Every SUM wraps the column in `COALESCE(…, 0)` and the result in `COALESCE(SUM(…), 0)`. Rules (from the spec table):
   - `wins`: `COUNT(DISTINCT m.id) FILTER (WHERE m.result = 'WIN')`
   - `hatTricks`: `COUNT(*) FILTER (WHERE p.goals >= 3)`
   - `goals`, `assists`, `shots`, `hits`, `faceoffWins` (`faceoff_wins`), `takeaways`, `blockedShots` (`blocked_shots`): sums over all rows
   - `goalieGamesCompleted`: `COUNT(DISTINCT m.id) FILTER (WHERE p.is_goalie AND NOT COALESCE(p.player_dnf, false))`
   - `goalieWins`: `COUNT(DISTINCT m.id) FILTER (WHERE p.is_goalie AND m.result = 'WIN')`
   - `goalieSaves` (`saves`), `goalieDesperationSaves` (`desp_saves`), `goaliePokeChecks` (`pokechecks`): sums `FILTER (WHERE p.is_goalie)`
   - `goalieShutouts`: `COUNT(DISTINCT m.id) FILTER (WHERE p.is_goalie AND NOT COALESCE(p.player_dnf, false) AND COALESCE(p.goals_against, 0) = 0)`
   - Cast every aggregate `::int`.
2. EA-only query: `dekes_made`, `fights_won`, `breakaways` from `ea_member_season_stats` (COALESCE 0).
   Keep the two recorded-mode queries as they are. Update the doc comment on `loadSeasonTotals`. Its signature stays `loadSeasonTotals(titleIds: readonly number[]): Promise<SeasonTotals>`; the worker, the `card-mythic` CLI and the admin page call it unchanged.

- [ ] **Step 5: Run the tests, build and typecheck all consumers**

Run: `pnpm --filter @eanhl/db build && node --test packages/db/dist/cards/season-totals.test.js packages/db/dist/cards/badge-catalog.test.js && pnpm --filter @eanhl/worker typecheck && pnpm --filter web typecheck`
Expected: all tests PASS, no type errors.

- [ ] **Step 6: Spot-check against live data (read-only tunnel, see Global Constraints)**

Run a small Node script from the scratchpad that imports `loadCardTitles` and `loadSeasonTotals` from `packages/db/dist/queries/index.js` (with `DATABASE_URL` from the read-only URL file) and prints the NHL 27 values for Stick Menace, silkyjoker85, JoeyFlopfish and Matteo Lehmann. Compare with direct SQL over the tunnel:

```sql
SELECT p.gamertag, SUM(s.goals) g, SUM(s.hits) h, COUNT(*) FILTER (WHERE s.goals >= 3) ht,
  COUNT(DISTINCT m.id) FILTER (WHERE m.result = 'WIN') w,
  COUNT(DISTINCT m.id) FILTER (WHERE s.is_goalie AND m.result = 'WIN') gw,
  COUNT(*) FILTER (WHERE s.goals IS NULL OR s.saves IS NULL) null_rows
FROM player_match_stats s JOIN matches m ON m.id = s.match_id JOIN players p ON p.id = s.player_id
WHERE m.game_title_id = 7 AND p.gamertag IN ('Stick Menace','silkyjoker85','JoeyFlopfish','Matteo Lehmann')
GROUP BY 1;
```

Expected: the loader's values equal the SQL; no value is NULL or NaN; Stick Menace's `pwins` is at most the club's NHL 27 win count (46 on 2026-10-26), not EA's 66. Delete the scratch script afterwards.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/cards/ packages/db/src/queries/card-mythics.ts
git commit -m "feat(cards): badge totals from per-game club records; only dekes, fights, breakaways from EA"
```

### Task 2: Silent rebase mode (planner, worker, CLI)

**Files:**

- Modify: `packages/db/src/cards/recompute-plan.ts`
- Test: `packages/db/src/cards/recompute-plan.test.ts`
- Modify: `apps/worker/src/card-progression.ts`, `apps/worker/src/card-recompute-cli.ts`

**Interfaces:**

- Produces:
  - `planCardRecompute(totals, storedStanding, storedLevels, laddersOf = …, opts: { rebase?: boolean } = {}): PlannedPlayer[]`
  - `recomputeCardProgression(opts: { dryRun: boolean; rebase?: boolean }): Promise<RecomputeResult[]>`
  - CLI: `pnpm --filter @eanhl/worker card-recompute [--dry-run] [--rebase]`

- [ ] **Step 1: Write the failing tests** in `recompute-plan.test.ts`:
  - `rebase lowers a stored tier to the computed standing and emits no events`: stored standing `{tier: 3, level: 2, pool: 'skater', mythicTheme: null}`, stored levels all 13, totals that compute to tier 1 → planned `standing.tier === 1`, `events.length === 0`, `writeStanding === true`.
  - `rebase keeps a manual standing and does not write it`: stored `{tier: 6, level: 10, pool: 'manual', mythicTheme: 'frozen'}` → planned standing equals stored, `writeStanding === false`, no events.
  - `rebase with a level increase still emits no events`.
  - Existing never-downgrade tests stay unchanged (no `opts`).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @eanhl/db build && node --test packages/db/dist/cards/recompute-plan.test.js`
Expected: FAIL (the rebase cases keep tier 3 / emit events).

- [ ] **Step 3: Implement the planner change**

With `opts.rebase`: standing = `prev?.pool === 'manual' ? prev : computeStanding(values, ladders)`; events = `[]`. Without it: unchanged.

- [ ] **Step 4: Run to verify they pass** (same command). Expected: PASS.

- [ ] **Step 5: Worker and CLI**

In `recomputeCardProgression`: pass `{ rebase }` to `planCardRecompute`. When `rebase` is true:

- before the upserts, inside the same transaction, `DELETE FROM player_card_events WHERE game_title_id IN (<card title ids>) AND kind NOT IN ('mythic_awarded', 'mythic_cleared')` and log `[card-recompute] rebase: deleted N history events` (the linked `discord_unlock_posts` and `discord_card_posts` rows go by `ON DELETE CASCADE`);
- with `dryRun`, run the matching `SELECT count(*)` instead and log `[card-recompute] rebase (dry-run): would delete N history events`.
  The upsert of `player_card_progress` keeps its `setWhere tier_pool <> 'manual'`. In the CLI, parse `--rebase`, add `rebase` to the mode line (`mode=write rebase` / `mode=dry-run (no writes) rebase`), and update the header comment. `ingest.ts` keeps calling `{ dryRun: false }` (no rebase).

- [ ] **Step 6: Verify on live data, read-only**

Run: `pnpm --filter @eanhl/db build && pnpm --filter @eanhl/worker build && pnpm --filter @eanhl/worker typecheck`, then with the read-only tunnel URL: `DATABASE_URL=$(cat <url file>) pnpm --filter @eanhl/worker card-recompute --rebase --dry-run`
Expected: `database=eanhl mode=dry-run (no writes) rebase`; `would delete N history events` with N = the count of NHL 27 non-mythic events (188 on 2026-10-26, more later); a standings table with Utiz23 still T6; exit 0. (The read-only URL also proves no write happened: any write would fail.)

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/cards/recompute-plan.ts packages/db/src/cards/recompute-plan.test.ts apps/worker/src/card-progression.ts apps/worker/src/card-recompute-cli.ts
git commit -m "feat(cards): card-recompute --rebase for the silent club-only switch-over"
```

### Task 3: Size the ladders again (operator approval gate)

**Files:**

- Create: `apps/worker/src/__scripts__/card-ladder-sizing-2026-10.ts` (one-off, dated, like `phase-2b-parallel-diff-2026-05-21.ts`)
- Modify: `docs/superpowers/specs/2026-10-26-club-only-badges-design.md` (new section "Proposed ladders and pace")
- Modify (after approval): `packages/db/src/cards/badge-catalog.ts` (`BADGE_LADDERS`, `AI_GOALIE_LADDERS`, their comments)
- Test: `packages/db/src/cards/badge-catalog.test.ts`, `packages/db/src/cards/progression.test.ts`

**Interfaces:**

- Consumes: `loadCardTitles`, `loadSeasonTotals` (Task 1); `computeStanding`, `laddersFor`, `BADGE_FAMILIES` from `@eanhl/db/cards`.
- Produces: new values in `BADGE_LADDERS` and `AI_GOALIE_LADDERS` only; no new exports.

- [ ] **Step 1: Write the sizing script**

It reads the NHL 27 totals (Task 1 loader) and the club's NHL 27 club-game count (`SELECT count(*) FROM matches WHERE game_title_id = 7`). Then:

1. Projection: each player's season value per family = current value × (300 / club games so far).
2. Regulars = players in at least 50% of the club's games so far.
3. Ceiling per family = the best regular's projected value, rounded to a nice number (spec item 7). AI goalies: same from Lehmann/Wagner, for `gg`, `gw`, `gsv`, `gso` only.
4. Ladder: level L targets `ceiling × (L/30)²`, takes the nearest nice number (multiples of 5 under 100, 10 under 1,000, 50 from 1,000; ceilings under 450 count 1, 2, 3 … up to 12 first, then step in 5s; a ceiling of 50 or less counts 1–25 then 5s; 30 or less counts 1–30), strictly increasing (bump to the next nice number on a tie).
5. Pace: for weeks 1..48, values = projected × week/48; `computeStanding(values, laddersFor(isAi))`; record the first week each tier 2–5 is reached.
6. Print the proposed ladders (level 30, levels 1–10, level 20 per badge, same table form as the 10-08 spec) and the pace table (player, projected games, T2–T5 week).
   The script takes `--ceiling-scale <x>` (default 1.0) to multiply all ceilings, for tuning. Run it on the read-only tunnel.

- [ ] **Step 2: Tune until the pace goal holds**

Goal (spec): regulars reach T5 in weeks 40–48; part-timers finish at T3 or T4. Adjust `--ceiling-scale` or single ceilings. Change `TIER_BARS` only if ladders alone cannot hold the goal, and say so in the doc.

- [ ] **Step 3: Write the proposal into the spec and stop for the operator**

Add section "Proposed ladders and pace (Task 3)" to the design doc: the ladder table, the pace table, the ceiling rule used, and the date of the data. Commit the script and the doc section:

```bash
git add apps/worker/src/__scripts__/card-ladder-sizing-2026-10.ts docs/superpowers/specs/2026-10-26-club-only-badges-design.md
git commit -m "docs(specs): proposed club-only badge ladders and simulated pace"
```

**GATE:** ask the operator to approve the ceilings and the pace table. Do not continue until they approve.

- [ ] **Step 4: Put the approved ladders in the catalog**

Replace `BADGE_LADDERS` and `AI_GOALIE_LADDERS` values; update their comments (club-only, ~300-game season, 2026-10 sizing, link to the spec section). Fix any test in `progression.test.ts` that hard-codes an old threshold so it reads the threshold from the ladder.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @eanhl/db test`
Expected: all PASS, including `nice numbers: multiples of 5 / 10 / 50, plain counts only for rare stats early on` and the 30-level / strictly-increasing checks.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/cards/
git commit -m "feat(cards): resize badge ladders for the club-only season"
```

### Task 4: Label each badge's source in the badge UI

**Files:**

- Modify: `apps/web/src/components/badges/badge-board.ts` (`BadgeRowView`)
- Modify: `apps/web/src/components/badges/player-badges.tsx` (detail panel, under `pb-detail-label`)
- Modify: `apps/web/src/components/badges/player-badges.css` (one small muted text style, if no existing class fits)
- Test: `apps/web/src/components/badges/badge-board.test.ts`

**Interfaces:**

- Consumes: `BadgeFamily.source` (Task 1).
- Produces: `BadgeRowView.sourceText: string`.

- [ ] **Step 1: Write the failing test** `source text: club games vs EA totals`: the row for `pgoals` has `sourceText === 'Counts club games only'`; the rows for `pdekes`, `pfight`, `pbrk` have `sourceText === 'EA season totals · includes drop-ins'`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && node --test src/components/badges/badge-board.test.ts`
Expected: FAIL (`sourceText` undefined).

- [ ] **Step 3: Implement** `sourceText` in the row builder from `family.source`, and render it in the detail panel below the head label.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @eanhl/db build && cd apps/web && node --test src/components/badges/badge-board.test.ts && pnpm --filter web typecheck`
Expected: PASS, no type errors. Optional visual check: `next dev` on the read-only tunnel (login 500s are expected in that mode), open a roster profile, select Goals and then Dekes.

- [ ] **Step 5: Commit, review, merge**

```bash
git add apps/web/src/components/badges/
git commit -m "feat(badges): show whether a badge counts club games or EA totals"
```

Run a whole-branch review, then merge `feat/club-only-badges` to `main` and push.

### Task 5: Switch-over on live (Hotel-Echo)

Runs after the news desk release. Use the `docker-redeploy` skill for build and rollback tags. All commands on Hotel-Echo in `~/eanhl-team-website`.

- [ ] **Step 1: Back up the card tables**

```bash
ssh hotel-echo 'mkdir -p ~/eanhl-backups/manual && docker exec eanhl-team-website-db-1 pg_dump -U eanhl -d eanhl -Fc -t player_card_events -t player_badge_levels -t player_card_progress -t discord_unlock_posts -t discord_card_posts > ~/eanhl-backups/manual/cards-pre-rebase-$(TZ=America/Edmonton date +%F).dump && ls -l ~/eanhl-backups/manual/'
```

Expected: a non-empty `.dump` file.

- [ ] **Step 2: Pull and build the new images; tag rollbacks** (per `docker-redeploy`). Do not start the new worker yet.

- [ ] **Step 3: Stop the worker** so its 5-minute recompute cannot run between the history delete and the rebase: `docker compose stop worker`.

- [ ] **Step 4: Dry run with the new image**

`docker compose run --rm worker <card-recompute CLI from the worker image, see Dockerfile> --rebase --dry-run`
Expected: `mode=dry-run (no writes) rebase`, the would-delete count, Utiz23 still T6, the new tiers. Show the table to the operator before Step 5.

- [ ] **Step 5: Run the rebase** — the same command without `--dry-run`.
      Expected: `deleted N history events`, then the standings table.

- [ ] **Step 6: Start the new worker and web**: `docker compose up -d worker web`.

- [ ] **Step 7: Check**

```sql
SELECT kind, count(*) FROM player_card_events WHERE game_title_id = 7 GROUP BY 1;            -- only mythic_awarded (1)
SELECT p.gamertag, l.family_id, l.value, l.level FROM player_badge_levels l JOIN players p ON p.id = l.player_id
 WHERE l.game_title_id = 7 AND p.gamertag = 'Stick Menace' ORDER BY 2;                        -- pwins ≤ the club's NHL 27 wins, not EA's 66
```

After one worker cycle: no new events unless a club game was played; Discord posted nothing. Open a profile on https://boogeymen.app and check the badge source labels.

- [ ] **Step 8: Records**

Journal entry in `docs/journal/2026-<MM>.md`; update `HANDOFF.md` in place (live versions, rollback tags); update memories `project_member_stats_include_dropins.md` (built and live) and `project_hotel_echo_launch_host.md` (live versions). Commit and push the docs.
