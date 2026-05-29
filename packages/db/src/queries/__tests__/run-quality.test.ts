/**
 * Integration tests for the run-quality query helpers (Phase 2 of the
 * Run-Level Quality Reporting workstream, plan
 * `/home/michal/.claude/plans/ok-plan-this-run-level-nifty-comet.md`).
 *
 * All tests hit a real local Postgres. Sentinel match IDs 9201-9210 are used
 * for cleanup isolation. Skips gracefully when DATABASE_URL is unset.
 *
 * Build + run:
 *   pnpm --filter @eanhl/db build
 *   set -a && source .env && set +a
 *   node --test packages/db/dist/queries/__tests__/run-quality.test.js
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { eq, inArray } from 'drizzle-orm'
import {
  db,
  sql,
  matches,
  ocrCaptureBatches,
  ocrExtractions,
  ocrDecoderRuns,
  ocrFieldEvidence,
  ocrPromotions,
  ocrRunQualityReports,
  ocrSegments,
  playerLoadoutSnapshots,
  matchEvents,
} from '../../index.js'
import {
  buildScreenTableByRun,
  buildPromotionDistribution,
  buildDefenseLayerCounters,
  buildUnresolvedCounts,
  countSegmentsByRun,
  upsertRunQualityReport,
} from '../run-quality.js'

const GAME_TITLE_ID = 1 // NHL 26
const SENTINEL_MATCH_IDS = [
  9201, 9202, 9203, 9204, 9205,
  // P2-1 (personas-leak) + P3 (segments count) sentinels
  9216, 9217, 9218, 9219, 9220,
] as const

interface SeededFixture {
  matchId: number
  runId: number
  batchId: number
  extractionId: number
}

// ── cleanup ───────────────────────────────────────────────────────────────────

async function cleanupSentinels(): Promise<void> {
  const matchIds = [...SENTINEL_MATCH_IDS]

  // Quality reports → promotions → field_evidence → loadout snapshots →
  // match_events → extractions → batches → decoder_runs → matches.
  const runRows = await db
    .select({ id: ocrDecoderRuns.id })
    .from(ocrDecoderRuns)
    .where(inArray(ocrDecoderRuns.matchId, matchIds))
  const runIds = runRows.map((r) => r.id)

  if (runIds.length > 0) {
    await db
      .delete(ocrRunQualityReports)
      .where(inArray(ocrRunQualityReports.runId, runIds))
    await db.delete(ocrPromotions).where(inArray(ocrPromotions.runId, runIds))
    await db.delete(ocrFieldEvidence).where(inArray(ocrFieldEvidence.runId, runIds))
    await db.delete(ocrSegments).where(inArray(ocrSegments.runId, runIds))
  }
  await db
    .delete(playerLoadoutSnapshots)
    .where(inArray(playerLoadoutSnapshots.matchId, matchIds))
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

// ── seed helpers ──────────────────────────────────────────────────────────────

async function seedFixture(matchId: number): Promise<SeededFixture> {
  await db.insert(matches).values({
    id: matchId,
    gameTitleId: GAME_TITLE_ID,
    eaMatchId: `test-sentinel-run-quality-${matchId}`,
    matchType: 'gameType5',
    opponentClubId: '88888',
    opponentName: `run-quality sentinel ${matchId}`,
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
      videoSha256: `sentinel-run-quality-${matchId}-sha`,
      decoderVersion: 'hmm-viterbi-v1',
      weightsHash: 'sentinel-weights',
      configHash: 'sentinel-config',
      isActive: true,
      notes: `run-quality sentinel ${matchId}`,
    })
    .returning({ id: ocrDecoderRuns.id })
  if (!runRow) throw new Error(`Failed to insert decoder run for match ${matchId}`)

  const [batchRow] = await db
    .insert(ocrCaptureBatches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      matchId,
      runId: runRow.id,
      sourceDirectory: `test-sentinel-run-quality-${matchId}-dir`,
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
      sourcePath: `test-sentinel-run-quality-${matchId}/seed.png`,
      sourceHash: `test-sentinel-run-quality-${matchId}-hash`,
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

// ── lifecycle ─────────────────────────────────────────────────────────────────

before(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanupSentinels()
})

after(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanupSentinels()
  await sql.end({ timeout: 5 })
})

// ── tests ─────────────────────────────────────────────────────────────────────

void test('buildScreenTableByRun returns aggregated rows for the seeded run', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — run-quality integration tests require DB.')
    return
  }
  const matchId = 9201
  const f = await seedFixture(matchId)
  // Add an additional extraction with status=error and a different screen
  await db.insert(ocrExtractions).values({
    batchId: f.batchId,
    matchId,
    runId: f.runId,
    screenType: 'post_game_box_score_goals',
    sourcePath: `test-sentinel-run-quality-${matchId}/seed-2.png`,
    rawResultJson: {},
    transformStatus: 'error',
    reviewStatus: 'pending_review',
    overallConfidence: '0.5000',
  })

  const rows = await buildScreenTableByRun(f.runId)
  assert.equal(rows.length, 2, `expected 2 screen types, got ${rows.length}`)

  const byScreen = new Map(rows.map((r) => [r.screenType, r]))
  const loadout = byScreen.get('player_loadout_view')
  const boxScore = byScreen.get('post_game_box_score_goals')

  assert.ok(loadout, 'expected player_loadout_view row')
  assert.equal(loadout!.frames, 1)
  assert.equal(loadout!.ok, 1)
  assert.equal(loadout!.err, 0)
  assert.equal(loadout!.reviewed, 1)
  assert.equal(loadout!.avgConf, 0.9)

  assert.ok(boxScore, 'expected post_game_box_score_goals row')
  assert.equal(boxScore!.frames, 1)
  assert.equal(boxScore!.ok, 0)
  assert.equal(boxScore!.err, 1)
  assert.equal(boxScore!.reviewed, 0)
})

void test('buildPromotionDistribution returns 3-axis breakdown', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — run-quality integration tests require DB.')
    return
  }
  const matchId = 9202
  const f = await seedFixture(matchId)

  await db.insert(ocrPromotions).values([
    {
      matchId,
      runId: f.runId,
      targetTable: 'player_loadout_snapshots',
      targetSemanticKey: { match_id: matchId, slot: 'bgm_C' },
      fieldKey: 'gamertag',
      promotionStatus: 'promoted',
      winningValue: 'foo',
    },
    {
      matchId,
      runId: f.runId,
      targetTable: 'player_loadout_snapshots',
      targetSemanticKey: { match_id: matchId, slot: 'bgm_LW' },
      fieldKey: 'gamertag',
      promotionStatus: 'blocked_consensus',
      blockingReason: 'non_dominant_top',
    },
    {
      matchId,
      runId: f.runId,
      targetTable: 'player_loadout_snapshots',
      targetSemanticKey: { match_id: matchId, slot: 'bgm_RW' },
      fieldKey: 'build_class',
      promotionStatus: 'blocked_invariant',
      blockingReason: 'hard_fields_not_promoted',
    },
  ])

  const dist = await buildPromotionDistribution(f.runId)
  assert.equal(dist.totals.rows, 3)
  assert.equal(dist.totals.promoted, 1)
  assert.equal(dist.totals.blocked, 2)
  assert.equal(dist.by_status['promoted'], 1)
  assert.equal(dist.by_status['blocked_consensus'], 1)
  assert.equal(dist.by_status['blocked_invariant'], 1)
  assert.equal(dist.by_blocking_reason['non_dominant_top'], 1)
  assert.equal(dist.by_blocking_reason['hard_fields_not_promoted'], 1)
  assert.equal(dist.by_blocking_reason['none'], 1) // the promoted row has no reason
  assert.deepEqual(dist.by_field_key['gamertag'], { promoted: 1, blocked: 1 })
  assert.deepEqual(dist.by_field_key['build_class'], { promoted: 0, blocked: 1 })
})

void test('buildDefenseLayerCounters counts CPU-evidence + hard-field blocks', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — run-quality integration tests require DB.')
    return
  }
  const matchId = 9203
  const f = await seedFixture(matchId)

  // Two is_cpu=true rows on the BGM side (no cross-team overlap).
  await db.insert(ocrFieldEvidence).values([
    {
      matchId,
      runId: f.runId,
      screenState: 'pre_game_lobby_state_2',
      subjectSlotKey: 'lobby_for_C',
      fieldKey: 'is_cpu',
      fieldFamily: 'closed_vocab',
      candidateValue: true,
      extractorFamily: 'closed_vocab',
      extractorVersion: 'test-v1',
    },
    {
      matchId,
      runId: f.runId,
      screenState: 'pre_game_lobby_state_2',
      subjectSlotKey: 'lobby_against_G',
      fieldKey: 'is_cpu',
      fieldFamily: 'closed_vocab',
      candidateValue: true,
      extractorFamily: 'closed_vocab',
      extractorVersion: 'test-v1',
    },
  ])

  // One gamertag evidence row for cross-team-dupe heuristic check
  // ("XZ4RKY" on both team sides within the same segment_id NULL bucket).
  await db.insert(ocrFieldEvidence).values([
    {
      matchId,
      runId: f.runId,
      screenState: 'pre_game_lobby_state_2',
      subjectSlotKey: 'lobby_for_C',
      fieldKey: 'gamertag',
      fieldFamily: 'open_text',
      candidateValue: 'XZ4RKY',
      extractorFamily: 'open_text',
      extractorVersion: 'test-v1',
    },
    {
      matchId,
      runId: f.runId,
      screenState: 'pre_game_lobby_state_2',
      subjectSlotKey: 'lobby_against_G',
      fieldKey: 'gamertag',
      fieldFamily: 'open_text',
      candidateValue: 'XZ4RKY',
      extractorFamily: 'open_text',
      extractorVersion: 'test-v1',
    },
  ])

  await db.insert(ocrPromotions).values({
    matchId,
    runId: f.runId,
    targetTable: 'player_loadout_snapshots',
    targetSemanticKey: { slot: 'bgm_RW' },
    fieldKey: 'build_class',
    promotionStatus: 'blocked_invariant',
    blockingReason: 'hard_fields_not_promoted',
  })

  const counters = await buildDefenseLayerCounters(f.runId)
  assert.equal(counters.is_cpu_demotions, 2)
  assert.equal(counters.is_cpu_or_demoted_combined, 2)
  assert.equal(
    counters.cross_team_dupes_segment_level_heuristic,
    1,
    'XZ4RKY on both sides should count once (segment-level heuristic)',
  )
  assert.equal(counters.hard_field_blocks, 1)
  assert.equal(counters.junk_gamertag_blocks_ts, 0)
  assert.equal(counters.junk_gamertag_blocks_python, null)
  assert.ok(counters.notes.length >= 1, 'expected at least one note')
})

void test('buildUnresolvedCounts: gamertag block + null persona + unresolved actor', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — run-quality integration tests require DB.')
    return
  }
  const matchId = 9204
  const f = await seedFixture(matchId)

  await db.insert(ocrPromotions).values({
    matchId,
    runId: f.runId,
    targetTable: 'player_loadout_snapshots',
    targetSemanticKey: { slot: 'bgm_C' },
    fieldKey: 'gamertag',
    promotionStatus: 'blocked_consensus',
    blockingReason: 'non_dominant_top',
  })

  await db.insert(playerLoadoutSnapshots).values({
    gamertagSnapshot: 'test-snap',
    teamSide: 'for',
    position: 'C',
    gameTitleId: GAME_TITLE_ID,
    matchId,
    ocrExtractionId: f.extractionId,
    reviewStatus: 'reviewed',
    playerNamePersona: null,
  })

  // One match_events row tied to this run's extraction with no actor binding.
  await db.insert(matchEvents).values({
    matchId,
    periodNumber: 1,
    periodLabel: '1st',
    eventType: 'shot',
    teamSide: 'for',
    actorGamertagSnapshot: 'unresolved-tag',
    source: 'ocr',
    ocrExtractionId: f.extractionId,
    reviewStatus: 'reviewed',
  })

  const counts = await buildUnresolvedCounts(f.runId)
  assert.equal(counts.gamertags, 1)
  assert.equal(counts.personas, 1)
  assert.equal(counts.actor_bindings_for_side, 1)
  assert.equal(counts.totals.all, 3)
})

void test('upsertRunQualityReport: insert, conflict throws, force updates', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — run-quality integration tests require DB.')
    return
  }
  const matchId = 9205
  const f = await seedFixture(matchId)

  const derived = {
    matchId,
    schemaVersion: 1,
    overallPass: false,
    l1Score: null,
    l2Score: 0.98,
    l2LineupScore: 0.97,
    l3Score: 0.99,
    totalWallMs: 12345,
    totalSegments: 25,
    totalDemoted: 2,
    totalUnresolved: 3,
  }
  const body = { hello: 'world', l1: { score: null } }

  // First insert succeeds.
  const id = await upsertRunQualityReport(f.runId, body, derived)
  assert.ok(id > 0, 'expected positive id from first insert')

  const [first] = await db
    .select({ generatedAt: ocrRunQualityReports.generatedAt, l2: ocrRunQualityReports.l2Score })
    .from(ocrRunQualityReports)
    .where(eq(ocrRunQualityReports.id, id))
  assert.ok(first, 'expected report row after insert')
  const firstGeneratedAt = first!.generatedAt

  // Second insert without force MUST throw a unique-constraint violation
  // (Postgres SQLSTATE 23505). Phase 3's CLI needs to distinguish a
  // "user-correctable conflict" (existing report → suggest --force) from
  // a generic DB failure, so we pin the error shape here rather than
  // accepting any thrown value. Drizzle wraps driver errors in
  // `DrizzleQueryError.cause`, so we walk the chain.
  let conflictErr: unknown = null
  try {
    await upsertRunQualityReport(f.runId, body, derived)
  } catch (e) {
    conflictErr = e
  }
  assert.ok(conflictErr, 'expected error on second insert without force')
  const codes: Array<string | undefined> = []
  const messages: string[] = []
  let cur: unknown = conflictErr
  for (let i = 0; i < 5 && cur && typeof cur === 'object'; i++) {
    const obj = cur as { code?: string; message?: string; cause?: unknown }
    codes.push(obj.code)
    if (obj.message) messages.push(obj.message)
    cur = obj.cause
  }
  const isUniqueViolation =
    codes.includes('23505') ||
    messages.some((m) =>
      /duplicate key value violates unique constraint/i.test(m),
    )
  assert.ok(
    isUniqueViolation,
    `expected unique-violation (code 23505); got codes=${JSON.stringify(codes)} messages=${JSON.stringify(messages)}`,
  )

  // Force-update path: same runId, new body + new score.
  await new Promise((resolve) => setTimeout(resolve, 50)) // ensure timestamp moves
  const updatedDerived = { ...derived, l2Score: 0.95 }
  const id2 = await upsertRunQualityReport(
    f.runId,
    { hello: 'world-2' },
    updatedDerived,
    { force: true },
  )
  assert.equal(id2, id, 'force path should return the same row id')

  const [second] = await db
    .select({
      generatedAt: ocrRunQualityReports.generatedAt,
      l2: ocrRunQualityReports.l2Score,
      body: ocrRunQualityReports.report,
    })
    .from(ocrRunQualityReports)
    .where(eq(ocrRunQualityReports.id, id))
  assert.ok(second, 'expected report row after force update')
  assert.ok(
    second!.generatedAt.getTime() > firstGeneratedAt.getTime(),
    `expected generated_at to advance (first=${firstGeneratedAt.toISOString()}, second=${second!.generatedAt.toISOString()})`,
  )
  assert.equal(Number(second!.l2), 0.95, 'l2 should reflect the force update')
  assert.deepEqual(second!.body, { hello: 'world-2' })
})

void test('buildUnresolvedCounts.personas does not leak across runs on the same match (Codex P2-1)', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — run-quality integration tests require DB.')
    return
  }
  // Seed two runs on the same match. runA owns one snapshot with persona=NULL;
  // runB owns one snapshot with persona=NULL as well. Pre-fix, scoping by
  // match_id only meant runA's count would also see runB's snapshot — leaking
  // 2 instead of 1. With the run-scoped join through ocr_extractions, runA's
  // personas count is 1 and runB's is 1.
  const matchId = 9216
  const a = await seedFixture(matchId)

  // Seed a second run + extraction on the SAME match.
  const [runB] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId,
      videoSha256: `sentinel-run-quality-${matchId}-runB-sha`,
      decoderVersion: 'hmm-viterbi-v1',
      weightsHash: 'sentinel-weights-runB',
      configHash: 'sentinel-config-runB',
      isActive: false,
      notes: `run-quality sentinel ${matchId} runB`,
    })
    .returning({ id: ocrDecoderRuns.id })
  assert.ok(runB)

  const [batchB] = await db
    .insert(ocrCaptureBatches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      matchId,
      runId: runB!.id,
      sourceDirectory: `test-sentinel-run-quality-${matchId}-runB-dir`,
      captureKind: 'manual_screenshots',
    })
    .returning({ id: ocrCaptureBatches.id })
  assert.ok(batchB)

  const [extractionB] = await db
    .insert(ocrExtractions)
    .values({
      batchId: batchB!.id,
      matchId,
      runId: runB!.id,
      screenType: 'player_loadout_view',
      sourcePath: `test-sentinel-run-quality-${matchId}-runB/seed.png`,
      sourceHash: `test-sentinel-run-quality-${matchId}-runB-hash`,
      rawResultJson: {},
      transformStatus: 'success',
      reviewStatus: 'reviewed',
      overallConfidence: '0.9000',
    })
    .returning({ id: ocrExtractions.id })
  assert.ok(extractionB)

  // One persona=NULL snapshot per run.
  await db.insert(playerLoadoutSnapshots).values([
    {
      gamertagSnapshot: 'runA-snap',
      teamSide: 'for',
      position: 'C',
      gameTitleId: GAME_TITLE_ID,
      matchId,
      ocrExtractionId: a.extractionId,
      reviewStatus: 'reviewed',
      playerNamePersona: null,
    },
    {
      gamertagSnapshot: 'runB-snap',
      teamSide: 'for',
      position: 'LW',
      gameTitleId: GAME_TITLE_ID,
      matchId,
      ocrExtractionId: extractionB!.id,
      reviewStatus: 'reviewed',
      playerNamePersona: null,
    },
  ])

  const countsA = await buildUnresolvedCounts(a.runId)
  const countsB = await buildUnresolvedCounts(runB!.id)
  assert.equal(countsA.personas, 1, 'runA should see exactly its own persona=NULL snapshot')
  assert.equal(countsB.personas, 1, 'runB should see exactly its own persona=NULL snapshot')
})

void test('countSegmentsByRun returns ocr_segments count for the run (Codex P3)', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — run-quality integration tests require DB.')
    return
  }
  // Seed N=2 ocr_segments rows + M=3 ocr_extractions rows for the same run.
  // The hot column must mirror the segment count, not the frame count.
  const matchId = 9217
  const f = await seedFixture(matchId)

  // Two extra extractions on top of the seedFixture's first one (M=3 total).
  await db.insert(ocrExtractions).values([
    {
      batchId: f.batchId,
      matchId,
      runId: f.runId,
      screenType: 'player_loadout_view',
      sourcePath: `test-sentinel-run-quality-${matchId}/seed-2.png`,
      rawResultJson: {},
      transformStatus: 'success',
      reviewStatus: 'reviewed',
      overallConfidence: '0.9000',
    },
    {
      batchId: f.batchId,
      matchId,
      runId: f.runId,
      screenType: 'player_loadout_view',
      sourcePath: `test-sentinel-run-quality-${matchId}/seed-3.png`,
      rawResultJson: {},
      transformStatus: 'success',
      reviewStatus: 'reviewed',
      overallConfidence: '0.9000',
    },
  ])

  // N=2 segments for this run.
  await db.insert(ocrSegments).values([
    {
      matchId,
      segmentKey: 'seg-001',
      state: 'pre_game_lobby_state_2',
      uiVersion: 'nhl26',
      decoderVersion: 'hmm-viterbi-v1',
      runId: f.runId,
    },
    {
      matchId,
      segmentKey: 'seg-002',
      state: 'post_game_box_score_goals',
      uiVersion: 'nhl26',
      decoderVersion: 'hmm-viterbi-v1',
      runId: f.runId,
    },
  ])

  const segments = await countSegmentsByRun(f.runId)
  assert.equal(segments, 2, 'expected exactly 2 segments for this run')

  const screenRows = await buildScreenTableByRun(f.runId)
  const frames = screenRows.reduce((acc, r) => acc + r.frames, 0)
  assert.equal(frames, 3, 'sanity: expected 3 ocr_extractions on the run (1 seed + 2 added)')
  assert.notEqual(segments, frames, 'frames and segments must be distinguishable for this test')
})
