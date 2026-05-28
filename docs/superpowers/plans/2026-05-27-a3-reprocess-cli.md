# A3 — Reprocess CLI + Bad-Clip Re-Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `video_ingest reprocess` Typer subcommand that takes a match-id, creates a new `ocr_decoder_runs` row for the v2 engine, re-ingests the video against that candidate run, promotes evidence into the candidate's `ocr_promotions` rows, validates, atomically flips activation, rebuilds canonical snapshot tables from the now-active run, and supports a `--undo` rollback. Then run it against matches 968 (trigger case) and 250 (regression) to retire the v1 contamination bug.

**Architecture:** Hybrid orchestration. Python `video_ingest reprocess` is the entry point and drives high-level flow (matches the spec at master plan §A3). It shells out to a new TS `decoder-runs-cli` for the DB-atomic operations (create-candidate / validate / activate / undo) — TypeScript owns the DB transaction boundaries because Drizzle is the source of truth for schema + types. The Python orchestrator already has `video_ingest ingest --run-id N` and shells out to `ingest-ocr-cli --run-id N`; A3 wraps those with the run lifecycle.

**Tech Stack:** Python 3.12 / Typer (orchestrator); TypeScript / Node.js / Drizzle ORM (DB ops); PostgreSQL 16 (port 5433 local).

**Estimated effort:** 5-7h (matches master plan §A3 estimate).

**Sources of truth:**

- Master plan: `/home/michal/.claude/plans/multi-session-strategic-fix-for-misty-hamster.md` §A3 (lines 291-320).
- HANDOFF.md current state (2026-05-27 PM3): S5.5 complete, v2 weights shipped, proving bench green.
- [ocr-decoder-runs.ts](packages/db/src/schema/ocr-decoder-runs.ts) — schema (already has `isActive`, `decoderVersion`, `weightsHash`, `configHash`, partial-unique `one_active_per_match`).
- [loadout-v2.ts:280-293](apps/worker/src/ocr-promoters/loadout-v2.ts#L280-L293) — promoter already gates `writeSnapshots` on `effectiveRunIdForWrites === activeRunId`, so candidate-run promotions skip canonical writes (no extra plumbing needed there).
- [video_ingest/cli.py:57](tools/video_ingest/video_ingest/cli.py#L57) — existing `--run-id` plumbing for the `ingest` subcommand.

---

## File Structure

**Create:**

- `apps/worker/src/lib/rebuild-canonicals-from-active-run.ts` — helper that reads the active run's `ocr_promotions` for a match and writes `player_loadout_snapshots` + child tables. Also `match_period_summaries`, `match_events`, `match_faceoff_dots`, `match_shot_type_summaries` if/when those types of evidence land in the active run (Phase-A scope is loadout + lobby; the helper short-circuits cleanly when there are no promotions for a table).
- `apps/worker/src/lib/validate-candidate-run.ts` — read-only check that returns `{ ok: boolean; details: { loadoutSnapshotCount, lobbySnapshotCount, extractorErrors[] } }`.
- `apps/worker/src/decoder-runs-cli.ts` — new CLI: `create-candidate`, `validate`, `activate`, `undo` subcommands. Single argv entry; thin wrappers around the lib helpers and DB ops.
- `apps/worker/src/__tests__/rebuild-canonicals-from-active-run.test.ts` — unit tests for the helper.
- `apps/worker/src/__tests__/validate-candidate-run.test.ts` — unit tests.
- `apps/worker/src/__tests__/decoder-runs-cli.test.ts` — integration tests for the CLI.
- `tools/video_ingest/video_ingest/reprocess.py` — Typer subcommand module.
- `tools/video_ingest/tests/test_reprocess_cli.py` — CLI argument/wiring tests; uses subprocess mocks for the shelled-out TS CLIs.

**Modify:**

- `apps/worker/src/repromote-loadout-cli.ts` — add `--run-id` flag; pass through to `promoteLoadoutFromEvidence`.
- `apps/worker/src/repromote-lobby-cli.ts` — same.
- `apps/worker/src/index.ts` (or wherever workspace scripts are wired) — register the new `decoder-runs` CLI binary so it's invokable as `pnpm --filter worker decoder-runs <subcommand>`.
- `apps/worker/package.json` — add `decoder-runs` script entry.
- `tools/video_ingest/video_ingest/cli.py` — register `reprocess` subcommand alongside `ingest`, `classify-only`, `extract-only`.
- `tools/video_ingest/video_ingest/orchestrator.py` (and/or `pass2_extract.py`) — thread `run_id` into Pass-2 cache directory naming (`/tmp/ingest-cache/<sha>/pass2-run-<run_id>/...`) per master plan §1 (line 95).

---

## Pre-flight assumptions to verify in Task 0

These are checked first so subsequent tasks don't waste effort if the assumption is wrong:

1. `ocrDecoderRuns` table exists and has the constraints documented in [ocr-decoder-runs.ts](packages/db/src/schema/ocr-decoder-runs.ts). Verified via `\d ocr_decoder_runs` in psql.
2. `promoteLoadoutFromEvidence({ matchId, runId })` and `promoteLobbyFromEvidence({ matchId, runId })` are the v2 entry points; both already gate canonical-snapshot writes on `runId === activeRunId`.
3. `ocr_promotions` table has all the columns needed to project back to `player_loadout_snapshots` (gamertag, position, team_side, build_class, etc.), OR `rebuildCanonicalsFromActiveRun` reads from `ocr_field_evidence` + `ocr_extractions` joined against the active `runId` instead of from `ocr_promotions`. **This is the central design question and decides Task 1's body — confirm during Task 0 inspection.**

---

## Task 0: Pre-flight verification

**Files:**

- Read-only: `packages/db/src/schema/ocr-decoder-runs.ts`, `packages/db/src/schema/ocr-evidence.ts`, `apps/worker/src/ocr-promoters/loadout-v2.ts`, `apps/worker/src/ocr-promoters/lobby-v2.ts`.

- [ ] **Step 1: Confirm decoder runs schema in the live DB**

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "\d ocr_decoder_runs"
```

Expected: shows columns `id, match_id, video_sha256, decoder_version, weights_hash, config_hash, started_at, completed_at, is_active, notes` and partial-unique index `ocr_decoder_runs_one_active_per_match` on `(match_id) WHERE is_active = true`.

- [ ] **Step 2: Confirm ocr_promotions has the columns needed to rebuild canonicals**

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "\d ocr_promotions"
```

Decide on the rebuild source: if `ocr_promotions.target_payload` (or similar) carries the full snapshot payload, Task 1's helper can do `INSERT INTO player_loadout_snapshots SELECT ... FROM ocr_promotions WHERE run_id = $1 AND match_id = $2`. If not, the helper must read `ocr_field_evidence + ocr_extractions` joined on `run_id` and re-derive the canonical rows (same logic the promoter already runs).

Write the decision into the task body of Task 1 before starting Task 1 implementation.

- [ ] **Step 3: Confirm the existing test pattern for run-scoped promoters**

```bash
cat apps/worker/src/__tests__/loadout-promoter-run-scope.test.ts
```

Note the helper imports + fixture construction. Tasks 1 and 2 mirror this pattern.

- [ ] **Step 4: Confirm match 250 + 968 are in the DB**

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "SELECT id, gamertag_snapshot FROM matches WHERE id IN (250, 968)"
```

Both must return a row. If not, A3 is blocked on an upstream ingest of those matches first.

- [ ] **Step 5: Identify both matches' video sha256**

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "SELECT m.id AS match_id, b.video_sha256, b.source_directory FROM matches m JOIN ocr_capture_batches b ON b.match_id = m.id WHERE m.id IN (250, 968) ORDER BY m.id, b.id"
```

Record the sha256 values — Task 12/13's `video_ingest reprocess --match-id <N>` uses them to locate the source video.

- [ ] **Step 6: Confirm the source videos exist on disk**

```bash
ls -la "/mnt/k/NHL/NHL26/match 250/" "/mnt/k/NHL/NHL26/match 968/"
```

Expected: at least one `*.mkv` per directory. Note the canonical filenames for use in Task 12/13.

---

## Task 1: `rebuildCanonicalsFromActiveRun` helper

**Files:**

- Create: `apps/worker/src/lib/rebuild-canonicals-from-active-run.ts`
- Test: `apps/worker/src/__tests__/rebuild-canonicals-from-active-run.test.ts`

**Contract:**

```ts
export async function rebuildCanonicalsFromActiveRun(
  matchId: number,
  options?: { db?: Database; tx?: Transaction },
): Promise<{
  loadoutSnapshotsWritten: number
  lobbySnapshotsWritten: number
  // future canonical tables get their own counters here
}>
```

Idempotency contract: deletes existing canonical rows for the match FIRST, then inserts from the active run's evidence/promotions. Wraps both operations in the supplied `tx` if provided (so the caller's outer transaction can keep activation + rebuild atomic).

**Implementation strategy** (decide between these based on Task 0 step 2):

- **(a)** If `ocr_promotions` already carries the full snapshot payload as JSON: re-project from `ocr_promotions` rows tagged with `run_id = activeRunId`.
- **(b)** Otherwise: re-run the same `evidence → decisions → canonical-row` logic the promoter does, but read evidence scoped to `run_id = activeRunId`. Refactor the canonical-write portion of `loadout-v2.ts` and `lobby-v2.ts` into a shared helper that this function calls with `runId = activeRunId`.

For Phase A, (b) is more likely — the promoters' `writeSnapshots` block (loadout-v2.ts:781-940 ish) is the canonical-write block to extract.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/worker/src/__tests__/rebuild-canonicals-from-active-run.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db, ocrDecoderRuns, playerLoadoutSnapshots, matches } from '@eanhl/db'
import { rebuildCanonicalsFromActiveRun } from '../lib/rebuild-canonicals-from-active-run.js'
import {
  insertFixtureMatch,
  insertFixtureLoadoutEvidence,
  insertFixtureLobbyEvidence,
  clearFixtureMatch,
} from './_fixtures/decoder-runs-fixtures.js'

describe('rebuildCanonicalsFromActiveRun', () => {
  const matchId = 9999001 // fixture range
  beforeEach(async () => clearFixtureMatch(matchId))

  it("writes loadout snapshots from the active run's evidence", async () => {
    await insertFixtureMatch(matchId)
    // Insert two runs: v1 (inactive) and v2 (active). Each carries distinct
    // loadout evidence; only the v2 evidence should produce canonical rows.
    const [v1Run] = await db
      .insert(ocrDecoderRuns)
      .values({
        matchId,
        decoderVersion: 'hmm-viterbi-v1',
        weightsHash: 'wh-v1',
        configHash: 'ch-v1',
        isActive: false,
      })
      .returning()
    const [v2Run] = await db
      .insert(ocrDecoderRuns)
      .values({
        matchId,
        decoderVersion: 'hmm-viterbi-v2',
        weightsHash: 'wh-v2',
        configHash: 'ch-v2',
        isActive: true,
      })
      .returning()
    await insertFixtureLoadoutEvidence({
      matchId,
      runId: v1Run.id,
      gamertag: 'V1_GHOST',
    })
    await insertFixtureLoadoutEvidence({
      matchId,
      runId: v2Run.id,
      gamertag: 'V2_REAL',
    })

    const result = await rebuildCanonicalsFromActiveRun(matchId)

    const snaps = await db
      .select()
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, matchId))
    expect(snaps).toHaveLength(1)
    expect(snaps[0].gamertagSnapshot).toBe('V2_REAL')
    expect(result.loadoutSnapshotsWritten).toBe(1)
  })

  it('clears prior canonical rows before rebuilding (idempotency)', async () => {
    // ... insert fixture, call twice, assert no duplicates ...
  })

  it('throws when no active run exists for the match', async () => {
    await insertFixtureMatch(matchId)
    await expect(rebuildCanonicalsFromActiveRun(matchId)).rejects.toThrow(/no active run/i)
  })
})
```

The fixture helpers in `apps/worker/src/__tests__/_fixtures/decoder-runs-fixtures.ts` likely need to be created or extended; use the patterns already in `loadout-promoter-run-scope.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter worker test rebuild-canonicals-from-active-run.test
```

Expected: FAIL (`Cannot find module '../lib/rebuild-canonicals-from-active-run'`).

- [ ] **Step 3: Implement the helper**

```typescript
// apps/worker/src/lib/rebuild-canonicals-from-active-run.ts
import { eq, and, sql } from 'drizzle-orm'
import {
  db as defaultDb,
  ocrDecoderRuns,
  playerLoadoutSnapshots,
  playerLoadoutXFactors,
  playerLoadoutAttributes,
  type Database,
} from '@eanhl/db'
import { promoteLoadoutFromEvidence } from '../ocr-promoters/loadout-v2.js'
import { promoteLobbyFromEvidence } from '../ocr-promoters/lobby-v2.js'

export async function rebuildCanonicalsFromActiveRun(
  matchId: number,
  options?: { db?: Database },
): Promise<{ loadoutSnapshotsWritten: number; lobbySnapshotsWritten: number }> {
  const db = options?.db ?? defaultDb

  // 1. Resolve active run id
  const activeRow = await db
    .select({ id: ocrDecoderRuns.id })
    .from(ocrDecoderRuns)
    .where(and(eq(ocrDecoderRuns.matchId, matchId), eq(ocrDecoderRuns.isActive, true)))
    .limit(1)
  if (activeRow.length === 0) {
    throw new Error(`rebuildCanonicalsFromActiveRun: no active run for match ${matchId}`)
  }
  const activeRunId = activeRow[0].id

  // 2. Single transaction: delete + re-promote-with-snapshot-writes
  return await db.transaction(async (tx) => {
    // Delete prior canonical rows for this match.
    // X-factors and attributes cascade via FK from player_loadout_snapshots.
    await tx.delete(playerLoadoutSnapshots).where(eq(playerLoadoutSnapshots.matchId, matchId))
    // … plus other canonical tables as Phase-A scope grows (events, faceoffs, etc.)

    // Re-run the promoters with the active run id; writeSnapshots will be true
    // because effectiveRunIdForWrites === activeRunId.
    const loadoutResult = await promoteLoadoutFromEvidence({
      matchId,
      runId: activeRunId,
      db: tx,
    })
    const lobbyResult = await promoteLobbyFromEvidence({
      matchId,
      runId: activeRunId,
      db: tx,
    })

    return {
      loadoutSnapshotsWritten: loadoutResult.promotedSnapshotCount,
      lobbySnapshotsWritten: lobbyResult.promotedSnapshotCount,
    }
  })
}
```

If `promoteLoadoutFromEvidence` and `promoteLobbyFromEvidence` don't accept a `db: Transaction` override yet, that's a Task 1a sub-task: extend their signatures (their existing `db?` parameter is `Database`; widen to `Database | Transaction`).

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter worker test rebuild-canonicals-from-active-run.test
```

Expected: PASS for all three cases.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/lib/rebuild-canonicals-from-active-run.ts apps/worker/src/__tests__/rebuild-canonicals-from-active-run.test.ts apps/worker/src/__tests__/_fixtures/decoder-runs-fixtures.ts
git commit -m "feat(worker): add rebuildCanonicalsFromActiveRun helper for A3 reprocess

Reads the active ocr_decoder_runs row for a match and re-projects its
evidence into player_loadout_snapshots (+ x-factor/attribute children)
and lobby snapshot tables. Idempotent — deletes prior canonical rows
inside the same transaction before rebuilding. Used by the upcoming
decoder-runs-cli activate command."
```

---

## Task 2: `validateCandidateRun` helper

**Files:**

- Create: `apps/worker/src/lib/validate-candidate-run.ts`
- Test: `apps/worker/src/__tests__/validate-candidate-run.test.ts`

**Contract:**

```ts
export async function validateCandidateRun(
  runId: number,
  options?: { db?: Database; minLoadoutSnapshots?: number; minLobbySnapshots?: number },
): Promise<{
  ok: boolean
  details: {
    runId: number
    matchId: number
    loadoutPromotionCount: number
    lobbyPromotionCount: number
    extractorErrors: { kind: string; count: number }[]
    failureReasons: string[] // empty when ok=true
  }
}>
```

Default thresholds: 5 loadout promotions (one per skater), 1 lobby promotion (one per match), 0 extractor errors. Phase-A choice — make them tunable but don't over-engineer.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/worker/src/__tests__/validate-candidate-run.test.ts
import { describe, it, expect } from 'vitest'
import { validateCandidateRun } from '../lib/validate-candidate-run.js'
import {} from /* fixtures */ './_fixtures/decoder-runs-fixtures.js'

describe('validateCandidateRun', () => {
  it('returns ok=true when the run has expected loadout + lobby promotions', async () => {
    const matchId = 9999002
    // ... insert fixture run + 5 loadout promotions + 1 lobby promotion ...
    const result = await validateCandidateRun(runId)
    expect(result.ok).toBe(true)
    expect(result.details.loadoutPromotionCount).toBe(5)
    expect(result.details.lobbyPromotionCount).toBe(1)
  })

  it('returns ok=false when extractor errors are non-zero', async () => {
    // ... insert run with extractor_error rows ...
    const result = await validateCandidateRun(runId)
    expect(result.ok).toBe(false)
    expect(result.details.failureReasons).toContain(/extractor errors/i)
  })

  it('returns ok=false when promotion count is below floor', async () => {
    // ... insert run with only 2 loadout promotions ...
    const result = await validateCandidateRun(runId, { minLoadoutSnapshots: 5 })
    expect(result.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter worker test validate-candidate-run.test
```

Expected: FAIL (module missing).

- [ ] **Step 3: Implement the helper**

```typescript
// apps/worker/src/lib/validate-candidate-run.ts
import { eq, and, sql } from 'drizzle-orm'
import {
  db as defaultDb,
  ocrDecoderRuns,
  ocrPromotions,
  ocrExtractions,
  type Database,
} from '@eanhl/db'

export interface ValidationResult {
  ok: boolean
  details: {
    runId: number
    matchId: number
    loadoutPromotionCount: number
    lobbyPromotionCount: number
    extractorErrors: { kind: string; count: number }[]
    failureReasons: string[]
  }
}

export async function validateCandidateRun(
  runId: number,
  options: { db?: Database; minLoadoutSnapshots?: number; minLobbySnapshots?: number } = {},
): Promise<ValidationResult> {
  const db = options.db ?? defaultDb
  const minLoadout = options.minLoadoutSnapshots ?? 5
  const minLobby = options.minLobbySnapshots ?? 1

  const [runRow] = await db
    .select()
    .from(ocrDecoderRuns)
    .where(eq(ocrDecoderRuns.id, runId))
    .limit(1)
  if (!runRow) throw new Error(`validateCandidateRun: run ${runId} not found`)

  // Count promotions per target_table.
  const promotionCounts = await db
    .select({
      targetTable: ocrPromotions.targetTable,
      count: sql<number>`count(*)::int`,
    })
    .from(ocrPromotions)
    .where(eq(ocrPromotions.runId, runId))
    .groupBy(ocrPromotions.targetTable)

  const loadoutPromotionCount =
    promotionCounts.find((r) => r.targetTable === 'player_loadout_snapshots')?.count ?? 0
  const lobbyPromotionCount =
    promotionCounts.find((r) => r.targetTable === 'lobby_snapshots')?.count ?? 0
  // Confirm the exact targetTable names in Task 0 step 2 before pasting.

  // Count extractor errors associated with this run.
  const extractorErrors = await db
    .select({
      kind: ocrExtractions.extractorErrorKind,
      count: sql<number>`count(*)::int`,
    })
    .from(ocrExtractions)
    .where(
      and(eq(ocrExtractions.runId, runId), sql`${ocrExtractions.extractorErrorKind} IS NOT NULL`),
    )
    .groupBy(ocrExtractions.extractorErrorKind)

  const failureReasons: string[] = []
  if (loadoutPromotionCount < minLoadout) {
    failureReasons.push(`loadout promotions ${loadoutPromotionCount} < floor ${minLoadout}`)
  }
  if (lobbyPromotionCount < minLobby) {
    failureReasons.push(`lobby promotions ${lobbyPromotionCount} < floor ${minLobby}`)
  }
  if (extractorErrors.length > 0) {
    failureReasons.push(
      `extractor errors present: ${extractorErrors.map((e) => `${e.kind}=${e.count}`).join(', ')}`,
    )
  }

  return {
    ok: failureReasons.length === 0,
    details: {
      runId,
      matchId: runRow.matchId,
      loadoutPromotionCount,
      lobbyPromotionCount,
      extractorErrors,
      failureReasons,
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter worker test validate-candidate-run.test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/lib/validate-candidate-run.ts apps/worker/src/__tests__/validate-candidate-run.test.ts
git commit -m "feat(worker): add validateCandidateRun helper for A3 reprocess

Read-only check of a candidate run's promotion counts + extractor
errors. Phase-A thresholds: ≥5 loadout snapshots, ≥1 lobby snapshot,
zero extractor errors. Returns ok=false with reasons rather than
throwing so callers can decide whether to fail soft or hard."
```

---

## Task 3: `decoder-runs-cli` — `create-candidate` subcommand

**Files:**

- Create: `apps/worker/src/decoder-runs-cli.ts`
- Test: `apps/worker/src/__tests__/decoder-runs-cli.test.ts`
- Modify: `apps/worker/package.json` (add script)

- [ ] **Step 1: Write the failing test for create-candidate**

```typescript
// apps/worker/src/__tests__/decoder-runs-cli.test.ts
import { describe, it, expect } from 'vitest'
import { runCli } from './_helpers/run-cli.js'

describe('decoder-runs-cli create-candidate', () => {
  it('inserts a row with is_active=false and prints the new run_id as JSON on stdout', async () => {
    const matchId = 9999003
    // ... insert fixture match ...
    const { stdout, code } = await runCli('decoder-runs-cli', [
      'create-candidate',
      '--match-id',
      String(matchId),
      '--video-sha256',
      'deadbeef',
      '--decoder-version',
      'hmm-viterbi-v2',
      '--weights-hash',
      'wh-test',
      '--config-hash',
      'ch-test',
    ])
    expect(code).toBe(0)
    const payload = JSON.parse(stdout)
    expect(payload.run_id).toBeGreaterThan(0)
    expect(payload.is_active).toBe(false)
    // verify row in DB
    const [row] = await db
      .select()
      .from(ocrDecoderRuns)
      .where(eq(ocrDecoderRuns.id, payload.run_id))
    expect(row.matchId).toBe(matchId)
    expect(row.isActive).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter worker test decoder-runs-cli.test
```

Expected: FAIL (module missing).

- [ ] **Step 3: Implement the CLI skeleton + create-candidate**

```typescript
// apps/worker/src/decoder-runs-cli.ts
/**
 * pnpm --filter worker decoder-runs <subcommand> [args...]
 *
 * Subcommands:
 *   create-candidate  --match-id N --video-sha256 SHA --decoder-version V \
 *                     --weights-hash WH --config-hash CH
 *     Inserts a new ocr_decoder_runs row with is_active=false.
 *     Prints {"run_id": N, "is_active": false} on stdout.
 *
 *   validate          --run-id N [--min-loadout K] [--min-lobby K]
 *     Runs validateCandidateRun(N). Exit 0 on ok=true, exit 2 on ok=false.
 *     Prints the validation details as JSON on stdout regardless.
 *
 *   activate          --run-id N [--dry-run]
 *     Atomic transaction:
 *       UPDATE ocr_decoder_runs SET is_active=false WHERE match_id=X AND is_active=true;
 *       UPDATE ocr_decoder_runs SET is_active=true, completed_at=now() WHERE id=N;
 *       rebuildCanonicalsFromActiveRun(matchId);
 *       applyMatchColors(matchId);
 *     --dry-run prints what would happen without committing.
 *
 *   undo              --match-id N [--dry-run]
 *     Finds the prior active run via MAX(completed_at) WHERE match_id=N AND is_active=false.
 *     Runs the same atomic transaction with the prior run as the new active.
 */
import { db, ocrDecoderRuns, eq, and, desc, sql } from '@eanhl/db'
import { rebuildCanonicalsFromActiveRun } from './lib/rebuild-canonicals-from-active-run.js'
import { validateCandidateRun } from './lib/validate-candidate-run.js'
import { applyMatchColors } from './lib/match-color-aggregator.js'

function getFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}

async function createCandidate(argv: string[]): Promise<void> {
  const matchId = Number(getFlag(argv, 'match-id'))
  const videoSha256 = getFlag(argv, 'video-sha256') ?? null
  const decoderVersion = getFlag(argv, 'decoder-version')
  const weightsHash = getFlag(argv, 'weights-hash')
  const configHash = getFlag(argv, 'config-hash')
  if (!Number.isFinite(matchId) || !decoderVersion || !weightsHash || !configHash) {
    throw new Error(
      'create-candidate requires --match-id, --decoder-version, --weights-hash, --config-hash',
    )
  }
  const [row] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId,
      videoSha256,
      decoderVersion,
      weightsHash,
      configHash,
      isActive: false,
    })
    .returning({ id: ocrDecoderRuns.id, isActive: ocrDecoderRuns.isActive })
  process.stdout.write(JSON.stringify({ run_id: row.id, is_active: row.isActive }) + '\n')
}

async function main(): Promise<void> {
  const [subcommand, ...rest] = process.argv.slice(2)
  switch (subcommand) {
    case 'create-candidate':
      await createCandidate(rest)
      break
    case 'validate':
      throw new Error('not yet implemented (Task 4)')
    case 'activate':
      throw new Error('not yet implemented (Task 4)')
    case 'undo':
      throw new Error('not yet implemented (Task 5)')
    default:
      throw new Error(`unknown subcommand: ${subcommand}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message ?? err)
    process.exit(1)
  })
```

- [ ] **Step 4: Register the CLI script**

Edit `apps/worker/package.json`. In the `scripts` block, add (next to existing CLI scripts):

```json
"decoder-runs": "tsx src/decoder-runs-cli.ts"
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter worker test decoder-runs-cli.test
```

Expected: PASS for create-candidate; the validate/activate/undo cases still expect failure (those land in Task 4 + 5).

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/decoder-runs-cli.ts apps/worker/src/__tests__/decoder-runs-cli.test.ts apps/worker/package.json
git commit -m "feat(worker): decoder-runs-cli skeleton + create-candidate subcommand"
```

---

## Task 4: `decoder-runs-cli` — `validate` + `activate` subcommands

**Files:**

- Modify: `apps/worker/src/decoder-runs-cli.ts`
- Modify: `apps/worker/src/__tests__/decoder-runs-cli.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe('decoder-runs-cli validate', () => {
  it('exits 0 and prints details when validation passes', async () => {
    // ... insert fixture run with 5 loadout + 1 lobby promotion ...
    const { stdout, code } = await runCli('decoder-runs-cli', [
      'validate',
      '--run-id',
      String(runId),
    ])
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true })
  })
  it('exits 2 when validation fails', async () => {
    // ... fixture with insufficient promotions ...
    const { code } = await runCli('decoder-runs-cli', ['validate', '--run-id', String(runId)])
    expect(code).toBe(2)
  })
})

describe('decoder-runs-cli activate', () => {
  it('flips activation atomically and rebuilds canonicals', async () => {
    const matchId = 9999004
    // insert v1 (active) + v2 (inactive candidate) with distinct evidence
    // ... call activate --run-id <v2RunId> ...
    // verify v1.is_active=false, v2.is_active=true, canonical rows reflect v2
  })
  it('--dry-run does not modify the DB', async () => {
    /* ... */
  })
  it('fails if the target run is already active', async () => {
    /* ... */
  })
  it('fails if the target run does not belong to a match with another active run [allowed]', async () => {
    // Activating a candidate when no prior active run exists should still succeed.
    // (This case happens for the FIRST-EVER reprocess of a match.)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter worker test decoder-runs-cli.test
```

- [ ] **Step 3: Implement validate**

```typescript
// In decoder-runs-cli.ts
async function validate(argv: string[]): Promise<void> {
  const runId = Number(getFlag(argv, 'run-id'))
  const minLoadout = Number(getFlag(argv, 'min-loadout') ?? '5')
  const minLobby = Number(getFlag(argv, 'min-lobby') ?? '1')
  if (!Number.isFinite(runId)) throw new Error('validate requires --run-id')
  const result = await validateCandidateRun(runId, {
    minLoadoutSnapshots: minLoadout,
    minLobbySnapshots: minLobby,
  })
  process.stdout.write(JSON.stringify(result) + '\n')
  if (!result.ok) process.exit(2)
}
```

Replace the `validate` throw with `await validate(rest); break` in `main()`.

- [ ] **Step 4: Implement activate**

```typescript
// In decoder-runs-cli.ts
async function activate(argv: string[]): Promise<void> {
  const runId = Number(getFlag(argv, 'run-id'))
  const dryRun = argv.includes('--dry-run')
  if (!Number.isFinite(runId)) throw new Error('activate requires --run-id')

  const [target] = await db
    .select()
    .from(ocrDecoderRuns)
    .where(eq(ocrDecoderRuns.id, runId))
    .limit(1)
  if (!target) throw new Error(`activate: run ${runId} not found`)
  if (target.isActive) throw new Error(`activate: run ${runId} is already active`)
  const matchId = target.matchId

  if (dryRun) {
    const [prior] = await db
      .select({ id: ocrDecoderRuns.id })
      .from(ocrDecoderRuns)
      .where(and(eq(ocrDecoderRuns.matchId, matchId), eq(ocrDecoderRuns.isActive, true)))
      .limit(1)
    process.stdout.write(
      JSON.stringify({
        would_deactivate_run_id: prior?.id ?? null,
        would_activate_run_id: runId,
        would_rebuild_canonicals_for_match: matchId,
        dry_run: true,
      }) + '\n',
    )
    return
  }

  let result: { loadoutSnapshotsWritten: number; lobbySnapshotsWritten: number }
  await db.transaction(async (tx) => {
    await tx
      .update(ocrDecoderRuns)
      .set({ isActive: false })
      .where(and(eq(ocrDecoderRuns.matchId, matchId), eq(ocrDecoderRuns.isActive, true)))
    await tx
      .update(ocrDecoderRuns)
      .set({ isActive: true, completedAt: new Date() })
      .where(eq(ocrDecoderRuns.id, runId))
    // rebuildCanonicalsFromActiveRun must accept the tx so it stays atomic
    result = await rebuildCanonicalsFromActiveRun(matchId, { db: tx })
  })
  // applyMatchColors is idempotent + uses its own transaction; run outside.
  await applyMatchColors(matchId)
  process.stdout.write(
    JSON.stringify({
      activated_run_id: runId,
      match_id: matchId,
      ...result!,
    }) + '\n',
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter worker test decoder-runs-cli.test
```

Expected: PASS for create-candidate, validate, activate cases.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(worker): decoder-runs-cli validate + activate subcommands"
```

---

## Task 5: `decoder-runs-cli` — `undo` subcommand

**Files:**

- Modify: `apps/worker/src/decoder-runs-cli.ts`
- Modify: `apps/worker/src/__tests__/decoder-runs-cli.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe('decoder-runs-cli undo', () => {
  it('flips activation back to the prior run and rebuilds canonicals', async () => {
    const matchId = 9999005
    // insert v1 (currently inactive, was-active), v2 (currently active)
    // each with distinct evidence
    // call: decoder-runs-cli undo --match-id <matchId>
    // assert: v1 is_active=true, v2 is_active=false, canonicals match v1
  })
  it('fails when no prior inactive run exists', async () => {
    // match with only one (active) run; undo should error.
  })
  it('--dry-run reports the would-be flip without committing', async () => {
    /* ... */
  })
})
```

- [ ] **Step 2: Run to verify failure**
- [ ] **Step 3: Implement undo**

```typescript
async function undo(argv: string[]): Promise<void> {
  const matchId = Number(getFlag(argv, 'match-id'))
  const dryRun = argv.includes('--dry-run')
  if (!Number.isFinite(matchId)) throw new Error('undo requires --match-id')

  // Find prior inactive run with the latest completed_at.
  const prior = await db
    .select({ id: ocrDecoderRuns.id })
    .from(ocrDecoderRuns)
    .where(
      and(
        eq(ocrDecoderRuns.matchId, matchId),
        eq(ocrDecoderRuns.isActive, false),
        sql`${ocrDecoderRuns.completedAt} IS NOT NULL`,
      ),
    )
    .orderBy(desc(ocrDecoderRuns.completedAt))
    .limit(1)
  if (prior.length === 0) {
    throw new Error(`undo: no prior inactive run found for match ${matchId}`)
  }
  // Delegate to activate logic (same atomic flip).
  await activate(['--run-id', String(prior[0].id), ...(dryRun ? ['--dry-run'] : [])])
}
```

- [ ] **Step 4: Run tests, commit**

```bash
pnpm --filter worker test decoder-runs-cli.test
git commit -am "feat(worker): decoder-runs-cli undo subcommand"
```

---

## Task 6: Add `--run-id` to repromote CLIs

**Files:**

- Modify: `apps/worker/src/repromote-loadout-cli.ts`
- Modify: `apps/worker/src/repromote-lobby-cli.ts`
- Test: `apps/worker/src/__tests__/repromote-cli-run-id.test.ts` (new — covers both CLIs)

- [ ] **Step 1: Write failing test (both CLIs)**

```typescript
describe('repromote-{loadout,lobby}-cli --run-id', () => {
  it('repromote-loadout passes runId to promoteLoadoutFromEvidence', async () => {
    // Insert v1 + v2 runs with distinct evidence; verify --run-id N
    // produces promotions tagged with that runId only.
  })
  it('repromote-lobby behaves the same', async () => {
    /* ... */
  })
})
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Add `--run-id` parsing + thread to promoter**

```typescript
// repromote-loadout-cli.ts — add to parseArgs:
function parseArgs(argv: string[]) {
  const matchIds: number[] = []
  let runId: number | undefined = undefined
  let dryRun = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--match' && i + 1 < argv.length) {
      matchIds.push(Number(argv[++i]))
    } else if (argv[i] === '--run-id' && i + 1 < argv.length) {
      runId = Number(argv[++i])
    } else if (argv[i] === '--dry-run') {
      dryRun = true
    }
  }
  return { matchIds, runId, dryRun }
}
// Pass `runId` through to `promoteLoadoutFromEvidence({ matchId, runId })`.
```

Mirror for `repromote-lobby-cli.ts`.

- [ ] **Step 4: Tests pass, commit**

```bash
git commit -am "feat(worker): repromote-{loadout,lobby}-cli accept --run-id

Allows the A3 reprocess CLI to repromote against a specific candidate
run instead of the live (active + NULL) leg. Default behavior unchanged
when --run-id is omitted."
```

---

## Task 7: Pass-2 cache directory scoped by run_id

**Files:**

- Modify: `tools/video_ingest/video_ingest/orchestrator.py` (likely the pass2 cache path computation site)
- Modify: `tools/video_ingest/video_ingest/pass2_extract.py`
- Test: `tools/video_ingest/tests/test_pass2_cache_dir_scoped_by_run.py`

Per master plan §1 line 95: when `run_id` is provided, the Pass-2 cache dir should be `<sha>/pass2-run-<run_id>/...` instead of `<sha>/pass2/...`. Backwards compatible — without `--run-id`, the directory name is unchanged.

- [ ] **Step 1: Locate the existing pass2 cache dir construction**

```bash
grep -rn "pass2" tools/video_ingest/video_ingest/ --include='*.py' | grep -i "dir\|path" | head -10
```

Identify the function that builds the path. Note its current contract.

- [ ] **Step 2: Write the failing test**

```python
# tools/video_ingest/tests/test_pass2_cache_dir_scoped_by_run.py
from video_ingest.orchestrator import compute_pass2_cache_dir  # name TBD per step 1

def test_pass2_cache_dir_default_uses_unscoped_name(tmp_path):
    out = compute_pass2_cache_dir(root=tmp_path, sha="abc123", run_id=None)
    assert out.name == "pass2"

def test_pass2_cache_dir_with_run_id_appends_run_suffix(tmp_path):
    out = compute_pass2_cache_dir(root=tmp_path, sha="abc123", run_id=42)
    assert out.name == "pass2-run-42"
```

- [ ] **Step 3: Verify FAIL, implement, verify PASS**

```bash
PYTHONPATH=. python3 -m pytest tests/test_pass2_cache_dir_scoped_by_run.py -v
```

- [ ] **Step 4: Thread `run_id` through orchestrator + pass2_extract call sites**

Find all call sites of the pass2 cache dir helper. Add `run_id` to each (default `None` to preserve current behavior).

- [ ] **Step 5: Run the wider pass2 test suite to catch regressions**

```bash
PYTHONPATH=. python3 -m pytest tests/test_pass2_extract.py tests/test_cache_invalidation.py -v
```

Expected: still green.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(video_ingest): scope Pass-2 cache dir by run_id when provided

Per master plan §1: reprocess runs write to /tmp/ingest-cache/<sha>/
pass2-run-<run_id>/... so concurrent reprocesses against the same
video don't share PNG outputs. No-op (cache dir unchanged) when --run-id
is omitted, preserving legacy ingest behavior."
```

---

## Task 8: Python `video_ingest reprocess` subcommand skeleton

**Files:**

- Create: `tools/video_ingest/video_ingest/reprocess.py`
- Modify: `tools/video_ingest/video_ingest/cli.py` (register subcommand)
- Test: `tools/video_ingest/tests/test_reprocess_cli.py`

- [ ] **Step 1: Write the failing CLI-wiring test**

```python
# tools/video_ingest/tests/test_reprocess_cli.py
from typer.testing import CliRunner
from video_ingest.cli import app

def test_reprocess_subcommand_help_lists_required_args():
    runner = CliRunner()
    result = runner.invoke(app, ["reprocess", "--help"])
    assert result.exit_code == 0
    assert "--match-id" in result.stdout
    assert "--video" in result.stdout
    assert "--dry-run" in result.stdout
    assert "--undo" in result.stdout

def test_reprocess_match_id_alone_resolves_video_via_ocr_capture_batches():
    """Smoke test — runs with --dry-run so no DB writes occur.
    Asserts the resolved video path matches the one recorded in
    ocr_capture_batches for the match."""
    # ... use a fixture match + a real video path ...
```

- [ ] **Step 2: Run, verify FAIL**

```bash
PYTHONPATH=.:../game_ocr python3 -m pytest tests/test_reprocess_cli.py -v
```

Expected: FAIL — `reprocess` subcommand not registered.

- [ ] **Step 3: Implement the reprocess module skeleton**

```python
# tools/video_ingest/video_ingest/reprocess.py
"""video_ingest reprocess — Phase-A A3 reprocess CLI.

Orchestrates: create candidate run → ingest into candidate → promote
against candidate → validate → atomic activation + canonical rebuild.

Shells out to apps/worker's `decoder-runs` CLI for all DB-atomic
operations (Drizzle is the schema source of truth). The Python side
holds the high-level flow.
"""
from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
from pathlib import Path

import typer


REPO_ROOT = Path(__file__).resolve().parents[3]


def _run_decoder_runs_cli(*args: str) -> dict:
    """Invoke `pnpm --filter worker decoder-runs <args>` and parse the JSON
    payload it prints on stdout. Raises on non-zero exit (except for the
    validate command's exit 2, which is propagated)."""
    cmd = ["pnpm", "--filter", "worker", "decoder-runs", *args]
    res = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True)
    if res.returncode not in (0, 2):
        raise RuntimeError(
            f"decoder-runs {shlex.join(args)} exited {res.returncode}:\n{res.stderr}"
        )
    # Tolerate verbose pnpm header lines; the JSON we want is the last printed line.
    for line in res.stdout.strip().splitlines()[::-1]:
        if line.startswith("{"):
            return {**json.loads(line), "_exit": res.returncode}
    raise RuntimeError(f"no JSON payload found in decoder-runs output:\n{res.stdout}")


def reprocess(
    match_id: int = typer.Option(..., "--match-id"),
    video: Path = typer.Option(
        None, "--video", exists=True, readable=True, resolve_path=True,
        help="Override the video path; otherwise resolved via ocr_capture_batches.video_sha256.",
    ),
    dry_run: bool = typer.Option(False, "--dry-run"),
    undo: bool = typer.Option(False, "--undo"),
    version: str = typer.Option("nhl26", "--version"),
) -> None:
    """Reprocess a match's video against the current v2 weights.

    Default flow (no --undo):
      1. Create candidate ocr_decoder_runs row (is_active=false).
      2. Run video_ingest ingest --force-pass1 --force-pass2 --dispatch
         --run-id <new> --match-id N.
      3. Run repromote-loadout-cli + repromote-lobby-cli with --run-id.
      4. Validate the candidate (decoder-runs-cli validate).
      5. Atomic activation + canonical rebuild (decoder-runs-cli activate).

    --undo: shells through `decoder-runs-cli undo --match-id N`.
    --dry-run: prints what would happen at each step; no DB writes, no
    Pass-1/Pass-2 re-extraction.
    """
    if undo:
        flags = ["undo", "--match-id", str(match_id)]
        if dry_run: flags.append("--dry-run")
        result = _run_decoder_runs_cli(*flags)
        typer.echo(json.dumps(result, indent=2))
        return

    # Full reprocess — TBD in Task 9.
    raise typer.Exit(code=0)  # placeholder; Task 9 fills the body.
```

- [ ] **Step 4: Register the subcommand in cli.py**

```python
# tools/video_ingest/video_ingest/cli.py — add near the other @app.command() blocks
from video_ingest.reprocess import reprocess  # noqa: E402

app.command(name="reprocess")(reprocess)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
PYTHONPATH=.:../game_ocr python3 -m pytest tests/test_reprocess_cli.py -v
```

Expected: help test PASSES; the smoke test may still XFAIL until Task 9 implements the body. Skip-mark it for now.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(video_ingest): reprocess subcommand skeleton + --undo flow

CLI registered; --undo path delegates to decoder-runs-cli. Full
reprocess body (create-ingest-promote-validate-activate) lands in
the next commit."
```

---

## Task 9: Full reprocess flow (create-ingest-promote-validate-activate)

**Files:**

- Modify: `tools/video_ingest/video_ingest/reprocess.py`
- Modify: `tools/video_ingest/tests/test_reprocess_cli.py`

- [ ] **Step 1: Write the failing E2E test**

Use a small fixture (one previously-ingested match with a tiny video clip — match-250-clip.mkv works) and assert the full flow:

```python
def test_reprocess_full_flow_against_fixture_match(monkeypatch):
    """Run the full reprocess flow against a fixture match. Asserts:
      - a new ocr_decoder_runs row was created with is_active=false then true
      - canonical player_loadout_snapshots reflect the v2 evidence
      - the prior active run still exists but is_active=false
    Heavy test — only runs with RUN_REPROCESS_E2E=1."""
    if os.environ.get("RUN_REPROCESS_E2E") != "1":
        pytest.skip("set RUN_REPROCESS_E2E=1 to enable")
    # ... call the subcommand, assert DB state ...
```

- [ ] **Step 2: Compute weights_hash + config_hash in Python**

Add a helper to reprocess.py that produces sha256 of the v2 weights JSON and combined config (state machine YAML + regex priors YAML). The Python code already loads these for the bench:

```python
import hashlib

def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()

def _compute_hashes(version: str) -> tuple[str, str]:
    weights = REPO_ROOT / "tools" / "game_ocr" / "game_ocr" / "weights" / f"{version}-screen-classifier-v2.json"
    state_machine = REPO_ROOT / "tools" / "game_ocr" / "game_ocr" / "configs" / "state_machine" / f"{version}.yaml"
    regex_priors = REPO_ROOT / "tools" / "game_ocr" / "game_ocr" / "configs" / "state_machine" / f"{version}_regex_priors.yaml"
    weights_hash = _file_sha256(weights)
    # config_hash = sha256 of state_machine + regex_priors concatenated
    combined = hashlib.sha256()
    combined.update(state_machine.read_bytes())
    combined.update(regex_priors.read_bytes())
    config_hash = combined.hexdigest()
    return weights_hash, config_hash
```

- [ ] **Step 3: Resolve video path from ocr_capture_batches when --video is omitted**

Either query the DB directly via psycopg, or shell to `pnpm --filter worker decoder-runs lookup-video --match-id N` (add a new subcommand if needed). For now, query directly via `psycopg2` (already a worker dependency).

```python
def _resolve_video_path(match_id: int) -> Path:
    import psycopg
    dsn = os.environ["DATABASE_URL"]
    with psycopg.connect(dsn) as conn:
        rows = conn.execute(
            "SELECT video_sha256, source_directory FROM ocr_capture_batches "
            "WHERE match_id = %s AND video_sha256 IS NOT NULL "
            "ORDER BY id DESC LIMIT 1", (match_id,)
        ).fetchall()
    if not rows: raise RuntimeError(f"no video sha256 for match {match_id}")
    # Search for *.mkv under the recorded source_directory whose sha matches.
    # ... (sha computation can be skipped if source_directory uniquely identifies the file)
```

- [ ] **Step 4: Wire the full flow body**

```python
# In reprocess() function — replace the placeholder body:
weights_hash, config_hash = _compute_hashes(version)
video_path = video or _resolve_video_path(match_id)
video_sha256 = _file_sha256(video_path)

# Step 1: create candidate
create_result = _run_decoder_runs_cli(
    "create-candidate",
    "--match-id", str(match_id),
    "--video-sha256", video_sha256,
    "--decoder-version", "hmm-viterbi-v2",
    "--weights-hash", weights_hash,
    "--config-hash", config_hash,
)
new_run_id = create_result["run_id"]
typer.echo(f"created candidate run {new_run_id}")

if dry_run:
    typer.echo("dry-run: stopping before ingest")
    return

# Step 2: ingest
subprocess.run([
    "python3", "-m", "video_ingest.cli", "ingest",
    "--video", str(video_path),
    "--output-root", "/tmp/ingest-cache",
    "--version", version,
    "--force-pass1", "--force-pass2",
    "--dispatch",
    "--match-id", str(match_id),
    "--run-id", str(new_run_id),
    "--game-title-id", "1",  # nhl26
], cwd=REPO_ROOT, check=True)

# Step 3: repromote with the candidate runId
for cli in ("repromote-loadout", "repromote-lobby"):
    subprocess.run([
        "pnpm", "--filter", "worker", cli,
        "--", "--match", str(match_id), "--run-id", str(new_run_id),
    ], cwd=REPO_ROOT, check=True)

# Step 4: validate
val = _run_decoder_runs_cli("validate", "--run-id", str(new_run_id))
if val.get("_exit") != 0:
    typer.echo(f"validation failed: {val['details']['failureReasons']}", err=True)
    raise typer.Exit(code=2)

# Step 5: activate
act = _run_decoder_runs_cli("activate", "--run-id", str(new_run_id))
typer.echo(json.dumps(act, indent=2))
```

- [ ] **Step 5: Run all tests + smoke**

```bash
PYTHONPATH=.:../game_ocr python3 -m pytest tests/test_reprocess_cli.py -v
RUN_REPROCESS_E2E=1 PYTHONPATH=.:../game_ocr python3 -m pytest tests/test_reprocess_cli.py::test_reprocess_full_flow_against_fixture_match -v
```

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(video_ingest): reprocess full flow — create→ingest→promote→validate→activate

Wires the 5-step Python orchestration described in master plan §A3.
Shells out to apps/worker's decoder-runs CLI for DB-atomic ops and
to repromote-{loadout,lobby}-cli for typed-v1 promotion. video_ingest
ingest --run-id passes the candidate run through to ingest-ocr-cli."
```

---

## Task 10: Manual reprocess of match 250 (regression check)

**Files:** none modified — operational task.

- [ ] **Step 1: Snapshot the current canonical state for match 250 BEFORE reprocess**

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "\
  SELECT gamertag_snapshot, team_side, position, build_class \
  FROM player_loadout_snapshots WHERE match_id = 250 ORDER BY team_side, position" \
  > /tmp/match250-loadouts-pre.txt
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "\
  SELECT id, decoder_version, is_active, started_at FROM ocr_decoder_runs \
  WHERE match_id = 250 ORDER BY id" \
  > /tmp/match250-runs-pre.txt
```

- [ ] **Step 2: Run reprocess**

```bash
set -a && source .env && set +a
pnpm --filter @eanhl/db build
pnpm --filter @eanhl/worker build
pnpm --filter video_ingest build  # if applicable
PYTHONPATH=tools/game_ocr python3 -m video_ingest.cli reprocess --match-id 250
```

Expected runtime: ~3-5 minutes (Pass-1 + Pass-2 + promote + activate). The CLI prints progress + the activated run id at the end.

- [ ] **Step 3: Verify canonical state changed and is valid**

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "\
  SELECT gamertag_snapshot, team_side, position, build_class \
  FROM player_loadout_snapshots WHERE match_id = 250 ORDER BY team_side, position" \
  > /tmp/match250-loadouts-post.txt
diff /tmp/match250-loadouts-pre.txt /tmp/match250-loadouts-post.txt
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "\
  SELECT id, decoder_version, is_active FROM ocr_decoder_runs \
  WHERE match_id = 250 ORDER BY id"
```

Acceptance: there's a new run with `is_active=true` and `decoder_version='hmm-viterbi-v2'`; the prior active run is now `is_active=false`; the loadout snapshots reflect the v2 evidence (which for match-250 should be identical or improved compared to v1).

- [ ] **Step 4: Run the worker's regression tests**

```bash
pnpm --filter worker test match-250-benchmark
pnpm --filter worker test match-quality-regression
```

Expected: green (regression floors hold or improve). If any benchmark fails, investigate before proceeding to match 968.

- [ ] **Step 5: Verify --undo reverses cleanly**

```bash
PYTHONPATH=tools/game_ocr python3 -m video_ingest.cli reprocess --match-id 250 --undo
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "\
  SELECT id, decoder_version, is_active FROM ocr_decoder_runs \
  WHERE match_id = 250 ORDER BY id"
```

Expected: prior v1 run is `is_active=true` again; v2 run is `is_active=false`.

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "\
  SELECT gamertag_snapshot, team_side, position FROM player_loadout_snapshots \
  WHERE match_id = 250 ORDER BY team_side, position" \
  > /tmp/match250-loadouts-undo.txt
diff /tmp/match250-loadouts-pre.txt /tmp/match250-loadouts-undo.txt
```

Expected: no diff vs. the original snapshot.

- [ ] **Step 6: Re-apply v2 by reprocess (idempotency check) OR by re-activating the existing v2 run**

The simplest re-application: shell `decoder-runs-cli activate --run-id <prev_v2_run_id>`. Same atomic flip; canonicals rebuilt from the v2 run's preserved evidence.

```bash
pnpm --filter worker decoder-runs activate --run-id <v2_run_id_from_step_2>
```

Expected: match 250 is back on the v2 run; canonicals match the post-reprocess snapshot.

- [ ] **Step 7: Document the run in HANDOFF.md and commit**

Add a section to HANDOFF.md: "A3 — reprocess match 250 verified. Acceptance: regression tests green, --undo reverses, re-activation idempotent."

```bash
git commit -am "docs(handoff): A3 reprocess of match 250 verified — regression tests green, --undo reversible"
```

---

## Task 11: Manual reprocess of match 968 (trigger case)

**Files:** none modified — operational task.

The acceptance criteria from master plan §A3 lines 313-317 are the gates here.

- [ ] **Step 1: Snapshot pre-state**

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "\
  SELECT gamertag_snapshot, team_side, position, build_class \
  FROM player_loadout_snapshots WHERE match_id = 968 ORDER BY team_side, position" \
  > /tmp/match968-loadouts-pre.txt
```

Note the BGM v1 lineup — per HANDOFF context, expect duplicates / Stick Menace / THEBEAST31054 leakage.

- [ ] **Step 2: Run reprocess**

```bash
PYTHONPATH=tools/game_ocr python3 -m video_ingest.cli reprocess --match-id 968
```

- [ ] **Step 3: Verify BGM lineup is coherent (the key acceptance)**

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "\
  SELECT team_side, position, gamertag_snapshot FROM player_loadout_snapshots \
  WHERE match_id = 968 AND team_side = 'home' ORDER BY position"
```

Acceptance: 5 unique gamertags from the actual BGM roster (not the v1 Frankenstein). Run getMatchLineups via the worker or by direct SQL:

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "\
  SELECT gamertag_snapshot, count(*) FROM player_loadout_snapshots \
  WHERE match_id = 968 AND team_side = 'home' GROUP BY gamertag_snapshot \
  ORDER BY count(*) DESC"
```

Acceptance: each gamertag appears exactly once (no duplicates).

- [ ] **Step 4: Verify zero pre_game_lobby_state_2 segments over CLUB/loadout/WoC frames**

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "\
  SELECT segment_index, screen_type, start_seconds, end_seconds \
  FROM ocr_segments WHERE match_id = 968 \
    AND run_id = (SELECT id FROM ocr_decoder_runs WHERE match_id=968 AND is_active=true) \
    AND screen_type = 'pre_game_lobby_state_2' ORDER BY start_seconds"
```

Cross-reference each lobby_2 segment against the source video (`/mnt/k/NHL/NHL26/match 968/2026-05-22_17-21-34.mkv`). Acceptance: every lobby_2 segment falls on a frame range that visually shows the lobby (both teams panels), NOT the CLUB / PLAYER LOADOUTS / WORLD OF CHEL screens.

- [ ] **Step 5: Verify typed-v1 lobby extractor saw only real lobby frames**

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "\
  SELECT DISTINCT screen_type FROM ocr_extractions \
  WHERE match_id = 968 \
    AND run_id = (SELECT id FROM ocr_decoder_runs WHERE match_id=968 AND is_active=true) \
    AND extractor_kind = 'typed_v1_lobby'"
```

Acceptance: only `pre_game_lobby_state_2` (not loadout view, not WoC).

- [ ] **Step 6: Verify --undo reverses cleanly**

Same procedure as Task 10 Step 5.

- [ ] **Step 7: Commit**

```bash
git commit -am "docs(handoff): A3 reprocess of match 968 verified — BGM lineup coherent, contamination zero"
```

---

## Task 12: Final regression sweep + HANDOFF update

**Files:**

- Modify: `HANDOFF.md`

- [ ] **Step 1: Run the full game_ocr + video_ingest test suites**

```bash
cd tools/game_ocr && RUN_CLASSIFIER_E2E=0 PYTHONPATH=. python3 -m pytest tests/ --ignore=tests/test_xfactor_effects_spike.py -q
cd ../video_ingest && PYTHONPATH=.:../game_ocr python3 -m pytest tests/ --ignore=tests/test_screen_classifier_proving_bench.py -q
```

Expected: same baseline (261 + 395) ± any tests added in this plan. No regressions.

- [ ] **Step 2: Run the worker test suite**

```bash
pnpm --filter worker test
```

Expected: 203+ passed + same pre-existing failures. Confirm none of the new pieces (rebuild-canonicals, validate-candidate-run, decoder-runs-cli) added failing tests.

- [ ] **Step 3: Run the proving bench one more time (sanity)**

```bash
cd tools/video_ingest && RUN_CLASSIFIER_E2E=1 PYTHONPATH=.:../game_ocr python3 -m pytest tests/test_screen_classifier_proving_bench.py -v
```

Expected: both clips PASS.

- [ ] **Step 4: Update HANDOFF.md**

Add a new "Session Summary — YYYY-MM-DD" block at the top:

- Status: A3 done, Phase A complete (S5 + A1 + A2 + A3 all green).
- Bench status: green.
- Reprocess status: matches 250 + 968 on v2 active runs; `--undo` reversible; canonical loadouts coherent.
- A-gate evaluation per master plan: Are typed extractors only seeing valid frames? (yes per Task 11 step 5). Regression tests still green? (yes per Step 1-2). Any residual misclassification patterns from S5.5's 3 known-miss frames? (none beyond the documented OCR/training-data gaps).
- Next: A-gate decision → ship Phase A and close out (per master plan §A-gate line 330). Phase B is contingent and likely NOT needed.

- [ ] **Step 5: Commit**

```bash
git commit -am "docs(handoff): A3 complete — Phase A shipped, A-gate met, B-phase deferred"
```

---

## Self-review checklist (do this after writing the plan, before handing off)

**Spec coverage** (master plan §A3 lines 291-320):

- [x] Args `--match-id`, `--video`, `--dry-run`, `--undo` — Task 8
- [x] Create candidate run with `is_active=false` — Task 3
- [x] Ingest with `--force-pass1 --force-pass2 --dispatch --run-id` — Task 9 step 4 + Task 7 (cache scope)
- [x] Promote against candidate run (`promoteLoadoutFromEvidence({ matchId, runId })` + lobby twin) — Task 6 + Task 9 step 4
- [x] Validate candidate — Task 2 + Task 4 + Task 9 step 4
- [x] Atomic activation transaction (deactivate / activate / delete canonicals / rebuild / applyMatchColors) — Task 4
- [x] `--undo` — Task 5 + Task 8 step 3
- [x] `--dry-run` — Task 4 step 4 + Task 8 step 3
- [x] Run against match 968 — Task 11
- [x] Run against match 250 — Task 10
- [x] Acceptance per spec lines 313-320 — Task 10 step 4 + Task 11 steps 3-5

**Placeholder scan:** scanned for "TBD", "TODO", "implement later". Two remain intentionally:

- Task 0 step 2 — "decide between (a) and (b)" — this is a real decision the implementer must make based on inspection; explicitly framed as a decision point.
- Task 9 step 3 — `_resolve_video_path` sketch leaves sha-vs-source_directory detail open; the comment ("sha computation can be skipped if source_directory uniquely identifies the file") gives the implementer the criterion.

**Type consistency:**

- `runId` is consistently typed `number | null` (TS) / `int | None` (Python).
- `rebuildCanonicalsFromActiveRun(matchId, options?)` signature matches between Task 1 and Task 4.
- `validateCandidateRun(runId, options?)` signature matches between Task 2 and Task 4.

**Risks / open questions documented:** central design decision (rebuild-from-promotions vs rebuild-via-re-promote) is flagged in Task 0 step 2 and Task 1.
