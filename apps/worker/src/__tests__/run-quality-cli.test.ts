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
  playerLoadoutSnapshots,
  playerLoadoutAttributes,
  playerLoadoutXFactors,
  matchEvents,
} from '@eanhl/db'
import { eq, inArray } from 'drizzle-orm'

const GAME_TITLE_ID = 1 // NHL 26
const SENTINEL_MATCH_IDS = [9301, 9302, 9303, 9304, 9305, 9306, 9307, 9308, 9309, 9310] as const

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

async function seedFixture(matchId: number, isActive: boolean = true): Promise<SeededFixture> {
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
  assert.equal(body['schema_version'] as number, 1)
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

void test('--all-runs --emit-row writes a row per run; runtime is null', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set')
    return
  }
  // Seed three runs across three matches — IDs 9307, 9308, 9309.
  // Note: --all-runs iterates EVERY run in ocr_decoder_runs (not just
  // sentinels). We don't want to pollute production rows, so we snapshot
  // the current set of non-sentinel runIds *before* the CLI call and
  // delete any new rows it wrote against them at the end of the test.
  const f7 = await seedFixture(9307)
  const f8 = await seedFixture(9308)
  const f9 = await seedFixture(9309)

  const sentinelRunIds = new Set<number>([f7.runId, f8.runId, f9.runId])

  // Snapshot non-sentinel run ids that exist in ocr_decoder_runs right now.
  // After the CLI call, we delete any ocr_run_quality_reports rows that
  // belong to these non-sentinel runs (they're production runs we don't
  // want to leave polluted with synthetic backfill rows).
  const allRunsBefore = await db.select({ id: ocrDecoderRuns.id }).from(ocrDecoderRuns)
  const nonSentinelRunIds = allRunsBefore.map((r) => r.id).filter((id) => !sentinelRunIds.has(id))

  try {
    const result = runCli(['--all-runs', '--emit-row', '--force'])
    assert.equal(
      result.status,
      0,
      `expected exit 0; stderr-tail: ${result.stderr.split('\n').slice(-5).join(' | ')}`,
    )

    for (const runId of [f7.runId, f8.runId, f9.runId]) {
      const [row] = await db
        .select({
          report: ocrRunQualityReports.report,
          totalWallMs: ocrRunQualityReports.totalWallMs,
        })
        .from(ocrRunQualityReports)
        .where(eq(ocrRunQualityReports.runId, runId))
      assert.ok(row, `expected a report row for run ${runId}`)
      assert.equal(row!.totalWallMs, null, `expected totalWallMs null for backfill run ${runId}`)
      const body = row!.report as Record<string, unknown>
      const runtime = body['runtime'] as Record<string, unknown>
      assert.equal(runtime['total_wall_ms'], null)
      assert.equal(runtime['captured_from'], 'backfill')
    }
  } finally {
    // Clean up any reports written against non-sentinel (production) runs.
    if (nonSentinelRunIds.length > 0) {
      await db
        .delete(ocrRunQualityReports)
        .where(inArray(ocrRunQualityReports.runId, nonSentinelRunIds))
    }
  }
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
  const stages = runtime['stages'] as Record<string, number>
  assert.equal(stages['ingest_ms'], 200)
  assert.equal(stages['run_quality_emit_ms'], 900)
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
    screens: { totals: { frames: number } }
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
  assert.equal(row!.totalSegments, body.screens.totals.frames)
  const expectedDemoted =
    body.defense_layers.is_cpu_or_demoted_combined +
    body.defense_layers.hard_field_blocks +
    body.defense_layers.junk_gamertag_blocks_ts
  assert.equal(row!.totalDemoted, expectedDemoted)
  assert.equal(row!.totalUnresolved, body.unresolved.totals.all)
})
