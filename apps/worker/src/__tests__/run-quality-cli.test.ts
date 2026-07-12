/**
 * Phase-3 integration tests for the run-quality CLI.
 *
 * The CLI is exercised via `spawnSync` against the built JS so it covers
 * the real binary path that Phase-4's `reprocess.py` will use. Sentinel
 * match IDs 9301-9310 isolate cleanup from Phase-2's 9201-9205.
 *
 * Build + run:
 *   pnpm --filter @eanhl/db build
 *   pnpm --filter @eanhl/worker build
 *   set -a && source .env && set +a
 *   node --test apps/worker/dist/__tests__/run-quality-cli.test.js
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  db,
  sql as rawSql,
  matches,
  ocrCaptureBatches,
  ocrDecoderRuns,
  ocrExtractions,
  ocrFieldEvidence,
  ocrPromotions,
  ocrRunQualityReports,
  ocrSegments,
  playerLoadoutSnapshots,
  playerLoadoutAttributes,
  playerLoadoutXFactors,
  matchEvents,
} from '@eanhl/db'
import { eq, inArray } from 'drizzle-orm'

const GAME_TITLE_ID = 1 // NHL 26
const SENTINEL_MATCH_IDS = [
  9301, 9302, 9303, 9304, 9305, 9306, 9307, 9308, 9309, 9310,
  // P1-1 race-vs-reprocess test
  9311, 9312, 9313, 9314, 9315,
  // P3 segments-hot-column test
  9316, 9317, 9318, 9319, 9320,
  // P1-2 inactive-run layer-skip tests
  9321, 9322, 9323, 9324, 9325,
  // Phase 4 Part B stage-runtimes round-trip tests
  9326, 9327, 9328, 9329,
] as const

const REPO_ROOT = path.resolve(process.cwd())
const CLI_PATH = path.resolve(REPO_ROOT, 'apps/worker/dist/run-quality-cli.js')

// ── cleanup ──────────────────────────────────────────────────────────────────

async function cleanupSentinels(): Promise<void> {
  const matchIds = [...SENTINEL_MATCH_IDS]

  const runRows = await db
    .select({ id: ocrDecoderRuns.id })
    .from(ocrDecoderRuns)
    .where(inArray(ocrDecoderRuns.matchId, matchIds))
  const runIds = runRows.map((r) => r.id)

  if (runIds.length > 0) {
    await db.delete(ocrRunQualityReports).where(inArray(ocrRunQualityReports.runId, runIds))
    await db.delete(ocrPromotions).where(inArray(ocrPromotions.runId, runIds))
    await db.delete(ocrFieldEvidence).where(inArray(ocrFieldEvidence.runId, runIds))
    await db.delete(ocrSegments).where(inArray(ocrSegments.runId, runIds))
  }

  // Loadout child tables hang off snapshots — collect snap ids first.
  const snapIds = (
    await db
      .select({ id: playerLoadoutSnapshots.id })
      .from(playerLoadoutSnapshots)
      .where(inArray(playerLoadoutSnapshots.matchId, matchIds))
  ).map((r) => r.id)
  if (snapIds.length > 0) {
    await db
      .delete(playerLoadoutXFactors)
      .where(inArray(playerLoadoutXFactors.loadoutSnapshotId, snapIds))
    await db
      .delete(playerLoadoutAttributes)
      .where(inArray(playerLoadoutAttributes.loadoutSnapshotId, snapIds))
  }
  await db.delete(playerLoadoutSnapshots).where(inArray(playerLoadoutSnapshots.matchId, matchIds))
  await db.delete(matchEvents).where(inArray(matchEvents.matchId, matchIds))

  const batchRows = await db
    .select({ id: ocrCaptureBatches.id })
    .from(ocrCaptureBatches)
    .where(inArray(ocrCaptureBatches.matchId, matchIds))
  const batchIds = batchRows.map((b) => b.id)
  if (batchIds.length > 0) {
    await db.delete(ocrExtractions).where(inArray(ocrExtractions.batchId, batchIds))
    await db.delete(ocrCaptureBatches).where(inArray(ocrCaptureBatches.matchId, matchIds))
  }
  if (runIds.length > 0) {
    await db.delete(ocrDecoderRuns).where(inArray(ocrDecoderRuns.id, runIds))
  }
  await db.delete(matches).where(inArray(matches.id, matchIds))
}

// ── seed helpers ─────────────────────────────────────────────────────────────

interface SeededFixture {
  matchId: number
  runId: number
  batchId: number
  extractionId: number
}

async function seedFixture(
  matchId: number,
  isActive: boolean = true,
  /**
   * Defaults to `new Date()` so the seeded run is treated as "completed" by
   * the P1-1 `--all-runs` filter. Pass `null` to simulate a mid-pipeline run
   * (the race-vs-reprocess scenario the filter was added to defend against).
   */
  completedAt: Date | null = new Date(),
): Promise<SeededFixture> {
  await db.insert(matches).values({
    id: matchId,
    gameTitleId: GAME_TITLE_ID,
    eaMatchId: `test-sentinel-run-quality-cli-${matchId}`,
    matchType: 'gameType5',
    opponentClubId: '88888',
    opponentName: `run-quality-cli sentinel ${matchId}`,
    playedAt: new Date('2026-05-28T00:00:00Z'),
    result: 'WIN',
    scoreFor: 0,
    scoreAgainst: 0,
    shotsFor: 0,
    shotsAgainst: 0,
    hitsFor: 0,
    hitsAgainst: 0,
  })

  const [runRow] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId,
      videoSha256: `sentinel-run-quality-cli-${matchId}-sha`,
      decoderVersion: 'hmm-viterbi-v1',
      weightsHash: `wh-${matchId}`,
      configHash: `ch-${matchId}`,
      isActive,
      completedAt,
      notes: `run-quality-cli sentinel ${matchId}`,
    })
    .returning({ id: ocrDecoderRuns.id })
  if (!runRow) throw new Error(`Failed to insert decoder run for match ${matchId}`)

  const [batchRow] = await db
    .insert(ocrCaptureBatches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      matchId,
      runId: runRow.id,
      sourceDirectory: `test-sentinel-run-quality-cli-${matchId}-dir`,
      captureKind: 'manual_screenshots',
    })
    .returning({ id: ocrCaptureBatches.id })
  if (!batchRow) throw new Error(`Failed to insert batch for match ${matchId}`)

  const [extractionRow] = await db
    .insert(ocrExtractions)
    .values({
      batchId: batchRow.id,
      matchId,
      runId: runRow.id,
      screenType: 'player_loadout_view',
      sourcePath: `test-sentinel-run-quality-cli-${matchId}/seed.png`,
      sourceHash: `test-sentinel-run-quality-cli-${matchId}-hash`,
      rawResultJson: {},
      transformStatus: 'success',
      reviewStatus: 'reviewed',
      overallConfidence: '0.9000',
    })
    .returning({ id: ocrExtractions.id })
  if (!extractionRow) throw new Error(`Failed to insert extraction for match ${matchId}`)

  return {
    matchId,
    runId: runRow.id,
    batchId: batchRow.id,
    extractionId: extractionRow.id,
  }
}

// ── CLI runner ───────────────────────────────────────────────────────────────

interface CliResult {
  status: number | null
  stdout: string
  stderr: string
}

function runCli(args: string[]): CliResult {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env },
    encoding: 'utf8',
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function lastJsonLine(stdout: string): string | undefined {
  return stdout
    .trim()
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .pop()
}

// ── lifecycle ────────────────────────────────────────────────────────────────

before(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanupSentinels()
})

after(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanupSentinels()
  await rawSql.end({ timeout: 5 })
})

// ── tests ────────────────────────────────────────────────────────────────────

void test('--json single-run shape contract: required top-level keys', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set')
    return
  }
  const f = await seedFixture(9301)
  const result = runCli(['--run-id', String(f.runId), '--json'])
  assert.equal(
    result.status,
    0,
    `expected exit 0; stderr: ${result.stderr}; stdout: ${result.stdout}`,
  )
  const line = lastJsonLine(result.stdout)
  assert.ok(line, `expected JSON line on stdout; got: ${result.stdout}`)
  const body = JSON.parse(line!) as Record<string, unknown>
  for (const key of [
    'schema_version',
    'run',
    'runtime',
    'screens',
    'promotions',
    'defense_layers',
    'unresolved',
    'layers',
    'errors',
  ]) {
    assert.ok(key in body, `missing top-level key '${key}' in body`)
  }
  assert.equal(body['schema_version'] as number, 2)
  const runtime = body['runtime'] as Record<string, unknown>
  assert.equal(runtime['total_wall_ms'], null)
  assert.equal(runtime['stages'], null)
  assert.equal(runtime['captured_from'], 'backfill')
})

void test('--match-id resolves to the active run for the match', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set')
    return
  }
  const f = await seedFixture(9302, /* isActive */ true)
  const result = runCli(['--match-id', String(f.matchId), '--json'])
  assert.equal(result.status, 0, `stderr: ${result.stderr}`)
  const line = lastJsonLine(result.stdout)
  assert.ok(line)
  const body = JSON.parse(line!) as { run: { run_id: number } }
  assert.equal(body.run.run_id, f.runId, 'expected run.run_id to match the seeded active run')
})

void test('--match-id fails when no active run exists for the match', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set')
    return
  }
  const f = await seedFixture(9303, /* isActive */ false)
  const result = runCli(['--match-id', String(f.matchId), '--json'])
  assert.equal(result.status, 1, `expected exit 1; stdout: ${result.stdout}`)
  assert.match(result.stderr, /no active run/i, `got: ${result.stderr}`)
})

void test('--emit-row inserts exactly one row in ocr_run_quality_reports', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set')
    return
  }
  const f = await seedFixture(9304)
  const result = runCli(['--run-id', String(f.runId), '--emit-row'])
  assert.equal(result.status, 0, `stderr: ${result.stderr}; stdout: ${result.stdout}`)
  const line = lastJsonLine(result.stdout)
  assert.ok(line, `expected JSON; got: ${result.stdout}`)
  const payload = JSON.parse(line!) as {
    run_id: number
    report_id: number
    written: boolean
  }
  assert.equal(payload.run_id, f.runId)
  assert.equal(payload.written, true)
  assert.ok(payload.report_id > 0)

  const rows = await db
    .select({ id: ocrRunQualityReports.id })
    .from(ocrRunQualityReports)
    .where(eq(ocrRunQualityReports.runId, f.runId))
  assert.equal(rows.length, 1, `expected 1 row in ocr_run_quality_reports; got ${rows.length}`)
})

void test('second --emit-row without --force exits 1 with "already exists" message', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set')
    return
  }
  const f = await seedFixture(9305)
  const first = runCli(['--run-id', String(f.runId), '--emit-row'])
  assert.equal(first.status, 0, `first emit should succeed; stderr: ${first.stderr}`)

  const second = runCli(['--run-id', String(f.runId), '--emit-row'])
  assert.equal(
    second.status,
    1,
    `expected exit 1 on second emit; stdout: ${second.stdout}; stderr: ${second.stderr}`,
  )
  assert.match(
    second.stderr,
    /already exists/i,
    `expected stderr to mention "already exists"; got: ${second.stderr}`,
  )
})

void test('--force overwrites an existing row (generated_at advances)', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set')
    return
  }
  const f = await seedFixture(9306)
  const first = runCli(['--run-id', String(f.runId), '--emit-row'])
  assert.equal(first.status, 0)

  const [firstRow] = await db
    .select({ generatedAt: ocrRunQualityReports.generatedAt })
    .from(ocrRunQualityReports)
    .where(eq(ocrRunQualityReports.runId, f.runId))
  assert.ok(firstRow)
  const firstTs = firstRow!.generatedAt.getTime()

  // Sleep a moment so the timestamp can advance.
  await new Promise((resolve) => setTimeout(resolve, 50))

  const forced = runCli(['--run-id', String(f.runId), '--emit-row', '--force'])
  assert.equal(forced.status, 0, `stderr: ${forced.stderr}; stdout: ${forced.stdout}`)
  const line = lastJsonLine(forced.stdout)
  assert.ok(line)
  const payload = JSON.parse(line!) as { written: boolean }
  assert.equal(payload.written, true)

  const [secondRow] = await db
    .select({ generatedAt: ocrRunQualityReports.generatedAt })
    .from(ocrRunQualityReports)
    .where(eq(ocrRunQualityReports.runId, f.runId))
  assert.ok(secondRow)
  assert.ok(
    secondRow!.generatedAt.getTime() > firstTs,
    `expected generated_at to advance: first=${new Date(firstTs).toISOString()}, second=${secondRow!.generatedAt.toISOString()}`,
  )
})

void test('--all-runs --emit-row (no --force) writes only to runs without a report; skips existing', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set')
    return
  }
  // Codex R3 P1: never run `--force` globally against the DB in tests. The
  // safe `--all-runs` path is `--emit-row` without `--force` — the upsert
  // plain INSERTs and on-conflict SKIPS, so pre-existing production rows are
  // physically untouched. We assert that contract via the set-of-run_ids
  // snapshot pattern (no per-row content comparison needed because no
  // production row is reachable for mutation).
  //
  // Sentinel set:
  //   (a) 9307 — completed run, NO existing report  → must get a new backfill row
  //   (b) 9308 — incomplete run (completed_at=null) → must remain rowless
  //   (c) 9309 — completed run, WITH existing report → row must be unchanged
  const fNoReport = await seedFixture(9307)
  const fIncomplete = await seedFixture(9308, /* isActive */ true, /* completedAt */ null)
  const fWithReport = await seedFixture(9309)

  // Seed sentinel (c)'s pre-existing report directly so its prior content
  // survives the no-force --all-runs pass.
  const seededTotalWallMs = 4242
  const seededReportBody = {
    schema_version: 1,
    seeded_for_test: 'r3-p1-no-force-skip',
    runtime: {
      total_wall_ms: seededTotalWallMs,
      stages: { ingest_ms: 99 },
      captured_at: '2026-05-29T00:00:00Z',
      captured_from: 'reprocess.py',
    },
  }
  await db.insert(ocrRunQualityReports).values({
    runId: fWithReport.runId,
    matchId: fWithReport.matchId,
    schemaVersion: 1,
    overallPass: true,
    l1Score: null,
    l2Score: '0.9000',
    l2LineupScore: '0.9000',
    l3Score: '0.9000',
    totalWallMs: seededTotalWallMs,
    totalSegments: 7,
    totalDemoted: 0,
    totalUnresolved: 0,
    report: seededReportBody,
  })

  // Snapshot the run_id set with a report row BEFORE the CLI runs. Because
  // we run without --force, every run_id present in this set must still be
  // present afterward and its content must be untouched (verified end-to-end
  // for the sentinel we seeded; verified by set-relationship for everything
  // else — no production row is even reachable for mutation without --force).
  const preexistingReportRunIds = new Set<number>(
    (await db.select({ runId: ocrRunQualityReports.runId }).from(ocrRunQualityReports)).map(
      (r) => r.runId,
    ),
  )
  assert.ok(
    preexistingReportRunIds.has(fWithReport.runId),
    'sentinel (c) seeded report should be in the pre-existing set',
  )
  assert.ok(
    !preexistingReportRunIds.has(fNoReport.runId),
    'sentinel (a) should not yet have a report',
  )
  assert.ok(
    !preexistingReportRunIds.has(fIncomplete.runId),
    'sentinel (b) should not yet have a report',
  )

  const result = runCli(['--all-runs', '--emit-row'])
  assert.equal(
    result.status,
    0,
    `expected exit 0; stderr-tail: ${result.stderr.split('\n').slice(-5).join(' | ')}`,
  )

  // (a) Sentinel without a prior report now has a backfill row.
  const [aRow] = await db
    .select({
      report: ocrRunQualityReports.report,
      totalWallMs: ocrRunQualityReports.totalWallMs,
    })
    .from(ocrRunQualityReports)
    .where(eq(ocrRunQualityReports.runId, fNoReport.runId))
  assert.ok(aRow, `expected a backfill report row for sentinel (a) run ${fNoReport.runId}`)
  assert.equal(aRow!.totalWallMs, null, 'sentinel (a) backfill should have null total_wall_ms')
  const aBody = aRow!.report as Record<string, unknown>
  const aRuntime = aBody['runtime'] as Record<string, unknown>
  assert.equal(aRuntime['captured_from'], 'backfill')

  // (b) Incomplete sentinel must remain rowless — the round-1 completed_at
  // filter excludes it from the iteration.
  const bRows = await db
    .select({ id: ocrRunQualityReports.id })
    .from(ocrRunQualityReports)
    .where(eq(ocrRunQualityReports.runId, fIncomplete.runId))
  assert.equal(bRows.length, 0, 'sentinel (b) incomplete run must not get a report')

  // (c) Pre-existing report row must be byte-identical content for the
  // fields we seeded (the skip-on-conflict path doesn't even touch this row).
  const [cRow] = await db
    .select({
      report: ocrRunQualityReports.report,
      totalWallMs: ocrRunQualityReports.totalWallMs,
      totalSegments: ocrRunQualityReports.totalSegments,
    })
    .from(ocrRunQualityReports)
    .where(eq(ocrRunQualityReports.runId, fWithReport.runId))
  assert.ok(cRow, 'sentinel (c) pre-existing row should still be present')
  assert.equal(
    cRow!.totalWallMs,
    seededTotalWallMs,
    'sentinel (c) seeded total_wall_ms must be preserved (no --force)',
  )
  assert.equal(cRow!.totalSegments, 7, 'sentinel (c) seeded total_segments must be preserved')
  const cBody = cRow!.report as Record<string, unknown>
  assert.equal(
    cBody['seeded_for_test'],
    'r3-p1-no-force-skip',
    'sentinel (c) seeded report body must be preserved',
  )

  // Set-relationship check: after the CLI runs, the set of run_ids with a
  // report row is a SUPERSET of the pre-existing set. The skip-on-conflict
  // path physically cannot delete any pre-existing report, so no run_id that
  // was in the snapshot can have dropped out.
  const afterReportRunIds = new Set<number>(
    (await db.select({ runId: ocrRunQualityReports.runId }).from(ocrRunQualityReports)).map(
      (r) => r.runId,
    ),
  )
  for (const runId of preexistingReportRunIds) {
    assert.ok(
      afterReportRunIds.has(runId),
      `pre-existing report for run ${runId} disappeared — no-force --all-runs must never delete rows`,
    )
  }
  assert.ok(
    afterReportRunIds.has(fNoReport.runId),
    'sentinel (a) must have a new backfill report row',
  )

  // Best-effort cleanup of any newly-written backfill rows on non-sentinel
  // (production) runs. These are runs that were completed but lacked a
  // report at test start; the no-force --all-runs pass added a content-only
  // backfill row for each. Pre-existing rows are physically untouched
  // (skip-on-conflict). The sentinel rows themselves are cleaned up by the
  // suite-wide teardown.
  const sentinelRunIds = new Set<number>([fNoReport.runId, fIncomplete.runId, fWithReport.runId])
  const newlyWrittenNonSentinel = [...afterReportRunIds].filter(
    (id) => !preexistingReportRunIds.has(id) && !sentinelRunIds.has(id),
  )
  if (newlyWrittenNonSentinel.length > 0) {
    await db
      .delete(ocrRunQualityReports)
      .where(inArray(ocrRunQualityReports.runId, newlyWrittenNonSentinel))
  }
})

void test('--force on a single run preserves measured runtime (Codex R2 P2 contract, scoped)', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set')
    return
  }
  // Codex R3 P1: this replaces the old global `--all-runs --emit-row --force`
  // scenario with a scoped `--run-id N --emit-row --force` scenario that's
  // structurally safe. We verify the same semantic — "force overwrite respects
  // the runtime-preservation contract" — without ever running --force against
  // any production row.
  const f = await seedFixture(9312)

  // Seed a pre-existing report directly with measured runtime (total_wall_ms
  // and a populated runtime sub-object with stages.ingest_ms set so the
  // CASE/jsonb_set branch in upsertRunQualityReport selects "preserve").
  const seededTotalWallMs = 1234
  const seededReportBody = {
    schema_version: 1,
    seeded_for_test: 'r3-p1-force-preserves-runtime',
    runtime: {
      total_wall_ms: seededTotalWallMs,
      stages: { ingest_ms: 77 },
      captured_at: '2026-05-29T01:23:45Z',
      captured_from: 'reprocess.py',
    },
  }
  await db.insert(ocrRunQualityReports).values({
    runId: f.runId,
    matchId: f.matchId,
    schemaVersion: 1,
    overallPass: true,
    l1Score: null,
    l2Score: '0.5000',
    l2LineupScore: '0.5000',
    l3Score: '0.5000',
    totalWallMs: seededTotalWallMs,
    totalSegments: 1,
    totalDemoted: 0,
    totalUnresolved: 0,
    report: seededReportBody,
  })

  // Run --emit-row --force WITHOUT --stage-runtimes → backfill mode → the
  // round-2 commit-2 contract requires total_wall_ms and runtime.stages to
  // be preserved from the prior row. Content fields (e.g. report->'run') are
  // refreshed.
  const result = runCli(['--run-id', String(f.runId), '--emit-row', '--force'])
  assert.equal(result.status, 0, `stderr: ${result.stderr}; stdout: ${result.stdout}`)

  const [row] = await db
    .select({
      report: ocrRunQualityReports.report,
      totalWallMs: ocrRunQualityReports.totalWallMs,
    })
    .from(ocrRunQualityReports)
    .where(eq(ocrRunQualityReports.runId, f.runId))
  assert.ok(row, 'row should still be present after --force')
  assert.equal(
    row!.totalWallMs,
    seededTotalWallMs,
    `total_wall_ms must be preserved across --force when no --stage-runtimes provided; got ${row!.totalWallMs}`,
  )
  const body = row!.report as Record<string, unknown>
  const runtime = body['runtime'] as Record<string, unknown>
  assert.equal(
    runtime['total_wall_ms'],
    seededTotalWallMs,
    'report->runtime->total_wall_ms must be preserved across --force',
  )
  const stages = runtime['stages'] as Record<string, unknown> | null
  assert.ok(stages, 'report->runtime->stages must be preserved (not nulled out)')
  assert.equal((stages as Record<string, number>)['ingest_ms'], 77)
  assert.equal(runtime['captured_from'], 'reprocess.py')

  // Content fields ARE refreshed (the run.run_id is present and matches the
  // sentinel — the seeded report body had no run.run_id key at all).
  const runMeta = body['run'] as Record<string, unknown> | undefined
  assert.ok(runMeta, 'report.run should be populated by the refreshed body')
  assert.equal(runMeta!['run_id'], f.runId)
})

void test('--stage-runtimes injects runtime block; total_wall_ms + captured_from match file', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set')
    return
  }
  const f = await seedFixture(9310)

  const tmpDir = mkdtempSync(path.join(tmpdir(), 'run-quality-cli-'))
  const stagePath = path.join(tmpDir, 'stage-runtimes.json')
  const stageData = {
    stages: {
      create_candidate_ms: 100,
      ingest_ms: 200,
      repromote_loadout_ms: 300,
      repromote_lobby_ms: 400,
      validate_ms: 500,
      activate_ms: 600,
      consolidate_loadouts_ms: 700,
      backfill_event_actor_resolution_ms: 800,
      run_quality_emit_ms: 900,
    },
    total_wall_ms: 4500,
    captured_at: '2026-05-28T12:34:56Z',
    captured_from: 'reprocess.py',
  }
  writeFileSync(stagePath, JSON.stringify(stageData), 'utf8')

  const result = runCli(['--run-id', String(f.runId), '--emit-row', '--stage-runtimes', stagePath])
  assert.equal(result.status, 0, `stderr: ${result.stderr}; stdout: ${result.stdout}`)

  const [row] = await db
    .select({
      report: ocrRunQualityReports.report,
      totalWallMs: ocrRunQualityReports.totalWallMs,
    })
    .from(ocrRunQualityReports)
    .where(eq(ocrRunQualityReports.runId, f.runId))
  assert.ok(row)
  assert.equal(row!.totalWallMs, 4500)
  const body = row!.report as Record<string, unknown>
  const runtime = body['runtime'] as Record<string, unknown>
  assert.equal(runtime['total_wall_ms'], 4500)
  assert.equal(runtime['captured_from'], 'reprocess.py')
  assert.equal(runtime['captured_at'], '2026-05-28T12:34:56Z')
  const stages = runtime['stages'] as Record<string, number | null>
  assert.equal(stages['ingest_ms'], 200)
  assert.equal(stages['run_quality_emit_ms'], 900)
  // Phase 4 Part B: forward-compat — a pre-Part-B fixture (no Phase-4
  // stage keys, no pass1_cache_hit) must produce a persisted row whose
  // new fields are null so downstream analytics can distinguish "didn't
  // measure" from "measured zero." The loader sets them via emptyStages.
  assert.equal(stages['pass1_ms'], null)
  assert.equal(stages['pass1_classify_ms'], null)
  assert.equal(stages['pass1_decode_ms'], null)
  assert.equal(stages['pass1_viterbi_ms'], null)
  assert.equal(stages['pass2_ms'], null)
  assert.equal(runtime['pass1_cache_hit'], null)
})

void test('--stage-runtimes round-trips Phase 4 Part B Pass-1 sub-phase keys + pass1_cache_hit', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set')
    return
  }
  const f = await seedFixture(9326)

  const tmpDir = mkdtempSync(path.join(tmpdir(), 'run-quality-cli-partb-'))
  const stagePath = path.join(tmpDir, 'stage-runtimes.json')
  const stageData = {
    stages: {
      create_candidate_ms: 100,
      ingest_ms: 80000,
      repromote_loadout_ms: 300,
      repromote_lobby_ms: 400,
      validate_ms: 500,
      activate_ms: 600,
      consolidate_loadouts_ms: 700,
      backfill_event_actor_resolution_ms: 800,
      run_quality_emit_ms: 900,
      // Phase 4 Part B numeric keys.
      pass1_ms: 65000,
      pass2_ms: 9000,
      pass1_decode_ms: 600,
      pass1_classify_ms: 64000,
      pass1_viterbi_ms: 400,
      // WS1b Visual-Prefilter Pass-2 selection telemetry (numeric keys).
      prefilter_frames_scanned: 92,
      prefilter_frames_selected: 13,
      prefilter_selection_ms: 2568,
    },
    total_wall_ms: 84000,
    captured_at: '2026-05-30T20:00:00Z',
    captured_from: 'reprocess.py',
    // Phase 4 Part B top-level boolean.
    pass1_cache_hit: false,
  }
  writeFileSync(stagePath, JSON.stringify(stageData), 'utf8')

  const result = runCli(['--run-id', String(f.runId), '--emit-row', '--stage-runtimes', stagePath])
  assert.equal(result.status, 0, `stderr: ${result.stderr}; stdout: ${result.stdout}`)

  const [row] = await db
    .select({ report: ocrRunQualityReports.report })
    .from(ocrRunQualityReports)
    .where(eq(ocrRunQualityReports.runId, f.runId))
  assert.ok(row)
  const body = row!.report as Record<string, unknown>
  const runtime = body['runtime'] as Record<string, unknown>
  const stages = runtime['stages'] as Record<string, number | null>
  // Numeric stage keys round-trip verbatim.
  assert.equal(stages['pass1_ms'], 65000)
  assert.equal(stages['pass2_ms'], 9000)
  assert.equal(stages['pass1_decode_ms'], 600)
  assert.equal(stages['pass1_classify_ms'], 64000)
  assert.equal(stages['pass1_viterbi_ms'], 400)
  // pass1_cache_hit lands top-level on runtime, NOT inside stages.
  assert.equal(runtime['pass1_cache_hit'], false)
  assert.equal(stages['pass1_cache_hit'], undefined)
  // WS1b prefilter keys round-trip verbatim inside stages.
  assert.equal(stages['prefilter_frames_scanned'], 92)
  assert.equal(stages['prefilter_frames_selected'], 13)
  assert.equal(stages['prefilter_selection_ms'], 2568)
})

void test('--stage-runtimes accepts pass1_cache_hit=true and pass1_cache_hit=null', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set')
    return
  }
  // Two fixtures: one with cache_hit=true, one with cache_hit explicitly null.
  for (const [seedOffset, cacheHitValue] of [
    [9327, true],
    [9328, null],
  ] as const) {
    const f = await seedFixture(seedOffset)
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'run-quality-cli-partb-'))
    const stagePath = path.join(tmpDir, 'stage-runtimes.json')
    writeFileSync(
      stagePath,
      JSON.stringify({
        stages: {
          create_candidate_ms: null,
          ingest_ms: null,
          repromote_loadout_ms: null,
          repromote_lobby_ms: null,
          validate_ms: null,
          activate_ms: null,
          consolidate_loadouts_ms: null,
          backfill_event_actor_resolution_ms: null,
          run_quality_emit_ms: null,
        },
        total_wall_ms: null,
        captured_at: null,
        captured_from: 'reprocess.py',
        pass1_cache_hit: cacheHitValue,
      }),
      'utf8',
    )

    const result = runCli([
      '--run-id',
      String(f.runId),
      '--emit-row',
      '--stage-runtimes',
      stagePath,
    ])
    assert.equal(result.status, 0, `cache_hit=${cacheHitValue}: ${result.stderr}`)

    const [row] = await db
      .select({ report: ocrRunQualityReports.report })
      .from(ocrRunQualityReports)
      .where(eq(ocrRunQualityReports.runId, f.runId))
    const runtime = (row!.report as Record<string, unknown>)['runtime'] as Record<string, unknown>
    assert.equal(runtime['pass1_cache_hit'], cacheHitValue)
  }
})

void test('--stage-runtimes rejects pass1_cache_hit when non-boolean', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set')
    return
  }
  const f = await seedFixture(9329)
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'run-quality-cli-partb-'))
  const stagePath = path.join(tmpDir, 'stage-runtimes.json')
  writeFileSync(
    stagePath,
    JSON.stringify({
      stages: {
        create_candidate_ms: null,
        ingest_ms: null,
        repromote_loadout_ms: null,
        repromote_lobby_ms: null,
        validate_ms: null,
        activate_ms: null,
        consolidate_loadouts_ms: null,
        backfill_event_actor_resolution_ms: null,
        run_quality_emit_ms: null,
      },
      total_wall_ms: null,
      captured_at: null,
      captured_from: 'reprocess.py',
      pass1_cache_hit: 'not-a-bool', // String — must be rejected.
    }),
    'utf8',
  )

  const result = runCli(['--run-id', String(f.runId), '--emit-row', '--stage-runtimes', stagePath])
  assert.notEqual(result.status, 0, 'expected non-zero exit for invalid pass1_cache_hit')
  assert.match(
    result.stderr,
    /pass1_cache_hit must be boolean or null/i,
    `expected pass1_cache_hit error, got: ${result.stderr}`,
  )
})

// Stand-alone tests that don't require sentinel cleanup of additional state.
// They run against fresh sentinel matches.

void test('defense_layers counters return 0 on a zero-CPU run', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set')
    return
  }
  // Use sentinel match 9301 (already seeded by the first test). Need a fresh
  // match to avoid colliding with the row inserted by --emit-row tests.
  // Run with no is_cpu evidence inserted → expect zeros.
  const matchId = 9304 // reused — only OcrFieldEvidence matters here
  // Look up the run we already seeded for match 9304.
  const [runRow] = await db
    .select({ id: ocrDecoderRuns.id })
    .from(ocrDecoderRuns)
    .where(eq(ocrDecoderRuns.matchId, matchId))
    .limit(1)
  assert.ok(runRow, 'expected pre-seeded run for match 9304')
  const result = runCli(['--run-id', String(runRow!.id), '--json'])
  assert.equal(result.status, 0, `stderr: ${result.stderr}`)
  const line = lastJsonLine(result.stdout)
  assert.ok(line)
  const body = JSON.parse(line!) as {
    defense_layers: { is_cpu_demotions: number; hard_field_blocks: number }
  }
  assert.equal(body.defense_layers.is_cpu_demotions, 0)
  assert.equal(body.defense_layers.hard_field_blocks, 0)
})

void test('unresolved.gamertags surfaces a seeded blocked_consensus gamertag promotion', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set')
    return
  }
  // Reuse a sentinel that no other test mutates promotions on. 9303 (the
  // "no active run" test) has no promotions seeded — perfect.
  const matchId = 9303
  const [runRow] = await db
    .select({ id: ocrDecoderRuns.id })
    .from(ocrDecoderRuns)
    .where(eq(ocrDecoderRuns.matchId, matchId))
    .limit(1)
  assert.ok(runRow, 'expected pre-seeded run for match 9303')
  await db.insert(ocrPromotions).values({
    matchId,
    runId: runRow!.id,
    targetTable: 'player_loadout_snapshots',
    targetSemanticKey: { slot: 'bgm_C' },
    fieldKey: 'gamertag',
    promotionStatus: 'blocked_consensus',
    blockingReason: 'non_dominant_top',
  })
  const result = runCli(['--run-id', String(runRow!.id), '--json'])
  assert.equal(result.status, 0, `stderr: ${result.stderr}`)
  const line = lastJsonLine(result.stdout)
  assert.ok(line)
  const body = JSON.parse(line!) as { unresolved: { gamertags: number } }
  assert.equal(body.unresolved.gamertags, 1)
})

void test('hot-column mirrors: overall_pass + scores + counters match the body', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set')
    return
  }
  // Use the row we wrote in the --emit-row test (match 9304).
  const matchId = 9304
  const [runRow] = await db
    .select({ id: ocrDecoderRuns.id })
    .from(ocrDecoderRuns)
    .where(eq(ocrDecoderRuns.matchId, matchId))
    .limit(1)
  assert.ok(runRow)

  // Force-rewrite so we have an up-to-date row to inspect.
  const forced = runCli(['--run-id', String(runRow!.id), '--emit-row', '--force'])
  assert.equal(forced.status, 0, `stderr: ${forced.stderr}`)

  const [row] = await db
    .select({
      report: ocrRunQualityReports.report,
      overallPass: ocrRunQualityReports.overallPass,
      l2Score: ocrRunQualityReports.l2Score,
      l2LineupScore: ocrRunQualityReports.l2LineupScore,
      l3Score: ocrRunQualityReports.l3Score,
      totalSegments: ocrRunQualityReports.totalSegments,
      totalDemoted: ocrRunQualityReports.totalDemoted,
      totalUnresolved: ocrRunQualityReports.totalUnresolved,
    })
    .from(ocrRunQualityReports)
    .where(eq(ocrRunQualityReports.runId, runRow!.id))
  assert.ok(row, 'expected the row to be present after --emit-row --force')
  const body = row!.report as {
    layers: {
      overall_pass: boolean
      l2: { score: number }
      l2_lineup: { score: number }
      l3: { score: number }
    }
    screens: { totals: { frames: number; segments: number } }
    defense_layers: {
      is_cpu_or_demoted_combined: number
      hard_field_blocks: number
      junk_gamertag_blocks_ts: number
    }
    unresolved: { totals: { all: number } }
  }

  assert.equal(row!.overallPass, body.layers.overall_pass)
  // Numeric columns come back as strings; compare numeric values.
  assert.equal(Number(row!.l2Score), body.layers.l2.score)
  assert.equal(Number(row!.l2LineupScore), body.layers.l2_lineup.score)
  assert.equal(Number(row!.l3Score), body.layers.l3.score)
  // Post-P3: hot column mirrors the segment count, not the frame count.
  assert.equal(row!.totalSegments, body.screens.totals.segments)
  const expectedDemoted =
    body.defense_layers.is_cpu_or_demoted_combined +
    body.defense_layers.hard_field_blocks +
    body.defense_layers.junk_gamertag_blocks_ts
  assert.equal(row!.totalDemoted, expectedDemoted)
  assert.equal(row!.totalUnresolved, body.unresolved.totals.all)
})

void test('totals.segments is independent from totals.frames; hot column mirrors segments (Codex P3)', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set')
    return
  }
  // Seed N=2 ocr_segments + M=3 ocr_extractions on the same run. The body
  // must expose both `frames` (=M) and `segments` (=N), and the hot column
  // `total_segments` must mirror the segment count.
  const f = await seedFixture(9316)

  await db.insert(ocrExtractions).values([
    {
      batchId: f.batchId,
      matchId: f.matchId,
      runId: f.runId,
      screenType: 'player_loadout_view',
      sourcePath: `test-sentinel-run-quality-cli-${f.matchId}/seed-2.png`,
      rawResultJson: {},
      transformStatus: 'success',
      reviewStatus: 'reviewed',
      overallConfidence: '0.9000',
    },
    {
      batchId: f.batchId,
      matchId: f.matchId,
      runId: f.runId,
      screenType: 'player_loadout_view',
      sourcePath: `test-sentinel-run-quality-cli-${f.matchId}/seed-3.png`,
      rawResultJson: {},
      transformStatus: 'success',
      reviewStatus: 'reviewed',
      overallConfidence: '0.9000',
    },
  ])

  await db.insert(ocrSegments).values([
    {
      matchId: f.matchId,
      segmentKey: 'seg-001',
      state: 'pre_game_lobby_state_2',
      uiVersion: 'nhl26',
      decoderVersion: 'hmm-viterbi-v1',
      runId: f.runId,
    },
    {
      matchId: f.matchId,
      segmentKey: 'seg-002',
      state: 'post_game_box_score_goals',
      uiVersion: 'nhl26',
      decoderVersion: 'hmm-viterbi-v1',
      runId: f.runId,
    },
  ])

  const result = runCli(['--run-id', String(f.runId), '--emit-row', '--force'])
  assert.equal(result.status, 0, `stderr: ${result.stderr}`)

  const [row] = await db
    .select({
      report: ocrRunQualityReports.report,
      totalSegments: ocrRunQualityReports.totalSegments,
    })
    .from(ocrRunQualityReports)
    .where(eq(ocrRunQualityReports.runId, f.runId))
  assert.ok(row)
  const body = row!.report as {
    screens: { totals: { frames: number; segments: number } }
  }
  assert.equal(body.screens.totals.frames, 3, 'expected 3 ocr_extractions')
  assert.equal(body.screens.totals.segments, 2, 'expected 2 ocr_segments')
  assert.equal(row!.totalSegments, 2, 'hot column total_segments must mirror segment count')
})

void test('--all-runs skips runs with completed_at IS NULL until completed (race-vs-reprocess lifecycle)', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set')
    return
  }
  // Codex R3 P1: this test exercises the lifecycle "incomplete run → mark
  // completed → next --all-runs pass writes the row". It is structurally
  // safe because we never use --force: the upsert plain INSERTs and on-
  // conflict SKIPS, so no production row is reachable for mutation.
  //
  // Seed a run that is still mid-pipeline: completed_at = NULL. Without the
  // P1-1 filter, --all-runs would race against the in-flight reprocess and
  // write a runtime=null backfill row first. With the filter, the row is
  // skipped until reprocess sets completed_at.
  const f = await seedFixture(9313, /* isActive */ true, /* completedAt */ null)

  // Snapshot pre-existing report run_ids so we can leave them untouched and
  // clean up only what the test newly wrote on non-sentinel runs.
  const preexistingReportRunIds = new Set<number>(
    (await db.select({ runId: ocrRunQualityReports.runId }).from(ocrRunQualityReports)).map(
      (r) => r.runId,
    ),
  )

  const first = runCli(['--all-runs', '--emit-row'])
  assert.equal(
    first.status,
    0,
    `expected exit 0; stderr-tail: ${first.stderr.split('\n').slice(-5).join(' | ')}`,
  )
  assert.match(
    first.stderr,
    /incomplete runs skipped/i,
    `expected stderr to mention skip behavior; got: ${first.stderr.split('\n').slice(0, 3).join(' | ')}`,
  )

  const beforeRows = await db
    .select({ id: ocrRunQualityReports.id })
    .from(ocrRunQualityReports)
    .where(eq(ocrRunQualityReports.runId, f.runId))
  assert.equal(
    beforeRows.length,
    0,
    `expected 0 report rows for incomplete run ${f.runId}; got ${beforeRows.length}`,
  )

  // Now mark the run completed and re-run — the row should be written.
  await db
    .update(ocrDecoderRuns)
    .set({ completedAt: new Date() })
    .where(eq(ocrDecoderRuns.id, f.runId))

  const second = runCli(['--all-runs', '--emit-row'])
  assert.equal(
    second.status,
    0,
    `expected exit 0; stderr-tail: ${second.stderr.split('\n').slice(-5).join(' | ')}`,
  )

  const afterRows = await db
    .select({ id: ocrRunQualityReports.id })
    .from(ocrRunQualityReports)
    .where(eq(ocrRunQualityReports.runId, f.runId))
  assert.equal(
    afterRows.length,
    1,
    `expected 1 report row after completed_at is set; got ${afterRows.length}`,
  )

  // Best-effort cleanup: the two --all-runs --emit-row passes write content-
  // only backfill rows for any completed production run that lacked a
  // report at test start. The skip-on-conflict path leaves pre-existing
  // rows physically untouched; we delete only newly-added non-sentinel
  // rows. The sentinel row itself is cleaned up by the suite-wide teardown.
  const afterReportRunIds = new Set<number>(
    (await db.select({ runId: ocrRunQualityReports.runId }).from(ocrRunQualityReports)).map(
      (r) => r.runId,
    ),
  )
  const newlyWrittenNonSentinel = [...afterReportRunIds].filter(
    (id) => !preexistingReportRunIds.has(id) && id !== f.runId,
  )
  if (newlyWrittenNonSentinel.length > 0) {
    await db
      .delete(ocrRunQualityReports)
      .where(inArray(ocrRunQualityReports.runId, newlyWrittenNonSentinel))
  }
})

void test('--all-runs --stage-runtimes is rejected at argv level (Codex R3 P2)', async (t) => {
  // No DB required — the guard fires before any query runs. Skip is kept for
  // parity with sibling tests so DATABASE_URL-less environments behave the
  // same way as the rest of the suite.
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set')
    return
  }
  // The path doesn't need to exist — the guard runs before file load.
  const result = runCli(['--all-runs', '--stage-runtimes', '/tmp/anything.json'])
  assert.equal(
    result.status,
    1,
    `expected exit 1; stdout: ${result.stdout}; stderr: ${result.stderr}`,
  )
  assert.match(
    result.stderr,
    /--stage-runtimes is not allowed with --all-runs/i,
    `expected stderr to explain the rejection; got: ${result.stderr}`,
  )
  assert.match(
    result.stderr,
    /--run-id/i,
    `expected stderr to point at --run-id as the right flag; got: ${result.stderr}`,
  )
})

void test('inactive run: --json body has layers.computed=false + null scores (Codex P1-2)', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set')
    return
  }
  // Seed an inactive run. computeLayers would otherwise read match-scoped
  // state from the active run (or nothing, since there is none here) and
  // attribute it to this superseded row. The P1-2 fix skips the compute
  // and stores nulls so trend dashboards can tell "not computed" apart
  // from "computed = 0".
  const f = await seedFixture(9321, /* isActive */ false)
  const result = runCli(['--run-id', String(f.runId), '--json'])
  assert.equal(result.status, 0, `stderr: ${result.stderr}; stdout: ${result.stdout}`)
  const line = lastJsonLine(result.stdout)
  assert.ok(line, `expected JSON line; got: ${result.stdout}`)
  const body = JSON.parse(line!) as {
    layers: {
      computed: boolean
      l1: { score: null; pass: null }
      l2: { score: number | null; pass: boolean | null; notes: string }
      l2_lineup: { score: number | null; pass: boolean | null }
      l3: { score: number | null; pass: boolean | null }
      overall_pass: boolean | null
    }
  }
  assert.equal(body.layers.computed, false, 'expected layers.computed=false on inactive run')
  assert.equal(body.layers.l2.score, null, 'l2.score must be null when layers not computed')
  assert.equal(body.layers.l2.pass, null, 'l2.pass must be null when layers not computed')
  assert.equal(body.layers.l2_lineup.score, null, 'l2_lineup.score must be null')
  assert.equal(body.layers.l2_lineup.pass, null, 'l2_lineup.pass must be null')
  assert.equal(body.layers.l3.score, null, 'l3.score must be null')
  assert.equal(body.layers.l3.pass, null, 'l3.pass must be null')
  assert.equal(body.layers.overall_pass, null, 'overall_pass must be null')
  assert.match(
    body.layers.l2.notes,
    /not computed|not active/i,
    `expected l2.notes to mention 'not computed' or 'not active'; got: ${body.layers.l2.notes}`,
  )
})

void test('inactive run: --emit-row writes NULL hot columns for layer scores (Codex P1-2)', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set')
    return
  }
  const f = await seedFixture(9322, /* isActive */ false)
  const result = runCli(['--run-id', String(f.runId), '--emit-row'])
  assert.equal(result.status, 0, `stderr: ${result.stderr}; stdout: ${result.stdout}`)

  const [row] = await db
    .select({
      overallPass: ocrRunQualityReports.overallPass,
      l1Score: ocrRunQualityReports.l1Score,
      l2Score: ocrRunQualityReports.l2Score,
      l2LineupScore: ocrRunQualityReports.l2LineupScore,
      l3Score: ocrRunQualityReports.l3Score,
      totalSegments: ocrRunQualityReports.totalSegments,
      totalDemoted: ocrRunQualityReports.totalDemoted,
      totalUnresolved: ocrRunQualityReports.totalUnresolved,
    })
    .from(ocrRunQualityReports)
    .where(eq(ocrRunQualityReports.runId, f.runId))
  assert.ok(row, 'expected a report row to be written for inactive run')

  // Layer-derived hot columns must all be NULL.
  assert.equal(row!.overallPass, null, 'overall_pass must be NULL for inactive run')
  assert.equal(row!.l1Score, null, 'l1_score must always be NULL (ground-truth pending)')
  assert.equal(row!.l2Score, null, 'l2_score must be NULL when layers not computed')
  assert.equal(row!.l2LineupScore, null, 'l2_lineup_score must be NULL when layers not computed')
  assert.equal(row!.l3Score, null, 'l3_score must be NULL when layers not computed')

  // Run-scoped counter columns are independent of isActive and remain non-null.
  assert.notEqual(row!.totalSegments, null, 'total_segments is run-scoped and must remain non-null')
  assert.notEqual(row!.totalDemoted, null, 'total_demoted is run-scoped and must remain non-null')
  assert.notEqual(
    row!.totalUnresolved,
    null,
    'total_unresolved is run-scoped and must remain non-null',
  )
})
