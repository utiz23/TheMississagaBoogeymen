# OCR Mass-Ingest & Eval Program — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the one-video→one-match OCR pipeline into a measured, multi-match, unattended mass-ingest program: split multi-match videos into per-match reels, associate each reel to a DB `match_id` with operator confirm, auto-grade box-score OCR against EA-API truth, and orchestrate a resumable ~100-match run.

**Architecture:** Four milestones built in spec order (③→①→②→④). ③ adds an API-truth accuracy layer (L4) to the existing run-quality report — the measurement backbone everything else is verified against. ① adds a pure `match_split` grouping step between Pass-1 and dispatch. ② adds an `ocr_match_associations` table + fuzzy scorer + `resolve-match-cli` review queue. ④ wraps it all in a batch runner extending `reprocess.py`.

**Tech Stack:** TypeScript (Node's built-in `node:test`) for `apps/worker` + `packages/db` (Drizzle ORM, drizzle-kit, PostgreSQL 16). Python 3 (pytest, stdlib `unittest` style, Typer CLI) for `tools/video_ingest` + `tools/game_ocr`. pnpm workspaces + Turborepo.

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-07-07-ocr-mass-ingest-and-eval-program-design.md`. This plan realizes it; where reality diverged from the spec (below) the plan wins.
- **After ANY change in `packages/db/src/`**: `pnpm --filter @eanhl/db build` before typechecking any consumer (worker/web). New exports are invisible otherwise. Use the `schema-change` skill for migrations.
- **After editing worker source for local CLI use**: `pnpm --filter @eanhl/worker build`.
- Load env for local worker/python DB commands: `set -a && source .env && set +a`.
- Live DB (read-only checks): `docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "..."` (container `eanhl-team-website-db-1`, user `eanhl`, db `eanhl`, host port 5433).
- Regression anchor: `apps/worker/src/__tests__/match-250-benchmark.test.ts` must stay green throughout. Run: `pnpm --filter @eanhl/worker test`.
- Percentage/rate DB fields = `numeric(5,2)`; layer scores = `numeric(5,4)` bounded 0–1 by CHECK (mirror migration `0050`). `transform_status` enum = `'pending'|'success'|'error'`.
- Flag-never-drop (①), confidence/threshold gates (②③), per-video failure isolation + no silent truncation (④): log every skip/partial/dropped file.
- Green gates for this repo = typecheck + `@eanhl/worker` test + prettier + `pytest` in the affected Python venv. **`pnpm lint` is pre-existing-red repo-wide — do not chase it** (verify new code in isolation).
- **GPU venv fragility**: `video-ingest reprocess`/`ingest` run in `tools/video_ingest/.venv`; `game_ocr` is sourced onto `sys.path` from `tools/game_ocr/game_ocr/` (not pip). A walk-import smoke test is mandatory before any hours-long run (prior 37-min crash from a lost pydantic closure).

---

## Context

The operator is about to mass-ingest ~100 NHL26 recordings (since match 250, 2026-05-08) and wants to improve the OCR system *before* the run. Today the pipeline is hard-wired one-video→one-match: `orchestrator.ingest()` forwards a single `match_id` to `dispatch_segments`, which fans every screen-segment out under it — so a multi-match session (~47 games are trapped inside 16 multi-match files) collapses into one match's overwritten data. Ingest is also *blind*: nothing grades box-score OCR against the EA-API truth already in `player_match_stats`/`matches`. This program makes ingest multi-match-aware, associated, measured, and unattended.

### Grounding corrections (reality vs spec)

These were confirmed by reading the code and MUST override the spec's simplified descriptions:

1. **Per-player OCR is not promoted.** `apps/worker/src/ocr-promoters/post-game-player-summary.ts:16-19` is a no-op. Per the approved decision, L4 grades per-player from the **raw `ocr_extraction_fields` audit rows**, not a promoted table. No new promoter is written (respects spec non-goal #3).
2. **Box-score OCR lands in `match_period_summaries`** (per-period, `source='ocr'`), **not** `ocr_promotions`. It has **no `run_id` column** — it links via `ocr_extraction_id → ocr_extractions.run_id`, and that extraction run often differs from the *active* decoder run. L4 must resolve the OCR rows through the extraction join, not by assuming active-run scoping.
3. **Team-total truth = `matches.scoreFor/scoreAgainst/shotsFor/shotsAgainst`** (the box-score screen shows API team totals). NOT summed per-player SOG from `player_match_stats` (match 250: period-summary shots 29 ≠ summed player shots 25). Faceoff truth via `getMatchFaceoffTotals(matchId)` (`queries/matches.ts:274`).
4. **Real state-machine vocabulary** (from `tools/game_ocr/game_ocr/configs/state_machine/nhl26.yaml:34-52`) uses `pre_game_lobby_state_1`, `pre_game_lobby_state_2`, `player_loadout_view`, plus `loading_or_intro` and `end_of_video` — NOT the spec's `pre_game_lobby`/`loadout_view`. Grouping keys off the real names.
5. **`match_id` never partitions segments today** — `orchestrator.ingest()` forwards it verbatim to `dispatch_segments` (`orchestrator.py:771`); the fan-out loop applies one id to all segments (`dispatch.py:81,107-108`). This is the exact collapse point ① breaks.

### Execution note

This is a four-milestone program. Each milestone is independently shippable and testable; execute **one milestone per session** (per repo session-discipline) with a commit + `HANDOFF.md` update at each boundary. Prefer a feature branch (`feat/ocr-mass-ingest`).

---

# Milestone ③ — AUTO-EVAL (API-truth L4 layer)

**Deliverable:** an L4 accuracy section on `ocr_run_quality_reports` that diffs promoted box-score team totals and audit-row per-player lines against EA-API truth, verified against the 4 already-ingested matches (250, 463, 968, 2582). Build first — smallest, immediately testable, and it becomes ②'s association safety-check and ④'s promotion gate.

**File Structure:**
- Create `packages/db/src/queries/l4-api-truth-inputs.ts` — read OCR box-score (`match_period_summaries` source='ocr'), API truth (`matches` + `getMatchFaceoffTotals`), per-player OCR audit rows (`ocr_extraction_fields`), per-player API truth (`player_match_stats`).
- Create `apps/worker/src/lib/l4-api-truth.ts` — the pure comparator (OCR values + API values → per-field diffs + score).
- Modify `apps/worker/src/lib/quality-layers.ts` — add `l4` to `LayerScores` + compute it.
- Modify `apps/worker/src/lib/run-quality-report.ts` — extend `ReportLayersSerialized`, `ReportBody`, `serializeComputedLayers`, the 3 not-computed builders, `deriveColumns`.
- Modify `packages/db/src/queries/run-quality.ts` — add `l4Score` to `RunQualityReportDerivedColumns` + the upsert.
- Migration `packages/db/migrations/0054_ocr_run_quality_reports_l4.sql` (drizzle-generated) — add `l4_score numeric(5,4)` + range CHECK; bump `schema_version` default logic to 2.
- Create `apps/worker/src/__tests__/l4-api-truth.test.ts` — comparator unit tests + integration against the 4 matches.

### Task 3.1: Schema — add `l4Score` column

**Files:**
- Modify: `packages/db/src/schema/ocr-run-quality-reports.ts:60-105`
- Generate: `packages/db/migrations/0054_ocr_run_quality_reports_l4.sql`

**Interfaces:**
- Produces: `ocrRunQualityReports.l4Score` (`numeric(5,4)`, nullable, 0–1 range check).

- [ ] **Step 1** — Add the column after `l3Score` (mirror `l3Score` exactly), with a range check mirroring the `0050` pattern:
```ts
l4Score: numeric('l4_score', { precision: 5, scale: 4 }),
```
Add its CHECK to the table's constraints array (mirror `*_range_chk`): `check('ocr_run_quality_reports_l4_range_chk', sql\`${table.l4Score} IS NULL OR (${table.l4Score} >= 0 AND ${table.l4Score} <= 1)\`)`.
- [ ] **Step 2** — Generate + inspect: `pnpm --filter db generate`; read `packages/db/migrations/0054_*.sql` to confirm it only adds the column + constraint (no destructive DDL). Hand-edit if drizzle mis-orders (see `ocr-pipeline.ts:81-90` precedent for hand-edits).
- [ ] **Step 3** — Apply: `set -a && source .env && set +a && pnpm --filter db migrate`. Verify: `docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "\d ocr_run_quality_reports"` shows `l4_score`.
- [ ] **Step 4** — Rebuild: `pnpm --filter @eanhl/db build`.
- [ ] **Step 5** — Commit: `git add packages/db/src/schema/ocr-run-quality-reports.ts packages/db/migrations && git commit -m "feat(db): add l4_score column to ocr_run_quality_reports"`.

### Task 3.2: L4 input queries

**Files:**
- Create: `packages/db/src/queries/l4-api-truth-inputs.ts`
- Modify: `packages/db/src/queries/index.ts` (add `export * from './l4-api-truth-inputs.js'`)
- Test: `packages/db/` has no test harness; validate via the worker integration test in 3.4.

**Interfaces:**
- Produces:
  - `getOcrBoxScoreForMatch(matchId): Promise<{ goalsFor, goalsAgainst, shotsFor, shotsAgainst, faceoffsFor, faceoffsAgainst } | null>` — SUM over `match_period_summaries WHERE match_id=$1 AND source='ocr' AND period_number >= 1`.
  - `getApiTeamTotals(matchId): Promise<{ scoreFor, scoreAgainst, shotsFor, shotsAgainst, faceoffsFor, faceoffsAgainst } | null>` — from `getMatchById` + `getMatchFaceoffTotals`.
  - `getOcrPlayerSummaryFields(matchId): Promise<Array<{ personaRaw: string, goals: number|null, assists: number|null, saves: number|null, savePct: number|null }>>` — parse `ocr_extraction_fields.parsed_value_json` for extractions of screen_type `post_game_player_summary` linked to the match. Reads via `ocr_extractions` join on `match_id`.
  - `getApiPlayerStats(matchId): Promise<Array<{ playerId, gamertag, goals, assists, saves, savePct }>>` — `player_match_stats` joined to `players`.

- [ ] **Step 1** — Write `getOcrBoxScoreForMatch` + `getApiTeamTotals` reusing `getMatchById` (`queries/matches.ts:82`) and `getMatchFaceoffTotals` (`queries/matches.ts:274`). Note the `for/against` on `match_period_summaries` are strings resolved via `resolveBgmSide` at promotion time — read them directly, no re-resolution.
- [ ] **Step 2** — Write `getApiPlayerStats` (join `player_match_stats` → `players.gamertag`; compute `savePct = saves/(saves+goalsAgainst)` when goalie fields present, else null).
- [ ] **Step 3** — Write `getOcrPlayerSummaryFields`: select `ocr_extraction_fields` for extractions where `screen_type='post_game_player_summary'` and the extraction's `match_id=$1`. Field-key mapping (`goals`/`assists`/`saves`/`save_pct` → persona row) must be pinned by inspecting real rows first: `docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "SELECT field_key, parsed_value_json FROM ocr_extraction_fields f JOIN ocr_extractions e ON f.extraction_id=e.id WHERE e.match_id=250 AND e.screen_type='post_game_player_summary' LIMIT 40"`. Encode the discovered field-key shape in the query.
- [ ] **Step 4** — Add barrel export; rebuild `pnpm --filter @eanhl/db build`.
- [ ] **Step 5** — Commit: `git commit -am "feat(db): add L4 API-truth input queries"`.

### Task 3.3: L4 comparator (pure)

**Files:**
- Create: `apps/worker/src/lib/l4-api-truth.ts`
- Test: `apps/worker/src/__tests__/l4-api-truth.test.ts`

**Interfaces:**
- Consumes: the four query results from Task 3.2; persona→player resolver `resolvePersona` (`apps/worker/src/lib/normalize-persona.ts:46`) and `resolveGamertagToPlayer` (`ocr-promoters/resolve-identity.ts:97`).
- Produces:
```ts
export interface L4FieldDiff { field: string; scope: 'team'|`player:${string}`; ocrValue: number|null; apiValue: number|null; exactMatch: boolean }
export interface L4Result {
  gradable: boolean            // false ⇒ "ungradable — OCR sole source" (no matches row / no player_match_stats)
  score: number|null           // exact-match fraction over gradable fields, null when !gradable
  fieldsTotal: number
  fieldsMatched: number
  diffs: L4FieldDiff[]
  mismatches: L4FieldDiff[]    // diffs where !exactMatch, for the review queue
  notes: string
}
export function computeL4(inputs: {
  ocrTeam: OcrTeamTotals|null; apiTeam: ApiTeamTotals|null;
  ocrPlayers: OcrPlayerLine[]; apiPlayers: ApiPlayerLine[];
  resolvePersona: (raw: string) => Promise<{ playerId: number|null }>;
}): Promise<L4Result>
```

- [ ] **Step 1: failing test** — team totals exact + one mismatch:
```ts
test('computeL4 grades team totals exact, flags a shot mismatch', async () => {
  const r = await computeL4({
    ocrTeam: { goalsFor: 4, goalsAgainst: 2, shotsFor: 29, shotsAgainst: 20, faceoffsFor: 11, faceoffsAgainst: 9 },
    apiTeam: { scoreFor: 4, scoreAgainst: 2, shotsFor: 28, shotsAgainst: 20, faceoffsFor: 11, faceoffsAgainst: 9 },
    ocrPlayers: [], apiPlayers: [], resolvePersona: async () => ({ playerId: null }),
  })
  assert.equal(r.gradable, true)
  assert.equal(r.fieldsTotal, 6)
  assert.equal(r.fieldsMatched, 5)                 // shotsFor 29≠28
  assert.equal(r.mismatches.length, 1)
  assert.equal(r.mismatches[0]!.field, 'shotsFor')
})
```
- [ ] **Step 2** — Run `pnpm --filter @eanhl/worker build && node --test apps/worker/dist/__tests__/l4-api-truth.test.js`; expect FAIL (module not found).
- [ ] **Step 3** — Implement: map OCR team fields → API team fields (goalsFor↔scoreFor, etc.), exact-compare counting stats; for per-player, resolve each `ocrPlayers[i].personaRaw` via `resolvePersona` to a `playerId`, join to `apiPlayers`, exact-compare goals/assists/saves and compare savePct within `numeric(5,2)` tolerance (±0.01). `gradable=false` when `apiTeam===null`. `score = fieldsMatched/fieldsTotal`.
- [ ] **Step 4** — Add a `gradable:false` test (apiTeam null → score null, notes "ungradable — OCR sole source") and a per-player match/mismatch test. Run; expect PASS.
- [ ] **Step 5** — Commit: `git commit -am "feat(worker): add L4 API-truth comparator"`.

### Task 3.4: Wire L4 into computeLayers + report body + integration test

**Files:**
- Modify: `apps/worker/src/lib/quality-layers.ts:65-88` (add `l4` to `LayerScores`), `:96-101,:209` (compute + `overall`)
- Modify: `apps/worker/src/lib/run-quality-report.ts:97-117,119-135,137-167,177-200,308-330,348-370,444-488`
- Modify: `packages/db/src/queries/run-quality.ts:471-487,521-604`
- Test: `apps/worker/src/__tests__/l4-api-truth.test.ts` (add integration cases)

**Interfaces:**
- Consumes: `computeL4` (3.3), input queries (3.2).
- Produces: `LayerScores.l4: { score: number|null; pass: boolean|null; gradable: boolean; notes: string; mismatches: L4FieldDiff[] }`; serialized `report.layers.l4`; derived column `l4Score`.

- [ ] **Step 1** — Add `L4_THRESHOLD = 0.95` (mirror `L3_THRESHOLD`) and extend `LayerScores` with `l4`. In `computeLayers`, call the 3.2 queries + `computeL4`; set `pass = gradable ? score >= L4_THRESHOLD : null`. Leave `overall.pass` unchanged for now (L4 is informational, not promotion-blocking, until ④ wires the gate) — document this in a comment.
- [ ] **Step 2** — Extend `ReportLayersSerialized` + `serializeComputedLayers` + the 3 not-computed builders with an `l4` block; extend `deriveColumns` to emit `l4Score` (string via `toNumericString`, or null). Bump `schema_version` 1→2 in `ReportBody`/`deriveColumns`.
- [ ] **Step 3** — Extend `RunQualityReportDerivedColumns` + `upsertRunQualityReport` with `l4Score` (mirror `l3Score` exactly, incl. the `force` ON CONFLICT path).
- [ ] **Step 4: integration test** — for each of matches 250/463/968/2582, resolve the active run (`getActiveRunIdForMatch`), build the report body, assert `report.layers.l4.gradable === true`, `score` is a number in [0,1], and `mismatches` is an array. Gate on `process.env['DATABASE_URL']` (mirror match-250-benchmark.test.ts:189-192). Run via `pnpm --filter @eanhl/worker test`.
- [ ] **Step 5** — Rebuild db + worker; run the FULL worker suite incl. `match-250-benchmark` to confirm green. Prettier: `pnpm format`.
- [ ] **Step 6** — Commit: `git commit -am "feat(worker): compute + persist L4 API-truth accuracy layer"`.
- [ ] **Step 7** — Manual verify (evidence): `set -a && source .env && set +a && pnpm --filter worker run-quality --match-id 250 --json | jq '.layers.l4'` shows a populated L4 block. Record the 4 matches' L4 scores in `HANDOFF.md`.

---

# Milestone ① — MATCH-SPLIT (per-match reels)

**Deliverable:** a pure `match_split` module that groups Pass-1 segments into per-match reels + emits `reels.json`, and an orchestrator dispatch loop that runs once per reel. Unlocks the ~47 trapped multi-match games. Single-match videos keep today's exact behavior.

**File Structure:**
- Create `tools/video_ingest/video_ingest/match_split.py` — `Reel` dataclass + `group_into_reels(segments)` + `write_reels_json(...)`.
- Modify `tools/video_ingest/video_ingest/orchestrator.py` — group after segments are available (`:604`/`:660`), loop `dispatch_segments` per reel (`:765-780`).
- Modify `tools/video_ingest/video_ingest/dispatch.py` — no signature change; called once per reel bucket.
- Create `tools/video_ingest/tests/test_match_split.py` — synthetic `Segment`-sequence fixtures (mirror `tests/test_build_segments.py`).

### Task 1.1: `Reel` dataclass + `group_into_reels` (pure)

**Files:**
- Create: `tools/video_ingest/video_ingest/match_split.py`
- Test: `tools/video_ingest/tests/test_match_split.py`

**Interfaces:**
- Consumes: `Segment` (`pass1_classify.py:167-181`: `start_index,end_index,start_seconds,end_seconds,screen_type,frame_count,mean_color_score`).
- Produces:
```python
@dataclass
class Reel:
    reel_index: int
    start_s: float
    end_s: float
    segment_indices: list[int]          # indices into the input segments list
    screen_inventory: dict[str, bool]   # has_lobby, has_boxscore, has_action_tracker, has_events, has_loadout
    completeness_flags: list[str]       # missing_lobby | partial_no_boxscore | incomplete | low_confidence_boundary
    boundary_confidence: float

def group_into_reels(segments: list[Segment]) -> list[Reel]: ...
```
- **Grouping rule (real vocab):** OPENERS = `{pre_game_lobby_state_1, pre_game_lobby_state_2, loading_or_intro}`. POSTGAME = `{post_game_player_summary, post_game_box_score_goals, post_game_box_score_shots, post_game_box_score_faceoffs, post_game_events, post_game_action_tracker, post_game_faceoff_map, post_game_net_chart}`. TERMINAL = `end_of_video`. A reel opens at the first OPENER after the previous reel closed (or at video start); it closes at the last contiguous POSTGAME segment before the *next* OPENER, or at `end_of_video`/end-of-list. `unknown_or_transition`, `in_game_*`, `player_loadout_view`, `menu_world_of_chel` belong to whichever open reel contains them.

- [ ] **Step 1: failing test** — clean two-match sequence groups into 2 reels. Build a `_seg(i, screen_type, t0, t1)` helper and a screen-type sequence: `[loading_or_intro, pre_game_lobby_state_1, in_game_clock, post_game_box_score_goals, post_game_box_score_shots, pre_game_lobby_state_1, in_game_clock, post_game_box_score_goals, end_of_video]`. Assert `len(reels)==2`, reel0 covers segments 0–4, reel1 covers 5–8, both `screen_inventory['has_boxscore']` true.
- [ ] **Step 2** — Run `cd tools/video_ingest && .venv/bin/python -m pytest tests/test_match_split.py -q`; expect FAIL (no module).
- [ ] **Step 3** — Implement `group_into_reels` per the rule above; fill `screen_inventory`/`start_s`/`end_s`/`segment_indices`; leave flags empty + `boundary_confidence=1.0` for the clean path.
- [ ] **Step 4** — Run; expect PASS.
- [ ] **Step 5** — Commit: `git commit -am "feat(video-ingest): add match_split reel grouping"`.

### Task 1.2: Edge-case flagging (flag-never-drop)

**Files:** Modify `tools/video_ingest/video_ingest/match_split.py`; extend `tests/test_match_split.py`.

- [ ] **Step 1: failing tests** — one per edge case:
  - **late start** (postgame with no preceding opener): sequence starting `[post_game_box_score_goals, pre_game_lobby_state_1, ...]` ⇒ reel0 flagged `missing_lobby`, still emitted.
  - **early stop** (opener + gameplay, no postgame before next opener/end): ⇒ reel flagged `partial_no_boxscore`.
  - **sub-10-min fragment** (a lone `unknown_or_transition`/short run with no opener and no postgame): ⇒ 0 reels OR 1 reel flagged `incomplete`, never merged into a neighbor.
  - **back-to-back** (postgame directly followed by opener with no gap segment): ⇒ boundary reel flagged `low_confidence_boundary`, `boundary_confidence < 1.0`.
- [ ] **Step 2** — Run; expect FAIL.
- [ ] **Step 3** — Implement the four flag rules. Never merge a fragment into an adjacent reel; never drop segments (every input segment index appears in exactly one reel OR is explicitly recorded as dropped-with-reason in a returned `dropped: list[tuple[int,str]]` — add to `Reel`-set return if needed, and log it).
- [ ] **Step 4** — Run; expect PASS. Add a `test_match_463_style` case reusing the real multi-screen post-game burst shape from `tests/test_build_segments.py:137`.
- [ ] **Step 5** — Commit: `git commit -am "feat(video-ingest): flag reel completeness edge cases"`.

### Task 1.3: `write_reels_json` + orchestrator dispatch loop

**Files:**
- Modify: `tools/video_ingest/video_ingest/match_split.py` (add `write_reels_json(sha_root, reels)`)
- Modify: `tools/video_ingest/video_ingest/orchestrator.py:604,660,765-780`
- Test: `tools/video_ingest/tests/test_match_split.py` (json round-trip); `tests/test_dispatch_segment_flags.py` pattern for the loop.

**Interfaces:**
- Consumes: `Pass2Result` (`pass2_extract.py:174-188`, carries `.segment.screen_type`/`.start_seconds`) and the reels from 1.1.
- Produces: `sha_root/reels.json`; the orchestrator dispatches once per reel.
- **Per-reel `match_id` (milestone-boundary contract):** add an optional `reel_match_ids: dict[int,int] | None` param to the dispatch code path. Behavior for THIS milestone (② not built yet):
  - **1 reel** → today's exact behavior: dispatch all `pass2_results` under the single `match_id` passed to `ingest()`.
  - **>1 reel and `reel_match_ids is None`** → write `reels.json`, log `N reels need association`, and **skip dispatch** (do not collapse). This makes multi-match videos safe (no overwrite) and defers association to ②.
  - **>1 reel and `reel_match_ids` provided** → dispatch each reel's `Pass2Result` subset under its mapped id (loop `dispatch_segments` once per reel).

- [ ] **Step 1: failing test** — `group_into_reels` on a 1-reel sequence + a stubbed dispatch records exactly one `dispatch_segments` call with all segments under the passed `match_id` (behavior parity). A 2-reel sequence with `reel_match_ids=None` records **zero** dispatch calls + writes `reels.json`. Use `monkeypatch` on `dispatch_segments` (mirror `test_dispatch_segment_flags.py`).
- [ ] **Step 2** — Run `.venv/bin/python -m pytest tests/test_match_split.py -q`; expect FAIL.
- [ ] **Step 3** — Implement `write_reels_json`; splice grouping + the per-reel dispatch decision into `orchestrator.py` between segment availability and the existing `dispatch_segments` call. Map each `Pass2Result` to its reel via `segment_index ∈ reel.segment_indices`.
- [ ] **Step 4** — Run; expect PASS. Then run the FULL video_ingest suite: `.venv/bin/python -m pytest -q` (confirm no regression to single-match dispatch).
- [ ] **Step 5** — Commit: `git commit -am "feat(video-ingest): dispatch per reel + emit reels.json"`.
- [ ] **Step 6** — Manual verify (evidence): run `classify-only` on one known multi-match loose file to produce segments, then a small script calling `group_into_reels` + `write_reels_json`; confirm `reels.json` reel count matches the human-counted games. Record in `HANDOFF.md`.

---

# Milestone ② — ASSOCIATE (reel → DB match_id)

**Deliverable:** `ocr_match_associations` table + a fuzzy scorer that proposes a `match_id` per reel from an identity probe, surfaced through a new `resolve-match-cli` review queue; operator confirm stamps `match_id` onto the reel's capture batch and unlocks per-reel dispatch.

**File Structure:**
- Create `packages/db/src/schema/ocr-match-associations.ts` (mirror `ocr_capture_batches` style).
- Create `packages/db/src/queries/ocr-match-associations.ts` — insert/list/confirm/reject + candidate enumeration.
- Modify `packages/db/src/schema/index.ts` + `packages/db/src/queries/index.ts` barrels.
- Migration `0055_ocr_match_associations.sql`.
- Create `apps/worker/src/lib/match-association-score.ts` — pure weighted scorer.
- Create `apps/worker/src/resolve-match-cli.ts` (mirror `decoder-runs-cli.ts`); register in `apps/worker/package.json`.
- Create `tools/video_ingest/video_ingest/identity_probe.py` — cheap per-reel OCR of score/opponent/personas → `identity.json`.
- Tests: `apps/worker/src/__tests__/match-association-score.test.ts`; `tools/video_ingest/tests/test_identity_probe.py`.

### Task 2.1: `ocr_match_associations` schema

**Files:** Create `packages/db/src/schema/ocr-match-associations.ts`; modify `schema/index.ts`; generate `0055_*.sql`.

**Interfaces (produces):**
```ts
export type OcrAssociationStatus = 'pending' | 'confirmed' | 'rejected'
export const ocrMatchAssociations = pgTable('ocr_match_associations', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  reelIdentity: text('reel_identity').notNull(),                 // `${video_sha256}:${reel_index}`
  videoSha256: text('video_sha256').notNull(),
  runId: bigint('run_id', { mode: 'number' }).references(() => ocrDecoderRuns.id),
  proposedMatchId: bigint('proposed_match_id', { mode: 'number' }).references(() => matches.id),
  confidence: numeric('confidence', { precision: 5, scale: 4 }),
  evidence: jsonb('evidence').notNull(),                         // { score, opponent, personas, signals{...}, runnerUpGap }
  status: text('status').notNull().$type<OcrAssociationStatus>().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
}, (t) => [ uniqueIndex('ocr_match_associations_reel_uniq').on(t.reelIdentity) ])
export type OcrMatchAssociation = typeof ocrMatchAssociations.$inferSelect
export type NewOcrMatchAssociation = typeof ocrMatchAssociations.$inferInsert
```

- [ ] **Step 1** — Write the table file; add barrel line `export * from './ocr-match-associations.js'`.
- [ ] **Step 2** — `pnpm --filter db generate`; read `0055_*.sql`, confirm additive-only.
- [ ] **Step 3** — `pnpm --filter db migrate`; verify `\d ocr_match_associations`.
- [ ] **Step 4** — `pnpm --filter @eanhl/db build`.
- [ ] **Step 5** — Commit: `git commit -am "feat(db): add ocr_match_associations table"`.

### Task 2.2: Weighted fuzzy scorer (pure)

**Files:** Create `apps/worker/src/lib/match-association-score.ts`; test `apps/worker/src/__tests__/match-association-score.test.ts`.

**Interfaces:**
- Consumes: `levenshtein` + `normalizeSnapshot` (`ocr-promoters/resolve-identity.ts:57,70`), `resolvePersona` (`lib/normalize-persona.ts:46`).
- Produces:
```ts
export interface ProbeIdentity { captureEpochS: number; scoreFor: number; scoreAgainst: number; opponentText: string; personas: string[] }
export interface ApiCandidate { matchId: number; playedAtEpochS: number; scoreFor: number; scoreAgainst: number; opponentName: string; roster: string[] }
export interface Proposal { matchId: number|null; confidence: number; runnerUpGap: number; signals: Record<string, number> }
export function scoreCandidates(probe: ProbeIdentity, candidates: ApiCandidate[]): Proposal
```
- **Weights (initial, calibrated later per spec §12):** timestamp proximity (Gaussian on |captureEpochS − playedAtEpochS|, σ≈3h) ×0.35; exact score match ×0.30; opponent fuzzy (1 − normalizedLevenshtein) ×0.20; roster/persona overlap (Jaccard of resolved personas vs roster) ×0.15. `confidence` = best weighted sum in [0,1]; `runnerUpGap` = best − second. `matchId=null` when `confidence < 0.5` (⇒ `no_api_match`).

- [ ] **Step 1: failing test** — a probe (score 4-2, opp "Rangers", evening ts) against 3 candidates where one matches date+score+opp ⇒ `proposal.matchId === thatId`, `confidence > 0.8`, `runnerUpGap > 0.2`. A second test: no candidate within threshold ⇒ `matchId === null`.
- [ ] **Step 2** — `pnpm --filter @eanhl/worker build && node --test apps/worker/dist/__tests__/match-association-score.test.js`; expect FAIL.
- [ ] **Step 3** — Implement the weighted scorer (persona resolution can be pre-resolved into `candidate.roster`/`probe.personas` as normalized strings; use `normalizeSnapshot`+`levenshtein` for overlap so the scorer stays pure/synchronous).
- [ ] **Step 4** — Run; expect PASS.
- [ ] **Step 5** — Commit: `git commit -am "feat(worker): add match-association fuzzy scorer"`.

### Task 2.3: Association queries + `resolve-match-cli`

**Files:** Create `packages/db/src/queries/ocr-match-associations.ts` (+ barrel); create `apps/worker/src/resolve-match-cli.ts`; modify `apps/worker/package.json`.

**Interfaces:**
- Consumes: `getMatchesWithLineup` (`queries/matches.ts:214`, returns `{id,playedAt,opponentName,result,scoreFor,scoreAgainst}` — the ready-made candidate enumerator), `getMatchLineups` (`queries/match-lineups.ts:69`) for roster, `scoreCandidates` (2.2), `ocrCaptureBatches` (stamp target).
- Produces queries: `insertAssociationProposal(row)`, `listPendingAssociations()`, `confirmAssociation(id)`, `rejectAssociation(id)`. CLI subcommands: `propose --run-id N --identities <path>` (reads per-reel `identity.json`, enumerates candidates, scores, writes proposals), `list`, `confirm --id N`, `reject --id N`.
- **Confirm semantics (mirror `ingest-ocr-review-cli.ts` review_status flow):** `confirmAssociation` in a `db.transaction`: set `status='confirmed'`, `decidedAt=now()`, and stamp `ocr_capture_batches.matchId = proposedMatchId` for the batch matching `(videoSha256, runId)`. `no_api_match` proposals confirm as operator-supplied new/OCR-only match id via `confirm --id N --match-id M`.

- [ ] **Step 1: failing test** (queries via worker integration test, gated on DATABASE_URL) — insert a pending proposal, `listPendingAssociations` returns it, `confirmAssociation` flips status + stamps the capture batch's `match_id`. Assert against a throwaway sha (clean up in `after`).
- [ ] **Step 2** — Implement queries; add barrel exports; `pnpm --filter @eanhl/db build`.
- [ ] **Step 3** — Implement `resolve-match-cli.ts` mirroring `decoder-runs-cli.ts` (raw `process.argv`, `getFlag`, `switch(subcommand)`, `db`+`sqlTag` from `@eanhl/db`, `.finally(() => sqlTag.end())`). Register `"resolve-match": "node dist/resolve-match-cli.js"` in `package.json`.
- [ ] **Step 4** — `pnpm --filter @eanhl/worker build`; run the integration test; expect PASS. Manual: `pnpm --filter worker resolve-match list`.
- [ ] **Step 5** — Commit: `git commit -am "feat(worker): add resolve-match-cli association review queue"`.

### Task 2.4: Identity probe (Python) + wire into split

**Files:** Create `tools/video_ingest/video_ingest/identity_probe.py`; test `tools/video_ingest/tests/test_identity_probe.py`; modify `orchestrator.py` to emit per-reel `identity.json` when `>1 reel`.

**Interfaces:**
- Produces: for each reel, `sha_root/reel-<idx>-identity.json` = `{ capture_epoch_s, score_for, score_against, opponent_text, personas[] }`. `capture_epoch_s` = file-basename wall-clock (`2026-05-20_18-15-59`) + `reel.start_s`.
- Reuses the existing box-score/lobby OCR read path (the probe OCRs only a handful of the reel's box-score/lobby frames for score/opponent/personas — a thin wrapper over the frames Pass-2 already extracts; do NOT run full promotion).

- [ ] **Step 1: failing test** — `parse_basename_epoch("2026-05-20_18-15-59")` returns the right epoch; `build_identity(reel, basename, ocr_reads)` assembles the JSON shape. Pure-function tests only (no GPU) — mirror `test_reprocess_cli.py` helper-unit style.
- [ ] **Step 2** — Run `.venv/bin/python -m pytest tests/test_identity_probe.py -q`; expect FAIL.
- [ ] **Step 3** — Implement basename→epoch + identity assembly; wire orchestrator to write `identity.json` per reel. Keep the actual frame-OCR call behind the existing Pass-2 read helpers.
- [ ] **Step 4** — Run; expect PASS + full video_ingest suite green.
- [ ] **Step 5** — Commit: `git commit -am "feat(video-ingest): per-reel identity probe for association"`.

---

# Milestone ④ — BATCH ORCHESTRATION (unattended mass run)

**Deliverable:** a runner that enumerates the target set, dedups by sha, prioritizes, preflights the GPU venv, runs each video through Pass-1→split→probe→associate→per-reel promotion→L4 eval, and emits the review queue — safe to leave running, resumable, per-video failure-isolated. **Two prerequisites resolved in the 2026-07-13 ④ design session precede the run loop:** (4.0) GPU-enable the legacy `game_ocr.cli extract` path so an unattended corpus run is practical (~2.3h/video CPU → ~30 min/video GPU); (4.G) build a **coverage-aware L4 gate** that grades the strongest correctness signal (the TOT-row final) instead of the confound-prone per-period sum, so the batch can auto-classify {clean / hold-for-review} without false-rejecting correct associations.

> **Revised task order (2026-07-13 design):** 4.0 (GPU-enable) → 4.G (coverage-aware L4 gate) → 4.1 (enumerate) → 4.2 (preflight) → 4.3 (run loop, consumes 4.G). 4.0 and 4.G each ship + verify on-box before the loop depends on them; 4.1/4.2 are pure/headless; 4.3 is the on-box end-to-end.

**File Structure:**
- Create `tools/video_ingest/video_ingest/batch_ingest.py` — enumerate/dedup/prioritize/preflight/run-loop; registered as a Typer command in `cli.py` (`app.command("batch")(run_batch)`, mirror `reprocess` registration at `cli.py:255`).
- Reuse `reprocess.py` helpers: `_file_sha256`, `_disk_videos_by_sha`, `_resolve_video_paths`, `_psql_query`, `_run_decoder_runs_cli`, the `create-candidate → ingest → validate → activate` lifecycle (`reprocess.py:111-292,462-833`).
- 4.0 touches `tools/game_ocr/game_ocr/cli.py` (`extract` cmd) + `.env` (`OCR_PYTHON`); 4.G touches `apps/worker/src/lib/l4-api-truth.ts` + `packages/db/src/queries/l4-api-truth-inputs.ts` + `apps/worker/src/lib/quality-layers.ts` (a pure gate-decision fn).
- Test: `tools/video_ingest/tests/test_batch_ingest.py`.

### Task 4.0: GPU-enable `game_ocr.cli extract` (throughput prerequisite)

**Why:** the batch's per-segment promotion OCR shells out to `python -m game_ocr.cli extract` (`apps/worker/src/ocr-cli-runner.ts:83`), whose `extract` command builds `Extractor()` with **no `use_gpu`** → bare CPU RapidOCR (`tools/game_ocr/game_ocr/cli.py:27` → `ocr.py:156`). Its sibling `classify` subcommand already wires `use_gpu: bool = typer.Option(True)` + the nvidia-cu12 preload (`cli.py:60,68-75`). This is the ~1200%-CPU / ~30-min-per-heavy-segment cost the ② on-box run measured. Both venvs already have `onnxruntime_gpu-1.26.0` installed — GPU is present, just never requested on this path.

**Two required prongs (both, or it silently stays CPU):**
1. **Request GPU** — add `use_gpu: bool = typer.Option(True, ...)` to `extract` and construct `Extractor(registry=registry, backend=RapidOCRBackend(use_gpu=use_gpu))` (`cli.py:16-27`), mirroring `classify`. `RapidOCRBackend.__init__` already does the WSL2 nvidia-cu12 preload + missing-lib warning.
2. **GPU-capable interpreter** — set `OCR_PYTHON` → the game_ocr GPU venv in `.env` (currently unset; `ocr-cli-runner.ts:74` falls back to bare `python3`, which would silently CPU-fallback even after prong 1). Env-var precedent: `OCR_USE_CUDA` at `tools/historical_import/extract_review_artifacts.py:77`.

**Silent-fallback guard:** `RapidOCRBackend` logs `[ocr] WARN: use_gpu=True but CUDA runtime libraries unavailable` when the wheels aren't importable — the on-box verify MUST confirm that warning is **absent**.

- [ ] **Step 1** — Add the `use_gpu` option + backend wiring to `extract`; set `OCR_PYTHON` in `.env` (+ `.env.example` doc already present at `:39`).
- [ ] **Step 2** — Unit/smoke: `python -m game_ocr.cli extract --help` shows `--use-gpu/--no-use-gpu`; a `--no-use-gpu` run still succeeds (parity).
- [ ] **Step 3 — on-box evidence (required, GPU only exists on the box):** run ONE heavy `post_game_action_tracker` segment through `extract` on CPU vs GPU; record the wall-clock drop and confirm NO `CUDA runtime libraries unavailable` warning. Record in `HANDOFF.md`.
- [ ] **Step 4** — Commit: `git commit -am "feat(game-ocr): GPU-enable the extract CLI path (④ Task 4.0)"`.

### Task 4.G: Coverage-aware L4 gate (③-addendum; the batch's auto-classify signal)

**Why:** today's L4 grades the **summed per-period** box-score rows (`period_number >= 1`, `l4-api-truth-inputs.ts:102`), which undercounts when a period is missed (973 read `1-1 / [period-2 unread] / 3-1 / 0-0` → 4-2 vs API 7-3 → L4=0) even though the **TOT-row final** that drove association was read *correctly* (7-3). So a naive `L4≥τ` reject would false-reject correct associations. The gate must grade the strongest signal — the TOT final — not the confound-prone per-period sum. `L4_THRESHOLD=0.95` exists but is inert (excluded from `overall.pass`, `quality-layers.ts:270`).

**Key simplification (no schema/promoter change):** the TOT-row final is already in raw `ocr_extraction_fields` (`period_number = -1`); the per-player L4 path already reads raw cells there (`l4-api-truth-inputs.ts:228`). So `finalAccuracy` reads the TOT-row final from raw — **the promoter keeps discarding the `-1` row** (`box-score.ts:57`), no new persisted row, no double-count risk in per-period consumers, no migration.

**Three SEPARATE sub-metrics** added to the L4 layer (kept separate + interpretable, NOT blended into one weighted score — a weighted composite is less robust for gating: a good per-period can mask a wrong final, and threshold-vs-weights is hard to calibrate):
- **`finalAccuracy`** *(the hard gate)* — TOT-row (`period=-1`) final goals-for/against vs API final on `matches`. `[0,1]` or `null`. (Shots/faceoffs finals may be graded as extra sub-fields but do NOT gate.)
- **`periodCoverage`** — expected-vs-present per-period rows (soft flag).
- **`periodAccuracy`** — today's sum-vs-final grade, computed **only when coverage is complete**; incomplete ⇒ `null`, not `0` (removes the 973 confound).

**Pure gate-decision fn** (per match):
- `finalAccuracy == 1.0` → **PASS**
- `finalAccuracy` present & `< 1.0` → **HOLD** (genuinely misread final)
- `finalAccuracy == null` (api-missed — the batch's priority-0 target, no API truth to grade) → **operator-confirm only**; L4 cannot gate — the confirmed ② association is the sole gate there
- `periodCoverage`/`periodAccuracy` are always **soft** (informational on the scorecard)

**Enforcement = flag, don't purge (design decision):** promotion already sits behind the two-pass operator-confirm flow (Pass-1 defers dispatch; box-score promotes only Pass-2 after confirm). So a HOLD at Pass-2 is a *quality flag on an already-confirmed match*, not corruption-prevention (OCR never touches `matches` API truth — it writes a parallel `source='ocr'` set). The batch emits HOLD matches to the review queue with the reason + raw reads; it does **NOT** auto-purge and adds **no** `review_status` quarantine column. (Non-destructive hard quarantine via a `review_status` column is the deferred alternative if ever wanted.)

- [x] **Step 1: failing tests** — added 8 fixtures to `l4-api-truth.test.ts`: (a) clean final+coverage → PASS, (b) correct final + missing period → PASS with `periodCoverage=0.75` (973/974 case), (c) wrong final → HOLD, (c2) half-wrong → HOLD, (d) api-missed → OPERATOR_CONFIRM, (e) API-present-no-OCR-final → HOLD, back-compat (no ocrFinal → sub-metrics null), + a `gateFromL4` truth-table test.
- [x] **Step 2** — Ran; typecheck RED (`gateFromL4` unexported, `ocrFinal`/`finalAccuracy` absent).
- [x] **Step 3** — Implemented. Divergence from the "add TOT read to `getOcrBoxScoreForMatch`" wording: added TWO new **read-only** db queries in `l4-api-truth-inputs.ts` instead of overloading the summed query — `getOcrBoxScoreFinalForMatch` (majority-votes raw `period.TOT` away/home + team names across frames) + `getOcrBoxScorePeriodsForMatch` (per-period rows for coverage). Side resolution reuses a NEW pure `resolveSidesFromNames` extracted from `resolve-bgm-side.ts` (non-throwing core; the promoter wrapper still throws). Three sub-metrics + `gateFromL4` added to `l4-api-truth.ts`; wired in `quality-layers.ts`; surfaced in `ReportBody` (`final_accuracy`/`period_coverage`/`period_accuracy`). NOT wired into `overall.pass` (batch consumes the gate fn directly). schema_version stays 2.
- [x] **Step 4** — Full worker suite: **458 pass / 4 skip / 2 fail**. The 2 fails are PRE-EXISTING + unrelated (`ocr-decoder-runs-backfill.test.ts` — the ② on-box run left 39 `run_id=NULL` match-linked batches for 972–976, the deliberate fresh-ingest convention; my diff writes no batches). All L4 / gate / floor-deepEqual (250+463) / `match-250-benchmark` tests GREEN.
- [x] **Step 5 — on-box evidence:** recomputed `computeLayers` over 972–976: **972** finalAccuracy=1, cov=1, periodAcc=1 → PASS; **973** finalAccuracy=1 (7-3), cov=0.75, periodAcc=null → PASS (was old-L4 score=0); **974** finalAccuracy=1 (6-2), cov=0.75, periodAcc=null → PASS (was 0); **975/976** finalAccuracy=null (no readable box score) → HOLD. 250/463 floors rebaselined (all 1.0).
- [x] **Step 6** — Commit: `feat(worker): coverage-aware L4 gate — TOT-final grade + gate fn (④ Task 4.G)`.

### Task 4.1: Enumerate + dedup + prioritize (pure)

**Files:** Create `tools/video_ingest/video_ingest/batch_ingest.py`; test `tools/video_ingest/tests/test_batch_ingest.py`.

**Interfaces:**
- Produces:
```python
@dataclass
class BatchTarget:
    path: Path; sha256: str; kind: str            # 'match_folder' | 'loose'
    already_ingested: bool                        # sha ∈ ocr_capture_batches.video_sha256
    api_missed: bool                              # heuristic: no matches row near basename ts
    priority: int                                 # 0 api-missed, 1 api-covered, 2 partial/short

def enumerate_targets(video_root: Path, since: date) -> list[Path]: ...
def dedup_by_sha(paths: list[Path], known_shas: set[str]) -> list[BatchTarget]: ...
def prioritize(targets: list[BatchTarget]) -> list[BatchTarget]: ...
```
- Enumerate `matchNNN/` folders + loose top-level recordings with basename date `>= since` (2026-05-08). Dedup collapses `.mkv/.mp4/.remuxed/- Trim` copies via sha (reuse `_disk_videos_by_sha` `setdefault` first-wins). Known shas from `SELECT DISTINCT video_sha256 FROM ocr_capture_batches` via `_psql_query`.

- [x] **Step 1: failing test** — `test_batch_ingest.py` (13 tests): dedup byte-identical collapse (first path wins) + `already_ingested` from `known_shas` + kind classification; `prioritize` order/stability/no-mutate; enumerate window + landmine-dir + non-video exclusion. `tmp_path` fixtures (mirror `test_reprocess_cli.py`).
- [x] **Step 2** — Ran via the `.venv-1` runner (`.venv` has no pytest, [[reference_gpu_ocr_venv]]); RED — `ImportError: cannot import name 'batch_ingest'`.
- [x] **Step 3** — Implemented `BatchTarget` + `enumerate_targets`/`dedup_by_sha`/`prioritize` in `batch_ingest.py`. **Divergence:** streaming chunked `_file_sha256` (NOT `reprocess._file_sha256`'s `read_bytes()`) — the corpus holds ~22 GB `.mkv` files that would OOM a full read. `api_missed`/`priority` left at neutral defaults (DB-derived; the 4.3 run loop refines them).
- [x] **Step 4** — Ran; 13/13 PASS. Full `tools/video_ingest` suite **587 pass / 4 skip / 0 fail** (574 baseline + 13, zero regression).
- [x] **Step 5** — Committed `192d0da`: `feat(video-ingest): batch enumerate/dedup/prioritize (④ Task 4.1)`.

### Task 4.2: Preflight GPU-venv smoke test

**Files:** Modify `batch_ingest.py`; test `tests/test_batch_ingest.py`.

**Interfaces:** `def preflight() -> None` — walk-imports the full closure (`video_ingest.*` + `game_ocr.*` incl. `pydantic`, `rapidocr_onnxruntime`) and raises with a clear message on any `ImportError`. **Mandatory before the run loop** (prior 37-min crash from a lost pydantic closure).

- [x] **Step 1: failing test** — `preflight()` succeeds in the real venv (integration, gated by `RUN_BATCH_INTEGRATION` env like `test_reprocess_cli.py`); a monkeypatched broken import makes it raise `RuntimeError` with the missing-module name.
- [x] **Step 2** — Run; expect FAIL.
- [x] **Step 3** — Implement `preflight` (explicit `importlib.import_module` over a module list; catch + re-raise with the offending name).
- [x] **Step 4** — Run; expect PASS.
- [x] **Step 5** — Commit: `git commit -am "feat(video-ingest): mandatory GPU-venv preflight smoke test"`.

### Task 4.3: Run loop + review-queue emission + promotion gate

**Files:** Modify `batch_ingest.py`; register `batch` command in `cli.py`; test `tests/test_batch_ingest.py` (loop with stubbed subprocess/DB, mirror `test_reprocess_cli.py` monkeypatch style).

**Interfaces:** `def run_batch(video_root, since, dry_run, limit) -> None`. Per target (in priority order): `preflight()` once up front → `create-candidate` (mint `run_id`) → `video-ingest ingest --dispatch` (Pass-1 → ① split → ② identity probe; multi-reel ⇒ writes `reels.json`+`identity.json`, dispatch deferred) → `resolve-match propose` → **stop at operator confirm gate** (emit proposals + eval scorecards + completeness flags; do NOT auto-promote) → on a later pass, confirmed reels get per-reel Pass-2 + promotion + `run-quality --emit-row` (now carrying the **4.G coverage-aware L4**). Per-video try/except isolates failures (log + skip the 50 GB `2026-06-08`-style corrupt file, continue). **Promotion gate (revised 2026-07-13):** the **operator-confirmed ② association is the hard gate** — nothing dispatches/promotes without it. On top of that, the **4.G coverage-aware L4 gate** runs at Pass-2 and auto-classifies each promoted match {PASS / HOLD}: `finalAccuracy<1.0` ⇒ HOLD → review queue (flag, not purge); `finalAccuracy=null` (api-missed) ⇒ association-confirm is the sole gate. L4 is NOT a naive `≥τ` reject (it would false-reject the 973/974-style correct-association-noisy-per-period case).

- [x] **Step 1: failing test** — a stubbed `run_batch` over 3 fake targets (`_collect_targets` injected + `_run_streaming` monkeypatched) records: `preflight` called once; targets processed in priority order (real `prioritize` runs); a target that raises is logged + skipped (loop completes the other two); `dry_run=True` makes zero mutating calls. Plus `already_ingested` skip, `limit`, and `_known_shas`/`_refine_target` DB-helper units (`_psql_query` stubbed). **9 new tests.**
- [x] **Step 2** — Ran via the `.venv-1` runner; RED — `AttributeError: no run_batch/_collect_targets/_run_streaming/…`.
- [x] **Step 3** — Implemented `run_batch` + `_process_target`/`_collect_targets`/`_refine_target`/`_known_shas`/`_echo_plan` reusing `reprocess.py`'s `_run_streaming`/`_psql_query`; registered the `batch` Typer command via a thin `@app.command("batch")` wrapper in `cli.py` (not the literal `app.command("batch")(run_batch)` — kept `run_batch` a plain, testable fn; the wrapper parses `--video-root/--since/--dry-run/--limit`). **KEY DIVERGENCE:** fresh-ingest `run_id=NULL` path, NOT `create-candidate` (predates ②'s run_id=NULL finding; `ocr_decoder_runs.match_id` is NOT NULL so no candidate run can precede the association the batch discovers). No `_run_decoder_runs_cli`/create-candidate call.
- [x] **Step 4** — Ran; 25/25 `test_batch_ingest.py` PASS. Full `tools/video_ingest` suite **599 pass / 5 skip / 0 fail / 38 subtests** (590 baseline + 9, zero regression; ~14 min). `video-ingest batch --help` renders (import chain clean).
- [x] **Step 5** — Committed `0e2f7b7`: `feat(video-ingest): unattended batch run loop + review-queue gate (④ Task 4.3)`.
- [~] **Step 6 (ON-BOX, separate verify session)** — HALF DONE (`d680db8`). ✅ The dry/headless half verified GREEN: `batch --video-root /mnt/k/NHL/NHL26 --dry-run --limit 3`, exit 0, 28:47 wall, zero mutating calls, plan rendered in priority order. ⏳ The mutating `--limit 1` end-to-end is still DEFERRED (its only clean target was junk; see the CORRECTION entry in `HANDOFF.md`). **⚠️ CORRECTION — this step's closing line is WRONG and superseded by Task 4.4 below:** the second pass canNOT use `run-quality --emit-row` (`ocr_run_quality_reports.run_id` is NOT NULL + FK to `ocr_decoder_runs`, and these matches never have a run row). It uses `match-quality --match N --json` + `gateFromL4` instead. See Task 4.4.

---

### Task 4.4: Promotion-of-confirmed second pass (`batch-promote`) — ④'s drain

**Files:** Modify `batch_ingest.py` (+ `batch-promote` in `cli.py`), `match-quality-cli.ts`; tests `tests/test_batch_ingest.py`, `__tests__/match-quality-regression.test.ts`.

**Why:** `run_batch` stops every video at the operator-confirm gate and nothing drains the result, so a full-corpus run (78 targets ≈ 40-58 h GPU) would produce only a proposal backlog. This is the drain, and ④'s last feature.

**Interfaces:** `def run_promote(video_root, since, dry_run=False, limit=None) -> None`. `preflight()` once → `_promote_plan` (videos with ≥1 confirmed-but-undispatched reel) → `[:limit]` → per video: re-ingest with a flag set **byte-identical to Pass 1** (⇒ decode cache hit ⇒ `orchestrator`'s unconditional `load_confirmed_reel_map` returns a non-empty map ⇒ `dispatch_reels` **branch (c)** per-reel dispatch under each confirmed `match_id` ⇒ `promoteBoxScore` fires inside the ingest tx) → grade each confirmed match via `match-quality --match N --json` → `gate` → crash-safe JSON run summary persisted after **every** video. **No orchestrator change. No schema change. No migration.**

**🚩 THREE FINDINGS THAT REDIRECT THE ORIGINAL DESIGN (do not re-propose #1; do not build on #2):**

1. **`run-quality --emit-row` is STRUCTURALLY UNREACHABLE for these matches.** `ocr_run_quality_reports.run_id` is `bigint NOT NULL REFERENCES ocr_decoder_runs(id)`, and a fresh multi-reel ingest never mints a run row (`ocr_decoder_runs.match_id` is NOT NULL ⇒ no run can precede the association the batch discovers) ⇒ `run-quality --match-id` throws `no active run found`. **Minting does not rescue it:** `create-candidate` inserts `is_active=false` ⇒ `buildReportBody` short-circuits to `notComputedLayers` (all-null) ⇒ `gateFromL4` returns `OPERATOR_CONFIRM` for EVERY match regardless of quality; activating needs `--force` past a gate calibrated to reject most of the corpus **plus** `rebuildCanonicalsFromActiveRun`+`consolidateLoadouts` (real canonical mutation for an observability-only row). ⇒ Verdict read from **`match-quality`** instead: match-keyed (`computeLayers(matchId, …)`), needs no run row.
2. **The L4 verdict grades POST-promotion and cannot gate it.** `promoteBoxScore` runs inside the `ingest-ocr` transaction the instant a reel dispatches with `--match-id`. PASS/HOLD/OPERATOR_CONFIRM **route to review**; they cannot withhold or undo a promotion. The operator confirm is the only real gate. Naming says "verdict"/"grade", never "gate that prevents".
3. **`ocr_capture_batches.match_id` is an UNSOUND dispatch ledger.** `confirmAssociation` stamps it by `(video_sha256, run_id)` with **no reel scoping** ⇒ confirming a 2nd reel re-stamps the 1st reel's batches ⇒ a predicate on it would **false-skip a pending reel**. Idempotency keys on **`ocr_extractions.match_id`** (write-once). The stamp bug is latent (all 5 f0e57173 confirms preceded dispatch) — routed around, NOT fixed → separate follow-up.

- [x] **Step 1: failing test (TS)** — `match-quality-regression.test.ts` asserts `--json` carries `gate` and that it equals `gateFromL4(layers.l4)`. RED: `gate` undefined ×2.
- [x] **Step 2** — Implement: import `gateFromL4`, `const gate = gateFromL4(layers.l4)`, emit `gate` in `--json`, and render an L4-verdict block in `renderHuman` (L4 was previously absent from the human report entirely). `gateFromL4`'s **first production call site**. GREEN 460 pass.
- [x] **Step 3: failing tests (PY)** — 29 new: `_parse_json_object` ×4 (banner-tolerant, `^\{`-anchored + `raw_decode` — the bottom-up single-line scan `_parse_reel_map` uses cannot work since `--json` is PRETTY and pnpm's banner lands on **stdout**), `_run_captured` ×2, `_confirmed_associations` ×4 (incl. a SQL guard pinning the `ocr_extractions` join and forbidding `b.match_id`), `_promote_plan` ×5 (incl. a `_known_shas` → `pytest.fail` guard: `already_ingested` semantics are **INVERTED** here), `_grade_match` ×3, `run_promote` ×7 (incl. the byte-identical-flag/no-`--run-id` CacheMismatch guard), summary ×4 (incl. a `KeyboardInterrupt` crash-survival test). RED: 26 `AttributeError`.
- [x] **Step 4** — Implement `run_promote`/`_promote_target`/`_promote_plan`/`_confirmed_associations`/`_grade_match`/`_run_captured`/`_parse_json_object`/`PromoteTarget`/summary helpers + the `batch-promote` Typer wrapper. Planning **early-returns before touching disk when nothing is pending** — the steady state — so the re-run costs ~2s, not a ~20-min 82 GB re-hash.
- [x] **Step 5** — Full `tools/video_ingest` suite **642 pass / 5 skip / 0 fail / 38 subtests** (613 baseline + 29, zero regression). Worker **460 pass / 4 skip / 2 KNOWN pre-existing fails** (`ocr-decoder-runs-backfill`, untouched). Prettier clean. `batch-promote --help` renders.
- [x] **Step 6: REAL-SEAM EVIDENCE (live DB, no GPU needed)** — `_grade_match` through the real pnpm→worker→Postgres→parse chain: 463→PASS, 972→PASS, 975→HOLD — **exactly reproducing 4.G's independently-recorded on-box evidence**. `batch-promote --dry-run` over the REAL corpus + REAL DB plans **0 videos in 1.9s** (f0e57173's 5 confirmed reels correctly read as already drained) ⇒ **convergence proven**. Predicate SQL validated read-only against the live DB before any code was written.
- [x] **Step 7** — Committed `e310779`: `feat(video-ingest): promotion-of-confirmed second pass — batch-promote (④ Task 4.4)`.
- [ ] **Step 8 (ON-BOX, separate session)** — Prove the mutating path on real GPU. **Requires creating a backlog first** (there is currently none): `batch --limit 1` → `resolve-match confirm` its reels → `batch-promote --limit 1`. Proof points: `[pass1] cache hit`+`[pass2] cache hit` (a fresh Pass-1 = flag drift, STOP); **no** "dispatch deferred" line (branch (c) taken); `[dispatch] N ok, 0 failed`; `match_period_summaries` rows land for the match; `batch-promote --dry-run` afterwards drops the video from the plan. **Always `pnpm --filter @eanhl/worker build` first** — a stale `dist/` degrades every verdict to `decision="ERROR"`.

---

### Task 4.5: Un-strand single-reel videos (**CODE COMPLETE** — Steps 0–2 done; on-box proof folded into 4.4 Step 8)

**🚩 The gap:** `dispatch_reels` returns at `len(reels) <= 1` ([match_split.py:302-303](tools/video_ingest/video_ingest/match_split.py#L302-L303)) **BEFORE** `emit_reel_identities`, so a single-match recording emits **no** `reel-<idx>-identity.json` ⇒ `resolve-match propose` finds nothing ⇒ no `ocr_match_associations` row ⇒ **invisible to `batch-promote`**. Meanwhile `run_batch`'s Pass-1 dispatched it with `match_id=None` (it passes no `--match-id`), so `promoteBoxScore` throws *"Box Score promoter requires --match-id at batch ingest time"* and those extractions sit at `transform_status='error'`. **Net: single-match videos promote by NO path at all.** This is an ①/② design gap that ④ inherited — not a 4.4 bug.

**Why it matters now:** every ④ task is done, so this is the last correctness gap before committing 40-58 h of GPU. An unknown share of the 78-target corpus is single-match; a full run today would silently produce nothing for them.

- [x] **Step 0: SIZE IT FIRST — DONE (2026-07-15, read-only). VERDICT: the gap is NOT tiny — 35/78 targets (45%) are single-match ⇒ a design change is justified; the "narrower fix" escape hatch is CLOSED.**
  - **Method (the plan's own suggested signals were dead ends — do not retry them):** `/tmp/ingest-cache` had been cleared to a single sha, so the cache is not a sample. **`SELECT count(*) FROM ocr_extractions WHERE transform_status='error'` is a RED HERRING**: its 6,682 rows are ~99% `period_label OCR unrecognized` noise (Faceoff Map / Net Chart), and there are **ZERO** `requires --match-id` errors — because `batch` Pass-1 has only ever run on the one 5-reel pilot video, so the stranding signature has never fired. The DB cannot size this gap.
  - **What actually worked:** enumerate the corpus with the real `enumerate_targets` (78 targets, `since=2026-05-08`), ffprobe each for duration, and count EA `matches` rows whose `played_at` falls inside `[stamp-2m, stamp+duration+5m]` (`parse_basename_epoch`, `game_title_id=1`). `played_at` ≈ match **end**, so the span test is sound. **Calibrated on two anchors: `2026-05-22_19-07-03.mkv` → 5 matches (972–976), exactly matching its cached `reels.json` `reel_count=5` and its 106.9m duration == reel 4's end; `2026-05-08_18-25-42.mkv` → 1 match (250), the known single-match pilot.**
  - **Distribution (EA matches per recording):** 1→**35**, 2→22, 3→9, 4→1, 5→2, 6→1, 0→8. **Single-match = 35/78 = 45%, the largest single group.** Of ~126 OCR-able matches in the corpus, **~35 (28%) are stranded today.**
  - **The 8 zero-match recordings are unresolved and may raise the share to ~55%:** a tight window finds no EA row (incl. a 137m recording), so they are either poller-missed (**exactly the api-missed case where OCR is the only source — highest value**) or non-gameplay. Reel count unknown; do not assume they are empty. Note ①'s reels can be short (the pilot's reel 0 is 8.8m, reel 2 is 11.2m), so **duration alone does not bound reel count** — a 31.2m recording holds 3 matches.
- [x] **Step 1: shape CONFIRMED (2026-07-15) — branch (a), gated on `match_id is None`, NOT the reel count.** Verified against `group_into_reels`' 1-reel semantics and the parity contract before writing code, as required.
  - **🔑 Step-0 finding that reshapes (a) — the discriminator is `match_id is None`, NOT the reel count.** [match_split.py:300-303](tools/video_ingest/video_ingest/match_split.py#L300-L303)'s `len(reels) <= 1` early return is a *deliberate* "single-match parity" contract for the **manual** path, where the operator passes `--match-id` and it works **correctly** — that path must not regress. The break is only that [batch_ingest.py:516-521](tools/video_ingest/video_ingest/batch_ingest.py#L516-L521) builds its Pass-1 `ingest` command with **no `--match-id`** ⇒ `match_id=None` ⇒ dispatch under a null match ⇒ `promoteBoxScore` throws. So (a) narrows to: **when `match_id is None` and `len(reels) == 1`, emit the identity file + defer (the ② path); when `match_id` is provided, keep today's parity fan-out.** Decide `len(reels) == 0` explicitly too (no match content ⇒ nothing to emit; today it also falls into the `<= 1` branch).
  - **🚩 THE PLAN'S OWN GAP STATEMENT WAS HALF THE BUG — `len(reels) <= 1` ALSO SHADOWED `reel_match_ids`.** The gap above describes only pass 1 (no identity file emitted). But the early return fires *before the `reel_match_ids` branch too*, so even **after** ② confirms a single-reel association, pass 2 (`match_id=None` + `reel_match_ids={0: N}` from `load_confirmed_reel_map`) would **still** early-return and dispatch under the null match — throwing again. **Emitting the identity file alone would have fixed pass 1 and left single-match videos broken at pass 2.** Gating on `match_id` fixes both passes at once: an associated single reel now reaches the existing per-reel branch (c) unchanged, inheriting its forced `run_id=None` — which is why `batch-promote` needs **no** change to drain these.
  - **Parity is preserved for a structural reason, not by luck:** every pre-existing single-reel dispatch test passes `match_id=250`, so they all encode the **manual** path and stayed green untouched. The test suite independently corroborates that the real contract seam is `match_id`.
  - **`len(reels) == 0` decided explicitly:** `match_id` **set** ⇒ keep today's fan-out (the operator named the match; a grouping quirk must not silently drop their data). `match_id` **None** ⇒ nothing to dispatch and nothing for ② to score ⇒ emit no identity file, log a distinct "0 reels grouped and no match_id" line (an empty proposal set is not a review-queue item).
- [x] **Step 2+: TDD — DONE. 4 new tests in `tests/test_match_split.py`; full suite 646 pass / 5 skip / 38 subtests / 0 fail (613→642 at 4.4, +4 here).** RED first, for the right reason: the failure printed `([...], None)` — the production bug (dispatch under a **null match_id**) reproduced as a unit test. New coverage: single-reel-without-match_id emits + defers; single-reel-with-confirmed-id dispatches under the mapped id with `run_id` forced None; 0-reels-without-match_id emits/dispatches nothing; 0-reels-**with**-match_id keeps the parity fan-out (this one passed pre-change — it pins what must NOT move).
  - Final shape in [`dispatch_reels`](tools/video_ingest/video_ingest/match_split.py#L300-L320): `match_id` set + ≤1 reel → parity fan-out · `match_id` None + 0 reels → no-op · `reel_match_ids` None + ≥1 reel → emit identities + defer to ② · `reel_match_ids` set → per-reel dispatch. Also fixed a "1 reels need association" pluralization (single reels now hit that log routinely) and corrected three comments in `batch_ingest.py`/`orchestrator.py` that asserted the now-false "a single-match video dispatches inline".
  - **⚠️ `pnpm format` CANNOT gate Python work — do not treat it as a gate for `tools/video_ingest`.** The script is `prettier --write "**/*.{ts,tsx,json,md}"`; it has **no Python parser** (`No parser could be inferred for ... match_split.py`). Running it repo-wide on a Python-only change reformatted **54 unrelated files** (docs, classifier weights, benchmark fixtures — layout-only; canonicalized JSON hashed identically, so no data loss) and had to be reverted. It also exits **code 2 pre-existing**, joining `pnpm lint` as repo-wide red: committed files like `docs/calibration/after-phase-2-match-250.json` contain pnpm CLI banners and are not valid JSON. **Real gates for Python-only work: pytest via `.venv-1` only.**
- [ ] **Step 3 (ON-BOX) — folded into 4.4 Step 8, which 4.5 now unblocks.** 4.4 Step 8 needed a backlog and there was none; a **single-match** video is now the cheapest way to make one (1 reel to confirm, not 5). Run `batch --limit 1` against a known single-match target (e.g. `2026-05-08_18-25-42.mkv` → match 250) and add two 4.5-specific proof points to Step 8's list: Pass 1 logs **"1 reel needs association"** (NOT a dispatch) and writes `reel-0-identity.json`; `resolve-match propose` then finds it (pre-4.5 it found nothing).

---

## Cross-Cutting Verification (run at each milestone boundary)

1. **Typecheck:** `pnpm --filter @eanhl/db build && pnpm --filter @eanhl/worker build` (clean).
2. **Worker tests incl. regression anchor:** `pnpm --filter @eanhl/worker test` — `match-250-benchmark.test.ts` green.
3. **Python tests:** `cd tools/video_ingest && .venv/bin/python -m pytest -q` green.
4. **Format:** `pnpm format`.
5. **Do NOT gate on `pnpm lint`** (pre-existing repo-wide red).
6. **End-to-end evidence** (the per-milestone manual verify steps above) recorded in `HANDOFF.md` — real behavior observed, not just tests.

## Open items carried from spec §12 (resolve during implementation, not blockers)

- **Exact gradable field set** — pinned in Task 3.2/3.3 by inspecting real `ocr_extraction_fields` rows.
- **Association threshold** — 0.5 initial cutoff (2.2) is a placeholder; calibrate on the first real batch.
- **50 GB `2026-06-08` file** — handled by ④'s per-video failure isolation (log + skip); a remux/repair check is out of scope.
- **Web review page** — CLI review queue is the baseline; a web surface is a possible later refinement, not in this plan.
- **Unique-field accuracy** (events/coords/loadouts) — explicitly deferred; only confidence-flagged, not graded here.
