/**
 * Task 2A-14: writeFieldEvidenceForBatch — DB integration tests.
 *
 * Verifies the per-segment DELETE-then-INSERT idempotency contract and
 * column round-trip for every field in LoadoutEvidenceRecord.
 *
 * Sentinel segments use decoder_version='2a14-test-v1' so cleanup
 * (delete by like-pattern) is precise and does not touch real data.
 *
 * Requires DATABASE_URL pointing at a DB where migrations for
 * ocr_field_evidence have run.
 *
 * Run via:
 *   pnpm --filter @eanhl/db build && pnpm --filter @eanhl/worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/loadout-evidence-write-path.test.js
 */

import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { db, sql, ocrCaptureBatches, ocrSegments, ocrFieldEvidence } from '@eanhl/db'
import { eq, like } from 'drizzle-orm'
import { writeFieldEvidenceForBatch, type LoadoutEvidenceRecord } from '../ingest-ocr.js'

// Match 250 is the canonical pilot match in this project.
const TEST_MATCH_ID = 250
// Game title 1 = NHL 26 (confirmed in game_titles table).
const TEST_GAME_TITLE_ID = 1
// Sentinel decoder version so cleanup cannot accidentally delete real rows.
const SENTINEL_DECODER_VERSION = '2a14-test-v1'
const SENTINEL_EXTRACTOR_VERSION = '2a14-test-v1'

// ── Helper factories ──────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<LoadoutEvidenceRecord> = {}): LoadoutEvidenceRecord {
  return {
    screen_state: 'player_loadout_view',
    field_key: 'build_class',
    field_family: 'closed_vocab',
    candidate_value: 'Playmaker',
    candidate_rank: 0,
    raw_confidence: 0.92,
    calibrated_confidence: 0.88,
    extractor_family: 'closed_vocab',
    extractor_version: SENTINEL_EXTRACTOR_VERSION,
    observability_status: 'observable',
    normalization_status: 'normalized',
    support_frame_ids: [100, 200],
    ...overrides,
  }
}

async function insertSentinelBatch(): Promise<number> {
  const [row] = await db
    .insert(ocrCaptureBatches)
    .values({
      gameTitleId: TEST_GAME_TITLE_ID,
      matchId: TEST_MATCH_ID,
      sourceDirectory: `/tmp/2a14-test-batch`,
      captureKind: 'manual_screenshots',
      notes: 'inserted by loadout-evidence-write-path.test.ts',
    })
    .returning({ id: ocrCaptureBatches.id })
  if (!row) throw new Error('Failed to insert sentinel batch')
  return row.id
}

async function insertSentinelSegment(batchId: number, segmentKey: string): Promise<number> {
  const [row] = await db
    .insert(ocrSegments)
    .values({
      matchId: TEST_MATCH_ID,
      segmentKey,
      state: 'player_loadout_view',
      frameCount: 5,
      uiVersion: 'nhl26',
      decoderVersion: SENTINEL_DECODER_VERSION,
      captureBatchId: batchId,
    })
    .returning({ id: ocrSegments.id })
  if (!row) throw new Error(`Failed to insert sentinel segment ${segmentKey}`)
  return row.id
}

async function cleanup(): Promise<void> {
  // FK order: field_evidence → segments → batches.
  await db
    .delete(ocrFieldEvidence)
    .where(like(ocrFieldEvidence.extractorVersion, `${SENTINEL_EXTRACTOR_VERSION}%`))
  await db
    .delete(ocrSegments)
    .where(like(ocrSegments.decoderVersion, `${SENTINEL_DECODER_VERSION}%`))
  await db
    .delete(ocrCaptureBatches)
    .where(like(ocrCaptureBatches.notes, '%loadout-evidence-write-path.test.ts%'))
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('writeFieldEvidenceForBatch', () => {
  let testBatchId: number
  let testSegmentId: number
  // Second segment for the isolation test.
  let testSegmentId2: number

  before(async () => {
    if (!process.env['DATABASE_URL']) return
    await cleanup()
    testBatchId = await insertSentinelBatch()
    testSegmentId = await insertSentinelSegment(testBatchId, '2a14-test-seg-A')
    testSegmentId2 = await insertSentinelSegment(testBatchId, '2a14-test-seg-B')
  })

  after(async () => {
    if (!process.env['DATABASE_URL']) return
    await cleanup()
    await sql.end()
  })

  test('writes one row per candidate', async () => {
    if (!process.env['DATABASE_URL']) return

    const records: LoadoutEvidenceRecord[] = [
      makeRecord({ field_key: 'build_class', candidate_rank: 0 }),
      makeRecord({ field_key: 'position', candidate_rank: 0 }),
      makeRecord({
        field_key: 'gamertag',
        field_family: 'open_text',
        extractor_family: 'open_text',
        candidate_rank: 0,
      }),
    ]

    const result = await writeFieldEvidenceForBatch({
      matchId: TEST_MATCH_ID,
      segmentId: testSegmentId,
      batchId: testBatchId,
      records,
    })

    assert.equal(result.insertedCount, 3, 'inserted 3 rows')
    assert.equal(result.deletedCount, 0, 'no prior rows to delete')

    const rows = await db
      .select()
      .from(ocrFieldEvidence)
      .where(eq(ocrFieldEvidence.segmentId, testSegmentId))
    assert.equal(rows.length, 3, '3 rows in DB')

    // Clean up so subsequent tests start fresh for this segment.
    await db.delete(ocrFieldEvidence).where(eq(ocrFieldEvidence.segmentId, testSegmentId))
  })

  test('idempotent on re-run with same extractor_version', async () => {
    if (!process.env['DATABASE_URL']) return

    const records: LoadoutEvidenceRecord[] = [
      makeRecord({ field_key: 'build_class', candidate_rank: 0 }),
      makeRecord({ field_key: 'build_class', candidate_rank: 1, candidate_value: 'Sniper' }),
      makeRecord({ field_key: 'position', candidate_rank: 0 }),
    ]

    // First write.
    const first = await writeFieldEvidenceForBatch({
      matchId: TEST_MATCH_ID,
      segmentId: testSegmentId,
      batchId: testBatchId,
      records,
    })
    assert.equal(first.insertedCount, 3)

    // Second write — same records, same extractor_version.
    const second = await writeFieldEvidenceForBatch({
      matchId: TEST_MATCH_ID,
      segmentId: testSegmentId,
      batchId: testBatchId,
      records,
    })
    assert.equal(second.insertedCount, 3, 'still 3 rows inserted on re-run')
    assert.equal(second.deletedCount, 3, '3 prior rows deleted (idempotent)')

    const rows = await db
      .select()
      .from(ocrFieldEvidence)
      .where(eq(ocrFieldEvidence.segmentId, testSegmentId))
    assert.equal(rows.length, 3, 'still 3 rows in DB — not 6')

    // Clean up.
    await db.delete(ocrFieldEvidence).where(eq(ocrFieldEvidence.segmentId, testSegmentId))
  })

  test('overwrites stale extractor_version rows for same segment', async () => {
    if (!process.env['DATABASE_URL']) return

    const v1Records: LoadoutEvidenceRecord[] = [
      makeRecord({ field_key: 'build_class', extractor_version: '2a14-test-v1' }),
      makeRecord({ field_key: 'position', extractor_version: '2a14-test-v1' }),
    ]

    // Insert v1 rows.
    const first = await writeFieldEvidenceForBatch({
      matchId: TEST_MATCH_ID,
      segmentId: testSegmentId,
      batchId: testBatchId,
      records: v1Records,
    })
    assert.equal(first.insertedCount, 2)

    // Re-ingest with v2 extractor_version.
    const v2Records: LoadoutEvidenceRecord[] = [
      makeRecord({
        field_key: 'build_class',
        extractor_version: '2a14-test-v2',
        candidate_value: 'Power Forward',
      }),
      makeRecord({
        field_key: 'position',
        extractor_version: '2a14-test-v2',
        candidate_value: 'LD',
      }),
      makeRecord({
        field_key: 'gamertag',
        extractor_version: '2a14-test-v2',
        field_family: 'open_text',
        extractor_family: 'open_text',
      }),
    ]

    const second = await writeFieldEvidenceForBatch({
      matchId: TEST_MATCH_ID,
      segmentId: testSegmentId,
      batchId: testBatchId,
      records: v2Records,
    })
    assert.equal(second.insertedCount, 3, '3 v2 rows inserted')
    assert.equal(second.deletedCount, 2, '2 v1 rows deleted')

    // Confirm only v2 rows remain.
    const rows = await db
      .select()
      .from(ocrFieldEvidence)
      .where(eq(ocrFieldEvidence.segmentId, testSegmentId))
    assert.equal(rows.length, 3, 'exactly 3 rows (v2 only)')
    for (const row of rows) {
      assert.equal(row.extractorVersion, '2a14-test-v2', 'all rows are v2')
    }

    // Clean up.
    await db.delete(ocrFieldEvidence).where(eq(ocrFieldEvidence.segmentId, testSegmentId))
  })

  test('supports array of support_frame_ids', async () => {
    if (!process.env['DATABASE_URL']) return

    const frameIds = [100, 200, 300, 400, 500]
    const records: LoadoutEvidenceRecord[] = [
      makeRecord({ field_key: 'build_class', support_frame_ids: frameIds }),
    ]

    await writeFieldEvidenceForBatch({
      matchId: TEST_MATCH_ID,
      segmentId: testSegmentId,
      batchId: testBatchId,
      records,
    })

    const rows = await db
      .select()
      .from(ocrFieldEvidence)
      .where(eq(ocrFieldEvidence.segmentId, testSegmentId))
    assert.equal(rows.length, 1)
    assert.deepEqual(rows[0]!.supportFrameIds, frameIds, 'support_frame_ids round-trip matches')

    // Clean up.
    await db.delete(ocrFieldEvidence).where(eq(ocrFieldEvidence.segmentId, testSegmentId))
  })

  test('records observability_status per slot', async () => {
    if (!process.env['DATABASE_URL']) return

    const statuses = [
      'observable',
      'not_observable_from_source',
      'obstructed',
      'low_quality',
    ] as const

    const records: LoadoutEvidenceRecord[] = statuses.map((status, i) =>
      makeRecord({
        field_key: `obs_test_field_${i}`,
        subject_slot_key: `slot_${i}`,
        observability_status: status,
        normalization_status: status === 'not_observable_from_source' ? 'failed' : 'normalized',
      }),
    )

    await writeFieldEvidenceForBatch({
      matchId: TEST_MATCH_ID,
      segmentId: testSegmentId,
      batchId: testBatchId,
      records,
    })

    const rows = await db
      .select()
      .from(ocrFieldEvidence)
      .where(eq(ocrFieldEvidence.segmentId, testSegmentId))
    assert.equal(rows.length, statuses.length, `${String(statuses.length)} rows inserted`)

    const sortedRows = [...rows].sort((a, b) => (a.fieldKey > b.fieldKey ? 1 : -1))
    for (let i = 0; i < statuses.length; i++) {
      assert.equal(
        sortedRows[i]!.observabilityStatus,
        statuses[i],
        `slot ${i} observability_status stored correctly`,
      )
    }

    // Clean up.
    await db.delete(ocrFieldEvidence).where(eq(ocrFieldEvidence.segmentId, testSegmentId))
  })

  test('two segments for same match do not overwrite each other', async () => {
    if (!process.env['DATABASE_URL']) return

    const recordsA: LoadoutEvidenceRecord[] = [
      makeRecord({ field_key: 'build_class', subject_slot_key: 'slot_A_0' }),
      makeRecord({ field_key: 'position', subject_slot_key: 'slot_A_0' }),
      makeRecord({
        field_key: 'gamertag',
        subject_slot_key: 'slot_A_0',
        field_family: 'open_text',
        extractor_family: 'open_text',
      }),
    ]

    const recordsB: LoadoutEvidenceRecord[] = [
      makeRecord({
        field_key: 'build_class',
        subject_slot_key: 'slot_B_0',
        candidate_value: 'Grinder',
      }),
      makeRecord({ field_key: 'position', subject_slot_key: 'slot_B_0', candidate_value: 'RW' }),
      makeRecord({
        field_key: 'gamertag',
        subject_slot_key: 'slot_B_0',
        field_family: 'open_text',
        extractor_family: 'open_text',
        candidate_value: 'PlayerB',
      }),
    ]

    // Write 3 records to segment A.
    const resultA = await writeFieldEvidenceForBatch({
      matchId: TEST_MATCH_ID,
      segmentId: testSegmentId,
      batchId: testBatchId,
      records: recordsA,
    })
    assert.equal(resultA.insertedCount, 3)

    // Write 3 records to segment B (same matchId, different segmentId).
    const resultB = await writeFieldEvidenceForBatch({
      matchId: TEST_MATCH_ID,
      segmentId: testSegmentId2,
      batchId: testBatchId,
      records: recordsB,
    })
    assert.equal(resultB.insertedCount, 3)
    assert.equal(resultB.deletedCount, 0, 'segment B write did not delete segment A rows')

    // Verify segment A still has its own 3 rows.
    const rowsA = await db
      .select()
      .from(ocrFieldEvidence)
      .where(eq(ocrFieldEvidence.segmentId, testSegmentId))
    assert.equal(rowsA.length, 3, 'segment A has 3 rows')

    // Verify segment B also has 3 rows.
    const rowsB = await db
      .select()
      .from(ocrFieldEvidence)
      .where(eq(ocrFieldEvidence.segmentId, testSegmentId2))
    assert.equal(rowsB.length, 3, 'segment B has 3 rows')

    // Clean up both segments.
    await db.delete(ocrFieldEvidence).where(eq(ocrFieldEvidence.segmentId, testSegmentId))
    await db.delete(ocrFieldEvidence).where(eq(ocrFieldEvidence.segmentId, testSegmentId2))
  })
})
